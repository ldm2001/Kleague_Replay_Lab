from __future__ import annotations

import os
import json
import hashlib
import base64
import stat
import tempfile
import threading
import time
import logging
import re
from pathlib import Path
from typing import Callable, Mapping, Protocol
from .http import Api, HttpError
from .worker import job

logger = logging.getLogger(__name__)


class PulseStopped(RuntimeError):
    # Lease를 더 이상 확인할 수 없어 작업을 중단한다
    pass

# Worker API 계약
class WorkerApi(Protocol):
    def claim(self, kind: str) -> dict[str, object] | None: ...
    def media(self, url: str, target: Path) -> None: ...
    def progress(
        self,
        item: dict[str, object],
        stage: str,
        percent: int,
        message: str | None = None,
    ) -> dict[str, object] | None: ...
    def result(self, item: dict[str, object], payload: dict[str, object]) -> dict[str, object] | None: ...
    def evidence(self, item: dict[str, object], entries: list[dict[str, object]]) -> dict[str, object] | None: ...
    def put(
        self,
        url: str,
        source: Path,
        content_type: str,
        headers: Mapping[str, str] | None = None,
    ) -> None: ...


MAX_GRANT_ITEMS = 128
MAX_MEDIA_BYTES = 50 * 1024 * 1024
MAX_DIAGNOSTIC_BYTES = 128 * 1024 * 1024
MAX_GRANT_BYTES = 200 * 1024 * 1024
LOCAL_OBSERVER_PIPELINE_VERSION = "video-local-observers-v1"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


# 큰 산출물을 메모리에 올리지 않고 해시한다
def file_hash(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


# 작업 결과 폴더 안의 일반 파일만 선택한다
def local_file(root: Path, value: object, error: str) -> Path:
    if not isinstance(value, str) or not value:
        raise RuntimeError(error)
    relative = Path(value)
    if relative.is_absolute():
        raise RuntimeError(error)
    base = root.resolve()
    try:
        path = (base / relative).resolve(strict=True)
        mode = path.stat().st_mode
    except OSError as cause:
        raise RuntimeError(error) from cause
    if not path.is_relative_to(base) or not stat.S_ISREG(mode):
        raise RuntimeError(error)
    return path


# 권한 응답을 요청 이름별로 완전하게 대조한다
def grant_map(response: object, names: list[str], error: str) -> dict[str, dict[str, object]]:
    if not isinstance(response, dict) or response.get("kind") != "GRANTED" or not isinstance(response.get("items"), list):
        raise RuntimeError(error)
    items = response["items"]
    if len(items) != len(names):
        raise RuntimeError(error)
    result: dict[str, dict[str, object]] = {}
    for grant in items:
        if not isinstance(grant, dict):
            raise RuntimeError(error)
        name = grant.get("name")
        if not isinstance(name, str) or name not in names or name in result:
            raise RuntimeError(error)
        upload_url, object_key = grant.get("uploadUrl"), grant.get("objectKey")
        if not isinstance(upload_url, str) or not upload_url or not isinstance(object_key, str) or not object_key:
            raise RuntimeError(error)
        result[name] = grant
    if set(result) != set(names):
        raise RuntimeError(error)
    return result


# 증거 권한 자체가 사라진 경우에는 일반 처리 실패를 제출하지 않는다
def evidence_grants(
    api: WorkerApi,
    item: dict[str, object],
    requests: list[dict[str, object]],
    error: str,
) -> dict[str, dict[str, object]]:
    try:
        response = api.evidence(item, requests)
    except HttpError as cause:
        if str(cause) in {"http-404", "http-409"}:
            raise PulseStopped("WORKER_LEASE_LOST") from cause
        raise
    if isinstance(response, dict) and response.get("kind") in {
            "NOT_FOUND", "STALE_LEASE", "ALREADY_FINISHED"}:
        raise PulseStopped("WORKER_LEASE_LOST")
    return grant_map(response, [str(request["name"]) for request in requests], error)

# 작업 Lease 갱신
class Pulse:
    def __init__(self, api: WorkerApi, item: dict[str, object], stage: str, interval: float = 10.0) -> None:
        # API와 작업 정보 저장
        self.api = api
        self.item = item
        self.stage = stage
        self.percent = 10
        self.interval = interval
        self.stop = threading.Event()
        self.state_lock = threading.Lock()
        self.request_lock = threading.Lock()
        self.failure: str | None = None
        self.confirmed = False
        self.accepted = False
        self.thread = threading.Thread(target=self.beat, daemon=True)

    # 갱신 실패를 Lease 상실과 연결 실패로 구분해 보관한다
    def failed(self, error: object, code: str = "WORKER_HEARTBEAT_FAILED") -> None:
        terminal = (isinstance(error, HttpError) and str(error) in {"http-404", "http-409"}) or (
            isinstance(error, dict) and error.get("kind") in {"NOT_FOUND", "STALE_LEASE", "ALREADY_FINISHED"}
        )
        with self.state_lock:
            if self.accepted or self.failure is not None:
                return
            self.failure = "WORKER_LEASE_LOST" if terminal else code
            self.confirmed = False
            self.stop.set()

    # 진행 응답이 실제 Lease 갱신인지 확인한다
    def renew_request(self, stage: str, percent: int, message: str | None) -> None:
        with self.state_lock:
            if self.accepted or self.failure is not None or (
                    message == "worker-heartbeat" and self.stop.is_set()):
                return
        try:
            response = self.api.progress(self.item, stage, percent, message)
        except Exception as error:
            terminal = isinstance(error, HttpError) and str(error) in {"http-404", "http-409"}
            with self.state_lock:
                if self.accepted or self.failure is not None:
                    return
                self.failure = "WORKER_LEASE_LOST" if terminal else "WORKER_HEARTBEAT_FAILED"
                self.confirmed = False
                self.stop.set()
            logger.warning("heartbeat-failed type=%s", type(error).__name__)
            return
        with self.state_lock:
            if self.accepted or self.failure is not None:
                return
            if not isinstance(response, dict) or response.get("kind") != "UPDATED":
                terminal = isinstance(response, dict) and response.get("kind") in {
                    "NOT_FOUND", "STALE_LEASE", "ALREADY_FINISHED",
                }
                self.failure = "WORKER_LEASE_LOST" if terminal else "WORKER_HEARTBEAT_FAILED"
                self.confirmed = False
                self.stop.set()
                return
            self.confirmed = True

    # 갱신 요청의 서버 저장 순서를 직렬화한다
    def renew(self, stage: str, percent: int, message: str | None) -> None:
        with self.request_lock:
            self.renew_request(stage, percent, message)

    # 처리 경계에서 background heartbeat 실패를 전달한다
    def check(self) -> None:
        with self.state_lock:
            failure = self.failure
        if failure is not None:
            raise PulseStopped(failure)

    # 실패 결과를 보낼 수 있는 확인된 Lease인지 조회한다
    def owns_lease(self) -> bool:
        with self.state_lock:
            return self.confirmed and self.failure is None and not self.accepted

    # 최신 진행 상태 보고
    def progress(self, stage: str, percent: int, message: str | None = None) -> None:
        # heartbeat와 단계 보고의 요청 완료 순서를 별도 잠금으로 보장한다
        with self.request_lock:
            with self.state_lock:
                self.stage = stage
                self.percent = percent
            self.renew_request(stage, percent, message)
        self.check()

    # 갱신 반복
    def beat(self) -> None:
        while not self.stop.wait(self.interval):
            with self.request_lock:
                with self.state_lock:
                    stage, percent = self.stage, self.percent
                self.renew_request(stage, percent, "worker-heartbeat")

    # 갱신 시작
    def __enter__(self) -> Pulse:
        self.renew(self.stage, 10, "worker-started")
        self.check()
        self.thread.start()
        return self

    # heartbeat와 잠금을 공유하지 않고 최종 결과를 제출한다
    def submit(self, payload: dict[str, object]) -> None:
        self.check()
        try:
            response = self.api.result(self.item, payload)
        except Exception as error:
            self.failed(error, "WORKER_RESULT_FAILED")
            self.check()
            raise
        if not isinstance(response, dict) or response.get("kind") not in {"ACCEPTED", "ALREADY_FINISHED"}:
            self.failed(response, "WORKER_RESULT_FAILED")
            self.check()
        # 서버가 결과를 수락했다면 동시에 끝난 heartbeat의 409보다 최종 결과가 우선한다
        with self.state_lock:
            self.accepted = True
            self.confirmed = False
            self.failure = None
            self.stop.set()

    # 갱신 종료
    def __exit__(self, *_args: object) -> None:
        self.stop.set()
        self.thread.join(timeout=1)

# 증거 파일 업로드
def artifacts(
    api: WorkerApi,
    item: dict[str, object],
    root: Path,
    entries: list[dict[str, object]],
    check_cancelled: Callable[[], None] | None = None,
) -> list[dict[str, object]]:
    # 모든 입력을 먼저 검증해 일부 파일만 업로드되는 일을 막는다
    files: list[tuple[Path, str, dict[str, object], int, str]] = []
    names: set[str] = set()
    # 증거 입력 순회
    for entry in entries:
        # 작업 폴더 안의 경로 확인
        path = local_file(root, entry.get("path"), "evidence-path-invalid")
        suffix = path.suffix.lower()
        if suffix in {".jpg", ".jpeg"}:
            content_type, expected_kind = "image/jpeg", "FRAME"
        elif suffix == ".mp4":
            content_type, expected_kind = "video/mp4", "CLIP"
        else:
            raise RuntimeError("evidence-type-invalid")
        if entry.get("kind") != expected_kind:
            raise RuntimeError("evidence-kind-invalid")
        if path.name in names:
            raise RuntimeError("evidence-name-duplicate")
        names.add(path.name)
        size = path.stat().st_size
        if size <= 0 or size > MAX_MEDIA_BYTES:
            raise RuntimeError("evidence-size-invalid")
        files.append((path, content_type, entry, size, file_hash(path)))
    if not files:
        # 증거가 없으면 빈 결과 반환
        return []
    result: list[dict[str, object]] = []
    # 서버 제한 안에서 순서를 보존한 권한 묶음을 만든다
    batches: list[list[tuple[Path, str, dict[str, object], int, str]]] = []
    batch: list[tuple[Path, str, dict[str, object], int, str]] = []
    total = 0
    for source in files:
        if batch and (len(batch) == MAX_GRANT_ITEMS or total + source[3] > MAX_GRANT_BYTES):
            batches.append(batch)
            batch, total = [], 0
        batch.append(source)
        total += source[3]
    if batch:
        batches.append(batch)
    for batch in batches:
        if check_cancelled:
            check_cancelled()
        requests = [{"name": path.name, "contentType": content_type, "sizeBytes": size}
                    for path, content_type, _entry, size, _sha256 in batch]
        granted = evidence_grants(api, item, requests, "evidence-grant-invalid")
        if any(granted[path.name].get("headers") not in (None, {})
               for path, _content_type, _entry, _size, _sha256 in batch):
            raise RuntimeError("evidence-grant-invalid")
        for path, content_type, entry, _size, sha256 in batch:
            grant = granted[path.name]
            if check_cancelled:
                check_cancelled()
            api.put(str(grant["uploadUrl"]), path, content_type)
            result.append({
                "candidateIndex": entry["candidate_index"],
                "kind": entry["kind"],
                "objectKey": grant["objectKey"],
                "contentSha256": sha256,
                "startMs": entry["start_ms"],
                "endMs": entry["end_ms"],
                "width": None,
                "height": None,
            })
    return result


# 로컬 관측 진단 파일을 체크섬과 불변 조건이 묶인 권한으로 업로드한다
def perception_artifact(
    api: WorkerApi,
    item: dict[str, object],
    root: Path,
    value: object,
    check_cancelled: Callable[[], None] | None = None,
) -> dict[str, object]:
    if not isinstance(value, dict):
        raise RuntimeError("perception-invalid")
    forbidden = {"observations", "poses", "interactions", "links", "hypotheses", "rawHypotheses"}
    if set(value) & forbidden:
        raise RuntimeError("perception-raw-data-invalid")
    required = {"schemaVersion", "sourceSha256", "processingStatus", "coverage", "models",
                "artifact", "summary", "incidents"}
    if set(value) != required or not isinstance(value.get("artifact"), dict):
        raise RuntimeError("perception-invalid")
    local = value["artifact"]
    assert isinstance(local, dict)
    if set(local) != {"path", "contentType", "contentSha256", "sizeBytes"}:
        raise RuntimeError("perception-artifact-invalid")
    if not isinstance(local.get("path"), str) or not local["path"]:
        raise RuntimeError("perception-path-invalid")
    path = local_file(root, local.get("path"), "perception-path-invalid")
    size = path.stat().st_size
    if (path.name.endswith(".jsonl.gz") is False or local.get("contentType") != "application/gzip" or
            not isinstance(local.get("sizeBytes"), int) or isinstance(local.get("sizeBytes"), bool) or
            local.get("sizeBytes") != size or
            size <= 0 or size > MAX_DIAGNOSTIC_BYTES):
        raise RuntimeError("perception-artifact-invalid")
    sha256 = file_hash(path)
    if not isinstance(local.get("contentSha256"), str) or local.get("contentSha256") != sha256:
        raise RuntimeError("perception-artifact-invalid")
    analysis_id, job_id, revision = item.get("analysisId"), item.get("jobId"), item.get("jobRevision")
    if (not isinstance(analysis_id, str) or UUID.fullmatch(analysis_id) is None or
            not isinstance(job_id, str) or UUID.fullmatch(job_id) is None or
            not isinstance(revision, int) or isinstance(revision, bool) or revision < 1):
        raise RuntimeError("perception-grant-invalid")
    if check_cancelled:
        check_cancelled()
    request = {"name": path.name, "contentType": "application/gzip", "sizeBytes": size,
               "contentSha256": sha256}
    granted = evidence_grants(api, item, [request], "perception-grant-invalid")
    grant = granted[path.name]
    expected_key = f"perception/{analysis_id}/{job_id}/{revision}/{sha256}.jsonl.gz"
    if grant["objectKey"] != expected_key:
        raise RuntimeError("perception-grant-invalid")
    raw_headers = grant.get("headers")
    if not isinstance(raw_headers, dict):
        raise RuntimeError("perception-grant-invalid")
    headers = {str(key).lower(): value for key, value in raw_headers.items()}
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    if (len(headers) != len(raw_headers) or headers != {
            "x-amz-checksum-sha256": checksum, "if-none-match": "*"}):
        raise RuntimeError("perception-grant-invalid")
    if check_cancelled:
        check_cancelled()
    api.put(str(grant["uploadUrl"]), path, "application/gzip", headers)
    result = dict(value)
    result["artifact"] = {"objectKey": grant["objectKey"], "contentType": "application/gzip",
                          "contentSha256": sha256, "sizeBytes": size}
    return result

# 파이프라인 보고서 변환
def report(
    api: WorkerApi,
    item: dict[str, object],
    path: Path,
    check_cancelled: Callable[[], None] | None = None,
) -> dict[str, object]:
    # 파이프라인 보고서 읽기
    value = json.loads(path.read_text(encoding="utf-8"))
    # 샷 결과 API 형식 변환
    shots = [{
        "index": item["index"],
        "startMs": item["start_ms"],
        "endMs": item["end_ms"],
        "playbackSpeed": item["playback_speed"],
        "isReplay": item["is_replay"],
        "cameraAngle": item["camera_angle"],
    } for item in value["shots"]]
    # 후보 결과 API 형식 변환
    candidates = [{
        "index": item["index"],
        "category": item["category"],
        "startMs": item["start_ms"],
        "endMs": item["end_ms"],
        "anchorMs": item["anchor_ms"],
        "confidence": item["confidence"],
        "cameraSufficiency": item["camera_sufficiency"],
        "reasons": item["reasons"],
        "shotIndices": item["shot_indices"],
        "tracking": item.get("tracking"),
        "sceneEvent": item.get("scene_event"),
        "broadcastCue": item.get("broadcast_cue"),
    } for item in value["candidates"]]
    perception = value.get("perception")
    if value["pipeline_version"] == LOCAL_OBSERVER_PIPELINE_VERSION and perception is None:
        raise RuntimeError("perception-required")
    evidence = artifacts(api, item, path.parent, value["evidence"], check_cancelled)
    uploaded_perception = (perception_artifact(api, item, path.parent, perception, check_cancelled)
                           if perception is not None else None)
    # 분석 결과와 증거 업로드 정보 반환
    result = {
        "kind": "ANALYZED",
        "pipelineVersion": value["pipeline_version"],
        "limitations": value["limitations"],
        "shots": shots,
        "candidates": candidates,
        "evidence": evidence,
    }
    if uploaded_perception is not None:
        result["perception"] = uploaded_perception
    return result

# 작업 한 건 처리
def cycle(api: WorkerApi, kind: str, root: Path) -> bool:
    # 처리할 작업 선점
    item = api.claim(kind)
    if item is None:
        return False
    root.mkdir(parents=True, exist_ok=True)
    pulse: Pulse | None = None
    try:
        # 작업별 임시 폴더 생성
        with tempfile.TemporaryDirectory(prefix="replay-", dir=root) as directory:
            work = Path(directory)
            source = work / "source.mp4"
            output = work / "result"
            stage = "VALIDATING" if kind == "VALIDATE_VIDEO" else "SEGMENTING"
            # Lease 갱신과 작업 실행
            pulse = Pulse(api, item, stage)
            with pulse:
                try:
                    source_url = item.get("sourceUrl")
                    # 원본 주소 확인
                    if not isinstance(source_url, str) or not source_url:
                        raise ValueError("source-url-invalid")
                    # 원본 영상 다운로드
                    api.media(source_url, source)
                    pulse.check()
                    # 로컬 파이프라인 실행
                    local = job({
                        "job_id": item.get("jobId"),
                        "job_type": item.get("jobType"),
                        "source_path": str(source),
                        "output_path": str(output),
                    }, progress=pulse.progress, check_cancelled=pulse.check)
                    pulse.check()
                    # 검증 결과 API payload 변환
                    if local.payload.get("kind") == "VALIDATED":
                        payload = {
                            "kind": "VALIDATED",
                            "durationMs": local.payload["duration_ms"],
                            "width": local.payload["width"],
                            "height": local.payload["height"],
                        }
                    else:
                        # 분석 보고서 API payload 변환
                        payload = report(api, item, Path(str(local.payload["report_path"])), pulse.check)
                    pulse.check()
                    pulse.submit(payload)
                except PulseStopped:
                    raise
                except Exception:
                    # 확인된 Lease에서만 실패 결과를 보내고 그동안 heartbeat를 유지한다
                    if not pulse.owns_lease():
                        pulse.check()
                        raise
                    pulse.submit({"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False})
            # 작업 완료 반환
            return True
    except PulseStopped as error:
        # Lease 상실 또는 확인 실패 뒤에는 성공이나 실패 결과를 제출하지 않는다
        logger.warning("worker-stopped code=%s", error)
        return True
    except Exception:
        # 처리 실패 결과 전송
        if pulse is None:
            try:
                api.result(item, {"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False})
            except Exception:
                # 실패 결과 전송 오류 무시
                pass
        # 작업은 처리되었으므로 다음 작업 진행
        return True

# Worker 반복 실행
def loop(api: WorkerApi, root: Path, delay: float) -> None:
    while True:
        # 한 종류의 작업 조회 실패가 전체 워커를 중단하지 않도록 격리
        worked = False
        failure = False
        for kind in ("VALIDATE_VIDEO", "ANALYZE_VIDEO"):
            try:
                worked = cycle(api, kind, root) or worked
            except Exception as error:
                logger.warning("claim-failed job=%s type=%s", kind, type(error).__name__)
                failure = True
        # 작업이 없거나 실패하면 폴링 지연
        # 실패 반복 중 요청 과열 방지
        if failure or not worked:
            time.sleep(delay)

# 환경값 조회
def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name}-required")
    return value

# Worker 진입점
def main() -> None:
    api = Api(
        env("INTERNAL_API_BASE_URL"),
        env("WORKER_AUTH_TOKEN"),
        os.environ.get("WORKER_ID", "video-worker-1"),
    )
    root = Path(os.environ.get("WORKER_TEMP_DIR", "/tmp/replay-lab-worker"))
    delay = max(0.1, float(os.environ.get("WORKER_POLL_MS", "1000")) / 1000)
    loop(api, root, delay)

if __name__ == "__main__":
    main()

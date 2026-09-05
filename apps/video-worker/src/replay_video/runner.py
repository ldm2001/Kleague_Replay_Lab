from __future__ import annotations

import os
import json
import hashlib
import tempfile
import threading
import time
import logging
from pathlib import Path
from typing import Protocol

from .http import Api
from .worker import job

# 오류 종류만 기록해 재시도와 종료 원인 추적
logger = logging.getLogger(__name__)


class WorkerApi(Protocol):
    # Worker API 계약
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
    def put(self, url: str, source: Path, content_type: str) -> None: ...


class Pulse:
    # 작업 Lease 갱신
    def __init__(self, api: WorkerApi, item: dict[str, object], stage: str, interval: float = 10.0) -> None:
        # API와 작업 정보 저장
        self.api = api
        self.item = item
        self.stage = stage
        self.percent = 10
        self.interval = interval
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self.beat, daemon=True)

    # 최신 진행 상태 보고
    def progress(self, stage: str, percent: int, message: str | None = None) -> None:
        with self.lock:
            self.stage = stage
            self.percent = percent
            # heartbeat와 단계 보고의 요청 완료 순서를 동일 잠금으로 보장
            try:
                self.api.progress(self.item, stage, percent, message)
            except Exception as error:
                logger.warning("progress-failed type=%s", type(error).__name__)

    # 갱신 반복
    def beat(self) -> None:
        while not self.stop.wait(self.interval):
            with self.lock:
                try:
                    self.api.progress(self.item, self.stage, self.percent, "worker-heartbeat")
                except Exception as error:
                    logger.warning("heartbeat-failed type=%s", type(error).__name__)
                    self.stop.set()

    # 갱신 시작
    def __enter__(self) -> Pulse:
        self.api.progress(self.item, self.stage, 10, "worker-started")
        self.thread.start()
        return self

    # 갱신 종료
    def __exit__(self, *_args: object) -> None:
        self.stop.set()
        self.thread.join(timeout=1)


# 증거 파일 업로드
def artifacts(api: WorkerApi, item: dict[str, object], root: Path, entries: list[dict[str, object]]) -> list[dict[str, object]]:
    # 증거 권한 요청 목록 초기화
    requests: list[dict[str, object]] = []
    # 파일 이름별 원본 정보 초기화
    files: dict[str, tuple[Path, str, dict[str, object]]] = {}
    # 증거 입력 순회
    for entry in entries:
        # 작업 폴더 안의 경로 확인
        path = (root / str(entry["path"])).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise RuntimeError("evidence-path-invalid")
        content_type = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "video/mp4"
        # 업로드 권한 항목 구성
        requests.append({"name": path.name, "contentType": content_type, "sizeBytes": path.stat().st_size})
        # 이름으로 원본 조회 등록
        files[path.name] = (path, content_type, entry)
    if not requests:
        # 증거가 없으면 빈 결과 반환
        return []
    # 증거 업로드 권한 요청
    response = api.evidence(item, requests)
    if not response or response.get("kind") != "GRANTED" or not isinstance(response.get("items"), list):
        raise RuntimeError("evidence-grant-invalid")
    result: list[dict[str, object]] = []
    # 발급된 권한별 파일 업로드
    for grant in response["items"]:
        if not isinstance(grant, dict):
            raise RuntimeError("evidence-grant-invalid")
        name = str(grant.get("name", ""))
        source = files.get(name)
        if source is None:
            raise RuntimeError("evidence-grant-invalid")
        path, content_type, entry = source
        # 업로드 URL과 객체 키 확인
        upload_url = grant.get("uploadUrl")
        object_key = grant.get("objectKey")
        if not isinstance(upload_url, str) or not isinstance(object_key, str):
            raise RuntimeError("evidence-grant-invalid")
        api.put(upload_url, path, content_type)
        # 저장된 증거 메타데이터 구성
        result.append({
            "candidateIndex": entry["candidate_index"],
            "kind": entry["kind"],
            "objectKey": object_key,
            "contentSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "startMs": entry["start_ms"],
            "endMs": entry["end_ms"],
            "width": None,
            "height": None,
        })
    return result


# 파이프라인 보고서 변환
def report(api: WorkerApi, item: dict[str, object], path: Path) -> dict[str, object]:
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
    } for item in value["candidates"]]
    # 분석 결과와 증거 업로드 정보 반환
    return {
        "kind": "ANALYZED",
        "pipelineVersion": value["pipeline_version"],
        "limitations": value["limitations"],
        "shots": shots,
        "candidates": candidates,
        "evidence": artifacts(api, item, path.parent, value["evidence"]),
    }


# 작업 한 건 처리
def cycle(api: WorkerApi, kind: str, root: Path) -> bool:
    # 처리할 작업 선점
    item = api.claim(kind)
    if item is None:
        return False
    root.mkdir(parents=True, exist_ok=True)
    try:
        # 작업별 임시 폴더 생성
        with tempfile.TemporaryDirectory(prefix="replay-", dir=root) as directory:
            work = Path(directory)
            source = work / "source.mp4"
            source_url = item.get("sourceUrl")
            # 원본 주소 확인
            if not isinstance(source_url, str) or not source_url:
                raise ValueError("source-url-invalid")
            output = work / "result"
            stage = "VALIDATING" if kind == "VALIDATE_VIDEO" else "SEGMENTING"
            # Lease 갱신과 작업 실행
            with Pulse(api, item, stage) as pulse:
                # 원본 영상 다운로드
                api.media(source_url, source)
                # 로컬 파이프라인 실행
                local = job({
                    "job_id": item.get("jobId"),
                    "job_type": item.get("jobType"),
                    "source_path": str(source),
                    "output_path": str(output),
                }, progress=pulse.progress)
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
                    payload = report(api, item, Path(str(local.payload["report_path"])))
                    pulse.progress("APPLYING_RULES", 95, "facts-required")
            api.result(item, payload)
            # 작업 완료 반환
            return True
    except Exception:
        # 처리 실패 결과 전송
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

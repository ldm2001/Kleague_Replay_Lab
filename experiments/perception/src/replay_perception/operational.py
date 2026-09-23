from __future__ import annotations
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
from typing import Any, Callable
from .continuity import AppearanceContinuity
from .artifact import DiagnosticArtifact
from .incidents import IncidentLinker, InteractionTracker
from .inspection import Detector, failureReason, fingerprint, versions
from .media import VideoReader
from .observer import PoseModel, RoleModel
from .observations import PoseObservation
from .objects import OfficialObserver
from .frames import RecordedFrame
from .matching import assignments
from .tracking import TrackAssociator


# 시각 전용 로컬 관측 실행 판본 정의
PIPELINE_VERSION = "video-local-observers-v1"
# 시각 관측 요약 자료 계약의 판본 정의
SCHEMA_VERSION = "perception-run-v1"
# 원본 화면을 읽을 밀리초 표본 간격 정의
SAMPLE_INTERVAL_MS = 100
# 한 관측 실행의 전체 시간 상한 정의
MAX_RUNTIME_SECONDS = 1800
# 원본 관측의 최대 처리 표본 수 정의
MAX_PROCESSED_FRAMES = 30_000
# 한 화면에서 자세를 추정할 최대 사람 수 정의
MAX_PEOPLE_PER_FRAME = 64
# 종류별 전송 요약에 보존할 사건 수 상한 정의
MAX_RETAINED_EPISODES = 128
# 고유 사건 식별자를 기억할 전체 색인 크기 상한 정의
MAX_INDEXED_EPISODES = 30_000
# 전송 요약에 보존할 음향 단서 수 상한 정의
MAX_RETAINED_AUDIO_CUES = 256


@dataclass(frozen=True, slots=True)
class ObserverModels:
    # 사람·공 검출을 담당할 로컬 모델 계약
    detector: Detector
    # 선수·심판 역할 가설을 관측할 로컬 모델 계약
    role: RoleModel
    # 검출 영역에서 관절 좌표를 관측할 로컬 모델 계약
    pose: PoseModel

# 파일을 읽어 원본 대조용 해시 계산
def fileDigest(path: Path) -> str:
    # 내용 해시 대조를 위해 파일을 바이트 스트림으로 열기
    with path.open("rb") as stream:
        # 파일의 실제 바이트에서 계산한 내용 해시 반환
        return hashlib.file_digest(stream, "sha256").hexdigest()

# 사용한 세 모델의 식별자·판본·가중치 해시 기록
def modelRecords(models: ObserverModels) -> list[dict[str, str]]:
    # 검증된 모델 출처 목록 생성
    result = []
    # 승인된 검출·역할·자세 모델과 대응 가중치 파일 순회
    for component, model, filename in (
        ("detector", models.detector, "model.safetensors"),
        ("role", models.role, "yolo-football-player-detection.pt"),
        ("pose", models.pose, "model.safetensors"),
    ):
        # 현재 모델이 제공하는 고정 가중치 출처 읽음
        data = model.provenance
        # 모델 이름과 고정 판본 읽음
        model_id, revision = data.get("model_id"), data.get("revision")
        # 해당 모델 가중치 파일의 내용 해시 읽음
        weights = data.get("files", {}).get(filename)
        # 모델 이름·판본·가중치 해시가 출처 계약을 만족하는지 확인
        if (
            not isinstance(model_id, str)
            or not 1 <= len(model_id) <= 160
            or not isinstance(revision, str)
            or not 1 <= len(revision) <= 64
            or not isinstance(weights, str)
            or re.fullmatch(r"[0-9a-f]{64}", weights) is None
        ):
            # 이름·판본·가중치 해시가 유효하지 않은 모델 출처 거부
            raise ValueError("MODEL_PROVENANCE_INVALID")
        # 검증된 모델 종류와 판본 및 가중치 해시 추가
        result.append(
            {
                "component": component,
                "modelId": model_id,
                "revision": revision,
                "weightsSha256": weights,
            }
        )
    # 모델별 고정 출처와 가중치 해시 목록 반환
    return result

# 현재 구현 파일의 해시와 런타임 버전을 기록
def implementationRecord() -> dict[str, Any]:
    # 현재 실행 중인 관측 구현의 루트 경로 확인
    directory = Path(__file__).parent
    # 구현과 설정 해시를 재현 가능한 파일 순서로 수집
    sources = sorted(
        path for path in directory.rglob("*") if path.is_file() and path.suffix in (".py", ".json")
    )
    # 현재 구현의 파일별 해시와 런타임 판본 반환
    return {
        "pipelineVersion": PIPELINE_VERSION,
        "runtimeVersions": versions(),
        "sourceFilesSha256": {
            path.relative_to(directory).as_posix(): fileDigest(path) for path in sources
        },
    }

# 음향 관측의 원본 해시와 시간 범위 및 구현 출처를 확인
def audioInput(
    value: dict[str, Any], source_sha256: str, duration_ms: int
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    # 음향 입력과 내부 관측 자료가 모두 사전 구조인지 확인
    if not isinstance(value, dict) or not isinstance(value.get("observations"), dict):
        # 음향 관측 계약으로 해석할 수 없는 입력 거부
        raise ValueError("AUDIO_INPUT_INVALID")
    # 음향 입력에서 원본 관측 자료 읽음
    observations = value["observations"]
    # 음향 관측을 생성한 원본 해시 읽음
    source = observations.get("sourceSha256")
    # 음향 원본 해시가 정해진 소문자 해시 형식인지 확인
    if not isinstance(source, str) or re.fullmatch(r"[0-9a-f]{64}", source) is None:
        # 잘못된 형식의 음향 원본 식별자 거부
        raise ValueError("AUDIO_INPUT_INVALID")
    # 음향 자료와 현재 영상의 원본 일치 여부 확인
    if source != source_sha256:
        # 다른 영상의 소리를 결합하지 않도록 거부
        raise ValueError("AUDIO_SOURCE_MISMATCH")
    # 음향 관측 방법의 구현 출처 읽음
    implementation = value.get("implementation")
    # 음향 구현 파일별 내용 해시 목록 읽음
    hashes = implementation.get("sourceFilesSha256") if isinstance(implementation, dict) else None
    # 필수 음향 구현 해시와 안전한 상대 파일 이름 형식 확인
    if (
        not isinstance(hashes, dict)
        or not {"audio.py", "audio_observations.py"}.issubset(hashes)
        or any(
            not isinstance(name, str)
            or not name
            or len(name) > 256
            or Path(name).is_absolute()
            or ".." in Path(name).parts
            or not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            for name, digest in hashes.items()
        )
    ):
        # 재현 가능한 음향 구현 출처가 없는 입력 거부
        raise ValueError("AUDIO_INPUT_INVALID")
    # 주파수 기반 원시 소리 단서 목록 읽음
    cues = observations.get("cues")
    # 음향 처리 제한사항과 실패 사유 읽음
    reasons = observations.get("reasons")
    # 원본 영상에 대응하는 음향 시간축 정보 읽음
    timeline = observations.get("timeline")
    # 음향 판본·방법·처리 상태·단서 수·시간축 계약의 일관성 확인
    if (
        observations.get("version") != "audio-observations-v1"
        or observations.get("status") not in ("COMPLETE", "ABSENT", "UNSUPPORTED", "FAILED")
        or observations.get("method") != "spectral-multitone-v1"
        or observations.get("speechStatus") != "NOT_ANALYZED"
        or type(observations.get("cueCount")) is not int
        or not isinstance(cues, list)
        or observations["cueCount"] != len(cues)
        or observations.get("associations") != []
        or observations.get("truncated") is not False
        or not isinstance(reasons, list)
        or any(not isinstance(reason, str) for reason in reasons)
        or not isinstance(timeline, dict)
    ):
        # 원시 음향 관측 계약과 다른 판본 또는 상태 구조 거부
        raise ValueError("AUDIO_INPUT_INVALID")
    # 시간 대응에 필수적인 음향 메타데이터 필드 정의
    timeline_keys = (
        "videoOriginSeconds",
        "audioOffsetMs",
        "scannedStartMs",
        "scannedEndMs",
        "decodedFrameCount",
        "frameDurationMs",
        "gapPolicy",
    )

    # 미확인 값 또는 0 이상의 정수인지 확인
    def nullableInteger(item: Any) -> bool:
        # 미확인 값은 허용하되 불리언을 정수 시각으로 받아들이지 않음
        return item is None or (type(item) is int and item >= 0)

    # 영상 시간축의 원점 읽음
    origin = timeline.get("videoOriginSeconds")
    # 원본 소리의 초당 표본 수 읽음
    sample_rate = observations.get("sourceSampleRateHz")
    # 원본 음향 채널 수 읽음
    channels = observations.get("sourceChannels")
    # 음향 시간 원점·간격·범위·표본 주파수·채널의 수치 유효성 확인
    if (
        any(key not in timeline for key in timeline_keys)
        or timeline["frameDurationMs"] != 100
        or timeline["gapPolicy"] != "PRESERVED_WITH_SYNTHETIC_SILENCE"
        or type(timeline["decodedFrameCount"]) is not int
        or timeline["decodedFrameCount"] < 0
        or (origin is not None and (type(origin) not in (int, float) or not math.isfinite(origin)))
        or (timeline["audioOffsetMs"] is not None and type(timeline["audioOffsetMs"]) is not int)
        or not all(nullableInteger(timeline[key]) for key in ("scannedStartMs", "scannedEndMs"))
        or (
            timeline["scannedStartMs"] is not None
            and timeline["scannedEndMs"] is not None
            and timeline["scannedStartMs"] > timeline["scannedEndMs"]
        )
        or (timeline["scannedStartMs"] is None) != (timeline["scannedEndMs"] is None)
        or (timeline["scannedEndMs"] is not None and timeline["scannedEndMs"] > duration_ms)
        or (sample_rate is not None and (type(sample_rate) is not int or sample_rate <= 0))
        or (channels is not None and (type(channels) is not int or channels <= 0))
    ):
        # 원본 시간축에 연결할 수 없는 음향 메타데이터 거부
        raise ValueError("AUDIO_INPUT_INVALID")
    # 전송에 필요한 원시 음향 단서 필드 정의
    cue_fields = ("id", "startMs", "endMs", "peakFrequenciesHz", "frameCount")
    # 각 소리 단서의 식별자·시간 범위·주파수·표본 수 검증
    if any(
        not isinstance(cue, dict)
        or any(field not in cue for field in cue_fields)
        or not isinstance(cue["id"], str)
        or not cue["id"]
        or type(cue["startMs"]) is not int
        or type(cue["endMs"]) is not int
        or cue["startMs"] < 0
        or cue["endMs"] <= cue["startMs"]
        or cue["endMs"] > duration_ms
        or timeline["scannedStartMs"] is None
        or cue["startMs"] < timeline["scannedStartMs"]
        or cue["endMs"] > timeline["scannedEndMs"]
        or type(cue["frameCount"]) is not int
        or cue["frameCount"] <= 0
        or not isinstance(cue["peakFrequenciesHz"], list)
        or any(
            type(frequency) not in (int, float) or not math.isfinite(frequency) or frequency < 0
            for frequency in cue["peakFrequenciesHz"]
        )
        for cue in cues
    ):
        # 원본 분석 범위와 맞지 않거나 수치가 잘못된 음향 단서 거부
        raise ValueError("AUDIO_INPUT_INVALID")
    # 음향 전체 관측 중 전송 계약에 필요한 메타데이터만 추출
    metadata = {
        key: observations[key]
        for key in (
            "version",
            "sourceSha256",
            "status",
            "method",
            "speechStatus",
            "sourceSampleRateHz",
            "sourceChannels",
            "timeline",
            "cueCount",
            "associations",
            "truncated",
            "reasons",
        )
        if key in observations
    }
    # 음향 형식 정보가 값 없음과 다르게 필드 자체가 누락되었는지 확인
    if "sourceSampleRateHz" not in metadata or "sourceChannels" not in metadata:
        # 값 미확인과 구별하여 음향 형식 필드 자체의 누락 거부
        raise ValueError("AUDIO_INPUT_INVALID")
    # 검증한 필수 시간축 필드만 보존
    metadata["timeline"] = {key: timeline[key] for key in timeline_keys}
    # 각 소리 단서에서 허용한 필드만 복사
    raw_cues = [{key: cue[key] for key in cue_fields} for cue in cues]
    # 검증된 음향 메타데이터와 구현 출처 및 원시 단서 반환
    return metadata, {"sourceFilesSha256": dict(hashes)}, raw_cues


class _Retained:

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 요약 상한 안에서 보존할 사건별 최신 관측 저장소 생성
        self.rows: dict[str, dict[str, Any]] = {}
        # 요약 생략 여부와 무관하게 본 사건 식별자 집합 생성
        self.seen: set[str] = set()
        # 중복을 제외한 전체 관측 사건 수 초기화
        self.count = 0
        # 요약 상한에 의한 생략 여부 초기화
        self.truncated = False

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(self, rows) -> None:
        # 이번 표본에 나타난 사건 식별자 집합 계산
        current = {row["id"] for row in rows}
        # 이전 표본에서 본 적 없는 새 사건 식별자 추출
        added = current - self.seen
        # 고유 사건 추적용 색인 크기 상한 확인
        if len(self.seen) + len(added) > MAX_INDEXED_EPISODES:
            # 무제한 식별자 누적을 방지하기 위해 처리 중단
            raise ValueError("EPISODE_INDEX_LIMIT")
        # 새 사건만 전체 관측 수에 합산
        self.count += len(added)
        # 새 사건 식별자를 중복 검사 집합에 보존
        self.seen.update(added)
        # 현재 사건들의 최신 지속 구간을 요약에 반영
        for row in rows:
            # 기존 요약 갱신 또는 상한 안의 신규 요약 허용 여부 확인
            if row["id"] in self.rows or len(self.rows) < MAX_RETAINED_EPISODES:
                # 사건의 마지막 시각까지 반영된 관측으로 갱신
                self.rows[row["id"]] = row
            else:
                # 새 사건이 요약에서 생략되었음을 원시 보존과 별도로 기록
                self.truncated = True

# 심판 관련 관측 구간을 원본 해시와 결합해 요약
def officialEpisode(value: dict[str, Any], source_sha256: str) -> dict[str, Any]:
    # 원본·연속 구간·추적·신호·시작 시각으로 심판 관측 식별 자료 구성
    identity = [
        source_sha256,
        value["continuityId"],
        value["trackId"],
        value["startMs"],
        value["signalKind"],
        value["signalSide"],
    ]
    # 같은 지속 신호를 같은 관측으로 묶을 안정적 식별 해시 계산
    digest = hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
    # 심판 역할·신호 가설과 미검증 사실 상태를 함께 반환
    return {
        "id": f"official-{digest}",
        "startMs": value["startMs"],
        "endMs": value["timestampMs"],
        "continuityId": value["continuityId"],
        "actorTrackIds": [value["trackId"]],
        "officialRole": value["officialRole"],
        "signalKind": value["signalKind"],
        "signalSide": value["signalSide"],
        "supportFrameCount": value["supportFrameCount"],
        "lastFrame": value["lastFrame"],
        # 심판 동작으로 실제 접촉을 추정 확정하지 않음
        "contact": "UNVERIFIED",
        # 심판 동작 관측을 선언된 원심과 구별
        "originalDecision": "UNKNOWN",
        "restart": "UNVERIFIED",
        # 이 관측 방법을 규정 사실 입력으로 승인하지 않았음을 명시
        "admission": "NOT_ADMITTED",
        "reasons": [
            "OFFICIAL_METHOD_UNVALIDATED",
            "SIGNAL_MEANING_UNVALIDATED",
            "RESTART_NOT_VISIBLE",
        ],
    }

# 동일 원본 시간축의 검출·역할·자세·음향 관측을 비공개 산출물에 기록
def observations(
    source: Path | str,
    output: Path | str,
    models: ObserverModels,
    *,
    duration_ms: int,
    start_ms: int = 0,
    end_ms: int | None = None,
    progress: Callable[[dict[str, Any]], None] | None = None,
    check_cancelled: Callable[[], None] | None = None,
    audio_input: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # 원본 영상의 실제 절대 경로 확인
    source_path = Path(source).expanduser().resolve()
    # 새 관측 파일을 생성할 절대 출력 경로 구성
    output_path = Path(output).expanduser().absolute()
    # 기존 파일·디렉터리·끊어진 링크까지 출력 충돌 확인
    if os.path.lexists(output_path):
        # 이전 관측 결과를 덮어쓰지 않도록 실행 중단
        raise FileExistsError("REPORT_PATH_EXISTS")
    # 입력 원본 영상 파일 존재 여부 확인
    if not source_path.is_file():
        # 없는 원본 경로로 관측 실행 거부
        raise ValueError("SOURCE_NOT_FOUND")
    # 종료 시각을 지정하지 않으면 원본 끝까지 분석 범위 설정
    requested_end = duration_ms if end_ms is None else end_ms
    # 분석 요청이 원본 길이 내부의 유효한 정수 시각 구간인지 확인
    if (
        type(duration_ms) is not int
        or duration_ms <= 0
        or type(start_ms) is not int
        or start_ms < 0
        or type(requested_end) is not int
        or not start_ms < requested_end <= duration_ms
    ):
        # 영상 길이를 벗어나거나 역전된 분석 구간 거부
        raise ValueError("SCAN_RANGE_INVALID")
    # 해시 계산 전 파일 상태를 변경 감지 기준으로 보존
    before = fingerprint(source_path)
    # 관측·증거·음향을 같은 원본에 연결할 내용 해시 계산
    source_sha256 = fileDigest(source_path)
    # 해시를 읽는 동안 원본 파일이 바뀌었는지 확인
    if fingerprint(source_path) != before:
        # 분석 도중 바뀐 원본에 출처를 부여하지 않도록 중단
        raise ValueError("VIDEO_SOURCE_CHANGED")
    # 음향 미실행 상태를 소리 단서 없음과 구별해 초기화
    audio_metadata = audio_implementation = audio_cues = None
    # 호출자가 원본 음향 관측을 제공했는지 확인
    if audio_input is not None:
        # 같은 원본과 시간축을 가진 음향 관측인지 검증하고 분리
        audio_metadata, audio_implementation, audio_cues = audioInput(
            audio_input, source_sha256, duration_ms
        )
    # 음향 자료 포함 여부에 맞는 관측 자료 판본 선택
    schema_version = "perception-run-v2" if audio_metadata is not None else SCHEMA_VERSION
    # 시각 전용과 시각·음향 결합 실행 판본 선택
    pipeline_version = (
        "video-local-observers-av-v1" if audio_metadata is not None else PIPELINE_VERSION
    )
    # 전송 요약에 넣을 세 모델의 검증된 출처 생성
    compact_models = modelRecords(models)
    # 분석 표본 주기에 맞춘 검출 추적 연결기 생성
    tracker = TrackAssociator(frame_rate=1000 / SAMPLE_INTERVAL_MS)
    # 화면 연속 구간 판별기와 심판 동작 관측기 생성
    continuity, official_observer = AppearanceContinuity(), OfficialObserver()
    # 화면 근접 구간 추적기와 관측 사건 시간 연결기 생성
    interaction_tracker, linker = InteractionTracker(), IncidentLinker()
    # 심판 신호·근접·시간 연결 요약의 독립 상한 저장소 생성
    officials_retained, interactions_retained, links_retained = (
        _Retained(),
        _Retained(),
        _Retained(),
    )
    # 요청 구간에서 기대하는 전체 표본 수 계산
    expected = math.ceil((requested_end - start_ms) / SAMPLE_INTERVAL_MS)
    # 처리 표본과 역할·자세 관측 수 초기화
    processed, role_count, pose_count = 0, 0, 0
    # 관측 실패가 아직 없음을 기록
    failure = None
    # 벽시계 변경에 영향받지 않는 실행 경과 시간 기준 보존
    started = time.perf_counter()
    # 원본 타임스탬프를 보존하는 일정 간격 영상 읽기 구성
    reader = VideoReader(
        source_path, start_ms=start_ms, end_ms=requested_end, interval_ms=SAMPLE_INTERVAL_MS
    )
    # 실패 시 부분 관측을 남길 현재 프레임 기록 초기화
    frame_record: dict[str, Any] | None = None
    # 영상 열기 단계를 실패 진단용 현재 상태로 기록
    stage = "OPEN_VIDEO"

    # 관측 취소 요청과 전체 실행 기한 확인
    def deadline() -> None:
        # 외부 취소 검사 함수 존재 여부 확인
        if check_cancelled is not None:
            # 다음 연산 진행 전에 작업 취소 여부 확인
            check_cancelled()
        # 전체 관측 실행 시간 상한 초과 여부 확인
        if time.perf_counter() - started > MAX_RUNTIME_SECONDS:
            # 실행 기한을 넘긴 관측 처리 중단
            raise ValueError("OBSERVATION_RUNTIME_LIMIT")

    # 현재 관측 단계 기록과 실행 상한 확인
    def checkpoint(name: str) -> None:
        # 중첩 점검 함수에서 바깥쪽 현재 단계 갱신
        nonlocal stage
        # 실패가 나면 남길 현재 모델 처리 단계 기록
        stage = name
        # 취소 요청과 전체 실행 기한 재확인
        deadline()
        # 전체 처리 표본 수 상한 확인
        if processed >= MAX_PROCESSED_FRAMES:
            # 처리 상한을 넘기는 추가 표본 실행 중단
            raise ValueError("OBSERVATION_SAMPLE_LIMIT")

    # 원시 관측과 실패 기록을 보존하는 비공개 압축 산출물 열기
    with DiagnosticArtifact(output_path / "perception.jsonl.gz") as artifact:
        # 이번 실행의 실제 소스 해시와 런타임 판본 수집
        implementation = implementationRecord()
        # 음향 포함 여부가 반영된 실제 실행 판본 기록
        implementation["pipelineVersion"] = pipeline_version
        # 음향 관측 구현 출처가 제공되었는지 확인
        if audio_implementation is not None:
            # 음향 관측 구현 해시를 시각 관측 출처에 함께 보존
            implementation["audio"] = audio_implementation
        # 원본·구현·모델·추적·표본 간격을 묶은 진단 헤더 생성
        header = {
            "kind": "HEADER",
            "schemaVersion": schema_version,
            "sourceSha256": source_sha256,
            "implementation": implementation,
            "models": {
                "detector": models.detector.provenance,
                "role": models.role.provenance,
                "pose": models.pose.provenance,
            },
            "tracker": tracker.provenance,
            "sampling": {
                "startMs": start_ms,
                "endMs": requested_end,
                "intervalMs": SAMPLE_INTERVAL_MS,
            },
            # 이 관측 방법을 규정 사실 입력으로 승인하지 않았음을 명시
            "admission": "NOT_ADMITTED",
        }
        # 음향 관측 메타데이터 존재 여부 확인
        if audio_metadata is not None:
            # 헤더에 원본 음향 형식과 시간축 보존
            header["audio"] = audio_metadata
        # 원시 관측 파일 첫 행에 실행 출처 기록
        artifact.append(header)
        # 시간 대응 가능한 원시 음향 단서가 제공되었는지 확인
        if audio_cues is not None:
            # 요약 상한과 무관하게 모든 원시 소리 단서 순회
            for cue in audio_cues:
                # 소리 단서를 원본 해시와 함께 비공개 원시 자료로 보존
                artifact.append({"kind": "AUDIO_CUE", "sourceSha256": source_sha256, **cue})
        try:
            # 종료 시 디코더가 해제되는 원본 읽기 구간 시작
            with reader:
                # 다음 프레임 디코딩 단계로 진단 상태 갱신
                stage = "DECODING"
                # 요청 시간 구간의 원본 표본을 순서대로 처리
                for sample in reader:
                    # 현재 프레임의 원본 좌표와 시간 및 미확인 리플레이 상태 기록
                    frame_record = {
                        "kind": "FRAME",
                        "frame": sample.as_record(),
                        "sourceSha256": source_sha256,
                        "replayState": "UNKNOWN",
                    }
                    # 검출 실행 전 취소·시간·표본 상한 확인
                    checkpoint("DETECTOR")
                    # 화면 외형 변화에 따른 연속 구간 식별자 갱신
                    context = continuity.update(sample.rgb)
                    # 프레임 관측에 화면 연속 구간 연결
                    frame_record["continuityId"] = context
                    # 현재 원본 화면에서 승인된 모델로 사람·공 검출
                    detections = models.detector.predict(sample.rgb)
                    # 추적 실행 전 처리 기한과 취소 확인
                    checkpoint("TRACKING")
                    # 같은 연속 구간의 검출을 원본 시각에 따라 추적 조각으로 연결
                    detections = tracker.update(detections, sample.timestamp_ms, context)
                    # 추적 식별자를 포함한 검출 원시 자료 보존
                    frame_record["detections"] = [item.as_record() for item in detections]
                    # 후속 관측기에 전달할 원본 프레임·검출·구간 문맥 조립
                    frame = RecordedFrame(sample, detections, context, processed)
                    # 역할 관측 실행 전 처리 기한과 취소 확인
                    checkpoint("ROLE")
                    # 승인된 역할 모델로 선수·심판 역할 후보 관측
                    raw_roles = models.role.predict(sample.rgb)
                    # 사람 검출과 역할 후보를 화면 사각형 기준으로 대응
                    roles = assignments(detections, raw_roles)
                    # 역할 대응 이전의 모델 출력 보존
                    frame_record["roleDetections"] = [item.as_record() for item in raw_roles]
                    # 사람 검출에 연결된 역할 가설 보존
                    frame_record["roles"] = [item.as_record() for item in roles]
                    # 역할 모델 입력 크기 변환과 원본 좌표 대응 정보 보존
                    frame_record["roleInputTransform"] = models.role.last_transform
                    # 역할 검출 대응이 성립한 사람만 자세 추정 대상으로 선택
                    selected = {item.detection_id for item in roles if item.status == "MATCHED"}
                    # 자세 모델에 넣을 원본 사람 검출 목록 생성
                    people = tuple(item for item in detections if item.detection_id in selected)
                    # 한 프레임에서 처리할 사람 수 상한 확인
                    if len(people) > MAX_PEOPLE_PER_FRAME:
                        # 과도한 자세 추론 수를 허용하지 않고 중단
                        raise ValueError("OBSERVATION_PERSON_LIMIT")
                    # 자세 관측 실행 전 처리 기한과 취소 확인
                    checkpoint("POSE")
                    # 대응된 사람이 있을 때만 원본 영역의 관절 좌표 추정
                    poses = models.pose.predict(sample.rgb, people) if people else ()
                    # 자세 결과가 예상 자료형·검출 순서·입력 사각형과 일치하는지 확인
                    if (
                        not isinstance(poses, tuple)
                        or any(not isinstance(pose, PoseObservation) for pose in poses)
                        or tuple(pose.detection_id for pose in poses)
                        != tuple(item.detection_id for item in people)
                        or any(pose.source_box != person.box for pose, person in zip(poses, people))
                    ):
                        # 자세 자료의 순서·검출 번호·입력 영역 불일치 거부
                        raise ValueError("POSE_OUTPUT_MISMATCH")
                    # 유효한 자세 원시 좌표와 모델 점수 보존
                    frame_record["poses"] = [item.as_record() for item in poses]
                    # 관측 사건 연결 전 처리 기한과 취소 확인
                    checkpoint("OBSERVATION_LINKS")
                    # 역할·관절 근거로 심판 관련 화면 신호 가설 갱신
                    officials = official_observer.update(frame, roles, poses)
                    # 사람 검출의 화면 근접 구간을 중립적으로 갱신
                    interactions = interaction_tracker.update(frame, roles)
                    # 근접과 심판 신호의 시간 관계를 인과 확정 없이 연결
                    links = linker.update(frame, interactions, officials)
                    # 같은 원본 프레임의 심판·근접·시간 연결 관측 결합
                    frame_record.update(
                        officials=list(officials),
                        interactions=list(interactions),
                        links=list(links),
                    )
                    # 취소 요청과 전체 실행 기한 재확인
                    deadline()
                    # 완성한 프레임 원시 관측을 비공개 파일에 기록
                    artifact.append(frame_record)
                    # 모든 관측 단계가 끝난 표본 수 증가
                    processed += 1
                    # 검출 대응이 성립한 역할 관측 수 누적
                    role_count += len(selected)
                    # 생성한 자세 관측 수 누적
                    pose_count += len(poses)
                    # 요약 집계 단계로 현재 진단 상태 갱신
                    stage = "SUMMARY"
                    # 여러 표본에서 지속된 심판 신호만 요약 저장소에 반영
                    officials_retained.update(
                        [
                            officialEpisode(item, source_sha256)
                            for item in officials
                            if item["sustained"]
                        ]
                    )
                    # 현재 화면 근접 사건의 최신 구간 요약 반영
                    interactions_retained.update(interactions)
                    # 근접과 심판 관측의 시간 연결 요약 반영
                    links_retained.update(links)
                    # 표본 처리 진행률을 받을 함수 존재 여부 확인
                    if progress is not None:
                        # 진행 알림 처리 단계를 실패 진단에 기록
                        stage = "PROGRESS"
                        # 처리 표본 수와 예상 수 및 현재 원본 시각 전달
                        progress(
                            {
                                "processedSamples": processed,
                                "expectedSamples": expected,
                                "timestampMs": sample.timestamp_ms,
                            }
                        )
                    # 완료한 표본 기록을 해제하여 다음 디코딩 실패와 구별
                    frame_record = None
                    # 다음 프레임 디코딩 단계로 진단 상태 갱신
                    stage = "DECODING"
            # 전체 표본 읽기 종료 후 마무리 단계 기록
            stage = "FINALIZING"
            # 취소 요청과 전체 실행 기한 재확인
            deadline()
        # 관측 실패를 정상적인 사건 없음과 구별해 진단 자료에 보존
        except Exception as error:
            # 산출물에 관측 실행 실패 상태 반영
            artifact.failure(error)
            # 전송 가능한 실패 사유 코드로 변환
            failure = failureReason(error)
            # 가능한 부분 프레임 자료와 실패 단계·사유 결합
            failed_record = {
                **(frame_record or {}),
                "kind": "FRAME_FAILURE" if frame_record else "RUN_FAILURE",
                "failedStage": stage,
                "failureReason": failure,
            }
            try:
                # 실패한 프레임 또는 실행 자체의 진단 행 기록
                artifact.append(failed_record)
            # 진단 추가도 용량 또는 저장장치 문제로 실패한 경우 처리
            except (ValueError, OSError):
                # 크기·디스크 오류에도 진단 추가를 위한 상한 해제 금지
                pass
    # 관측 완료 후에도 원본 상태와 내용 해시가 유지되었는지 확인
    if fingerprint(source_path) != before or fileDigest(source_path) != source_sha256:
        # 분석 도중 바뀐 원본에 출처를 부여하지 않도록 중단
        raise ValueError("VIDEO_SOURCE_CHANGED")
    # 세 종류 요약 중 하나라도 상한으로 잘렸는지 집계
    truncated = any(
        item.truncated for item in (officials_retained, interactions_retained, links_retained)
    )
    # 규정 사실 승인이 되지 않은 관측 방법의 공통 제한사항 구성
    reasons = [
        "OFFICIAL_METHOD_UNVALIDATED",
        "CONTACT_METHOD_UNVALIDATED",
        "SIGNAL_MEANING_UNVALIDATED",
        "RESTART_METHOD_UNVALIDATED",
        "LIVE_REPLAY_UNVERIFIED",
    ]
    # 실행 중 관측 실패 존재 여부 확인
    if failure is not None:
        # 실제 처리 실패 사유를 결과 제한사항에 추가
        reasons.append(failure)
    # 요청한 시간 범위의 기대 표본 수와 실제 처리량 비교
    if processed != expected:
        # 표본 범위 미완결 사유 기록
        reasons.append("SAMPLING_COVERAGE_INCOMPLETE")
    # 전송 요약의 개수 상한 생략 여부 확인
    if truncated:
        # 요약은 잘렸으나 원시 자료는 보존되었음을 기록
        reasons.append("SUMMARY_TRUNCATED_RAW_PRESERVED")
    # 음향이 단순히 없는 상태와 실패·미지원 상태 구별
    if audio_metadata is not None and audio_metadata["status"] in ("FAILED", "UNSUPPORTED"):
        # 음향 실패 또는 미지원 사유를 전체 결과에 연결
        reasons.append(f"AUDIO_{audio_metadata['status']}")
    # 처리 범위와 모델 출처 및 비공개 관측 요약 조립
    result = {
        "schemaVersion": schema_version,
        "pipelineVersion": pipeline_version,
        "sourceSha256": source_sha256,
        # 표본 처리 완료 상태이며 파울 판정 완료를 뜻하지 않음
        "processingStatus": (
            "COMPLETE"
            if failure is None
            and processed == expected
            and (
                audio_metadata is None or audio_metadata["status"] not in ("FAILED", "UNSUPPORTED")
            )
            else "PARTIAL"
        ),
        "coverage": {
            "startMs": start_ms,
            "endMs": requested_end,
            "sampleIntervalMs": SAMPLE_INTERVAL_MS,
            "expectedSamples": expected,
            "processedSamples": processed,
            "failedSamples": max(0, expected - processed),
        },
        "models": compact_models,
        "artifact": artifact.metadata(),
        "summary": {
            "roleObservationCount": role_count,
            "poseObservationCount": pose_count,
            "officialCueCount": officials_retained.count,
            "interactionCount": interactions_retained.count,
            "linkCount": links_retained.count,
            "truncated": truncated,
            "reasons": reasons,
        },
        "observations": list(officials_retained.rows.values()),
        "interactions": list(interactions_retained.rows.values()),
        "links": list(links_retained.rows.values()),
    }
    # 검증된 음향 메타데이터와 단서가 함께 있는지 확인
    if audio_metadata is not None and audio_cues is not None:
        # 전송 요약의 소리 단서 개수 상한 초과 여부 계산
        audio_truncated = len(audio_cues) > MAX_RETAINED_AUDIO_CUES
        # 원시 음향은 보존하고 전송용 단서만 상한 내에서 요약
        result["audio"] = {
            **audio_metadata,
            "cues": audio_cues[:MAX_RETAINED_AUDIO_CUES],
            "truncated": audio_truncated,
            "reasons": [
                *audio_metadata["reasons"],
                *(["AUDIO_SUMMARY_TRUNCATED_RAW_PRESERVED"] if audio_truncated else []),
            ],
        }
    # 기존 파일 덮어쓰기 없이 관측 요약 파일 생성
    with (output_path / "summary.json").open("x", encoding="utf-8") as stream:
        # 비유한 수치를 거부하며 읽을 수 있는 관측 요약 기록
        json.dump(result, stream, ensure_ascii=False, allow_nan=False, indent=2)
    # 규정 판단과 분리된 관측 처리 결과 반환
    return result

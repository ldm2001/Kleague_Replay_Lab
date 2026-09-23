from __future__ import annotations
from copy import deepcopy
from dataclasses import replace
import json
import os
from pathlib import Path
from typing import Any, Callable
from ..domain.models import (
    AV_OBSERVER_PIPELINE_VERSION,
    LOCAL_OBSERVER_PIPELINE_VERSION,
    Candidate,
    PerceptionOutput,
    Shot,
    VideoMetadata,
)
from .sounds import observations as source_audio_observations
from .tracking import summaries


# 관측만으로 새로 만들 수 있는 증거 후보 수 상한 정의
MAX_NEW_CANDIDATES = 16
# 보고서에 담을 관측 사건 요약 수 상한 정의
MAX_INCIDENTS = 128
# 하나의 증거 후보가 포함할 최대 시간 길이 정의
MAX_WINDOW_MS = 30_000
# 관측 근거 클립이 필요한 후보임을 나타내는 사유 정의
EVIDENCE_REASON = "LOCAL_OBSERVER_EVIDENCE_REQUIRED"

# 승인된 로컬 모델의 비공개 시각·음향 관측 생성
def localObservations(
    source: Path,
    output: Path,
    *,
    duration_ms: int,
    progress=None,
    check_cancelled=None,
    audio_input=None,
) -> dict[str, Any]:
    # 영상 검증과 일반 단위 테스트에서 모델 불러오기 분리
    try:
        from replay_perception.detector import RtdetrDetector
        from replay_perception.assets import directory as detectorDirectory
        from replay_perception.weights import directory as observerDirectory
        from replay_perception.operational import ObserverModels, observations
        from replay_perception.pose import VitPoseEstimator
        from replay_perception.roles import YoloRoleDetector
    # 승인된 로컬 모델 실행 의존성 누락 처리
    except ImportError as error:
        # 모델 실행 불가 상태를 관측 없음과 구별해 알림
        raise RuntimeError("WORKER_MODEL_RUNTIME_UNAVAILABLE") from error
    # 환경에서 실행 장치를 읽고 기본 중앙처리장치 사용
    device = os.environ.get("WORKER_PERCEPTION_DEVICE", "cpu")
    # 승인된 로컬 실행 장치인지 확인
    if device not in ("cpu", "mps"):
        # 지원하지 않는 실행 장치 거부
        raise ValueError("WORKER_PERCEPTION_DEVICE_INVALID")

    # 작업 취소 여부 확인
    def checkpoint():
        # 호출자가 제공한 취소 검사 존재 여부 확인
        if check_cancelled is not None:
            # 작업 취소 요청이 있으면 다음 처리 진행 중단
            check_cancelled()
    # 비용이 큰 다음 모델 적재 전에 취소 여부 확인
    checkpoint()
    # 검출 전용 검증 경로에서 사람·공 검출 모델 생성
    detector = RtdetrDetector(detectorDirectory(), device=device)
    # 비용이 큰 다음 모델 적재 전에 취소 여부 확인
    checkpoint()
    # 역할 전용 검증 경로에서 선수·심판 역할 관측 모델 생성
    role = YoloRoleDetector(observerDirectory("role"), device=device)
    # 비용이 큰 다음 모델 적재 전에 취소 여부 확인
    checkpoint()
    # 자세 전용 검증 경로에서 관절 관측 모델 생성
    pose = VitPoseEstimator(observerDirectory("pose"), device=device)
    # 비용이 큰 다음 모델 적재 전에 취소 여부 확인
    checkpoint()
    # 승인된 세 모델로 원본 시간축의 비공개 관측 실행 결과 반환
    return observations(
        source,
        output,
        ObserverModels(detector, role, pose),
        duration_ms=duration_ms,
        progress=progress,
        check_cancelled=check_cancelled,
        audio_input=audio_input,
    )

# 관측 요약의 후보와 비공개 증거 참조 변환
def adaptation(
    raw: dict[str, Any],
    root: Path,
    metadata: VideoMetadata,
    candidates: tuple[Candidate, ...],
    shots: tuple[Shot, ...],
) -> PerceptionOutput:
    # 산출물 경계 검사에 사용할 출력 경로 정규화
    root = Path(root).resolve()
    # 원본 관측 참조를 변경하지 않도록 산출물 정보 복사
    artifact = dict(raw["artifact"])
    # 관측 파일의 실제 절대 경로 확인
    path = Path(artifact["path"]).resolve()
    # 파일이 출력 경계 안에 실제로 존재하는지 확인
    if not path.is_relative_to(root) or not path.is_file():
        # 외부 경로 또는 누락된 관측 파일 참조 거부
        raise ValueError("PERCEPTION_ARTIFACT_PATH_INVALID")
    # 전송 가능한 출력 폴더 기준 상대 경로로 변환
    artifact["path"] = path.relative_to(root).as_posix()
    # 요약 제한사항을 원본과 독립적으로 갱신할 복사본 생성
    summary = deepcopy(raw["summary"])
    # 음향 결합 자료 판본의 필수 항목 처리
    if raw["schemaVersion"] == "perception-run-v2":
        # 음향 결합 결과에 음향 관측 사전이 존재하는지 확인
        if not isinstance(raw.get("audio"), dict):
            # 필수 음향 자료가 누락된 결합 관측 거부
            raise ValueError("PERCEPTION_AUDIO_REQUIRED")
        # 영상과 음향 관측이 같은 원본을 가리키는지 확인
        if raw["audio"].get("sourceSha256") != raw["sourceSha256"]:
            # 서로 다른 원본의 시각·음향 결합 거부
            raise ValueError("PERCEPTION_AUDIO_SOURCE_MISMATCH")
    # 기존 변화 후보를 보존한 채 확장할 가변 목록 생성
    result = list(candidates)
    # 규정 사실이 아닌 관측 사건 요약 목록 생성
    incidents = []
    # 기존 후보 번호와 충돌하지 않는 다음 번호 계산
    next_index = max((item.index for item in candidates), default=-1) + 1
    # 이번 관측으로 새로 생성한 후보 수 초기화
    created = 0
    # 관측 사건 식별자 중복 검사 집합 생성
    identifiers = set()

    # 요약 누락 표시와 제외 사유 기록
    def omitted(reason: str) -> None:
        # 상한 때문에 요약 일부가 생략되었음을 기록
        summary["truncated"] = True
        # 같은 요약 생략 사유 중복 여부 확인
        if reason not in summary["reasons"]:
            # 새 요약 생략 사유 추가
            summary["reasons"].append(reason)

    # 의미 연결과 지속된 심판 신호 및 화면 근접 구간 순서로 검토
    values = [
        *raw["links"],
        *raw["observations"],
        *(
            item
            for item in raw["interactions"]
            if item["supportFrameCount"] >= 3 and item["endMs"] - item["startMs"] >= 200
        ),
    ]
    # 우선순위가 정해진 관측 사건을 후보 증거 구간에 연결
    for item in values:
        # 관측 사건 식별자가 이미 사용되었는지 확인
        if item["id"] in identifiers:
            # 중복 식별자로 인한 사건 혼합 거부
            raise ValueError("PERCEPTION_INCIDENT_ID_DUPLICATE")
        # 검사한 사건 식별자 보존
        identifiers.add(item["id"])
        # 관측 사건 요약 개수 상한 확인
        if len(incidents) >= MAX_INCIDENTS:
            # 개수 상한으로 보존하지 못한 요약의 제한 사유 기록
            omitted("INCIDENT_SUMMARY_LIMIT")
            # 상한 또는 구간 제한을 넘긴 관측 요약 건너뜀
            continue
        # 관측 사건의 원본 시작·종료 시각 읽음
        start, end = item["startMs"], item["endMs"]
        # 관측 구간이 원본 안의 정수 시각이며 연속 구간 번호가 유효한지 확인
        if (
            type(start) is not int
            or type(end) is not int
            or not 0 <= start < end <= metadata.duration_ms
            or type(item["continuityId"]) is not int
            or item["continuityId"] < 0
        ):
            # 원본 범위 밖 시간 또는 잘못된 연속 구간 식별자 거부
            raise ValueError("PERCEPTION_INTERVAL_INVALID")
        # 관측 전후 맥락을 포함하되 원본 길이를 넘지 않는 증거 구간 계산
        window_start, window_end = max(0, start - 1500), min(metadata.duration_ms, end + 3000)
        # 증거 구간 길이가 허용 상한을 초과하는지 확인
        if window_end - window_start > MAX_WINDOW_MS:
            # 긴 관측 구간을 임의 절단하지 않고 생략 사유 기록
            omitted("OBSERVATION_WINDOW_TOO_LONG")
            # 상한 또는 구간 제한을 넘긴 관측 요약 건너뜀
            continue
        # 새 관측 구간과 합쳐도 길이 상한을 지키는 기존 후보 탐색
        overlapping = [
            index
            for index, candidate in enumerate(result)
            if candidate.end_ms >= window_start
            and candidate.start_ms <= window_end
            and max(candidate.end_ms, window_end) - min(candidate.start_ms, window_start)
            <= MAX_WINDOW_MS
        ]
        # 재사용할 수 있는 기존 증거 후보 존재 여부 확인
        if overlapping:
            # 조건을 만족하는 첫 기존 후보 위치 선택
            position = overlapping[0]
            # 확장 대상 기존 후보 읽음
            candidate = result[position]
            # 후보 점수와 종류를 유지하며 증거 시간 범위와 사유 확장
            candidate = replace(
                candidate,
                start_ms=min(candidate.start_ms, window_start),
                end_ms=max(candidate.end_ms, window_end),
                reasons=tuple(dict.fromkeys((*candidate.reasons, EVIDENCE_REASON))),
            )
            # 기존 후보 위치에 확장 결과 반영
            result[position] = candidate
        else:
            # 모델 관측으로 새로 생성할 후보 수 상한 확인
            if created >= MAX_NEW_CANDIDATES:
                # 개수 상한으로 보존하지 못한 요약의 제한 사유 기록
                omitted("INCIDENT_SUMMARY_LIMIT")
                # 상한 또는 구간 제한을 넘긴 관측 요약 건너뜀
                continue
            # 검증되지 않은 관측 근거를 보존할 중립 후보 생성
            candidate = Candidate(
                next_index,
                "OTHER",
                window_start,
                window_end,
                start,
                0.0,
                "LOW",
                (EVIDENCE_REASON, "UNVERIFIED_MODEL_OBSERVATION"),
                (),
            )
            # 새 관측 증거 후보를 기존 후보 목록에 추가
            result.append(candidate)
            # 다음 새 후보를 위한 식별 번호 증가
            next_index += 1
            # 관측에서 새로 생성한 후보 수 누적
            created += 1
        # 후보 참조와 미검증 사실 상태를 포함한 관측 사건 추가
        incidents.append(
            {
                "id": item["id"],
                "candidateIndex": candidate.index,
                "continuityId": item["continuityId"],
                "startMs": start,
                "endMs": end,
                "evidenceIndices": [],
                "officialRole": item.get("officialRole", "UNKNOWN"),
                "signal": item.get("signalKind", "UNKNOWN"),
                # 근접·모델 관측을 실제 접촉 사실로 승격하지 않음
                "contact": "UNVERIFIED",
                # 심판 신호 가설을 선언된 원심으로 확정하지 않음
                "originalDecision": "UNKNOWN",
                # 재개 방식의 규정 사실 승인 전 상태 보존
                "restart": "UNVERIFIED",
                "reasons": list(item["reasons"]),
            }
        )
    # 관측으로 확장된 모든 후보의 샷 중첩 관계 재계산
    result = [
        replace(
            item,
            shot_indices=tuple(
                shot.index
                for shot in shots
                if shot.end_ms >= item.start_ms and shot.start_ms <= item.end_ms
            ),
        )
        for item in result
    ]
    # 원본 식별·처리 범위·모델 출처를 독립된 전송 자료로 복사
    perception = {
        key: deepcopy(raw[key])
        for key in ("schemaVersion", "sourceSha256", "processingStatus", "coverage", "models")
    }
    # 정규화된 파일 참조와 제한사항 및 후보 연결 결과 결합
    perception.update(artifact=artifact, summary=summary, incidents=incidents)
    # 음향 결합 자료 판본의 필수 항목 처리
    if raw["schemaVersion"] == "perception-run-v2":
        # 음향 결합 판본의 원시 음향 관측 보존
        perception["audio"] = deepcopy(raw["audio"])
    # 변경된 후보와 별도의 관측 근거를 함께 반환
    return PerceptionOutput(tuple(result), perception)

# 확장된 후보 구간의 원시 추적 요약 재계산
def trackingRefresh(root: Path, result: PerceptionOutput, check_cancelled=None) -> PerceptionOutput:
    # 모델 관측으로 확장된 새 후보 구간에 맞춰 전체 원본 표본 재집계
    root = Path(root).resolve()
    # 후보 재집계에 필요한 추적 요약과 원시 표본 경로 생성
    summary_path, trace_path = (
        root / "tracking/context-summary.json",
        root / "tracking/context.jsonl",
    )
    # 추적을 실행하지 않아 두 근거 파일이 모두 없는지 확인
    if not summary_path.exists() and not trace_path.exists():
        # 누락 사유를 독립적으로 추가할 관측 결과 복사
        perception = deepcopy(result.perception)
        # 추적 근거 누락 사유 중복 여부 확인
        if "TRACKING_TRACE_UNAVAILABLE" not in perception["summary"]["reasons"]:
            # 추적 없음이 움직임 없음으로 해석되지 않도록 누락 기록
            perception["summary"]["reasons"].append("TRACKING_TRACE_UNAVAILABLE")
        # 사용할 수 없는 추적 요약을 제거한 후보와 관측 반환
        return PerceptionOutput(
            tuple(replace(item, tracking=None) for item in result.candidates), perception
        )
    # 두 추적 파일이 모두 출력 경계 안의 실제 파일인지 확인
    if any(
        not path.resolve().is_relative_to(root) or not path.is_file()
        for path in (summary_path, trace_path)
    ):
        # 출력 경계 밖 또는 불완전한 추적 파일 쌍 거부
        raise ValueError("TRACKING_TRACE_PATH_INVALID")
    # 추적 요약과 원시 표본 파일이 각 크기 상한을 지키는지 확인
    if (
        summary_path.stat().st_size > 8 * 1024 * 1024
        or trace_path.stat().st_size > 512 * 1024 * 1024
    ):
        # 원시 추적 읽기의 전체 용량 상한 초과로 중단
        raise ValueError("TRACKING_TRACE_SIZE_LIMIT")
    # 저장된 추적 요약과 원본 출처 읽음
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    # 추적과 모델 관측이 같은 원본 영상인지 확인
    if summary.get("source_sha256") != result.perception["sourceSha256"]:
        # 다른 영상의 추적 자료 재사용 거부
        raise ValueError("TRACKING_SOURCE_MISMATCH")
    # 원시 추적 파일을 한 줄씩 읽는 스트림 열기
    with trace_path.open(encoding="utf-8") as stream:

        # 보존된 원시 관측의 후보 추적 표본 읽음
        def samples():
            # 취소 검사 주기를 위한 읽은 표본 수 초기화
            count = 0
            # 실제로 읽은 원시 자료의 누적 바이트 수 초기화
            actual_bytes = 0
            # 행 상한 초과 여부를 확인할 수 있는 크기까지만 읽음
            while line := stream.readline(8 * 1024 * 1024 + 1):
                # 문자 수 대신 실제 인코딩 바이트 수 계산
                size = len(line.encode("utf-8"))
                # 읽은 자료의 총 바이트 수 누적
                actual_bytes += size
                # 원시 표본 한 행의 크기 상한 확인
                if size > 8 * 1024 * 1024:
                    # 지나치게 큰 원시 표본 행 거부
                    raise ValueError("TRACKING_TRACE_ROW_LIMIT")
                # 읽는 도중 전체 자료 크기 상한 재확인
                if actual_bytes > 512 * 1024 * 1024:
                    # 원시 추적 읽기의 전체 용량 상한 초과로 중단
                    raise ValueError("TRACKING_TRACE_SIZE_LIMIT")
                # 대량 표본 처리 중 일정 주기로 취소 요청 확인
                if check_cancelled is not None and count % 256 == 0:
                    # 작업 취소 요청이 있으면 다음 처리 진행 중단
                    check_cancelled()
                # 읽은 표본 수 증가
                count += 1
                # 현재 원시 표본을 파싱해 재집계기에 순차 전달
                yield json.loads(line)
        # 확장된 후보 시간 구간과 전체 추적 표본의 대응 재집계
        candidates = summaries(
            samples(), result.candidates, summary.get("coverage_status") == "MATCHES_METADATA"
        )
    # 재집계된 후보와 기존 모델 관측 반환
    return PerceptionOutput(candidates, result.perception)


class PerceptionAdapter:

    # 초기 상태와 입력 계약 구성
    def __init__(
        self,
        *,
        progress: Callable[[str, int, str], None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
        observe=None,
        audio_enabled: bool = False,
        observe_audio=None,
    ) -> None:
        # 외부 작업 진행 알림 함수 보존
        self.progress = progress
        # 외부 작업 취소 검사 함수 보존
        self.check_cancelled = check_cancelled
        # 주입된 관측기 또는 승인된 로컬 관측기 선택
        self.observationRun = observe or localObservations
        # 시각·음향 결합 실행 여부 보존
        self.audio_enabled = audio_enabled
        # 주입된 음향 관측기 또는 원본 음향 관측기 선택
        self.observe_audio = observe_audio or source_audio_observations
        # 음향 결합 여부에 맞는 파이프라인 판본 선택
        self.pipeline_version = (
            AV_OBSERVER_PIPELINE_VERSION if audio_enabled else LOCAL_OBSERVER_PIPELINE_VERSION
        )

    # 승인된 로컬 관측 실행과 후보·비공개 근거 결합
    def __call__(self, source, root, metadata, candidates, shots) -> PerceptionOutput:

        # 현재 단계와 처리량 전달
        def progress(value):
            # 외부 진행률 수신 함수 존재 여부 확인
            if self.progress is not None:
                # 전체 작업의 관측 단계 구간에 표본 처리 비율 배정
                percent = 55 + min(
                    14, int(14 * value["processedSamples"] / max(1, value["expectedSamples"]))
                )
                # 관측 표본 처리 진행률 전달
                self.progress("EXTRACTING_FACTS", percent, "local-observer-processing")
        # 원본 길이와 진행·취소 함수를 관측 실행 인자로 구성
        kwargs = {
            "duration_ms": metadata.duration_ms,
            "progress": progress,
            "check_cancelled": self.check_cancelled,
        }
        # 음향 결합 실행이 활성화된 경우에만 음향 계약 처리
        if self.audio_enabled:
            # 외부 진행률 수신 함수 존재 여부 확인
            if self.progress is not None:
                # 원본 음향 관측 시작 상태 전달
                self.progress("EXTRACTING_FACTS", 55, "source-audio-observation")
            # 같은 원본의 음향 단서와 시간축 및 구현 출처 수집
            kwargs["audio_input"] = self.observe_audio(
                Path(source), duration_ms=metadata.duration_ms, check_cancelled=self.check_cancelled
            )
        # 관측 전용 하위 경로에 원시 모델·음향 관측 실행
        raw = self.observationRun(Path(source), Path(root) / "perception", **kwargs)
        # 음향 결합 실행이 활성화된 경우에만 음향 계약 처리
        if self.audio_enabled:
            # 음향 활성화 요청에 맞는 결과 판본과 음향 자료 확인
            if raw.get("schemaVersion") != "perception-run-v2" or not isinstance(
                raw.get("audio"), dict
            ):
                # 필수 음향 자료가 누락된 결합 관측 거부
                raise ValueError("PERCEPTION_AUDIO_REQUIRED")
            # 실행 중 영상과 음향 원본 식별자가 바뀌지 않았는지 확인
            if raw["sourceSha256"] != kwargs["audio_input"]["observations"]["sourceSha256"]:
                # 서로 다른 원본의 시각·음향 결합 거부
                raise ValueError("PERCEPTION_AUDIO_SOURCE_MISMATCH")
        # 결과 변환 전후에도 작업 취소 요청 확인
        if self.check_cancelled is not None:
            # 취소된 작업의 후속 결과 처리 중단
            self.check_cancelled()
        # 관측 요약을 후보로 연결한 뒤 확장 구간의 추적 재집계
        result = trackingRefresh(
            Path(root),
            adaptation(raw, Path(root), metadata, candidates, shots),
            self.check_cancelled,
        )
        # 결과 변환 전후에도 작업 취소 요청 확인
        if self.check_cancelled is not None:
            # 취소된 작업의 후속 결과 처리 중단
            self.check_cancelled()
        # 관측 근거와 보강된 후보가 담긴 실행 결과 반환
        return result

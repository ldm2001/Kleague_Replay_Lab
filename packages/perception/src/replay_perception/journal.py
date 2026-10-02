# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 기록과 설정을 직렬화할 도구 읽음
import json
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 식별자와 해시 문자열 형식을 검사할 도구 읽음
import re
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any, TextIO
# 관측 목록 관련 함수와 자료형 읽음
from .observations import ROLE_LABELS, PoseObservation, RoleDetection, RoleHypothesis
# 관측 표시 관련 함수와 자료형 읽음
from .overlay import preview
# 프레임 목록 관련 함수와 자료형 읽음
from .frames import RecordedFrame


# 최댓값 직렬화 자료 바이트에 8 및 1024의 곱 및 1024의 곱 저장
MAX_JSON_BYTES = 8 * 1024 * 1024
# 최댓값 기록된 프레임 목록을 30000 값으로 설정
MAX_RECORDED_FRAMES = 30_000
# 256에 정규식 준비 처리 결과 저장
_SHA256 = re.compile(r"[0-9a-fA-F]{64}")
# 팔 상태 목록을 다음 항목으로 구성
_ARM_STATES = ("ARM_RAISED", "NOT_RAISED", "UNOBSERVABLE")
# 연결된 역할 레이블 목록에 허용된 역할 레이블 목록의 선택 항목 저장
_MATCHED_ROLE_LABELS = ROLE_LABELS[1:]
# 이 실증에서 평가하지 않은 축구 판단 목록을 다음 항목으로 구성
_NOT_ASSESSED = [
    "mainVsAssistantReferee",
    "flagObject",
    "cards",
    "declaredDecision",
    "contact",
    "foul",
    "restarts",
    "liveReplay",
]
# 관측을 판정으로 오인하지 않도록 저장을 막을 필드 목록을 다음 항목으로 구성
_FORBIDDEN_EPISODE_KEYS = {
    "mainvsassistantreferee",
    "flagobject",
    "card",
    "cards",
    "declareddecision",
    "observeddecision",
    "decision",
    "contact",
    "foul",
    "restart",
    "restarts",
    "livereplay",
}

# 유한한 수치만 허용하는 직렬화 자료 문자열을 생성
def jsonText(value: object) -> str:
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 저장용 직렬화 문자열 반환
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except (TypeError, ValueError, OverflowError) as error:
        # 보고서 직렬화 자료 유효하지 않음 오류 알림
        raise ValueError("REPORT_JSON_INVALID") from error

# 직렬화 자료 직렬화를 통해 입력과 독립된 기록 사본을 생성
def jsonClone(value: dict[str, Any], reason: str) -> dict[str, Any]:
    # 부정 조건 값의 자료형 일치 여부 확인
    if not isinstance(value, dict):
        # 현재 오류를 호출자에게 전달
        raise TypeError(reason)
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 복제한에 직렬화 문자열을 해석한 자료 저장
        cloned = json.loads(jsonText(value))
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except ValueError as error:
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason) from error
    # 부정 조건 복제한의 자료형 일치 여부 확인
    if not isinstance(cloned, dict):
        # 현재 오류를 호출자에게 전달
        raise TypeError(reason)
    # 복제한 반환
    return cloned

# 끊어진 심볼릭 링크까지 포함해 출력 경로의 기존 점유를 확인
def pathExists(path: Path) -> bool:
    # 끊어진 링크까지 포함한 경로 점유 여부 반환
    return os.path.lexists(path)

# 출력 경로의 버전 관리 작업 폴더 내부 여부 확인
def gitWorktree(path: Path) -> bool:
    # 상위 경로에 심볼릭 링크를 해석한 경로 저장
    parent = path.parent.resolve(strict=False)
    # 상위 경로·상위 경로 목록의 펼친 값의 항목별 변환 결과의 하나 이상 조건 충족 여부 반환
    return any(pathExists(ancestor / ".git") for ancestor in (parent, *parent.parents))

# 에피소드에 승인되지 않은 판정 필드가 포함됐는지 검사
def forbiddenKey(value: object) -> bool:
    # 값의 자료형 일치 여부 확인
    if isinstance(value, dict):
        # 키와 값의 쌍 목록에서 키·항목을 하나씩 읽음
        for key, item in value.items():
            # 표기 차이로 금지 필드 검사를 피하지 못하도록 키를 소문자와 글자·숫자로 정규화
            normalized = "".join(character for character in str(key).lower() if character.isalnum())
            # 정규화 결과 및 관측을 판정으로 오인하지 않도록 저장을 막을 필드 목록의 포함 조건 또는 금지된 키 처리 결과 확인
            if normalized in _FORBIDDEN_EPISODE_KEYS or forbiddenKey(item):
                # 참 반환
                return True
    # 값의 자료형 일치 여부 확인
    elif isinstance(value, list):
        # 값의 항목별 변환 결과의 하나 이상 조건 충족 여부 반환
        return any(forbiddenKey(item) for item in value)
    # 거짓 반환
    return False


# 미리보기 후보의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class _PreviewCandidate:
    # 기록된 순번을 보관할 자료형 선언
    recorded_index: int
    # 압축 이미지를 보관할 자료형 선언
    jpeg: bytes
    # 기록을 보관할 자료형 선언
    record: dict[str, Any]


# 관측 보고서의 필드와 동작을 묶을 자료형 선언
class ObservationReport:

    # 초기 상태·입력 계약 구성
    def __init__(
        self,
        output: Path | str,
        *,
        source: dict[str, Any],
        upstream: dict[str, Any],
        models: dict[str, Any],
        settings: dict[str, Any],
        max_previews: int = 24,
    ) -> None:
        # 최댓값 미리보기 목록의 자료 형식과 허용 조건 확인
        if type(max_previews) is not int or not 2 <= max_previews <= 24:
            # 최댓값 미리보기 목록 유효하지 않음 오류 알림
            raise ValueError("MAX_PREVIEWS_INVALID")
        # 출력에 절대 경로 저장
        self.output = Path(output).expanduser().absolute()
        # 원본에 직렬화로 원본과 분리한 기록 사본 저장
        self.source = jsonClone(source, "REPORT_SOURCE_INVALID")
        # 상위 단계에 직렬화로 원본과 분리한 기록 사본 저장
        self.upstream = jsonClone(upstream, "REPORT_UPSTREAM_INVALID")
        # 생성 시 출처를 직렬화해 고정
        # 실행 중 모델 객체 변경에도 보고서 출처 고정
        self.models = jsonClone(models, "REPORT_MODELS_INVALID")
        # 설정에 직렬화로 원본과 분리한 기록 사본 저장
        self.settings = jsonClone(settings, "REPORT_SETTINGS_INVALID")
        # 원본 해시 256에 내용 해시의 키에 해당하는 값 저장
        source_sha256 = self.source.get("sha256")
        # 원본 256의 자료 형식과 허용 조건 확인
        if not isinstance(source_sha256, str) or _SHA256.fullmatch(source_sha256) is None:
            # 원본 256 유효하지 않음 오류 알림
            raise ValueError("SOURCE_SHA256_INVALID")
        # 최댓값 미리보기 목록에 최댓값 미리보기 목록 저장
        self.max_previews = max_previews

        # 진입 여부를 거짓 값으로 설정
        self._entered = False
        # 마감 호출 여부를 거짓 값으로 설정
        self._finish_called = False
        # 요약 기록한을 거짓 값으로 설정
        self._summary_written = False
        # 관측 목록을 아직 없는 상태로 초기화
        self._observations: TextIO | None = None
        # 관측 구간 목록을 아직 없는 상태로 초기화
        self._episodes: TextIO | None = None
        # 기록된 프레임 수량을 0 값으로 설정
        self._recorded_frame_count = 0
        # 원본 사람 수량을 0 값으로 설정
        self._source_person_count = 0
        # 원시 역할 검출 수량을 0 값으로 설정
        self._raw_role_detection_count = 0
        # 원시 역할 목록 기준 레이블에 허용된 역할 레이블 목록의 항목별 변환 결과 저장
        self._raw_roles_by_label = {label: 0 for label in ROLE_LABELS}
        # 연결된 역할 수량을 0 값으로 설정
        self._matched_role_count = 0
        # 연결된 역할 목록 기준 레이블에 연결된 역할 레이블 목록의 항목별 변환 결과 저장
        self._matched_roles_by_label = {label: 0 for label in _MATCHED_ROLE_LABELS}
        # 연결되지 않은 역할 수량을 0 값으로 설정
        self._unmatched_role_count = 0
        # 모호한 역할 수량을 0 값으로 설정
        self._ambiguous_role_count = 0
        # 자세 수량을 0 값으로 설정
        self._pose_count = 0
        # 팔 상태 목록 기준 상태에 팔 상태 목록의 항목별 변환 결과 저장
        self._arm_states_by_state = {state: 0 for state in _ARM_STATES}
        # 후보 수량을 0 값으로 설정
        self._candidate_count = 0
        # 미리보기 간격을 1 값으로 설정
        self._preview_stride = 1
        # 미리보기 간격별 표본을 모를 빈 자료 생성
        self._preview_grid: list[_PreviewCandidate] = []
        # 마지막 미리보기를 아직 없는 상태로 초기화
        self._last_preview: _PreviewCandidate | None = None
        # 기록한 미리보기 목록을 모를 빈 자료 생성
        self._written_previews: dict[int, dict[str, Any]] = {}
        # 마감 재생을 모를 빈 자료 생성
        self._finalization_replay: dict[str, Any] = {}
        # 마감 단계별 소요 시간을 모를 빈 자료 생성
        self._finalization_timings: dict[str, Any] = {}
        # 마감 실패 복구 여부를 거짓 값으로 설정
        self._finalization_failure_recovered = False

    # 처리 자원 준비
    def __enter__(self) -> ObservationReport:
        # 보고서 이미 진입 여부를 감지해 잘못된 입력의 후속 사용 차단
        if self._entered:
            # 보고서 이미 진입 여부 오류 알림
            raise RuntimeError("REPORT_ALREADY_ENTERED")
        # 경로 존재 여부 처리 결과 확인
        if pathExists(self.output):
            # 현재 오류를 호출자에게 전달
            raise FileExistsError(self.output)
        # 출력 내부 버전 관리 작업 폴더를 감지해 잘못된 입력의 후속 사용 차단
        if gitWorktree(self.output):
            # 출력 내부 버전 관리 작업 폴더 오류 알림
            raise ValueError("OUTPUT_INSIDE_GIT_WORKTREE")
        # 출력에 필요한 출력 폴더 생성
        self.output.mkdir(parents=True, exist_ok=False)
        # 관측 목록을 아직 없는 상태로 초기화
        observations: TextIO | None = None
        # 관측 구간 목록을 아직 없는 상태로 초기화
        episodes: TextIO | None = None
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 출력 및 프레임 목록의 비율에 필요한 출력 폴더 생성
            (self.output / "frames").mkdir(exist_ok=False)
            # 관측 목록에 열린 파일 또는 영상 스트림 저장
            observations = (self.output / "observations.jsonl").open(
                "x", encoding="utf-8", newline="\n"
            )
            # 관측 구간 목록에 열린 파일 또는 영상 스트림 저장
            episodes = (self.output / "arm-candidates.jsonl").open(
                "x", encoding="utf-8", newline="\n"
            )
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception:
            # 관측 목록이 있는지 확인
            if observations is not None:
                # 관측 목록의 열린 자원 정리
                observations.close()
            # 관측 구간 목록이 있는지 확인
            if episodes is not None:
                # 관측 구간 목록의 열린 자원 정리
                episodes.close()
            # 현재 오류를 호출자에게 전달
            raise
        # 관측 목록에 관측 목록 저장
        self._observations = observations
        # 관측 구간 목록에 관측 구간 목록 저장
        self._episodes = episodes
        # 진입 여부를 참 값으로 설정
        self._entered = True
        # 현재 객체 반환
        return self

    # 보고서가 기록 가능한 상태인지 확인하고 열린 스트림을 반환
    def activeStreams(self) -> tuple[TextIO, TextIO]:
        # 보고서 아닌 활성을 감지해 잘못된 입력의 후속 사용 차단
        if (
            not self._entered
            or self._observations is None
            or self._episodes is None
            or self._observations.closed
            or self._episodes.closed
        ):
            # 보고서 아닌 활성 오류 알림
            raise RuntimeError("REPORT_NOT_ACTIVE")
        # 보고서 이미 종료 여부를 감지해 잘못된 입력의 후속 사용 차단
        if self._finish_called:
            # 보고서 이미 종료 여부 오류 알림
            raise RuntimeError("REPORT_ALREADY_FINISHED")
        # 관측 목록·관측 구간 목록 반환
        return self._observations, self._episodes

    # 행 기록
    @staticmethod
    def line(stream: TextIO, value: dict[str, Any]) -> None:
        # 줄에 유한한 수치만 포함한 저장 문자열 및 지정 문자열의 합 저장
        line = jsonText(value) + "\n"
        # 보고서 행 지나친 큼을 감지해 잘못된 입력의 후속 사용 차단
        if len(line.encode("utf-8")) > MAX_JSON_BYTES:
            # 보고서 행 지나친 큼 오류 알림
            raise ValueError("REPORT_ROW_TOO_LARGE")
        # 한 줄 쓰기가 실패할 때 불완전한 기록을 제거할 시작 위치 보존
        position = stream.tell()
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 스트림에 줄 기록
            stream.write(line)
            # 스트림의 메모리 버퍼를 출력 스트림에 반영
            stream.flush()
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception:
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 스트림의 읽기 또는 쓰기 위치를 기록 위치으로 이동
                stream.seek(position)
                # 스트림의 현재 위치 뒤 불완전한 기록 제거
                stream.truncate()
                # 스트림의 메모리 버퍼를 출력 스트림에 반영
                stream.flush()
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception:
                # 디스크 오류로 복구 불가 시에도 해당 행 집계 제외
                pass
            # 현재 오류를 호출자에게 전달
            raise

    # 프레임 입력 검사
    @staticmethod
    def frameValidation(
        frame: RecordedFrame,
        roles_raw: tuple[RoleDetection, ...],
        roles_matched: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
        arms: tuple[dict[str, Any], ...],
    ) -> None:
        # 보고서 프레임의 자료 형식과 허용 조건 확인
        if not isinstance(frame, RecordedFrame):
            # 보고서 프레임 유효하지 않음 오류 알림
            raise TypeError("REPORT_FRAME_INVALID")
        # 보고서 역할 검출 목록의 자료 형식과 허용 조건 확인
        if not isinstance(roles_raw, tuple) or any(
            not isinstance(item, RoleDetection) for item in roles_raw
        ):
            # 보고서 역할 검출 목록 유효하지 않음 오류 알림
            raise TypeError("REPORT_ROLE_DETECTIONS_INVALID")
        # 보고서 역할 가설 목록의 자료 형식과 허용 조건 확인
        if not isinstance(roles_matched, tuple) or any(
            not isinstance(item, RoleHypothesis) for item in roles_matched
        ):
            # 보고서 역할 가설 목록 유효하지 않음 오류 알림
            raise TypeError("REPORT_ROLE_HYPOTHESES_INVALID")
        # 보고서 자세 목록의 자료 형식과 허용 조건 확인
        if not isinstance(poses, tuple) or any(
            not isinstance(item, PoseObservation) for item in poses
        ):
            # 보고서 자세 목록 유효하지 않음 오류 알림
            raise TypeError("REPORT_POSES_INVALID")
        # 보고서 팔 목록의 자료 형식과 허용 조건 확인
        if not isinstance(arms, tuple) or any(not isinstance(item, dict) for item in arms):
            # 보고서 팔 목록 유효하지 않음 오류 알림
            raise TypeError("REPORT_ARMS_INVALID")
        # 역할 검출 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len({item.role_detection_id for item in roles_raw}) != len(roles_raw):
            # 역할 검출 식별자 중복 오류 알림
            raise ValueError("ROLE_DETECTION_ID_DUPLICATE")
        # 역할 가설 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len({item.detection_id for item in roles_matched}) != len(roles_matched):
            # 역할 가설 식별자 중복 오류 알림
            raise ValueError("ROLE_HYPOTHESIS_ID_DUPLICATE")
        # 자세 검출 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len({item.detection_id for item in poses}) != len(poses):
            # 자세 검출 식별자 중복 오류 알림
            raise ValueError("POSE_DETECTION_ID_DUPLICATE")
        # 원본 사람 목록에 프레임의 검출 목록에서 조건에 맞는 항목을 모은 값 저장
        source_people = {
            detection.detection_id for detection in frame.detections if detection.label == "person"
        }
        # 역할 가설 원본 아닌 사람을 감지해 잘못된 입력의 후속 사용 차단
        if any(item.detection_id not in source_people for item in roles_matched):
            # 역할 가설 원본 아닌 사람 오류 알림
            raise ValueError("ROLE_HYPOTHESIS_SOURCE_NOT_PERSON")
        # 자세 원본 아닌 사람을 감지해 잘못된 입력의 후속 사용 차단
        if any(item.detection_id not in source_people for item in poses):
            # 자세 원본 아닌 사람 오류 알림
            raise ValueError("POSE_SOURCE_NOT_PERSON")
        # 팔 키 목록에 빈 중복을 없앤 집합 저장
        arm_keys: set[tuple[int, object]] = set()
        # 팔 목록에서 팔을 하나씩 읽음
        for arm in arms:
            # 검출 식별자에 검출 식별자의 키에 해당하는 값 저장
            detection_id = arm.get("detectionId")
            # 상태에 상태의 키에 해당하는 값 저장
            state = arm.get("state")
            # 키를 다음 항목으로 구성
            key = (detection_id, arm.get("side"))
            # 팔 관측의 자료 형식과 허용 조건 확인
            if (
                type(detection_id) is not int
                or detection_id not in source_people
                or state not in _ARM_STATES
                or key in arm_keys
            ):
                # 팔 관측 유효하지 않음 오류 알림
                raise ValueError("ARM_OBSERVATION_INVALID")
            # 팔 키 목록에 키를 중복 없이 추가
            arm_keys.add(key)

    # 역할·자세·손 주변 물체의 프레임 관측을 검증해 진단 행으로 기록
    def append(
        self,
        frame: RecordedFrame,
        roles_raw: tuple[RoleDetection, ...],
        roles_matched: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
        arms: tuple[dict[str, Any], ...],
        episodes: tuple[dict[str, Any], ...],
        timings: dict[str, Any],
        *,
        role_input_transform: dict[str, Any] | None = None,
    ) -> None:
        # 관측 목록·사용하지 않는 값에 활성 스트림 목록 처리 결과 저장
        observations, _ = self.activeStreams()
        # 보고서 프레임 한도 초과를 감지해 잘못된 입력의 후속 사용 차단
        if self._recorded_frame_count >= MAX_RECORDED_FRAMES:
            # 보고서 프레임 한도 초과 오류 알림
            raise ValueError("REPORT_FRAME_LIMIT_EXCEEDED")
        # 프레임 입력 검사으로 프레임의 계약 확인
        self.frameValidation(frame, roles_raw, roles_matched, poses, arms)
        # 역할 입력 좌표 변환의 자료 형식과 허용 조건 확인
        if role_input_transform is not None and not isinstance(role_input_transform, dict):
            # 역할 입력 좌표 변환 유효하지 않음 오류 알림
            raise TypeError("ROLE_INPUT_TRANSFORM_INVALID")
        # 정규화한 좌표 변환에 조건에 따라 선택한 없음 저장
        normalized_transform = (
            None
            if role_input_transform is None
            # 앞선 분기에 해당하지 않는 경우 처리
            else jsonClone(role_input_transform, "ROLE_INPUT_TRANSFORM_INVALID")
        )
        # 정규화한 팔 목록에 팔 목록의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 저장
        normalized_arms = tuple(jsonClone(arm, "ARM_OBSERVATION_INVALID") for arm in arms)
        # 정규화한 단계별 소요 시간에 직렬화로 원본과 분리한 기록 사본 저장
        normalized_timings = jsonClone(timings, "STAGE_TIMINGS_INVALID")
        # 보고서 관측 구간 목록의 자료 형식과 허용 조건 확인
        if not isinstance(episodes, tuple) or any(not isinstance(item, dict) for item in episodes):
            # 보고서 관측 구간 목록 유효하지 않음 오류 알림
            raise TypeError("REPORT_EPISODES_INVALID")

        # 행을 다음 항목으로 구성
        row = {
            # 원본 해시 256 필드 기록
            "sourceSha256": self.source["sha256"],
            **frame.sample.as_record(),
            # 상위 단계 기록 순번 필드 기록
            "upstreamRecordIndex": frame.record_index,
            # 연속 구간 식별자 필드 기록
            "continuityId": frame.continuity_id,
            # 생중계와 재생의 구별 상태를 미승인 또는 미확인 상태로 보존
            "replayState": "UNKNOWN",
            # 원본 검출 목록 필드 기록
            "sourceDetections": [detection.as_record() for detection in frame.detections],
            # 역할 검출 목록 필드 기록
            "roleDetections": [item.as_record() for item in roles_raw],
            # 역할 가설 목록 필드 기록
            "roleHypotheses": [item.as_record() for item in roles_matched],
            # 자세 목록 필드 기록
            "poses": [item.as_record() for item in poses],
            # 팔 목록 필드 기록
            "arms": list(normalized_arms),
            # 역할 입력 좌표 변환 필드 기록
            "roleInputTransform": normalized_transform,
            # 단계 단계별 소요 시간 필드 기록
            "stageTimings": normalized_timings,
        }
        # 연결할 두 관절 또는 저장 기록을 지정 형식으로 반영
        self.line(observations, row)

        # 기록이 정상 반영된 뒤에만 저장 프레임 수 증가
        self._recorded_frame_count += 1
        # 원본 사람 수량에 검출 목록의 항목별 변환 결과의 합계를 더해 누적
        self._source_person_count += sum(
            detection.label == "person" for detection in frame.detections
        )
        # 원시 역할 검출 수량에 역할 목록 원시의 항목 수를 더해 누적
        self._raw_role_detection_count += len(roles_raw)
        # 역할 목록 원시에서 항목을 하나씩 읽음
        for item in roles_raw:
            # 원시 역할 목록 기준 레이블의 선택 항목에 1을 더해 누적
            self._raw_roles_by_label[item.role] += 1
        # 역할 목록 연결된에서 항목을 하나씩 읽음
        for item in roles_matched:
            # 항목의 상태 및 연결된의 일치 조건 확인
            if item.status == "MATCHED":
                # 연결된 역할 수량에 1을 더해 누적
                self._matched_role_count += 1
                # 연결된 역할 목록 기준 레이블의 선택 항목에 1을 더해 누적
                self._matched_roles_by_label[item.role] += 1
            # 항목의 상태 및 연결되지 않은의 일치 조건 확인
            elif item.status == "UNMATCHED":
                # 연결되지 않은 역할 수량에 1을 더해 누적
                self._unmatched_role_count += 1
            # 앞선 분기에 해당하지 않는 경우 처리
            else:
                # 모호한 역할 수량에 1을 더해 누적
                self._ambiguous_role_count += 1
        # 자세 수량에 자세 목록의 항목 수를 더해 누적
        self._pose_count += len(poses)
        # 정규화한 팔 목록에서 팔을 하나씩 읽음
        for arm in normalized_arms:
            # 팔 상태 목록 기준 상태의 선택 항목에 1을 더해 누적
            self._arm_states_by_state[arm["state"]] += 1
        # 기록된 순번에 기록된 프레임 수량 및 1의 차이 저장
        recorded_index = self._recorded_frame_count - 1
        # 미리보기 보존에 필요한 입력을 전달해 처리
        self.previewRetention(
            recorded_index, frame, roles_raw, roles_matched, poses, normalized_arms
        )
        # 관측 구간 목록에 필요한 입력을 전달해 처리
        self.episodes(episodes)

    # 메모리 상한 안에서 미리보기 후보 프레임을 보존
    def previewRetention(
        self,
        recorded_index: int,
        frame: RecordedFrame,
        roles_raw: tuple[RoleDetection, ...],
        roles_matched: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
        arms: tuple[dict[str, Any], ...],
    ) -> None:
        # 압축 이미지·기록에 판정과 구분해 표시한 미리보기 저장
        jpeg, record = preview(frame, roles_raw, roles_matched, poses, arms)
        # 후보에 미리보기 후보 처리 결과 저장
        candidate = _PreviewCandidate(recorded_index, jpeg, record)
        # 기록된 순번 및 미리보기 간격의 나머지 및 0의 일치 조건 확인
        if recorded_index % self._preview_stride == 0:
            # 미리보기 간격별 표본에 후보 추가
            self._preview_grid.append(candidate)
        # 간격별 표본 한도에 최댓값 미리보기 목록 및 1의 차이 저장
        grid_limit = self.max_previews - 1
        # 미리보기 간격별 표본의 항목 수 및 간격별 표본 한도의 초과 조건을 만족하는 동안 반복
        while len(self._preview_grid) > grid_limit:
            # 보존 후보가 상한을 넘으면 표본 간격을 두 배로 늘려 메모리 사용 제한
            self._preview_stride *= 2
            # 미리보기 간격별 표본에 미리보기 간격별 표본에서 조건에 맞는 항목을 모은 값 저장
            self._preview_grid = [
                retained
                for retained in self._preview_grid
                if retained.recorded_index % self._preview_stride == 0
            ]
        # 마지막 미리보기에 후보 저장
        self._last_preview = candidate

    # 에피소드 입력을 검증하고 저장 가능한 필드로 정규화
    @staticmethod
    def normalizedEpisode(episode: dict[str, Any]) -> dict[str, Any]:
        # 정규화 결과에 직렬화로 원본과 분리한 기록 사본 저장
        normalized = jsonClone(episode, "EPISODE_INVALID")
        # 관측 구간 종류의 자료 형식과 허용 조건 확인
        if normalized.get("kind") != "ARM_RAISED":
            # 관측 구간 종류 유효하지 않음 오류 알림
            raise ValueError("EPISODE_KIND_INVALID")
        # 관측 구간 행위자 역할의 자료 형식과 허용 조건 확인
        if normalized.get("actorRoleHypothesis") != "referee":
            # 관측 구간 행위자 역할 유효하지 않음 오류 알림
            raise ValueError("EPISODE_ACTOR_ROLE_INVALID")
        # 관측 구간 판정 입력 승인 여부의 자료 형식과 허용 조건 확인
        if normalized.get("admission") != "NOT_ADMITTED":
            # 관측 구간 판정 입력 승인 여부 유효하지 않음 오류 알림
            raise ValueError("EPISODE_ADMISSION_INVALID")
        # 역할·팔 동작 관측 안에 접촉이나 판정 사실이 섞이지 않도록 금지 필드 검사
        if forbiddenKey(normalized):
            # 관측 구간 판정 필드 목록 금지된 오류 알림
            raise ValueError("EPISODE_DECISION_FIELDS_FORBIDDEN")
        # 정규화 결과 반환
        return normalized

    # 관측 구간 검증 후 연속 관측 기록 추가
    def episodes(self, episodes: tuple[dict[str, Any], ...]) -> None:
        # 사용하지 않는 값·대상 파일에 활성 스트림 목록 처리 결과 저장
        _, destination = self.activeStreams()
        # 보고서 관측 구간 목록의 자료 형식과 허용 조건 확인
        if not isinstance(episodes, tuple) or any(not isinstance(item, dict) for item in episodes):
            # 보고서 관측 구간 목록 유효하지 않음 오류 알림
            raise TypeError("REPORT_EPISODES_INVALID")
        # 관측 구간 목록에서 관측 구간을 하나씩 읽음
        for episode in episodes:
            # 정규화 결과에 정규화한 관측 구간 처리 결과 저장
            normalized = self.normalizedEpisode(episode)
            # 연결할 두 관절 또는 저장 기록을 지정 형식으로 반영
            self.line(destination, normalized)
            # 후보 수량에 1을 더해 누적
            self._candidate_count += 1

    # 진단 구간을 대표하도록 보존된 미리보기 후보를 선택
    def selectedPreviews(self) -> list[_PreviewCandidate]:
        # 선택 결과에 미리보기 간격별 표본의 목록 변환 결과 저장
        selected = list(self._preview_grid)
        # 마지막 미리보기가 있는지 및 선택 결과의 항목별 변환 결과의 전체 조건 충족 여부 확인
        if self._last_preview is not None and all(
            item.recorded_index != self._last_preview.recorded_index for item in selected
        ):
            # 선택 결과에 마지막 미리보기 추가
            selected.append(self._last_preview)
        # 선택 결과를 지정한 비교 기준으로 정렬
        selected.sort(key=lambda item: item.recorded_index)
        # 선택 결과의 선택 항목 반환
        return selected[: self.max_previews]

    # 선택한 진단 표본을 미리보기 이미지 파일로 저장
    def previewFiles(self, *, strict: bool) -> list[dict[str, Any]]:
        # 기록 목록을 모를 빈 자료 생성
        records: list[dict[str, Any]] = []
        # 순번을 붙인 항목 목록에서 저장 순서·후보를 하나씩 읽음
        for ordinal, candidate in enumerate(self.selectedPreviews()):
            # 기존에 후보의 기록된 순번의 키에 해당하는 값 저장
            existing = self._written_previews.get(candidate.recorded_index)
            # 이미 저장한 기록이 있는지 확인
            if existing is not None:
                # 기록 목록에 기존 추가
                records.append(existing)
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 상대 경로에 파일 경로 객체 및 현재 값을 포함한 문자열의 비율 저장
            relative_path = Path("frames") / (
                f"preview-{ordinal:04d}-frame-{candidate.recorded_index:08d}.jpg"
            )
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
                with (self.output / relative_path).open("xb") as destination:
                    # 대상 파일에 후보의 압축 이미지 기록
                    destination.write(candidate.jpeg)
                    # 대상 파일의 메모리 버퍼를 출력 스트림에 반영
                    destination.flush()
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception:
                # 엄격한 오류 처리 확인
                if strict:
                    # 현재 오류를 호출자에게 전달
                    raise
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 기록을 다음 항목으로 구성
            record = {"path": relative_path.as_posix(), **candidate.record}
            # 기록한 미리보기 목록의 선택 항목에 기록 저장
            self._written_previews[candidate.recorded_index] = record
            # 기록 목록에 기록 추가
            records.append(record)
        # 기록 목록을 지정한 비교 기준으로 정렬
        records.sort(key=lambda value: (value["timestampMs"], value["upstreamRecordIndex"]))
        # 기록 목록 반환
        return records

    # 기록한 표본과 검출 및 추적의 누적 수량을 집계
    def counts(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 기록된 프레임 수량 필드 기록
            "recordedFrameCount": self._recorded_frame_count,
            # 원본 사람 수량 필드 기록
            "sourcePersonCount": self._source_person_count,
            # 원시 역할 검출 수량 필드 기록
            "rawRoleDetectionCount": self._raw_role_detection_count,
            # 원시 역할 목록 기준 레이블 필드 기록
            "rawRolesByLabel": dict(self._raw_roles_by_label),
            # 연결된 역할 수량 필드 기록
            "matchedRoleCount": self._matched_role_count,
            # 연결된 역할 목록 기준 레이블 필드 기록
            "matchedRolesByLabel": dict(self._matched_roles_by_label),
            # 연결되지 않은 역할 수량 필드 기록
            "unmatchedRoleCount": self._unmatched_role_count,
            # 모호한 역할 수량 필드 기록
            "ambiguousRoleCount": self._ambiguous_role_count,
            # 자세 수량 필드 기록
            "poseCount": self._pose_count,
            # 팔 상태 목록 기준 상태 필드 기록
            "armStatesByState": dict(self._arm_states_by_state),
            # 후보 수량 필드 기록
            "candidateCount": self._candidate_count,
        }

    # 진단 수량과 처리 범위 및 제한사항을 최종 요약으로 구성
    def summary(
        self,
        status: str,
        *,
        replay: dict[str, Any],
        timings: dict[str, Any],
        previews: list[dict[str, Any]],
        failure_reason: str | None,
        finalization_failure_reason: str | None = None,
    ) -> dict[str, Any]:
        # 요약을 다음 항목으로 구성
        summary: dict[str, Any] = {
            # 계약 버전 필드 기록
            "schemaVersion": 1,
            # 보고서 자료형 필드 기록
            "reportType": "REFEREE_OBSERVATIONS",
            # 상태 필드 기록
            "status": status,
            # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
            "admission": "NOT_ADMITTED",
            # 원본 필드 기록
            "source": self.source,
            # 상위 단계 필드 기록
            "upstream": self.upstream,
            # 모델 목록 필드 기록
            "models": self.models,
            # 설정 필드 기록
            "settings": self.settings,
            # 재생 필드 기록
            "replay": replay,
            # 단계별 소요 시간 필드 기록
            "timings": timings,
            # 집계 필드 기록
            "counts": self.counts(),
            # 미리보기 목록 필드 기록
            "previews": previews,
            # 처리 성공을 전체 파울 판정 성공으로 오인하지 않도록 작업 범위 기록
            "scope": "ROLE_POSE_AND_ARM_OBSERVATION_ONLY",
            # 아닌 평가 대상 필드 기록
            "notAssessed": list(_NOT_ASSESSED),
        }
        # 실패 사유가 있는지 확인
        if failure_reason is not None:
            # 요약의 실패 사유에 실패 사유 저장
            summary["failureReason"] = failure_reason
        # 마감 실패 사유가 있는지 확인
        if finalization_failure_reason is not None:
            # 요약의 마감 실패 사유에 마감 실패 사유 저장
            summary["finalizationFailureReason"] = finalization_failure_reason
        # 요약 반환
        return summary

    # 열린 진단 스트림을 닫고 첫 정리 오류를 보존
    def streamClosure(self) -> Exception | None:
        # 닫기 오류를 아직 없는 상태로 초기화
        close_error: Exception | None = None
        # 관측 목록·관측 구간 목록에서 스트림을 하나씩 읽음
        for stream in (self._observations, self._episodes):
            # 스트림이 있는지 및 부정 조건 닫힘 여부 확인
            if stream is not None and not stream.closed:
                # 실패 시 아래 예외 처리로 정리할 작업 시작
                try:
                    # 스트림의 열린 자원 정리
                    stream.close()
                # 발생한 예외를 받아 원인 보존과 후속 처리 수행
                except Exception as error:
                    # 닫기 오류가 없는지 확인
                    if close_error is None:
                        # 닫기 오류에 오류 저장
                        close_error = error
        # 닫기 오류 반환
        return close_error

    # 요약 기록
    def summaryFile(self, summary: dict[str, Any]) -> None:
        # 직렬화한에 유한한 수치만 포함한 저장 문자열 및 지정 문자열의 합 저장
        serialized = jsonText(summary) + "\n"
        # 보고서 요약 지나친 큼을 감지해 잘못된 입력의 후속 사용 차단
        if len(serialized.encode("utf-8")) > MAX_JSON_BYTES:
            # 보고서 요약 지나친 큼 오류 알림
            raise ValueError("REPORT_SUMMARY_TOO_LARGE")
        # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
        with (self.output / "summary.json").open(
            "x", encoding="utf-8", newline="\n"
        ) as destination:
            # 대상 파일에 직렬화한 기록
            destination.write(serialized)
            # 대상 파일의 메모리 버퍼를 출력 스트림에 반영
            destination.flush()
        # 요약 기록한을 참 값으로 설정
        self._summary_written = True

    # 프레임·에피소드 기록을 마감하고 관측 요약과 실패 상태를 저장
    def finish(
        self,
        status: str,
        *,
        replay: dict[str, Any],
        timings: dict[str, Any],
        failure_reason: str | None = None,
    ) -> dict[str, Any]:
        # 활성 스트림 목록에 필요한 입력을 전달해 처리
        self.activeStreams()
        # 마감 호출 여부를 참 값으로 설정
        self._finish_called = True
        # 보고서 상태의 자료 형식과 허용 조건 확인
        if status not in {"COMPLETE", "FAILED"}:
            # 보고서 상태 유효하지 않음 오류 알림
            raise ValueError("REPORT_STATUS_INVALID")
        # 실패 필요 실패 사유를 감지해 잘못된 입력의 후속 사용 차단
        if status == "FAILED" and (
            not isinstance(failure_reason, str) or not failure_reason.strip()
        ):
            # 실패 필요 실패 사유 오류 알림
            raise ValueError("FAILED_REQUIRES_FAILURE_REASON")
        # 완료 허용하지 않음 실패 사유를 감지해 잘못된 입력의 후속 사용 차단
        if status == "COMPLETE" and failure_reason is not None:
            # 완료 허용하지 않음 실패 사유 오류 알림
            raise ValueError("COMPLETE_FORBIDS_FAILURE_REASON")

        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 정규화한 재생에 직렬화로 원본과 분리한 기록 사본 저장
            normalized_replay = jsonClone(replay, "REPORT_REPLAY_INVALID")
            # 마감 재생에 정규화한 재생 저장
            self._finalization_replay = normalized_replay
            # 정규화한 단계별 소요 시간에 직렬화로 원본과 분리한 기록 사본 저장
            normalized_timings = jsonClone(timings, "REPORT_TIMINGS_INVALID")
            # 마감 단계별 소요 시간에 정규화한 단계별 소요 시간 저장
            self._finalization_timings = normalized_timings
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except (TypeError, ValueError) as error:
            # 상태 및 실패의 불일치 조건 확인
            if status != "FAILED":
                # 현재 오류를 호출자에게 전달
                raise
            # 스트림 구간 마감에 필요한 입력을 전달해 처리
            self.streamClosure()
            # 마감 복구 처리 결과 반환
            return self.finalizationRecovery(error, failure_reason)
        # 닫기 오류에 스트림 구간 마감 처리 결과 저장
        close_error = self.streamClosure()
        # 닫기 오류가 있는지 확인
        if close_error is not None:
            # 마감 복구 처리 결과 반환
            return self.finalizationRecovery(close_error, failure_reason)
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 미리보기 목록에 미리보기 파일 목록 처리 결과 저장
            previews = self.previewFiles(strict=True)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception as error:
            # 마감 복구 처리 결과 반환
            return self.finalizationRecovery(error, failure_reason)
        # 요약에 요약 처리 결과 저장
        summary = self.summary(
            status,
            replay=normalized_replay,
            timings=normalized_timings,
            previews=previews,
            failure_reason=failure_reason,
        )
        # 요약 파일에 필요한 입력을 전달해 처리
        self.summaryFile(summary)
        # 요약 반환
        return summary

    # 보고서 마감 실패 시 남은 부분 결과와 실패 상태를 보존
    def finalizationRecovery(
        self,
        error: Exception,
        primary_failure_reason: str | None,
    ) -> dict[str, Any]:
        # 마감 사유에 오류의 정확한 자료형의 실행 모듈 이름 저장
        finalization_reason = type(error).__name__
        # 실패 사유에 최초 실패 사유 또는 마감 사유 저장
        failure_reason = primary_failure_reason or finalization_reason
        # 후속 사유에 조건에 따라 선택한 마감 사유 저장
        secondary_reason = finalization_reason if primary_failure_reason is not None else None
        # 미리보기 목록에 미리보기 파일 목록 처리 결과 저장
        previews = self.previewFiles(strict=False)
        # 요약에 요약 처리 결과 저장
        summary = self.summary(
            "FAILED",
            replay=self._finalization_replay,
            timings=self._finalization_timings,
            previews=previews,
            failure_reason=failure_reason,
            finalization_failure_reason=secondary_reason,
        )
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 요약 파일에 필요한 입력을 전달해 처리
            self.summaryFile(summary)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception:
            # 영구 복구 불가 시 첫 마감 오류 보존
            raise error
        # 마감 실패 복구 여부를 참 값으로 설정
        self._finalization_failure_recovered = True
        # 요약 반환
        return summary

    # 중간 결과를 보존하면서 실패 사유를 보고서에 기록
    def failureRecord(
        self,
        reason: str,
        *,
        finalization_failure_reason: str | None = None,
    ) -> None:
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 미리보기 목록에 미리보기 파일 목록 처리 결과 저장
            previews = self.previewFiles(strict=False)
            # 요약에 요약 처리 결과 저장
            summary = self.summary(
                "FAILED",
                replay=self._finalization_replay,
                timings=self._finalization_timings,
                previews=previews,
                failure_reason=reason,
                finalization_failure_reason=finalization_failure_reason,
            )
            # 요약 파일에 필요한 입력을 전달해 처리
            self.summaryFile(summary)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception:
            # 실패 기록은 가능한 범위에서 수행하고 원래 오류 보존
            pass

    # 처리 자원 정리
    def __exit__(self, exception_type, exception, _traceback) -> bool:
        # 닫기 오류에 스트림 구간 마감 처리 결과 저장
        close_error = self.streamClosure()
        # 요약 기록한이 비어 있거나 조건을 충족하지 않는지 확인
        if not self._summary_written:
            # 예외 자료형이 있는지 확인
            if exception_type is not None:
                # 사유에 예외 자료형의 실행 모듈 이름 저장
                reason = exception_type.__name__
            # 닫기 오류가 있는지 확인
            elif close_error is not None:
                # 사유에 닫기 오류의 정확한 자료형의 실행 모듈 이름 저장
                reason = type(close_error).__name__
            # 앞선 분기에 해당하지 않는 경우 처리
            else:
                # 사유를 보고서 마감 아닌 호출 여부 값으로 설정
                reason = "REPORT_FINISH_NOT_CALLED"
            # 실패 기록에 필요한 입력을 전달해 처리
            self.failureRecord(
                reason,
                finalization_failure_reason=(
                    type(close_error).__name__
                    if exception_type is not None and close_error is not None
                    # 앞선 분기에 해당하지 않는 경우 처리
                    else None
                ),
            )
        # 예외 자료형이 없는지 및 닫기 오류가 있는지 및 부정 조건 마감 실패 복구 여부 확인
        if (
            exception_type is None
            and close_error is not None
            and not self._finalization_failure_recovered
        ):
            # 현재 오류를 호출자에게 전달
            raise close_error
        # 거짓 반환
        return False

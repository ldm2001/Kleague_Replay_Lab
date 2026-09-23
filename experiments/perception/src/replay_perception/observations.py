# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 원본 시간축의 반올림 오차를 줄일 유리수 도구 읽음
from fractions import Fraction
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import isfinite
# 불리언과 수치 자료형을 구별할 기준 읽음
from numbers import Real
# 입출력 자료형과 호출 규약 읽음
from typing import Any


# 허용된 역할 레이블 목록을 다음 항목으로 구성
ROLE_LABELS = ("ball", "goalkeeper", "player", "referee")
# 모델 출력 순번과 관절 이름의 고정 대응 목록을 다음 항목으로 구성
KEYPOINT_NAMES = (
    "Nose",
    "L_Eye",
    "R_Eye",
    "L_Ear",
    "R_Ear",
    "L_Shoulder",
    "R_Shoulder",
    "L_Elbow",
    "R_Elbow",
    "L_Wrist",
    "R_Wrist",
    "L_Hip",
    "R_Hip",
    "L_Knee",
    "R_Knee",
    "L_Ankle",
    "R_Ankle",
)

# 입력이 불리언이 아닌 유한 수치인지 확인
def number(value: Any, reason: str) -> float:
    # 값의 자료형 일치 여부 또는 부정 조건 값의 자료형 일치 여부 확인
    if isinstance(value, bool) or not isinstance(value, Real):
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason)
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 정규화 결과에 값의 실수 변환 결과 저장
        normalized = float(value)
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except (OverflowError, ValueError):
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason) from None
    # 부정 조건 정규화 결과의 유한 수치 여부 확인
    if not isfinite(normalized):
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason)
    # 정규화 결과 반환
    return normalized

# 관측 식별자의 형식과 충돌 방지 조건을 확인
def identifier(value: Any, reason: str) -> None:
    # 값의 정확한 자료형 및 정수의 다른 객체 조건 또는 값 및 0의 미만 조건 확인
    if type(value) is not int or value < 0:
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason)

# 관측 신뢰 점수가 유한한 0부터 1 사이 값인지 확인
def score(value: Any, reason: str) -> float:
    # 정규화 결과에 수치 처리 결과 저장
    normalized = number(value, reason)
    # 부정 조건 0 및 정규화 결과·1의 이하·이하 조건 확인
    if not 0 <= normalized <= 1:
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason)
    # 정규화 결과 반환
    return normalized

# 검출 상자의 좌표 형식과 수치 범위를 확인
def box(value: Any, reason: str) -> tuple[float, float, float, float]:
    # 부정 조건 값의 자료형 일치 여부 또는 값의 항목 수 및 4의 불일치 조건 확인
    if not isinstance(value, tuple) or len(value) != 4:
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason)
    # 정규화 결과에 값의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 저장
    normalized = tuple(number(item, reason) for item in value)
    # 여러 값을 순서대로 모은 자료에 정규화 결과 저장
    x1, y1, x2, y2 = normalized
    # 시작 가로 좌표 및 0의 미만 조건 또는 시작 세로 좌표 및 0의 미만 조건 또는 끝 가로 좌표 및 시작 가로 좌표의 이하 조건 확인
    if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
        # 현재 오류를 호출자에게 전달
        raise ValueError(reason)
    # 정규화 결과 반환
    return normalized


# 역할 검출의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class RoleDetection:
    # 역할 검출 식별자를 보관할 자료형 선언
    role_detection_id: int
    # 역할을 보관할 자료형 선언
    role: str
    # 원본 화면의 시작점과 끝점 상자 좌표를 보관할 자료형 선언
    box: tuple[float, float, float, float]
    # 모델 출력 점수를 보관할 자료형 선언
    score: float

    # 초기 상태·입력 계약 구성
    def __post_init__(self) -> None:
        # 식별자에 필요한 입력을 전달해 처리
        identifier(self.role_detection_id, "ROLE_DETECTION_ID_INVALID")
        # 역할 레이블의 자료 형식과 허용 조건 확인
        if self.role not in ROLE_LABELS:
            # 역할 레이블 유효하지 않음 오류 알림
            raise ValueError("ROLE_LABEL_INVALID")
        # 검증한 원본 화면의 시작점과 끝점 상자 좌표 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "box", box(self.box, "ROLE_BOX_INVALID"))
        # 검증한 모델 출력 점수 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "score", score(self.score, "ROLE_SCORE_INVALID"))

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 역할 검출 식별자 필드 기록
            "roleDetectionId": self.role_detection_id,
            # 역할 필드 기록
            "role": self.role,
            # 원본 화면의 시작점과 끝점 상자 좌표 필드 기록
            "box": list(self.box),
            # 모델 출력 점수 필드 기록
            "score": self.score,
            # 모델이 만든 관측이라는 출처 유형 기록
            "source": "MODEL_ROLE_DETECTION",
        }


# 역할 가설의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class RoleHypothesis:
    # 검출 식별자를 보관할 자료형 선언
    detection_id: int
    # 상태를 보관할 자료형 선언
    status: str
    # 역할을 아직 없는 상태로 초기화
    role: str | None = None
    # 모델 출력 점수를 아직 없는 상태로 초기화
    score: float | None = None
    # 역할 검출 식별자를 아직 없는 상태로 초기화
    role_detection_id: int | None = None
    # 교집합 합집합 면적 비율을 아직 없는 상태로 초기화
    iou: float | None = None

    # 초기 상태·입력 계약 구성
    def __post_init__(self) -> None:
        # 식별자에 필요한 입력을 전달해 처리
        identifier(self.detection_id, "ROLE_SOURCE_ID_INVALID")
        # 역할 대응 상태의 자료 형식과 허용 조건 확인
        if self.status not in ("MATCHED", "UNMATCHED", "AMBIGUOUS"):
            # 역할 대응 상태 유효하지 않음 오류 알림
            raise ValueError("ROLE_MATCH_STATUS_INVALID")
        # 상태 및 연결된의 불일치 조건 확인
        if self.status != "MATCHED":
            # 연결되지 않은 역할 필드 목록 존재하는을 감지해 잘못된 입력의 후속 사용 차단
            if any(
                value is not None
                for value in (self.role, self.score, self.role_detection_id, self.iou)
            ):
                # 연결되지 않은 역할 필드 목록 존재하는 오류 알림
                raise ValueError("UNMATCHED_ROLE_FIELDS_PRESENT")
            # 현재 함수의 처리 종료
            return
        # 역할 대응 레이블의 자료 형식과 허용 조건 확인
        if self.role not in ROLE_LABELS[1:]:
            # 역할 대응 레이블 유효하지 않음 오류 알림
            raise ValueError("ROLE_MATCH_LABEL_INVALID")
        # 식별자에 필요한 입력을 전달해 처리
        identifier(self.role_detection_id, "ROLE_DETECTION_ID_INVALID")
        # 검증한 모델 출력 점수 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "score", score(self.score, "ROLE_SCORE_INVALID"))
        # 검증한 교집합 합집합 면적 비율 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "iou", score(self.iou, "ROLE_IOU_INVALID"))

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 검출 식별자 필드 기록
            "detectionId": self.detection_id,
            # 상태 필드 기록
            "status": self.status,
            # 역할 필드 기록
            "role": self.role,
            # 모델 출력 점수 필드 기록
            "score": self.score,
            # 역할 검출 식별자 필드 기록
            "roleDetectionId": self.role_detection_id,
            # 교집합 합집합 면적 비율 필드 기록
            "iou": self.iou,
            # 모델이 만든 관측이라는 출처 유형 기록
            "source": "MODEL_ROLE_ASSOCIATION",
            # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
            "admission": "NOT_ADMITTED",
        }


# 관절점의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class Keypoint:
    # 순번을 보관할 자료형 선언
    index: int
    # 이름을 보관할 자료형 선언
    name: str
    # 가로 좌표를 보관할 자료형 선언
    x: float
    # 세로 좌표를 보관할 자료형 선언
    y: float
    # 모델 출력 점수를 보관할 자료형 선언
    score: float

    # 초기 상태·입력 계약 구성
    def __post_init__(self) -> None:
        # 식별자에 필요한 입력을 전달해 처리
        identifier(self.index, "KEYPOINT_INDEX_INVALID")
        # 관절점 대응 관계의 자료 형식과 허용 조건 확인
        if self.index >= len(KEYPOINT_NAMES) or KEYPOINT_NAMES[self.index] != self.name:
            # 관절점 대응 관계 유효하지 않음 오류 알림
            raise ValueError("KEYPOINT_MAPPING_INVALID")
        # 가로 좌표·세로 좌표·모델 출력 점수에서 필드를 하나씩 읽음
        for field in ("x", "y", "score"):
            # 검증한 필드 필드 값을 불변 객체 초기화에 반영
            object.__setattr__(self, field, number(getattr(self, field), "KEYPOINT_VALUE_INVALID"))

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 순번 필드 기록
            "index": self.index,
            # 이름 필드 기록
            "name": self.name,
            # 가로 좌표 필드 기록
            "x": self.x,
            # 세로 좌표 필드 기록
            "y": self.y,
            # 모델 출력 점수 필드 기록
            "score": self.score,
        }


# 자세 관측의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class PoseObservation:
    # 검출 식별자를 보관할 자료형 선언
    detection_id: int
    # 원본 화면의 시작점과 끝점으로 표현한 검출 상자를 보관할 자료형 선언
    source_box: tuple[float, float, float, float]
    # 관절점 목록을 보관할 자료형 선언
    keypoints: tuple[Keypoint, ...]
    # 원본 좌표를 모델 입력 좌표로 옮길 행렬을 보관할 자료형 선언
    source_to_input: tuple[tuple[float, float, float], tuple[float, float, float]]
    # 모델 입력 너비와 높이를 다음 항목으로 구성
    input_size: tuple[int, int] = (192, 256)

    # 초기 상태·입력 계약 구성
    def __post_init__(self) -> None:
        # 식별자에 필요한 입력을 전달해 처리
        identifier(self.detection_id, "POSE_SOURCE_ID_INVALID")
        # 검증한 원본 화면의 시작점과 끝점으로 표현한 검출 상자 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "source_box", box(self.source_box, "POSE_SOURCE_BOX_INVALID"))
        # 자세 관절점 대응 관계의 자료 형식과 허용 조건 확인
        if (
            not isinstance(self.keypoints, tuple)
            or len(self.keypoints) != 17
            or any(not isinstance(point, Keypoint) for point in self.keypoints)
            or tuple(point.index for point in self.keypoints) != tuple(range(17))
        ):
            # 자세 관절점 대응 관계 유효하지 않음 오류 알림
            raise ValueError("POSE_KEYPOINT_MAPPING_INVALID")
        # 자세 입력 크기의 자료 형식과 허용 조건 확인
        if (
            not isinstance(self.input_size, tuple)
            or len(self.input_size) != 2
            or any(type(value) is not int or value <= 0 for value in self.input_size)
        ):
            # 자세 입력 크기 유효하지 않음 오류 알림
            raise ValueError("POSE_INPUT_SIZE_INVALID")
        # 자세 좌표 변환의 자료 형식과 허용 조건 확인
        if (
            not isinstance(self.source_to_input, tuple)
            or len(self.source_to_input) != 2
            or any(not isinstance(row, tuple) or len(row) != 3 for row in self.source_to_input)
        ):
            # 자세 좌표 변환 유효하지 않음 오류 알림
            raise ValueError("POSE_TRANSFORM_INVALID")
        # 변환 행렬에 원본 좌표를 모델 입력 좌표로 옮길 행렬의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 저장
        matrix = tuple(
            tuple(number(value, "POSE_TRANSFORM_INVALID") for value in row)
            for row in self.source_to_input
        )
        # 행렬의 주대각선 곱을 정확한 유리수로 구해 변환 퇴화 검사 준비
        diagonal = Fraction(matrix[0][0]) * Fraction(matrix[1][1])
        # 반대 대각선 곱도 유리수로 계산해 반올림에 따른 행렬식 오판 방지
        cross = Fraction(matrix[0][1]) * Fraction(matrix[1][0])
        # 두 곱이 같으면 좌표를 되돌릴 수 없는 퇴화 변환이므로 거부
        if diagonal == cross:
            # 자세 좌표 변환 유효하지 않음 오류 알림
            raise ValueError("POSE_TRANSFORM_INVALID")
        # 검증한 원본 좌표를 모델 입력 좌표로 옮길 행렬 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "source_to_input", matrix)

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 검출 식별자 필드 기록
            "detectionId": self.detection_id,
            # 원본 상자 필드 기록
            "sourceBox": list(self.source_box),
            # 관절점 목록 필드 기록
            "keypoints": [point.as_record() for point in self.keypoints],
            # 원본 좌표에서 입력 좌표로 옮길 행렬 필드 기록
            "sourceToInput": [list(row) for row in self.source_to_input],
            # 입력 크기 필드 기록
            "inputSize": {"width": self.input_size[0], "height": self.input_size[1]},
            # 모델이 만든 관측이라는 출처 유형 기록
            "source": "MODEL_POSE",
        }

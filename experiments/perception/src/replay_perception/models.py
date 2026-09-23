# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import isfinite
# 불리언과 수치 자료형을 구별할 기준 읽음
from numbers import Real
# 입출력 자료형과 호출 규약 읽음
from typing import Any


# 레이블 목록을 다음 항목으로 구성
LABELS = ("person", "sports ball")

# 불리언을 제외한 유한 실수인지 확인
def finiteReal(value: object) -> bool:
    # 참거짓 값을 제외한 실수이며 무한대나 수치 아님이 아닌지 확인해 반환
    return isinstance(value, Real) and not isinstance(value, bool) and isfinite(value)


# 검출의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class Detection:
    # 검출 식별자를 보관할 자료형 선언
    detection_id: int
    # 레이블을 보관할 자료형 선언
    label: str
    # 원본 화면의 시작점과 끝점 상자 좌표를 보관할 자료형 선언
    box: tuple[float, float, float, float]
    # 모델 출력 점수를 보관할 자료형 선언
    score: float
    # 구간 안에서만 유효한 추적 식별자를 아직 없는 상태로 초기화
    track_id: str | None = None

    # 초기 상태·입력 계약 구성
    def __post_init__(self) -> None:
        # 참거짓 값을 식별자로 받지 않도록 정확한 정수형과 비음수 조건 확인
        if type(self.detection_id) is not int or self.detection_id < 0:
            # 검출 식별자 유효하지 않음 오류 알림
            raise ValueError("DETECTION_ID_INVALID")
        # 사람과 공 이외의 검출 레이블을 자료 계약에서 거부
        if self.label not in LABELS:
            # 검출 레이블 유효하지 않음 오류 알림
            raise ValueError("DETECTION_LABEL_INVALID")
        # 검출 상자의 자료 형식과 허용 조건 확인
        if (
            not isinstance(self.box, tuple)
            or len(self.box) != 4
            or not all(finiteReal(value) for value in self.box)
        ):
            # 검출 상자 유효하지 않음 오류 알림
            raise ValueError("DETECTION_BOX_INVALID")
        # 검증한 네 좌표를 같은 실수형으로 정리
        normalized_box = tuple(float(value) for value in self.box)
        # 상자의 시작 가로·세로와 끝 가로·세로 좌표를 분리
        x1, y1, x2, y2 = normalized_box
        # 음수 시작 좌표나 너비와 높이가 양수가 아닌 상자 거부
        if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
            # 검출 상자 유효하지 않음 오류 알림
            raise ValueError("DETECTION_BOX_INVALID")
        # 점수가 유한하며 영부터 일 사이인지 확인하되 사실의 확률로 해석하지 않음
        if not finiteReal(self.score) or not 0 <= self.score <= 1:
            # 검출 점수 유효하지 않음 오류 알림
            raise ValueError("DETECTION_SCORE_INVALID")
        # 추적 식별자가 제공된 경우 비어 있지 않은 문자열인지 확인
        if self.track_id is not None and (not isinstance(self.track_id, str) or not self.track_id):
            # 추적 식별자 유효하지 않음 오류 알림
            raise ValueError("TRACK_ID_INVALID")
        # 검증한 원본 화면의 시작점과 끝점 상자 좌표 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "box", normalized_box)
        # 검증한 모델 출력 점수 필드 값을 불변 객체 초기화에 반영
        object.__setattr__(self, "score", float(self.score))

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 검출 식별자 필드 기록
            "detectionId": self.detection_id,
            # 레이블 필드 기록
            "label": self.label,
            # 원본 화면의 시작점과 끝점 상자 좌표 필드 기록
            "box": list(self.box),
            # 모델 출력 점수 필드 기록
            "score": self.score,
            # 구간 안에서만 유효한 추적 식별자 필드 기록
            "trackId": self.track_id,
            # 사람 검출만으로 선수나 심판이 확인된 것은 아니므로 역할 미검증 유지
            "actorRole": "UNPROVEN",
            # 모델이 만든 관측이라는 출처 유형 기록
            "source": "MODEL_DETECTION",
        }

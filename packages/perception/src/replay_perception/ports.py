# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 입출력 자료형과 호출 규약 읽음
from typing import Any, Protocol
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection
# 관측 목록 관련 함수와 자료형 읽음
from .observations import PoseObservation, RoleDetection

# 검출기의 필드와 동작을 묶을 자료형 선언
class Detector(Protocol):
    # 출처 정보를 보관할 자료형 선언
    provenance: dict[str, Any]

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(self, rgb: np.ndarray) -> tuple[Detection, ...]: ...

# 역할 모델의 필드와 동작을 묶을 자료형 선언
class RoleModel(Protocol):
    # 출처 정보를 보관할 자료형 선언
    provenance: dict[str, Any]
    # 마지막 좌표 변환을 보관할 자료형 선언
    last_transform: dict[str, Any] | None

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(self, rgb: np.ndarray) -> tuple[RoleDetection, ...]: ...

# 자세 모델의 필드와 동작을 묶을 자료형 선언
class PoseModel(Protocol):
    # 출처 정보를 보관할 자료형 선언
    provenance: dict[str, Any]

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(
        self, rgb: np.ndarray, detections: tuple[Detection, ...]
    ) -> tuple[PoseObservation, ...]: ...

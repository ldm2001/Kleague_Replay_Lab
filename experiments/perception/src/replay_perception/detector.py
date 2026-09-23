# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
import math
# 원본과 분리된 사본 생성 도구 읽음
from copy import deepcopy
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 모델 자산 관련 함수와 자료형 읽음
from .assets import assetVerification
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection


# 점수 임계값을 0점3 값으로 설정
SCORE_THRESHOLD = 0.30
# 출력 레이블 목록에 사람·지정 문자열의 변경 불가 집합 변환 결과 저장
_OUTPUT_LABELS = frozenset({"person", "sports ball"})

# 실행 환경 읽음
def runtimeBundle():
    # 검증된 모델의 텐서 추론 도구 읽음
    import torch
    # 고정 검출·자세 모델의 입력 처리와 추론 도구 읽음
    import transformers
    # 고정 검출·자세 모델의 입력 처리와 추론 도구 읽음
    from transformers import AutoImageProcessor, RTDetrForObjectDetection

    # 여러 값을 순서대로 모은 자료 반환
    return torch, transformers, AutoImageProcessor, RTDetrForObjectDetection


# 사람과 공 검출 모델 검출기의 필드와 동작을 묶을 자료형 선언
class RtdetrDetector:

    # 초기 상태·입력 계약 구성
    def __init__(self, model_dir: Path | str, device: str = "cpu") -> None:
        # 실행 장치 지원하지 않음을 감지해 잘못된 입력의 후속 사용 차단
        if device not in {"cpu", "mps"}:
            # 실행 장치 지원하지 않음 오류 알림
            raise ValueError(f"DEVICE_UNSUPPORTED: {device}")
        # 모델 경로에 심볼릭 링크를 해석한 경로 저장
        model_path = Path(model_dir).expanduser().resolve(strict=False)

        # 여러 값을 순서대로 모은 자료에 실행에 필요한 모델 도구 묶음 저장
        torch, transformers, processor_class, model_class = runtimeBundle()
        # 실행 장치 사용 불가를 감지해 잘못된 입력의 후속 사용 차단
        if device == "mps" and not torch.backends.mps.is_available():
            # 실행 장치 사용 불가 오류 알림
            raise RuntimeError("DEVICE_UNAVAILABLE: mps")

        # 메타데이터에 고정 자산 무결성 확인 결과 저장
        metadata = assetVerification(model_path)
        # 모델 설정 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if (
            metadata.get("architecture") != "RTDetrForObjectDetection"
            or metadata.get("disable_custom_kernels") is not True
            or metadata.get("threshold") != SCORE_THRESHOLD
        ):
            # 모델 설정 불일치 오류 알림
            raise ValueError("MODEL_CONFIG_MISMATCH")

        # 폴더에 모델 경로의 문자열 변환 결과 저장
        directory = str(model_path)
        # 입력 처리기에 검증된 로컬 파일에서 읽은 모델 구성 저장
        processor = processor_class.from_pretrained(
            directory,
            local_files_only=True,
            trust_remote_code=False,
        )
        # 모델에 검증된 로컬 파일에서 읽은 모델 구성 저장
        model = model_class.from_pretrained(
            directory,
            local_files_only=True,
            use_safetensors=True,
        )
        # 학습 구조와 레이블 대응 및 사용자 연산 비활성 설정이 승인 계약과 같은지 확인
        if not safeConfig(model.config):
            # 모델 설정 불일치 오류 알림
            raise ValueError("MODEL_CONFIG_MISMATCH")
        # 모델을 지정한 장치와 수치 정밀도로 이동
        model.to(device, dtype=torch.float32)
        # 모델의 학습 동작을 끄고 추론용 상태 설정
        model.eval()

        # 텐서 추론 도구에 텐서 실행 도구 저장
        self._torch = torch
        # 입력 처리기에 입력 처리기 저장
        self._processor = processor
        # 모델에 모델 저장
        self._model = model
        # 실행 장치에 실행 장치 저장
        self._device = device
        # 식별자 2 레이블에 키와 값의 쌍 목록의 항목별 변환 결과 저장
        self._id2label = {
            int(identifier): str(label) for identifier, label in model.config.id2label.items()
        }
        # 출처 정보를 다음 항목으로 구성
        self.provenance = {
            **deepcopy(metadata),
            # 실행 장치 필드 기록
            "device": device,
            # 수치 정밀도 필드 기록
            "precision": "float32",
            # 라이브러리 버전 목록 필드 기록
            "library_versions": {
                # 텐서 실행 도구 필드 기록
                "torch": torch.__version__,
                # 모델 실행 도구 필드 기록
                "transformers": transformers.__version__,
            },
        }

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(self, rgb: np.ndarray) -> tuple[Detection, ...]:
        # 검출기 입력의 자료 형식과 허용 조건 확인
        if (
            not isinstance(rgb, np.ndarray)
            or rgb.dtype != np.uint8
            or rgb.ndim != 3
            or rgb.shape[2] != 3
            or rgb.shape[0] <= 0
            or rgb.shape[1] <= 0
        ):
            # 검출기 입력 유효하지 않음 오류 알림
            raise ValueError("DETECTOR_INPUT_INVALID")

        # 원본 영상의 세로와 가로 크기를 읽어 후처리 좌표 복원 준비
        height, width = rgb.shape[:2]
        # 원본 영상을 고정 입력 처리기에 통과시키고 추론 장치로 이동
        inputs = self._processor(images=rgb, return_tensors="pt").to(self._device)
        # 처리 종료 시 정리되도록 학습용 기울기 기록을 끈 추론 문맥 사용
        with self._torch.inference_mode():
            # 승인 검출 모델로 현재 표본의 원시 예측값 계산
            outputs = self._model(**inputs)
        # 후처리 좌표를 원본 높이와 너비 기준으로 복원할 크기 전달
        target_sizes = self._torch.tensor([[height, width]], device=self._device)
        # 고정 점수 기준을 적용하고 예측 상자를 원본 화면 크기로 복원
        processed = self._processor.post_process_object_detection(
            outputs,
            threshold=SCORE_THRESHOLD,
            target_sizes=target_sizes,
        )
        # 처리된이 비어 있거나 조건을 충족하지 않는지 확인
        if not processed:
            # 승인 검출 구조와 사용자 연산 비활성 및 레이블 대응 설정의 일치 여부 반환
            return ()

        # 결과에 처리된의 선택 항목 저장
        result = processed[0]
        # 상자 목록에 저장된 값 목록 저장
        boxes = values(result["boxes"])
        # 점수 목록에 저장된 값 목록 저장
        scores = values(result["scores"])
        # 레이블 목록에 저장된 값 목록 저장
        labels = values(result["labels"])
        # 검출 목록을 모를 빈 자료 생성
        detections: list[Detection] = []
        # 순서별로 묶은 항목에서 원시 상자·원시 점수·원시 레이블을 하나씩 읽음
        for raw_box, raw_score, raw_label in zip(boxes, scores, labels, strict=False):
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 모델 출력 점수에 원시 점수의 실수 변환 결과 저장
                score = float(raw_score)
                # 레이블에 원시 레이블의 정수 변환 결과의 키에 해당하는 값 저장
                label = self._id2label.get(int(raw_label))
                # 원본 화면의 시작점과 끝점 상자 좌표에 원시 상자의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 저장
                box = tuple(float(value) for value in raw_box)
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except (TypeError, ValueError, OverflowError):
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 레이블 및 출력 레이블 목록의 미포함 조건 또는 부정 조건 모델 출력 점수의 유한 수치 여부 또는 모델 출력 점수 및 점수 임계값의 미만 조건 확인
            if (
                label not in _OUTPUT_LABELS
                or not math.isfinite(score)
                or score < SCORE_THRESHOLD
                or score > 1.0
                or len(box) != 4
                or not all(math.isfinite(value) for value in box)
            ):
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 여러 값을 순서대로 모은 자료에 원본 화면의 시작점과 끝점 상자 좌표 저장
            x1, y1, x2, y2 = box
            # 원본 화면 바깥 예측 좌표를 각 축의 실제 경계 안으로 제한
            clipped = (
                min(max(x1, 0.0), float(width)),
                min(max(y1, 0.0), float(height)),
                min(max(x2, 0.0), float(width)),
                min(max(y2, 0.0), float(height)),
            )
            # 경계 보정 후 너비나 높이가 영 이하인 상자는 검출에서 제외
            if clipped[2] <= clipped[0] or clipped[3] <= clipped[1]:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 검출 목록에 검출 처리 결과 추가
            detections.append(
                Detection(
                    detection_id=len(detections),
                    label=label,
                    box=clipped,
                    score=score,
                )
            )
        # 검출 목록의 순서를 고정한 튜플 변환 결과 반환
        return tuple(detections)

# 모델 설정이 승인된 구조와 로컬 실행 조건을 만족하는지 확인
def safeConfig(config: Any) -> bool:
    # 모델 구조 목록에 설정의 속성 또는 기본값 저장
    architectures = getattr(config, "architectures", None)
    # 승인 검출 구조와 사용자 연산 비활성 및 레이블 대응 설정의 일치 여부 반환
    return (
        isinstance(architectures, (list, tuple))
        and "RTDetrForObjectDetection" in architectures
        and getattr(config, "disable_custom_kernels", None) is True
        and isinstance(getattr(config, "id2label", None), dict)
    )

# 장치의 텐서 값을 중앙 처리 장치의 일반 목록으로 변환
def values(tensor: Any) -> list[Any]:
    # 학습 연결을 끊고 중앙 처리 장치로 옮겨 일반 값 목록 반환
    return tensor.detach().cpu().tolist()

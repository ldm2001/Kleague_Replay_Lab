# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 원본과 분리된 사본 생성 도구 읽음
from copy import deepcopy
# 설치 라이브러리 버전 조회 도구 읽음
from importlib.metadata import version
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection
# 관측 목록 관련 함수와 자료형 읽음
from .observations import KEYPOINT_NAMES, Keypoint, PoseObservation
# 모델 가중치 관련 함수와 자료형 읽음
from .weights import verification


# 고정 모델 입력 크기를 다음 항목으로 구성
_INPUT_SIZE = (192, 256)
# 묶음 크기를 8 값으로 설정
_BATCH_SIZE = 8
# 고정 학습 자료에 맞는 전문가 분기 번호를 0 값으로 설정
_EXPERT_INDEX = 0
# 학습 입력과 동일하게 유지할 전처리 설정을 다음 항목으로 구성
_PREPROCESSING = {
    # 크기 필드 기록
    "size": {"height": 256, "width": 192},
    # 적용 여부 일차 좌표 변환 좌표 변환 필드 기록
    "do_affine_transform": True,
    # 정규화 배율 필드 기록
    "normalize_factor": 200.0,
    # 적용 여부 값 배율 조정 필드 기록
    "do_rescale": True,
    # 값 배율 조정 배율 필드 기록
    "rescale_factor": 1 / 255,
    # 적용 여부 정규화 필드 기록
    "do_normalize": True,
    # 영상 평균 필드 기록
    "image_mean": [0.485, 0.456, 0.406],
    # 영상 표준편차 필드 기록
    "image_std": [0.229, 0.224, 0.225],
}

# 실행 환경 읽음
def runtimeBundle():
    # 검증된 모델의 텐서 추론 도구 읽음
    import torch
    # 고정 검출·자세 모델의 입력 처리와 추론 도구 읽음
    import transformers
    # 고정 검출·자세 모델의 입력 처리와 추론 도구 읽음
    from transformers import VitPoseForPoseEstimation
    # 모델 실행 도구 모델 목록 자세 추정 모델 영상 처리 영상 처리기 자세 추정 모델 관련 함수와 자료형 읽음
    from transformers.models.vitpose.image_processing_pil_vitpose import (
        VitPoseImageProcessorPil, get_warp_matrix, scipy_warp_affine,
    )

    # 삼원색 영상 자세 모델 자세 영상 입력 처리기 영상 처리기의 필드와 동작을 묶을 자료형 선언
    class RgbVitPoseImageProcessorPil(VitPoseImageProcessorPil):

        # 자세 입력 영상을 지정한 중심·배율·회전에 맞춰 변환
        def affine_transform(self, image, center, scale, rotation, size):
            # 영상 처리기의 채널·높이·너비 순서 보장과 기본 변환의 크기 추정 주의
            # 선택한 처리기의 실제 중심과 배율로 원본에서 입력으로 향하는 행렬 생성
            matrix = get_warp_matrix(
                rotation, center * 2.0, np.array((size.width, size.height)) - 1.0, scale * 200.0
            )
            # 색상 축을 뒤로 옮긴 영상에 동일한 기하 변환 적용
            transformed = scipy_warp_affine(
                image.transpose(1, 2, 0), matrix, (size.height, size.width)
            )
            # 모델이 요구하는 채널과 높이 및 너비 순서로 되돌려 반환
            return transformed.transpose(2, 0, 1)

    # 여러 값을 순서대로 모은 자료 반환
    return torch, transformers, RgbVitPoseImageProcessorPil, VitPoseForPoseEstimation

# 모델 설정이 승인된 구조와 로컬 실행 조건을 만족하는지 확인
def safeConfig(config: Any) -> bool:
    # 특징 추출기에 설정의 속성 또는 기본값 저장
    backbone = getattr(config, "backbone_config", None)
    # 레이블 목록에 설정의 속성 또는 기본값 저장
    labels = getattr(config, "id2label", None)
    # 영상 크기에 특징 추출기의 속성 또는 기본값 저장
    image_size = getattr(backbone, "image_size", None)
    # 모델 종류와 관절 순서 및 입력 크기와 전문가 분기 수가 승인 구조에 맞는지 반환
    return (
        getattr(config, "architectures", None) == ["VitPoseForPoseEstimation"]
        and getattr(config, "model_type", None) == "vitpose"
        and isinstance(labels, dict)
        and all(type(index) is int for index in labels)
        and labels == dict(enumerate(KEYPOINT_NAMES))
        and getattr(config, "num_labels", None) == 17
        and getattr(config, "use_simple_decoder", None) is False
        and getattr(backbone, "model_type", None) == "vitpose_backbone"
        and isinstance(image_size, (list, tuple))
        and tuple(image_size) == (256, 192)
        and getattr(backbone, "num_experts", None) == 6
    )

# 원본 상자 좌표를 자세 모델 입력 좌표로 연결하는 변환을 생성
def inputTransform(
    box: list[float],
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    # 선택한 처리기의 중심·배율·좌표 변환 함수를 그대로 사용
    # 32비트 실수 반올림 보존과 단순 자르기·크기 조정의 대체 금지
    from transformers.models.vitpose.image_processing_pil_vitpose import (
        box_to_center_and_scale,
        get_warp_matrix,
    )

    # 중심·배율에 상자 중심과 모델 전처리 배율 저장
    center, scale = box_to_center_and_scale(
        box,
        image_width=192,
        image_height=256,
        normalize_factor=200.0,
        padding_factor=1.25,
    )
    # 선택한 처리기의 실제 중심과 배율로 원본에서 입력으로 향하는 행렬 생성
    matrix = get_warp_matrix(0, center * 2.0, np.array(_INPUT_SIZE) - 1.0, scale * 200.0)
    # 변환 크기와 유한 수치 및 역변환 가능성을 확인해 잘못된 관절 좌표 생성 차단
    if matrix.shape != (2, 3) or not np.isfinite(matrix).all() or np.linalg.det(matrix[:, :2]) == 0:
        # 자세 좌표 변환 유효하지 않음 오류 알림
        raise ValueError("POSE_TRANSFORM_INVALID")
    # 변환 행렬의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 반환
    return tuple(tuple(float(value) for value in row) for row in matrix)


# 자세 모델 자세 추정기의 필드와 동작을 묶을 자료형 선언
class VitPoseEstimator:
    """고정된 로컬 자세 관측이며 역할·신호·파울 판정 제외"""

    # 초기 상태·입력 계약 구성
    def __init__(self, model_dir: Path | str, device: str = "cpu") -> None:
        # 실행 장치 지원하지 않음을 감지해 잘못된 입력의 후속 사용 차단
        if device not in ("cpu", "mps"):
            # 실행 장치 지원하지 않음 오류 알림
            raise ValueError(f"DEVICE_UNSUPPORTED: {device}")
        # 제공한 경로에 사용자 폴더 약어를 확장한 경로 저장
        supplied_path = Path(model_dir).expanduser()
        # 여러 값을 순서대로 모은 자료에 실행에 필요한 모델 도구 묶음 저장
        torch, transformers, processor_class, model_class = runtimeBundle()
        # 실행 장치 사용 불가를 감지해 잘못된 입력의 후속 사용 차단
        if device == "mps" and not torch.backends.mps.is_available():
            # 실행 장치 사용 불가 오류 알림
            raise RuntimeError("DEVICE_UNAVAILABLE: mps")
        # 메타데이터에 고정 판본과 해시의 무결성 확인 결과 저장
        metadata = verification("pose", supplied_path)
        # 모델 경로에 심볼릭 링크를 해석한 경로 저장
        model_path = supplied_path.resolve(strict=False)
        # 자세 모델 설정 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if metadata.get("architecture") != "VitPoseForPoseEstimation":
            # 자세 모델 설정 불일치 오류 알림
            raise ValueError("POSE_MODEL_CONFIG_MISMATCH")

        # 입력 처리기에 검증된 로컬 파일에서 읽은 모델 구성 저장
        processor = processor_class.from_pretrained(
            str(model_path / "preprocessor_config.json"),
            local_files_only=True,
            trust_remote_code=False,
            **deepcopy(_PREPROCESSING),
        )
        # 모델에 검증된 로컬 파일에서 읽은 모델 구성 저장
        model = model_class.from_pretrained(
            str(model_path),
            local_files_only=True,
            trust_remote_code=False,
            use_safetensors=True,
            weights_only=True,
        )
        # 자세 모델 설정 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if not safeConfig(model.config):
            # 자세 모델 설정 불일치 오류 알림
            raise ValueError("POSE_MODEL_CONFIG_MISMATCH")
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
        # 출처 정보를 다음 항목으로 구성
        self.provenance = {
            **deepcopy(metadata),
            # 실행 장치 필드 기록
            "device": device,
            # 수치 정밀도 필드 기록
            "precision": "float32",
            # 전문가 분기 순번 필드 기록
            "expert_index": _EXPERT_INDEX,
            # 전문가 분기 학습 자료 구분 필드 기록
            "expert_dataset": "COCO",
            # 묶음 크기 필드 기록
            "batch_size": _BATCH_SIZE,
            # 입력 처리기 실행 도구 필드 기록
            "processor_backend": f"{type(processor).__module__}.{type(processor).__name__}",
            # 라이브러리 버전 목록 필드 기록
            "library_versions": {
                # 텐서 실행 도구 필드 기록
                "torch": torch.__version__,
                # 모델 실행 도구 필드 기록
                "transformers": transformers.__version__,
                # 수치 배열 필드 기록
                "numpy": np.__version__,
                # 수치 변환 도구 필드 기록
                "scipy": version("scipy"),
                # 영상 처리 도구 필드 기록
                "pillow": version("pillow"),
            },
            # 전처리 필드 기록
            "preprocessing": {
                **deepcopy(_PREPROCESSING),
                # 입력 색상 필드 기록
                "input_color": "RGB",
                # 입력 배열 자료형 필드 기록
                "input_dtype": "uint8",
                # 입력 상자 형식 필드 기록
                "input_box_format": "source_xyxy",
                # 일차 좌표 변환 색상 채널 축 배열 순서 필드 기록
                "affine_channel_layout": "explicit_CHW_to_HWC_no_dimension_heuristic",
                # 입력 처리기 상자 형식 필드 기록
                "processor_box_format": "source_xywh",
                # 종횡 비율 필드 기록
                "aspect_ratio": 192 / 256,
                # 여백 배율 필드 기록
                "padding_factor": 1.25,
                # 회전 도 단위 필드 기록
                "rotation_degrees": 0,
                # 일차 좌표 변환 필드 기록
                "affine": "UDP: center*2, destination=(191,255), padded_scale*200",
                # 재표본화 필드 기록
                "resampling": "scipy.ndimage.affine_transform order=1 constant=0",
            },
            # 후처리 필드 기록
            "postprocessing": {
                # 방법 필드 기록
                "method": "post_process_pose_estimation",
                # 연산 커널 크기 필드 기록
                "kernel_size": 11,
                # 임계값 필드 기록
                "threshold": None,
                # 좌표 목록 필드 기록
                "coordinates": "source_image_pixels",
                # 점수 목록 필드 기록
                "scores": "raw_heatmap_maxima_not_probabilities",
                # 관절점 정렬 순서 필드 기록
                "keypoint_order": list(KEYPOINT_NAMES),
                # 원본 화면의 시작점과 끝점으로 표현한 검출 상자 필드 기록
                "source_box": "original_detection_xyxy_unmodified",
                # 출력 대상 영상 좌표 목록 필드 기록
                "out_of_image_coordinates": "preserved",
                # 경계 제한 필드 기록
                "clipping": False,
                # 시간축 보간 필드 기록
                "temporal_interpolation": False,
            },
        }

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(
        self, rgb: np.ndarray, detections: tuple[Detection, ...]
    ) -> tuple[PoseObservation, ...]:
        # 자세 입력의 자료 형식과 허용 조건 확인
        if (
            not isinstance(rgb, np.ndarray)
            or rgb.dtype != np.uint8
            or rgb.ndim != 3
            or rgb.shape[2] != 3
            or rgb.shape[0] <= 0
            or rgb.shape[1] <= 0
        ):
            # 자세 입력 유효하지 않음 오류 알림
            raise ValueError("POSE_INPUT_INVALID")
        # 높이·너비에 삼원색 영상의 배열 크기의 선택 항목 저장
        height, width = rgb.shape[:2]
        # 자세 검출 목록의 자료 형식과 허용 조건 확인
        if (
            not isinstance(detections, tuple)
            or any(
                not isinstance(person, Detection)
                or person.label != "person"
                or person.box[2] > width
                or person.box[3] > height
                for person in detections
            )
            or len({person.detection_id for person in detections}) != len(detections)
        ):
            # 자세 검출 목록 유효하지 않음 오류 알림
            raise ValueError("POSE_DETECTIONS_INVALID")
        # 관측 목록을 모를 빈 자료 생성
        observations = []
        # 반복할 순번 범위에서 이동량을 하나씩 읽음
        for offset in range(0, len(detections), _BATCH_SIZE):
            # 자세 추론에 사용할 원본 사람 검출을 순서대로 준비
            people = detections[offset:offset + _BATCH_SIZE]
            # 상자 목록에 사람 목록의 항목별 변환 결과의 항목별 변환 결과 저장
            boxes = [
                [x1, y1, x2 - x1, y2 - y1] for x1, y1, x2, y2 in (person.box for person in people)
            ]
            # 각 사람 상자의 실제 입력 변환을 보존해 관절 좌표의 근거 기록
            matrices = tuple(inputTransform(box) for box in boxes)
            # 입력 묶음에 지정 장치와 자료형으로 옮긴 값 저장
            inputs = self._processor(
                images=rgb, boxes=[boxes], input_data_format="channels_last", return_tensors="pt"
            ).to(self._device)
            # 화소 수에 화소 값 목록의 키에 해당하는 값 저장
            pixels = inputs.get("pixel_values")
            # 자세 전처리의 자료 형식과 허용 조건 확인
            if (
                not isinstance(pixels, self._torch.Tensor)
                or tuple(pixels.shape) != (len(people), 3, 256, 192)
                or pixels.dtype != self._torch.float32
                or not self._torch.isfinite(pixels).all().item()
            ):
                # 자세 전처리 유효하지 않음 오류 알림
                raise ValueError("POSE_PREPROCESSING_INVALID")
            # 학습 자료 구분 순번에 전체 처리 결과 저장
            dataset_index = self._torch.full(
                (len(people),), _EXPERT_INDEX, dtype=self._torch.long, device=self._device
            )
            # 처리 종료 시 정리되도록 학습용 기울기 기록을 끈 추론 문맥 사용
            with self._torch.inference_mode():
                # 출력 목록에 모델 처리 결과 저장
                outputs = self._model(**inputs, dataset_index=dataset_index)
                # 관절점 열지도에 출력 목록의 속성 또는 기본값 저장
                heatmaps = getattr(outputs, "heatmaps", None)
                # 자세 출력의 자료 형식과 허용 조건 확인
                if (
                    not isinstance(heatmaps, self._torch.Tensor)
                    or tuple(heatmaps.shape) != (len(people), 17, 64, 48)
                    or heatmaps.dtype != self._torch.float32
                    or not self._torch.isfinite(heatmaps).all().item()
                ):
                    # 자세 출력 유효하지 않음 오류 알림
                    raise ValueError("POSE_OUTPUT_INVALID")
                # 처리된에 후처리 프로세스 자세 추정 처리 결과 저장
                processed = self._processor.post_process_pose_estimation(
                    outputs,
                    boxes=[boxes],
                    kernel_size=11,
                    threshold=None,
                )
            # 자세 출력의 자료 형식과 허용 조건 확인
            if (
                not isinstance(processed, list)
                or len(processed) != 1
                or not isinstance(processed[0], list)
                or len(processed[0]) != len(people)
            ):
                # 자세 출력 유효하지 않음 오류 알림
                raise ValueError("POSE_OUTPUT_INVALID")
            # 순서별로 묶은 항목에서 사람·변환 행렬·결과를 하나씩 읽음
            for person, matrix, result in zip(people, matrices, processed[0], strict=True):
                # 관절점 목록에 관절점 목록 처리 결과 저장
                keypoints = self.keypoints(result)
                # 관측 목록에 자세 관측 처리 결과 추가
                observations.append(
                    PoseObservation(person.detection_id, person.box, keypoints, matrix, _INPUT_SIZE)
                )
        # 관측 목록의 순서를 고정한 튜플 변환 결과 반환
        return tuple(observations)

    # 모델 출력의 관절 좌표와 점수를 원본 관측으로 변환
    def keypoints(self, result: Any) -> tuple[Keypoint, ...]:
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 점 목록·점수 목록·레이블 목록에 관절점 목록·점수 목록·레이블 목록의 항목별 변환 결과 저장
            points, scores, labels = (
                result[key].detach().cpu().numpy() for key in ("keypoints", "scores", "labels")
            )
            # 자세 출력의 자료 형식과 허용 조건 확인
            if (
                points.shape != (17, 2)
                or scores.shape != (17,)
                or labels.shape != (17,)
                or not np.issubdtype(points.dtype, np.floating)
                or not np.issubdtype(scores.dtype, np.floating)
                or not np.issubdtype(labels.dtype, np.integer)
                or not np.array_equal(labels, np.arange(17))
                or not np.isfinite(points).all()
                or not np.isfinite(scores).all()
            ):
                # 자세 출력 유효하지 않음 오류 알림
                raise ValueError("POSE_OUTPUT_INVALID")
            # 순번을 붙인 항목 목록의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 반환
            return tuple(
                Keypoint(
                    index,
                    name,
                    float(points[index, 0]),
                    float(points[index, 1]),
                    float(scores[index]),
                )
                for index, name in enumerate(KEYPOINT_NAMES)
            )
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError) as exc:
            # 자세 출력 유효하지 않음 오류 알림
            raise ValueError("POSE_OUTPUT_INVALID") from exc

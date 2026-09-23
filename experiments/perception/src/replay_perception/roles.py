# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 원본과 분리된 사본 생성 도구 읽음
from copy import deepcopy
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 검증한 바이트를 파일처럼 읽을 메모리 스트림 읽음
from io import BytesIO
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 실행 경로와 표준 입출력을 다룰 도구 읽음
import sys
# 충돌하지 않는 임시 경로 생성 도구 읽음
import tempfile
# 가중치 읽기 전역 상태를 보호할 잠금 도구 읽음
from threading import RLock
# 실행 도구를 속성으로 묶을 자료형 읽음
from types import SimpleNamespace
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 가중치 저장본 내부를 검사할 압축 자료 도구 읽음
from zipfile import ZipFile
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 관측 목록 관련 함수와 자료형 읽음
from .observations import ROLE_LABELS, RoleDetection
# 모델 가중치 관련 함수와 자료형 읽음
from .weights import verification


# 모델 저장본 이름을 지정 문자열 값으로 설정
_CHECKPOINT_NAME = "yolo-football-player-detection.pt"
# 모델 저장본 최댓값 바이트를 40583084 값으로 설정
_CHECKPOINT_MAX_BYTES = 40583084
# 안전 역직렬화 전역 목록의 동시 변경 방지 잠금에 잠금 처리 결과 저장
_SAFE_LOAD_LOCK = RLock()
# 파이토치 2점6의 승인 자세 실행 환경에서 전역 객체 등록
# 분산 텐서·영상 최적화 객체의 실행 환경 공존 목록
# 가중치 허용 목록이 아니며 목록 구성을 위한 모듈 불러오기 금지
_RUNTIME_AMBIENT_OBJECTS = (
    ("torch.distributed.device_mesh", "DeviceMesh"),
    ("torch.distributed.tensor._dtensor_spec", "DTensorSpec"),
    ("torch.distributed.tensor._dtensor_spec", "TensorMeta"),
    ("torch.distributed.tensor", "DTensor"),
    ("torch.distributed.tensor.placement_types", "Partial"),
    ("torch.distributed.tensor.placement_types", "Replicate"),
    ("torch.distributed.tensor.placement_types", "Shard"),
    ("torch._dynamo.decorators", "_DimRange"),
)
# 고정 모델 입력 크기를 640 값으로 설정
_INPUT_SIZE = 640
# 검출 점수를 0점5 값으로 설정
_CONFIDENCE = 0.50
# 겹침 억제 교집합 합집합 면적 비율을 0점7 값으로 설정
_NMS_IOU = 0.70
# 최댓값 검출 목록을 300 값으로 설정
_MAX_DETECTIONS = 300
# 최댓값 예측 위치 수를 8400 값으로 설정
_MAX_ANCHORS = 8400  # 고정 모델 입력 크기 80×80 + 40×40 + 20×20
# 계층 자료형 목록을 다음 항목으로 구성
_LAYER_TYPES = (
    "Conv",
    "Conv",
    "C3k2",
    "Conv",
    "C3k2",
    "Conv",
    "C3k2",
    "Conv",
    "C3k2",
    "SPPF",
    "C2PSA",
    "Upsample",
    "Concat",
    "C3k2",
    "Upsample",
    "Concat",
    "C3k2",
    "Conv",
    "Concat",
    "C3k2",
    "Conv",
    "Concat",
    "C3k2",
    "Detect",
)

# 실행 환경 읽음
def runtimeBundle() -> SimpleNamespace:
    # 실행 환경 초기화 중 프로세스 전역 설정의 임시 변경
    with _SAFE_LOAD_LOCK:
        # 잠금 내부 실행 환경 처리 결과 반환
        return lockedRuntime()

# 잠금 내 실행 환경 읽음
def lockedRuntime() -> SimpleNamespace:
    # 직접 추론에서 외부 라이브러리의 경로 읽기·예측기·콜백 사용 금지
    # 설정 동기화·의존성 설치·사전학습 예열 사용 금지
    os.environ["YOLO_OFFLINE"] = "1"
    # 운영체제 도구의 환경 변수의 역할 검출 모델 자동 설치를 지정 문자열 값으로 설정
    os.environ["YOLO_AUTOINSTALL"] = "0"
    # 운영체제 도구의 환경 변수의 역할 모델 라이브러리 안전 검사 읽기를 지정 문자열 값으로 설정
    os.environ["ULTRALYTICS_SAFE_LOAD"] = "1"
    # 색상과 선분 및 미리보기를 다룰 영상 처리 도구 읽음
    import cv2
    # 검증된 모델의 텐서 추론 도구 읽음
    import torch

    # 이전 설정에 역할 검출 모델 설정 폴더의 키에 해당하는 값 저장
    previous_config = os.environ.get("YOLO_CONFIG_DIR")
    # 처리 종료 시 정리되도록 임시 파일 폴더 처리 결과 사용
    with tempfile.TemporaryDirectory(prefix="replay-role-settings-") as config_dir:
        # 운영체제 도구의 환경 변수의 역할 검출 모델 설정 폴더에 설정 폴더 저장
        os.environ["YOLO_CONFIG_DIR"] = config_dir
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 역할 모델 라이브러리 관련 함수와 자료형 읽음
            import ultralytics
            # 역할 모델 라이브러리 관련 함수와 자료형 읽음
            from ultralytics import utils
            # 역할 모델 라이브러리 신경망 모델 정의 관련 함수와 자료형 읽음
            from ultralytics.nn.tasks import DetectionModel
            # 역할 모델 라이브러리 신경망 모듈 목록 계층 묶음 관련 함수와 자료형 읽음
            from ultralytics.nn.modules.block import (
                Attention,
                Bottleneck,
                C2PSA,
                C3k,
                C3k2,
                DFL,
                PSABlock,
                SPPF,
            )
            # 역할 모델 라이브러리 신경망 모듈 목록 합성곱 관련 함수와 자료형 읽음
            from ultralytics.nn.modules.conv import Concat, Conv, DWConv
            # 역할 모델 라이브러리 신경망 모듈 목록 출력 계층 관련 함수와 자료형 읽음
            from ultralytics.nn.modules.head import Detect
            # 보조 도구의 외부 연결 여부를 거짓 값으로 설정
            utils.ONLINE = False
            # 보조 도구의 자동 설치를 거짓 값으로 설정
            utils.AUTOINSTALL = False
            # 메모리에서만 변경하고 사용자 영구 설정 보존
            dict.__setitem__(utils.SETTINGS, "sync", False)
        # 성공과 실패에 관계없이 남은 자원 정리
        finally:
            # 이전 설정이 없는지 확인
            if previous_config is None:
                # 제거한 값에 필요한 입력을 전달해 처리
                os.environ.pop("YOLO_CONFIG_DIR", None)
            # 앞선 분기에 해당하지 않는 경우 처리
            else:
                # 운영체제 도구의 환경 변수의 역할 검출 모델 설정 폴더에 이전 설정 저장
                os.environ["YOLO_CONFIG_DIR"] = previous_config
    # 신뢰 목록을 다음 항목으로 구성
    trusted = (
        DetectionModel,
        Attention,
        Bottleneck,
        C2PSA,
        C3k,
        C3k2,
        DFL,
        PSABlock,
        SPPF,
        Concat,
        Conv,
        DWConv,
        Detect,
        torch.nn.Sequential,
        torch.nn.ModuleList,
        torch.nn.Conv2d,
        torch.nn.BatchNorm2d,
        torch.nn.SiLU,
        torch.nn.Identity,
        torch.nn.MaxPool2d,
        torch.nn.Upsample,
    )
    # 단순 속성 묶음 처리 결과 반환
    return SimpleNamespace(
        torch=torch,
        cv2=cv2,
        version=ultralytics.__version__,
        model_type=DetectionModel,
        trusted_classes=trusted,
    )

# 객체의 모듈과 클래스 이름을 정규화된 전역 이름으로 생성
def globalName(value: Any) -> str:
    # 현재 값을 포함한 문자열 반환
    return f"{value.__module__}.{value.__qualname__}"

# 허용된 실행 환경의 전역 객체 목록 수집
def ambientObjects() -> tuple[Any, ...]:
    # 객체 목록을 모를 빈 자료 생성
    objects = []
    # 공존만 허용하고 가중치 참조는 허용하지 않는 전역 객체 목록에서 모듈 이름·속성을 하나씩 읽음
    for module_name, attribute in _RUNTIME_AMBIENT_OBJECTS:
        # 모듈에 모듈 이름의 키에 해당하는 값 저장
        module = sys.modules.get(module_name)
        # 값에 조건에 따라 선택한 없음 저장
        value = None if module is None else vars(module).get(attribute)
        # 값이 있는지 확인
        if value is not None:
            # 객체 목록에 값 추가
            objects.append(value)
    # 객체 목록의 순서를 고정한 튜플 변환 결과 반환
    return tuple(objects)

# 가중치 직렬화에서 기본형 이외의 전역 참조를 추출
def checkpointGlobals(payload: bytes, torch: Any) -> set[str]:
    # 공개 감사의 프로세스 전역 등록 제외와 별도 감사 구분
    # 고정된 파이토치 2점6 정적 명령 검사기로 모든 전역 참조 검사
    # 내장된 가중치 전용 기본 객체만 제외하고 주변 등록 클래스 유지
    # 미지원 형식·명령은 거부하고 직렬화 객체 실행 금지
    with ZipFile(BytesIO(payload)) as archive:
        # 기록 목록에 저장본 항목 목록 처리 결과에서 조건에 맞는 항목을 모은 값 저장
        records = [
            info
            for info in archive.infolist()
            if info.filename == "data.pkl" or info.filename.endswith("/data.pkl")
        ]
        # 역할 모델 저장본 객체 직렬화 자료의 자료 형식과 허용 조건 확인
        if len(records) != 1 or records[0].file_size > _CHECKPOINT_MAX_BYTES:
            # 역할 모델 저장본 객체 직렬화 자료 유효하지 않음 오류 알림
            raise ValueError("ROLE_CHECKPOINT_PICKLE_INVALID")
        # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
        with archive.open(records[0]) as source:
            # 자료에 한도 안에서 읽은 바이트 저장
            data = source.read(_CHECKPOINT_MAX_BYTES + 1)
        # 역할 모델 저장본 객체 직렬화 자료의 자료 형식과 허용 조건 확인
        if len(data) > _CHECKPOINT_MAX_BYTES:
            # 역할 모델 저장본 객체 직렬화 자료 유효하지 않음 오류 알림
            raise ValueError("ROLE_CHECKPOINT_PICKLE_INVALID")
    # 직렬화 검사기에 텐서 실행 도구의 모델 가중치 전용 역직렬화 검사기 저장
    scanner = torch._weights_only_unpickler
    # 조회 전역 참조 목록 내부 객체 직렬화 자료 처리 결과 및 조회 전역 참조 목록 처리 결과의 중복을 없앤 집합 변환 결과의 차이 반환
    return scanner.get_globals_in_pkl(BytesIO(data)) - set(scanner._get_allowed_globals())

# 모델 가중치 읽음
def checkpointData(
    path: Path, runtime: SimpleNamespace, *, expected_sha256: str | None = None
) -> tuple[dict, list[str]]:
    # 프로세스 전역 안전 객체 목록의 동시 역할 읽기 보호
    # 역직렬화 중 다른 작업의 검증된 허용 목록 제거 금지
    with _SAFE_LOAD_LOCK:
        # 잠금 내부 모델 저장본 처리 결과 반환
        return lockedCheckpoint(path, runtime, expected_sha256=expected_sha256)

# 잠금 내 모델 가중치 읽음
def lockedCheckpoint(
    path: Path, runtime: SimpleNamespace, *, expected_sha256: str | None
) -> tuple[dict, list[str]]:
    # 텐서 실행 도구에 실행 환경의 텐서 실행 도구 저장
    torch = runtime.torch
    # 신뢰 목록에 실행 환경의 신뢰 목록 클래스 목록의 항목별 변환 결과 저장
    trusted = {globalName(value): value for value in runtime.trusted_classes}
    # 실행 환경 공존을 위해 알려진 프레임워크 객체의 정확한 동일성만 허용
    # 실행 환경 공존과 가중치 역직렬화 권한 분리
    # 역할 가중치가 해당 클래스를 참조하면 계속 거부
    from torch.nested._internal.nested_tensor import NestedTensor, _rebuild_njt
    # 승인된 객체 목록을 다음 항목으로 구성
    approved_objects = (*runtime.trusted_classes, NestedTensor, _rebuild_njt, *ambientObjects())
    # 실행 환경 공존 객체 목록에 조회 안전 검사 전역 참조 목록 처리 결과의 순서를 고정한 튜플 변환 결과 저장
    ambient_objects = tuple(torch.serialization.get_safe_globals())
    # 실행 환경 공존 객체 목록에서 값을 하나씩 읽음
    for value in ambient_objects:
        # 역할 모델 저장본 실행 환경 공존 허용 목록을 감지해 잘못된 입력의 후속 사용 차단
        if not any(value is approved for approved in approved_objects):
            # 역할 모델 저장본 실행 환경 공존 허용 목록 오류 알림
            raise ValueError("ROLE_CHECKPOINT_AMBIENT_ALLOWLIST")
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
        with path.open("rb") as source:
            # 내용 바이트에 한도 안에서 읽은 바이트 저장
            payload = source.read(_CHECKPOINT_MAX_BYTES + 1)
        # 역할 모델 저장본 크기의 자료 형식과 허용 조건 확인
        if len(payload) > _CHECKPOINT_MAX_BYTES:
            # 역할 모델 저장본 크기 유효하지 않음 오류 알림
            raise ValueError("ROLE_CHECKPOINT_SIZE_INVALID")
        # 모델 해시 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if expected_sha256 is not None and hashlib.sha256(payload).hexdigest() != expected_sha256:
            # 모델 해시 불일치 오류 알림
            raise ValueError("MODEL_HASH_MISMATCH")
        # 해시를 확인한 불변 바이트 그대로 감사와 역직렬화 수행
        # 다른 프로세스의 캐시 교체·수정에도 검증 바이트 유지
        with BytesIO(payload) as stream:
            # 안전 전역 목록의 영향과 분리해 저장본 자체의 비내장 전역 참조 검사
            non_intrinsic = checkpointGlobals(payload, torch)
            # 감사가 필요한 전역 참조에 기준 순으로 정렬한 목록 저장
            unsafe = sorted(
                set(torch.serialization.get_unsafe_globals_in_checkpoint(stream)) | non_intrinsic
            )
            # 검사한 전역 참조에서 명시적으로 신뢰한 클래스 밖의 항목 분리
            unknown = set(unsafe) - trusted.keys()
            # 역할 모델 저장본 지원하지 않음 전역을 감지해 잘못된 입력의 후속 사용 차단
            if unknown:
                # 역할 모델 저장본 지원하지 않음 전역 오류 알림
                raise ValueError(
                    f"ROLE_CHECKPOINT_UNSUPPORTED_GLOBAL: {', '.join(sorted(unknown))}"
                )
            # 감사에서 읽은 스트림을 시작으로 되돌려 같은 바이트 역직렬화 준비
            stream.seek(0)
            # 감사를 통과하고 실제 존재하는 클래스만 추가
            # 동적 모듈 읽기·임의 내장 객체·안전하지 않은 대체 경로 금지
            missing = [
                trusted[name]
                for name in unsafe
                if not any(trusted[name] is existing for existing in ambient_objects)
            ]
            # 처리 종료 시 정리되도록 안전 검사 전역 참조 목록 처리 결과 사용
            with torch.serialization.safe_globals(missing):
                # 감사한 동일 바이트를 가중치 전용 모드로 읽어 임의 객체 실행 범위 제한
                checkpoint = torch.load(stream, map_location="cpu", weights_only=True)
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except ValueError:
        # 현재 오류를 호출자에게 전달
        raise
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except Exception as exc:
        # 역할 모델 저장본 읽기 실패 오류 알림
        raise ValueError(f"ROLE_CHECKPOINT_LOAD_FAILED: {type(exc).__name__}: {exc}") from exc
    # 역할 모델 저장본 모델의 자료 형식과 허용 조건 확인
    if not isinstance(checkpoint, dict):
        # 역할 모델 저장본 모델 유효하지 않음 오류 알림
        raise ValueError("ROLE_CHECKPOINT_MODEL_INVALID")
    # 모델 저장본·감사가 필요한 전역 참조 반환
    return checkpoint, unsafe

# 모델 구조 입력 검사
def architectureMetadata(model: Any, runtime: SimpleNamespace) -> dict[str, Any]:
    # 역할 모델 구조 불일치를 감지해 잘못된 입력의 후속 사용 차단
    if type(model) is not runtime.model_type:
        # 역할 모델 구조 불일치 오류 알림
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    # 설정에 모델의 속성 또는 기본값 저장
    config = getattr(model, "yaml", None)
    # 계층 목록에 모델의 모델의 목록 변환 결과 저장
    layers = list(model.model)
    # 역할 모델 구조 불일치를 감지해 잘못된 입력의 후속 사용 차단
    if (
        not isinstance(config, dict)
        or config.get("nc") != 4
        or config.get("scale") != "m"
        or config.get("scales", {}).get("m") != [0.50, 1.00, 512]
        or tuple(type(layer).__name__ for layer in layers) != _LAYER_TYPES
    ):
        # 역할 모델 구조 불일치 오류 알림
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    # 출력 계층에 계층 목록의 선택 항목 저장
    head = layers[-1]
    # 역할 모델 구조 불일치를 감지해 잘못된 입력의 후속 사용 차단
    if (
        head.nc != 4
        or head.f != [16, 19, 22]
        or head.stride.tolist() != [8, 16, 32]
        or bool(getattr(head, "end2end", False))
        or bool(getattr(head, "xyxy", False))
        or bool(getattr(head, "export", False))
        or layers[0].conv.out_channels != 64
        or layers[1].conv.out_channels != 128
    ):
        # 역할 모델 구조 불일치 오류 알림
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    # 모델의 전체 매개변수 수를 세어 승인 구조와 비교 준비
    parameter_count = sum(p.numel() for p in model.parameters())
    # 이름만 같고 내부 구조가 다른 가중치가 섞이지 않도록 정확한 매개변수 수 확인
    if parameter_count != 20056092:
        # 역할 모델 구조 불일치 오류 알림
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    # 필드별로 묶은 기록 반환
    return {
        # 이름 필드 기록
        "name": "YOLO11m",
        # 모델 클래스 필드 기록
        "model_class": globalName(type(model)),
        # 배율 필드 기록
        "scale": "m",
        # 배율 매개변수 목록 필드 기록
        "scale_parameters": [0.50, 1.00, 512],
        # 계층 자료형 목록 필드 기록
        "layer_types": list(_LAYER_TYPES),
        # 입력 축소 간격 목록 필드 기록
        "strides": [8, 16, 32],
        # 매개변수 수량 필드 기록
        "parameter_count": parameter_count,
    }


# 역할 검출 모델 역할 검출기의 필드와 동작을 묶을 자료형 선언
class YoloRoleDetector:
    """승인된 로컬 축구 역할 관측이며 판정 아님"""

    # 초기 상태·입력 계약 구성
    def __init__(self, model_dir: Path | str, device: str = "cpu") -> None:
        # 역할 실행 장치의 자료 형식과 허용 조건 확인
        if type(device) is not str or device not in ("cpu", "mps"):
            # 역할 실행 장치 유효하지 않음 오류 알림
            raise ValueError("ROLE_DEVICE_INVALID")
        # 요청한 폴더에 절대 경로 저장
        requested_directory = Path(model_dir).expanduser().absolute()
        # 메타데이터에 고정 판본과 해시의 무결성 확인 결과 저장
        metadata = verification("role", requested_directory)
        # 폴더에 심볼릭 링크를 해석한 경로 저장
        directory = requested_directory.resolve()
        # 실행 환경에 실행에 필요한 모델 도구 묶음 저장
        runtime = runtimeBundle()
        # 역할 금속 그래픽 가속 장치 사용 불가를 감지해 잘못된 입력의 후속 사용 차단
        if device == "mps" and not runtime.torch.backends.mps.is_available():
            # 역할 금속 그래픽 가속 장치 사용 불가 오류 알림
            raise ValueError("ROLE_MPS_UNAVAILABLE")
        # 역할 금속 그래픽 가속 장치 대체 실행 활성 여부를 감지해 잘못된 입력의 후속 사용 차단
        if device == "mps" and os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1":
            # 역할 금속 그래픽 가속 장치 대체 실행 활성 여부 오류 알림
            raise ValueError("ROLE_MPS_FALLBACK_ENABLED")
        # 모델 저장본·감사한 전역 참조 목록에 검증한 바이트에서만 읽은 가중치와 전역 참조 목록 저장
        checkpoint, audited_globals = checkpointData(
            directory / _CHECKPOINT_NAME,
            runtime,
            expected_sha256=metadata["files"][_CHECKPOINT_NAME],
        )
        # 모델에 이동 평균 가중치의 키에 해당하는 값 저장
        model = checkpoint.get("ema")
        # 모델이 없는지 확인
        if model is None:
            # 모델에 모델의 키에 해당하는 값 저장
            model = checkpoint.get("model")
        # 역할 모델 저장본 모델의 자료 형식과 허용 조건 확인
        if type(model) is not runtime.model_type:
            # 역할 모델 저장본 모델 유효하지 않음 오류 알림
            raise ValueError("ROLE_CHECKPOINT_MODEL_INVALID")
        # 이름 목록에 모델의 속성 또는 기본값 저장
        names = getattr(model, "names", None)
        # 역할 레이블 대응 관계 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if (
            type(names) is not dict
            or any(type(key) is not int for key in names)
            or names != dict(enumerate(ROLE_LABELS))
        ):
            # 역할 레이블 대응 관계 불일치 오류 알림
            raise ValueError("ROLE_LABEL_MAPPING_MISMATCH")
        # 모델 구조에 모델 구조 메타데이터 처리 결과 저장
        architecture = architectureMetadata(model, runtime)
        # 모델에 학습 동작을 끈 평가용 모델 저장
        self._model = model.to(device=device, dtype=runtime.torch.float32).eval()
        # 학습하지 않도록 모델의 기울기 계산 설정 반영
        self._model.requires_grad_(False)
        # 실행 환경에 실행 환경 저장
        self._runtime = runtime
        # 실행 장치에 실행 장치 저장
        self._device = device
        # 마지막 좌표 변환을 아직 없는 상태로 초기화
        self._last_transform: dict[str, Any] | None = None
        # 출처 정보를 다음 항목으로 구성
        self.provenance = {
            **metadata,
            # 실행 장치 필드 기록
            "device": device,
            # 수치 정밀도 필드 기록
            "precision": "float32",
            # 임계값 필드 기록
            "threshold": _CONFIDENCE,
            # 실제 레이블 목록 필드 기록
            "actual_labels": names.copy(),
            # 실제 모델 구조 필드 기록
            "actual_architecture": architecture,
            # 라이브러리 버전 목록 필드 기록
            "library_versions": {
                # 텐서 실행 도구 필드 기록
                "torch": runtime.torch.__version__,
                # 역할 모델 라이브러리 필드 기록
                "ultralytics": runtime.version,
            },
            # 안전 검사 읽기 방법 필드 기록
            "safe_loader": {
                # 방법 필드 기록
                "method": "torch.load",
                # 모델 가중치 전용 필드 기록
                "weights_only": True,
                # 감사 필드 기록
                "audit": "torch.serialization.get_unsafe_globals_in_checkpoint",
                # 독립 감사 필드 기록
                "independent_audit": "Torch 2.6 static all-GLOBAL scan minus native weights-only intrinsics",
                # 클래스 허용 목록 필드 기록
                "class_allowlist": audited_globals,
                # 배치 이동 주소 필드 기록
                "map_location": "cpu",
                # 내용 바이트 무결성 필드 기록
                "payload_integrity": "bounded immutable bytes hashed before audit/load",
            },
            # 추론 필드 기록
            "inference": {
                # 추론 진입점 필드 기록
                "entrypoint": "DetectionModel.forward",
                # 실행 방식 필드 기록
                "mode": "eval/inference_mode",
                # 주변 전용 필드 기록
                "local_only": True,
                # 내려받기 허용 여부 필드 기록
                "downloads": False,
                # 실행 장치 대체 실행 필드 기록
                "device_fallback": False,
                # 자동 정밀도 변환 활성 여부 필드 기록
                "autocast_enabled": False,
            },
            # 전처리 필드 기록
            "preprocessing": {
                # 모델 입력 너비와 높이 필드 기록
                "input_size": [640, 640],
                # 방법 필드 기록
                "method": "letterbox",
                # 보간 필드 기록
                "interpolation": "INTER_LINEAR",
                # 여백 값 필드 기록
                "padding_value": 114,
                # 색상 변환 필드 기록
                "color_conversion": "RGB -> BGR (resize/pad) -> RGB BCHW",
                # 정규화 필드 기록
                "normalization": "float32 / 255",
                # 배율 위쪽 필드 기록
                "scale_up": True,
                # 자동 간격 여백 필드 기록
                "auto_stride_padding": False,
                # 대응 관계 필드 기록
                "mapping": "exact rounded resize factors and integer padding recorded per frame in last_transform",
            },
            # 겹침 억제 필드 기록
            "nms": {
                # 방법 필드 기록
                "method": "stable class-aware NumPy greedy NMS",
                # 실행 장치 필드 기록
                "device": "cpu",
                # 교집합 합집합 면적 비율 임계값 필드 기록
                "iou_threshold": _NMS_IOU,
                # 최댓값 검출 목록 필드 기록
                "max_detections": _MAX_DETECTIONS,
                # 최댓값 예측 위치 수 필드 기록
                "max_anchors": _MAX_ANCHORS,
                # 여러 레이블 필드 기록
                "multi_label": False,
                # 검출 점수 비교 방식 필드 기록
                "confidence_comparison": ">= 0.50",
            },
        }

    # 직전 역할 추론에서 사용한 좌표 변환 정보를 반환
    @property
    def last_transform(self) -> dict[str, Any] | None:
        # 중첩 값까지 독립된 사본 반환
        return deepcopy(self._last_transform)

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(self, rgb: np.ndarray) -> tuple[RoleDetection, ...]:
        # 마지막 좌표 변환을 아직 없는 상태로 초기화
        self._last_transform = None
        # 역할 삼원색 영상의 자료 형식과 허용 조건 확인
        if (
            not isinstance(rgb, np.ndarray)
            or rgb.dtype != np.uint8
            or rgb.ndim != 3
            or rgb.shape[2] != 3
            or min(rgb.shape[:2]) <= 0
        ):
            # 역할 삼원색 영상 유효하지 않음 오류 알림
            raise ValueError("ROLE_RGB_INVALID")
        # 높이·너비에 삼원색 영상의 배열 크기의 선택 항목 저장
        height, width = rgb.shape[:2]
        # 영상 처리 도구·텐서 실행 도구를 다음 항목으로 구성
        cv2, torch = self._runtime.cv2, self._runtime.torch
        # 원본 종횡비를 유지하면서 정사각형 입력 안에 들어갈 축척 계산
        ratio = min(_INPUT_SIZE / width, _INPUT_SIZE / height)
        # 크기를 조정한 너비·크기를 조정한 높이를 다음 항목으로 구성
        resized_width, resized_height = max(1, round(width * ratio)), max(1, round(height * ratio))
        # 정사각형 입력에서 가로와 세로의 앞쪽 여백 계산
        left, top = (_INPUT_SIZE - resized_width) // 2, (_INPUT_SIZE - resized_height) // 2
        # 반올림한 크기와 앞쪽 여백을 제외한 뒤쪽 여백 계산
        right, bottom = _INPUT_SIZE - resized_width - left, _INPUT_SIZE - resized_height - top
        # 반올림한 실제 출력 크기로 축별 배율을 다시 구해 원본 좌표 복원 오차 방지
        scale_x, scale_y = resized_width / width, resized_height / height
        # 역순 삼원색 영상에 메모리에 연속 배치한 배열 저장
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        # 크기를 조정한에 지정 크기로 조정한 영상 저장
        resized = cv2.resize(bgr, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
        # 여백을 채운에 사본 생성 여백 처리 결과 저장
        padded = cv2.copyMakeBorder(
            resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )
        # 채널 높이 너비 배열에 메모리에 연속 배치한 배열 저장
        chw = np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1))
        # 영상의 채널 순서와 자료형을 맞추고 화소값을 영부터 일 사이로 변환
        tensor = (
            torch.from_numpy(chw).unsqueeze(0).to(device=self._device, dtype=torch.float32) / 255.0
        )
        # 처리 종료 시 정리되도록 학습용 기울기 기록을 끈 추론 문맥·자동 정밀도 변환 처리 결과 사용
        with torch.inference_mode(), torch.autocast(device_type=self._device, enabled=False):
            # 출력에 모델 처리 결과 저장
            output = self._model(tensor)
        # 역할 출력의 자료 형식과 허용 조건 확인
        if not isinstance(output, tuple) or len(output) != 2:
            # 역할 출력 유효하지 않음 오류 알림
            raise ValueError("ROLE_OUTPUT_INVALID")
        # 원시에 출력의 선택 항목 저장
        raw = output[0]
        # 역할 출력의 자료 형식과 허용 조건 확인
        if (
            not isinstance(raw, torch.Tensor)
            or raw.ndim != 3
            or tuple(raw.shape[:2]) != (1, 8)
            or raw.shape[2] > _MAX_ANCHORS
            or raw.dtype != torch.float32
        ):
            # 역할 출력 유효하지 않음 오류 알림
            raise ValueError("ROLE_OUTPUT_INVALID")
        # 장치 텐서를 분리해 중앙 처리 장치로 옮기고 예측 위치별 행 배열로 변환
        rows = raw.detach().float().cpu().numpy()[0].T.astype(np.float64)
        # 역할 출력의 자료 형식과 허용 조건 확인
        if (
            not np.isfinite(rows).all()
            or np.any(rows[:, 2:4] <= 0)
            or np.any(rows[:, 4:] < 0)
            or np.any(rows[:, 4:] > 1)
        ):
            # 역할 출력 유효하지 않음 오류 알림
            raise ValueError("ROLE_OUTPUT_INVALID")
        # 각 예측 위치의 역할 점수 중 최댓값 계산
        scores = rows[:, 4:].max(axis=1)
        # 각 예측 위치에서 가장 높은 점수의 역할 번호 선택
        labels = rows[:, 4:].argmax(axis=1)
        # 고정 최소 점수 이상인 예측 위치만 선택할 마스크 생성
        selected = scores >= _CONFIDENCE
        # 점수 기준을 통과한 예측과 점수 및 레이블만 같은 순서로 선택
        rows, scores, labels = rows[selected], scores[selected], labels[selected]
        # 중심과 너비·높이로 나온 예측을 시작점과 끝점 좌표의 상자로 변환
        boxes = np.concatenate(
            (rows[:, :2] - rows[:, 2:4] / 2, rows[:, :2] + rows[:, 2:4] / 2), axis=1
        )
        # 겹침에 하한 처리 결과 및 상한 처리 결과의 차이 저장
        overlap = np.minimum(
            boxes[:, 2:], [left + resized_width, top + resized_height]
        ) - np.maximum(boxes[:, :2], [left, top])
        # 예측 상자가 합성 여백이 아닌 실제 원본 영상 부분과 겹치는지 확인
        supported = np.all(overlap > 0, axis=1)
        # 합성 여백이 원본 근거 관측을 억제하거나 검출 한도를 점유하지 않도록 제한
        # 잘라내기 전 중첩 억제 좌표 보존
        boxes, scores, labels = boxes[supported], scores[supported], labels[supported]
        # 남긴 순번에 겹침 억제 처리 결과 저장
        kept = nms(boxes, scores, labels)
        # 결과 목록을 모를 빈 자료 생성
        results = []
        # 남긴 순번에서 순번을 하나씩 읽음
        for index in kept:
            # 원본 화면의 시작점과 끝점 상자 좌표에 원본을 건드리지 않을 사본 저장
            box = boxes[index].copy()
            # 가로 여백을 빼고 실제 가로 배율로 나누어 원본 화면 가로 좌표 복원
            box[[0, 2]] = np.clip((box[[0, 2]] - left) / scale_x, 0, width)
            # 세로 여백을 빼고 실제 세로 배율로 나누어 원본 화면 세로 좌표 복원
            box[[1, 3]] = np.clip((box[[1, 3]] - top) / scale_y, 0, height)
            # 합성 여백에만 있는 예측은 원본 근거 없음
            if box[2] <= box[0] or box[3] <= box[1]:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 결과 목록에 역할 검출 처리 결과 추가
            results.append(
                RoleDetection(
                    len(results),
                    ROLE_LABELS[int(labels[index])],
                    tuple(float(value) for value in box),
                    float(scores[index]),
                )
            )
        # 마지막 좌표 변환을 다음 항목으로 구성
        self._last_transform = {
            # 원본 너비 필드 기록
            "sourceWidth": width,
            # 원본 높이 필드 기록
            "sourceHeight": height,
            # 입력 너비 필드 기록
            "inputWidth": 640,
            # 입력 높이 필드 기록
            "inputHeight": 640,
            # 크기를 조정한 너비 필드 기록
            "resizedWidth": resized_width,
            # 크기를 조정한 높이 필드 기록
            "resizedHeight": resized_height,
            # 배율 가로 필드 기록
            "scaleX": scale_x,
            # 배율 세로 필드 기록
            "scaleY": scale_y,
            # 여백 좌상우하 필드 기록
            "paddingLTRB": [left, top, right, bottom],
            # 원본 좌표에서 입력 좌표로 옮길 행렬 필드 기록
            "sourceToInput": [[scale_x, 0, left], [0, scale_y, top]],
            # 모델 입력 좌표를 원본 좌표로 복원할 행렬 필드 기록
            "inputToSource": [[1 / scale_x, 0, -left / scale_x], [0, 1 / scale_y, -top / scale_y]],
        }
        # 결과 목록의 순서를 고정한 튜플 변환 결과 반환
        return tuple(results)

# 같은 레이블의 겹치는 검출 상자를 점수 순서로 정리
def nms(boxes: np.ndarray, scores: np.ndarray, labels: np.ndarray) -> list[int]:
    # 같은 점수에서도 순서가 안정적이도록 높은 점수부터 정렬
    order = np.argsort(-scores, kind="stable")
    # 남긴 순번을 모를 빈 자료 생성
    kept = []
    # 각 상자의 가로 길이와 세로 길이를 곱해 겹침 억제용 면적 계산
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    # 정렬 순서의 항목 수 및 남긴 순번의 항목 수 및 최댓값 검출 목록의 미만 조건을 만족하는 동안 반복
    while len(order) and len(kept) < _MAX_DETECTIONS:
        # 순번에 정렬 순서의 선택 항목의 정수 변환 결과 저장
        index = int(order[0])
        # 남긴 순번에 순번 추가
        kept.append(index)
        # 남은에 정렬 순서의 선택 항목 저장
        remaining = order[1:]
        # 선택 상자와 남은 상자 사이 교집합의 시작 좌표 계산
        lower = np.maximum(boxes[index, :2], boxes[remaining, :2])
        # 선택 상자와 남은 상자 사이 교집합의 끝 좌표 계산
        upper = np.minimum(boxes[index, 2:], boxes[remaining, 2:])
        # 겹치지 않는 축을 영으로 제한하고 축별 길이를 곱해 교집합 면적 계산
        intersection = np.maximum(upper - lower, 0).prod(axis=1)
        # 두 상자 면적에서 중복 면적을 뺀 합집합으로 교집합을 나누어 겹침 비율 계산
        iou = intersection / (areas[index] + areas[remaining] - intersection)
        # 다른 레이블은 유지하고 같은 레이블의 과도한 겹침만 제거
        order = remaining[(labels[remaining] != labels[index]) | (iou <= _NMS_IOU)]
    # 남긴 순번 반환
    return kept

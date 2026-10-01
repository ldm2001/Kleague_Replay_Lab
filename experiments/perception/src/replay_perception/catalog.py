# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 기록과 설정을 직렬화할 도구 읽음
import json
# 원본과 분리된 사본 생성 도구 읽음
from copy import deepcopy
# 패키지 자산 경로 조회 도구 읽음
from importlib import resources
# 입출력 자료형과 호출 규약 읽음
from typing import Any


# 역할 고정 판본을 고정 식별 문자열 값으로 설정
_ROLE_REVISION = "5e83fafa8d564243001ce8e063612a618a138fbe"
# 자세 고정 판본을 고정 식별 문자열 값으로 설정
_POSE_REVISION = "0c30b6534bb621af0162b481176742577264e36e"
# 고정 학습 규격의 관절 출력 순서를 다음 항목으로 구성
_COCO_KEYPOINTS = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]
# 승인된 모델 목록을 다음 항목으로 구성
_APPROVED_MODELS: dict[str, dict[str, Any]] = {
    # 역할 필드 기록
    "role": {
        # 모델 식별자 필드 기록
        "model_id": "martinjolif/yolo-football-player-detection",
        # 캐시 폴더 이름 필드 기록
        "slug": "yolo11m_football",
        # 고정 판본 필드 기록
        "revision": _ROLE_REVISION,
        # 사용 허가 필드 기록
        "license": "AGPL-3.0",
        # 모델 구조 필드 기록
        "architecture": "YOLO11m",
        # 레이블 목록 필드 기록
        "labels": ["ball", "goalkeeper", "player", "referee"],
        # 파일 목록 필드 기록
        "files": [
            {
                # 이름 필드 기록
                "name": "yolo-football-player-detection.pt",
                # 크기 필드 기록
                "size": 40583084,
                # 내용 해시 필드 기록
                "sha256": "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd",
                # 주소 필드 기록
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{_ROLE_REVISION}/yolo-football-player-detection.pt"
                ),
            },
            {
                # 이름 필드 기록
                "name": "README.md",
                # 크기 필드 기록
                "size": 2537,
                # 내용 해시 필드 기록
                "sha256": "446b7be35352183834b72eda7e197485a3da660e77a2013409a0e91fe00efb92",
                # 주소 필드 기록
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{_ROLE_REVISION}/README.md"
                ),
            },
        ],
    },
    # 자세 필드 기록
    "pose": {
        # 모델 식별자 필드 기록
        "model_id": "usyd-community/vitpose-plus-small",
        # 캐시 폴더 이름 필드 기록
        "slug": "vitpose_plus_small",
        # 고정 판본 필드 기록
        "revision": _POSE_REVISION,
        # 사용 허가 필드 기록
        "license": "Apache-2.0",
        # 모델 구조 필드 기록
        "architecture": "VitPoseForPoseEstimation",
        # 관절점 목록 필드 기록
        "keypoints": _COCO_KEYPOINTS,
        # 파일 목록 필드 기록
        "files": [
            {
                # 이름 필드 기록
                "name": "model.safetensors",
                # 크기 필드 기록
                "size": 132619932,
                # 내용 해시 필드 기록
                "sha256": "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9",
                # 주소 필드 기록
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/model.safetensors"
                ),
            },
            {
                # 이름 필드 기록
                "name": "config.json",
                # 크기 필드 기록
                "size": 1846,
                # 내용 해시 필드 기록
                "sha256": "9a81cb593c0af3c5a7e07bb4ffb4643d6a8163f73b4373d294b4a4997c8abe81",
                # 주소 필드 기록
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/config.json"
                ),
            },
            {
                # 이름 필드 기록
                "name": "preprocessor_config.json",
                # 크기 필드 기록
                "size": 363,
                # 내용 해시 필드 기록
                "sha256": "9b11cadc98c30b968a70cc1658ce1fbd74b721b0f21402a2ff8bc1dc9d1474a0",
                # 주소 필드 기록
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/preprocessor_config.json"
                ),
            },
            {
                # 이름 필드 기록
                "name": "README.md",
                # 크기 필드 기록
                "size": 11656,
                # 내용 해시 필드 기록
                "sha256": "0f83999d99d35f74969ff14d33c29fe9657888d92f532baff8339ba1a486f834",
                # 주소 필드 기록
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/README.md"
                ),
            },
        ],
    },
}
# 승인 검출 모델 키를 지정 문자열 값으로 설정
DETECTOR_KEY = "detector"
# 승인 검출 모델의 캐시 폴더 이름을 승인 검출 모델 값으로 설정
DETECTOR_SLUG = "rtdetr_r18vd"
# 승인 검출 모델의 고정 판본 식별자를 고정 식별 문자열 값으로 설정
DETECTOR_REVISION = "ac77a11ff0170a41b771c03264987f8ce2b0d753"
# 승인 검출 모델 식별자를 지정 문자열 값으로 설정
_DETECTOR_ID = "PekingU/rtdetr_r18vd"
# 승인 검출 모델 호스트를 지정 문자열 값으로 설정
_DETECTOR_HOST = "https://huggingface.co"
# 승인 검출 모델 파일 이름 목록에 여러 값을 순서대로 모은 자료의 변경 불가 집합 변환 결과 저장
_DETECTOR_FILENAMES = frozenset(
    {"config.json", "preprocessor_config.json", "model.safetensors", "README.md"}
)
# 내려받기 경로가 받는 모델 키 목록에 검출 모델과 승인 관측 모델 키 저장
MODEL_KEYS = (DETECTOR_KEY, *_APPROVED_MODELS)

# 관측 모델 자산 명세 읽음
def observerManifest() -> dict[str, Any]:
    # 자산 명세 경로에 하위 경로 결합 처리 결과 저장
    manifest_path = resources.files("replay_perception").joinpath("observer-models.json")
    # 자산 명세에 직렬화 문자열을 해석한 자료 저장
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    # 자산 명세 입력 검사으로 자산 명세의 계약 확인
    manifestValidation(manifest)
    # 자산 명세 반환
    return manifest

# 모델 식별자가 승인 목록에 포함되는지 확인
def approvedModel(model_key: str) -> dict[str, Any]:
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 승인된 모델 목록의 선택 항목 반환
        return _APPROVED_MODELS[model_key]
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except (KeyError, TypeError) as exc:
        # 관측기 모델 키 유효하지 않음 오류 알림
        raise ValueError(f"OBSERVER_MODEL_KEY_INVALID: {model_key!r}") from exc

# 자산 명세 입력 검사
def manifestValidation(manifest: dict[str, Any]) -> None:
    # 예상을 다음 항목으로 구성
    expected = {"schema_version": 1, "models": _APPROVED_MODELS}
    # 외부 자산 명세가 코드에 고정한 승인 목록과 완전히 같은지 확인
    if manifest != expected:
        # 관측기 모델 자산 명세 유효하지 않음 오류 알림
        raise ValueError("OBSERVER_MODEL_MANIFEST_INVALID")

# 자산 명세의 관측 모델 고정 메타데이터 읽음
def manifestModel(model_key: str) -> dict[str, Any]:
    # 자산 명세에 관측기 자산 명세 처리 결과 저장
    manifest = observerManifest()
    # 승인된 모델으로 모델 키의 계약 확인
    approvedModel(model_key)
    # 중첩 값까지 독립된 사본 반환
    return deepcopy(manifest["models"][model_key])

# 검출 모델 자산 명세 읽음
def detectorManifest() -> dict[str, Any]:
    # 자산 명세 경로에 하위 경로 결합 처리 결과 저장
    manifest_path = resources.files("replay_perception").joinpath("model-manifest.json")
    # 자산 명세에 직렬화 문자열을 해석한 자료 저장
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    # 검출 명세 입력 검사으로 자산 명세의 계약 확인
    detectorValidation(manifest)
    # 자산 명세 반환
    return manifest

# 검출 모델 자산 명세 입력 검사
def detectorValidation(manifest: dict[str, Any]) -> None:
    # 모델 명세의 승인 값과 파일 계약에서 벗어난 항목이 있는지 확인
    if (
        manifest.get("schema_version") != 1
        or manifest.get("model_id") != _DETECTOR_ID
        or manifest.get("revision") != DETECTOR_REVISION
        or manifest.get("architecture") != "RTDetrForObjectDetection"
        or manifest.get("disable_custom_kernels") is not True
        or manifest.get("labels") != ["person", "sports ball"]
        or manifest.get("threshold") != 0.30
    ):
        # 모델 자산 명세 유효하지 않음 오류 알림
        raise ValueError("MODEL_MANIFEST_INVALID")

    # 명세 항목 목록에 파일 목록의 키에 해당하는 값 저장
    entries = manifest.get("files")
    # 모델 자산 명세의 자료 형식과 허용 조건 확인
    if not isinstance(entries, list) or not entries:
        # 모델 자산 명세 유효하지 않음 오류 알림
        raise ValueError("MODEL_MANIFEST_INVALID")
    # 이미 확인한에 빈 중복을 없앤 집합 저장
    seen: set[str] = set()
    # 다른 판본이나 저장소 주소를 허용하지 않도록 승인 다운로드 주소의 고정 접두 경로 생성
    prefix = f"{_DETECTOR_HOST}/{_DETECTOR_ID}/resolve/{DETECTOR_REVISION}/"
    # 명세 항목 목록에서 명세 항목을 하나씩 읽음
    for entry in entries:
        # 이름에 이름의 키에 해당하는 값 저장
        name = entry.get("name")
        # 모델 자산 명세의 자료 형식과 허용 조건 확인
        if name not in _DETECTOR_FILENAMES or name in seen:
            # 모델 자산 명세 유효하지 않음 오류 알림
            raise ValueError("MODEL_MANIFEST_INVALID")
        # 이미 확인한에 이름을 중복 없이 추가
        seen.add(name)
        # 모델 명세의 승인 값과 파일 계약에서 벗어난 항목이 있는지 확인
        if (
            entry.get("url") != prefix + name
            or not isinstance(entry.get("sha256"), str)
            or len(entry["sha256"]) != 64
            or not isinstance(entry.get("size"), int)
            or isinstance(entry["size"], bool)
            or entry["size"] <= 0
            or not isinstance(entry.get("required"), bool)
        ):
            # 모델 자산 명세 유효하지 않음 오류 알림
            raise ValueError("MODEL_MANIFEST_INVALID")

# 모델 키별 오류 코드 접두사 반환
def codePrefix(model_key: str) -> str:
    # 모델 키 및 검출 모델의 일치 조건 확인
    if model_key == DETECTOR_KEY:
        # 검출 모델 오류 코드 접두사 반환
        return "MODEL"
    # 승인된 모델으로 모델 키의 계약 확인
    approvedModel(model_key)
    # 관측 모델 오류 코드 접두사 반환
    return "OBSERVER_MODEL"

# 승인 자산 명세의 요청 모델 파일 검색
def approvedEntry(model_key: str, filename: str) -> dict[str, Any]:
    # 모델 키 및 검출 모델의 일치 조건 확인
    if model_key == DETECTOR_KEY:
        # 명세 항목 목록에 검출 모델 자산 명세의 파일 목록 저장
        entries = detectorManifest()["files"]
    # 앞선 분기에 해당하지 않는 경우 처리
    else:
        # 명세 항목 목록에 관측 모델 자산 명세의 파일 목록 저장
        entries = manifestModel(model_key)["files"]
    # 명세 항목 목록에서 명세 항목을 하나씩 읽음
    for entry in entries:
        # 명세 항목의 이름 및 파일 이름의 일치 조건 확인
        if entry["name"] == filename:
            # 명세 항목 반환
            return entry
    # 모델 파일 유효하지 않음 오류 알림
    raise ValueError(f"{codePrefix(model_key)}_FILE_INVALID: {filename}")

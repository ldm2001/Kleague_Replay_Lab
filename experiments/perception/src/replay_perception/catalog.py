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

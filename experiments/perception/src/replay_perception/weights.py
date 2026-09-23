# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 기록과 설정을 직렬화할 도구 읽음
import json
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 충돌하지 않는 임시 경로 생성 도구 읽음
import tempfile
# 실행 시간과 제한 시간을 측정할 도구 읽음
import time
# 원본과 분리된 사본 생성 도구 읽음
from copy import deepcopy
# 패키지 자산 경로 조회 도구 읽음
from importlib import resources
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 자산 전송 관련 함수와 자료형 읽음
from .transport import boundedDownload


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
# 읽기 묶음 크기에 1024 및 1024의 곱 저장
CHUNK_SIZE = 1024 * 1024
# 읽기 제한 시간 초를 30 값으로 설정
READ_TIMEOUT_SECONDS = 30
# 최댓값 내려받기 초에 30 및 60의 곱 저장
MAX_DOWNLOAD_SECONDS = 30 * 60

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

# 승인 모델의 기본 로컬 캐시 경로를 반환
def directory(model_key: str) -> Path:
    # 모델에 승인된 모델 처리 결과 저장
    model = approvedModel(model_key)
    # 승인된 모델의 이름과 고정 판본을 구분하는 사용자 캐시 경로 반환
    return Path.home() / ".cache" / "replay-lab" / "models" / model["slug"] / model["revision"]

# 관측 모델 자산 무결성 확인
def verification(model_key: str, directory: Path | str) -> dict[str, Any]:
    # 승인된 모델으로 모델 키의 계약 확인
    approvedModel(model_key)
    # 모델에 자산 명세 모델 처리 결과 저장
    model = manifestModel(model_key)
    # 모델 폴더에 외부 폴더 처리 결과 저장
    model_dir = externalDirectory(directory)
    # 검증한을 모를 빈 자료 생성
    verified: dict[str, str] = {}
    # 모델의 파일 목록에서 명세 항목을 하나씩 읽음
    for entry in model["files"]:
        # 경로에 모델 폴더 및 명세 항목의 이름의 비율 저장
        path = model_dir / entry["name"]
        # 명세 항목 입력 검사으로 경로의 계약 확인
        entryValidation(path, entry)
        # 검증한의 선택 항목에 명세 항목의 내용 해시 저장
        verified[entry["name"]] = entry["sha256"]
    # 출처 정보 처리 결과 반환
    return provenance(model_key, model, verified)

# 관측 모델 자산 내려받음
def download(model_key: str, directory: Path | str) -> dict[str, Any]:
    # 승인된 모델으로 모델 키의 계약 확인
    approvedModel(model_key)
    # 모델에 자산 명세 모델 처리 결과 저장
    model = manifestModel(model_key)
    # 모델 폴더에 외부 폴더 처리 결과 저장
    model_dir = externalDirectory(directory)
    # 모델 폴더에 필요한 출력 폴더 생성
    model_dir.mkdir(parents=True, exist_ok=True)
    # 모델 폴더에 외부 폴더 처리 결과 저장
    model_dir = externalDirectory(model_dir)

    # 모델의 파일 목록에서 명세 항목을 하나씩 읽음
    for entry in model["files"]:
        # 대상 파일에 모델 폴더 및 명세 항목의 이름의 비율 저장
        destination = model_dir / entry["name"]
        # 저장소 보호 검사으로 대상 파일의 계약 확인
        repositoryGuard(destination)
        # 경로 존재 여부 또는 심볼릭 링크 여부 확인
        if destination.exists() or destination.is_symlink():
            # 명세 항목 입력 검사으로 대상 파일의 계약 확인
            entryValidation(destination, entry)
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 명세 항목 내려받기에 필요한 입력을 전달해 처리
        entryDownload(destination, model_key, entry)

    # 고정 판본과 해시의 무결성 확인 결과 반환
    return verification(model_key, model_dir)

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

# 자산 항목 무결성 확인
def entryValidation(path: Path, entry: dict[str, Any]) -> None:
    # 저장소 보호 검사으로 경로의 계약 확인
    repositoryGuard(path)
    # 관측기 모델 파일 없는을 감지해 잘못된 입력의 후속 사용 차단
    if not path.is_file():
        # 관측기 모델 파일 없는 오류 알림
        raise FileNotFoundError(
            f"OBSERVER_MODEL_FILE_MISSING: {entry['name']}"
        )

    # 해시 누적기에 내용 변경 검사용 해시 누적기 저장
    digest = hashlib.sha256()
    # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
    with path.open("rb") as stream:
        # 반복자에서 읽기 묶음을 하나씩 읽음
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            # 파일을 한꺼번에 메모리에 올리지 않고 읽은 묶음의 해시 누적
            digest.update(chunk)
    # 파일 이름이 같아도 승인된 내용과 다르면 모델 읽기 차단
    if digest.hexdigest() != entry["sha256"]:
        # 관측기 모델 해시 불일치 오류 알림
        raise ValueError(
            f"OBSERVER_MODEL_HASH_MISMATCH: {entry['name']}"
        )
    # 관측기 모델 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
    if path.stat().st_size != entry["size"]:
        # 관측기 모델 크기 불일치 오류 알림
        raise ValueError(
            f"OBSERVER_MODEL_SIZE_MISMATCH: {entry['name']}"
        )

# 자산 항목 내려받음
def entryDownload(destination: Path, model_key: str, entry: dict[str, Any]) -> None:
    # 저장소 보호 검사으로 대상 파일의 계약 확인
    repositoryGuard(destination)
    # 파일 핸들 번호·임시 파일 이름에 고유 임시 파일 생성 처리 결과 저장
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.download-",
    )
    # 임시 파일에 파일 경로 객체 저장
    temporary = Path(temporary_name)
    # 시작 시각에 시계 조정에 흔들리지 않는 현재 시각 저장
    started = time.monotonic()
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 상한 적용 내려받기에 필요한 입력을 전달해 처리
        boundedDownload(
            model_key,
            entry["name"],
            descriptor,
            remainingTime(started, entry),
        )
        # 운영체제 도구의 열린 자원 정리
        os.close(descriptor)
        # 파일 핸들 번호에 부호를 바꾼 1 저장
        descriptor = -1
        # 명세 항목 입력 검사으로 임시 파일의 계약 확인
        entryValidation(temporary, entry)

        # 기한에 필요한 입력을 전달해 처리
        deadline(started, entry)
        # 저장소 보호 검사으로 대상 파일의 계약 확인
        repositoryGuard(destination)
        # 기한에 필요한 입력을 전달해 처리
        deadline(started, entry)
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 검증한 임시 파일을 기존 대상을 덮어쓰지 않고 최종 경로에 연결
            os.link(temporary, destination)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except FileExistsError:
            # 명세 항목 입력 검사으로 대상 파일의 계약 확인
            entryValidation(destination, entry)
        # 예외 없이 앞선 작업을 마친 경우 처리
        else:
            # 명세 항목 입력 검사으로 대상 파일의 계약 확인
            entryValidation(destination, entry)
    # 성공과 실패에 관계없이 남은 자원 정리
    finally:
        # 파일 핸들 번호 및 0의 이상 조건 확인
        if descriptor >= 0:
            # 운영체제 도구의 열린 자원 정리
            os.close(descriptor)
        # 임시 파일의 임시 경로 정리
        temporary.unlink(missing_ok=True)

# 남은 내려받기 시간 계산
def remainingTime(started: float, entry: dict[str, Any]) -> float:
    # 전체 내려받기 한도에서 실제 경과 시간을 빼 남은 시간 계산
    remaining = MAX_DOWNLOAD_SECONDS - (time.monotonic() - started)
    # 관측기 모델 내려받기 제한 시간을 감지해 잘못된 입력의 후속 사용 차단
    if remaining <= 0:
        # 관측기 모델 내려받기 제한 시간 오류 알림
        raise TimeoutError(
            f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {entry['name']}"
        )
    # 남은 반환
    return remaining

# 내려받기 기한 초과 알림
def deadline(started: float, entry: dict[str, Any]) -> None:
    # 남은 시간에 필요한 입력을 전달해 처리
    remainingTime(started, entry)

# 모델 경로를 해석하고 저장소 밖의 안전한 위치인지 확인
def externalDirectory(directory: Path | str) -> Path:
    # 확장한에 사용자 폴더 약어를 확장한 경로 저장
    expanded = Path(directory).expanduser()
    # 문자 경로에 파일 경로 객체 저장
    lexical = Path(os.path.abspath(os.fspath(expanded)))
    # 심볼릭 링크의 실제 목적지를 구해 저장소 내부 우회 여부 검사 준비
    resolved = lexical.resolve(strict=False)
    # 입력 경로의 상위 폴더에 저장소 표식이 없는지 확인
    ancestorGuard(lexical)
    # 심볼릭 링크를 따라간 실제 경로도 저장소 밖인지 확인
    ancestorGuard(resolved)
    # 해석한 경로 반환
    return resolved

# 저장소 내부 경로 차단
def repositoryGuard(path: Path) -> None:
    # 문자 경로에 파일 경로 객체 저장
    lexical = Path(os.path.abspath(os.fspath(path)))
    # 심볼릭 링크의 실제 목적지를 구해 저장소 내부 우회 여부 검사 준비
    resolved = lexical.resolve(strict=False)
    # 입력 경로의 상위 폴더에 저장소 표식이 없는지 확인
    ancestorGuard(lexical)
    # 심볼릭 링크를 따라간 실제 경로도 저장소 밖인지 확인
    ancestorGuard(resolved)

# 상위 버전 관리 저장소 차단
def ancestorGuard(path: Path) -> None:
    # 경로·상위 경로 목록의 펼친 값에서 상위 경로를 하나씩 읽음
    for ancestor in (path, *path.parents):
        # 표식에 상위 경로 및 지정 문자열의 비율 저장
        marker = ancestor / ".git"
        # 관측기 모델 경로 내부 저장소를 감지해 잘못된 입력의 후속 사용 차단
        if marker.is_file() or marker.is_dir() or marker.is_symlink():
            # 관측기 모델 경로 내부 저장소 오류 알림
            raise ValueError(f"OBSERVER_MODEL_PATH_IN_REPOSITORY: {path}")

# 관측 또는 모델의 검증된 원본·파일 출처 정보를 반환
def provenance(model_key: str, model: dict[str, Any], files: dict[str, str]) -> dict[str, Any]:
    # 결과를 다음 항목으로 구성
    result = {
        # 자산 명세 버전 필드 기록
        "manifest_version": 1,
        # 모델 키 필드 기록
        "model_key": model_key,
        # 모델 식별자 필드 기록
        "model_id": model["model_id"],
        # 고정 판본 필드 기록
        "revision": model["revision"],
        # 사용 허가 필드 기록
        "license": model["license"],
        # 모델 구조 필드 기록
        "architecture": model["architecture"],
        # 파일 목록 필드 기록
        "files": dict(files),
    }
    # 모델 키 및 역할의 일치 조건 확인
    if model_key == "role":
        # 결과의 레이블 목록에 모델의 레이블 목록의 목록 변환 결과 저장
        result["labels"] = list(model["labels"])
    # 앞선 분기에 해당하지 않는 경우 처리
    else:
        # 결과의 관절점 목록에 모델의 관절점 목록의 목록 변환 결과 저장
        result["keypoints"] = list(model["keypoints"])
    # 결과 반환
    return result

# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 충돌하지 않는 임시 경로 생성 도구 읽음
import tempfile
# 실행 시간과 제한 시간을 측정할 도구 읽음
import time
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 승인 모델 목록과 명세 조회와 오류 코드 접두사 함수 읽음
from .catalog import approvedModel, codePrefix, manifestModel
# 자산 전송 관련 함수와 자료형 읽음
from .transport import boundedDownload


# 읽기 묶음 크기에 1024 및 1024의 곱 저장
CHUNK_SIZE = 1024 * 1024
# 최댓값 내려받기 초에 30 및 60의 곱 저장
MAX_DOWNLOAD_SECONDS = 30 * 60

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
    model_dir = externalDirectory(directory, model_key)
    # 검증한을 모를 빈 자료 생성
    verified: dict[str, str] = {}
    # 모델의 파일 목록에서 명세 항목을 하나씩 읽음
    for entry in model["files"]:
        # 경로에 모델 폴더 및 명세 항목의 이름의 비율 저장
        path = model_dir / entry["name"]
        # 명세 항목 입력 검사으로 경로의 계약 확인
        entryValidation(path, entry, model_key)
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
    # 모델 폴더에 명세의 모든 파일을 내려받은 폴더 저장
    model_dir = cacheDownload(model_key, directory, model["files"])
    # 고정 판본과 해시의 무결성 확인 결과 반환
    return verification(model_key, model_dir)

# 승인 모델의 명세 파일을 캐시 폴더에 채워 폴더 반환
def cacheDownload(model_key: str, directory: Path | str, entries: list[dict[str, Any]]) -> Path:
    # 모델 폴더에 외부 폴더 처리 결과 저장
    model_dir = externalDirectory(directory, model_key)
    # 모델 폴더에 필요한 출력 폴더 생성
    model_dir.mkdir(parents=True, exist_ok=True)
    # 모델 폴더에 외부 폴더 처리 결과 저장
    model_dir = externalDirectory(model_dir, model_key)

    # 명세의 파일 목록에서 명세 항목을 하나씩 읽음
    for entry in entries:
        # 대상 파일에 모델 폴더 및 명세 항목의 이름의 비율 저장
        destination = model_dir / entry["name"]
        # 저장소 보호 검사으로 대상 파일의 계약 확인
        repositoryGuard(destination, model_key)
        # 경로 존재 여부 또는 심볼릭 링크 여부 확인
        if destination.exists() or destination.is_symlink():
            # 명세 항목 입력 검사으로 대상 파일의 계약 확인
            entryValidation(destination, entry, model_key)
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 명세 항목 내려받기에 필요한 입력을 전달해 처리
        entryDownload(destination, model_key, entry)
    # 내려받기를 마친 모델 폴더 반환
    return model_dir

# 자산 항목 무결성 확인
def entryValidation(path: Path, entry: dict[str, Any], model_key: str) -> None:
    # 저장소 보호 검사으로 경로의 계약 확인
    repositoryGuard(path, model_key)
    # 모델 파일 없는을 감지해 잘못된 입력의 후속 사용 차단
    if not path.is_file():
        # 모델 파일 없는 오류 알림
        raise FileNotFoundError(
            f"{codePrefix(model_key)}_FILE_MISSING: {entry['name']}"
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
        # 모델 해시 불일치 오류 알림
        raise ValueError(
            f"{codePrefix(model_key)}_HASH_MISMATCH: {entry['name']}"
        )
    # 모델 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
    if path.stat().st_size != entry["size"]:
        # 모델 크기 불일치 오류 알림
        raise ValueError(
            f"{codePrefix(model_key)}_SIZE_MISMATCH: {entry['name']}"
        )

# 자산 항목 내려받음
def entryDownload(destination: Path, model_key: str, entry: dict[str, Any]) -> None:
    # 저장소 보호 검사으로 대상 파일의 계약 확인
    repositoryGuard(destination, model_key)
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
            remainingTime(started, entry, model_key),
        )
        # 운영체제 도구의 열린 자원 정리
        os.close(descriptor)
        # 파일 핸들 번호에 부호를 바꾼 1 저장
        descriptor = -1
        # 명세 항목 입력 검사으로 임시 파일의 계약 확인
        entryValidation(temporary, entry, model_key)

        # 저장소 보호 검사으로 대상 파일의 계약 확인
        repositoryGuard(destination, model_key)
        # 기한에 필요한 입력을 전달해 처리
        deadline(started, entry, model_key)
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 검증한 임시 파일을 기존 대상을 덮어쓰지 않고 최종 경로에 연결
            os.link(temporary, destination)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except FileExistsError:
            # 먼저 공개된 파일은 덮어쓰지 않고 아래 검증으로 연결
            pass
        # 직접 연결했든 먼저 공개됐든 최종 경로가 승인 내용인지 확인
        entryValidation(destination, entry, model_key)
    # 성공과 실패에 관계없이 남은 자원 정리
    finally:
        # 파일 핸들 번호 및 0의 이상 조건 확인
        if descriptor >= 0:
            # 운영체제 도구의 열린 자원 정리
            os.close(descriptor)
        # 임시 파일의 임시 경로 정리
        temporary.unlink(missing_ok=True)

# 남은 내려받기 시간 계산
def remainingTime(started: float, entry: dict[str, Any], model_key: str) -> float:
    # 전체 내려받기 한도에서 실제 경과 시간을 빼 남은 시간 계산
    remaining = MAX_DOWNLOAD_SECONDS - (time.monotonic() - started)
    # 모델 내려받기 제한 시간을 감지해 잘못된 입력의 후속 사용 차단
    if remaining <= 0:
        # 모델 내려받기 제한 시간 오류 알림
        raise TimeoutError(
            f"{codePrefix(model_key)}_DOWNLOAD_TIMEOUT: {entry['name']}"
        )
    # 남은 반환
    return remaining

# 내려받기 기한 초과 알림
def deadline(started: float, entry: dict[str, Any], model_key: str) -> None:
    # 남은 시간에 필요한 입력을 전달해 처리
    remainingTime(started, entry, model_key)

# 모델 경로를 해석하고 저장소 밖의 안전한 위치인지 확인
def externalDirectory(directory: Path | str, model_key: str) -> Path:
    # 확장한에 사용자 폴더 약어를 확장한 경로 저장
    expanded = Path(directory).expanduser()
    # 문자 경로에 파일 경로 객체 저장
    lexical = Path(os.path.abspath(os.fspath(expanded)))
    # 심볼릭 링크의 실제 목적지를 구해 저장소 내부 우회 여부 검사 준비
    resolved = lexical.resolve(strict=False)
    # 입력 경로의 상위 폴더에 저장소 표식이 없는지 확인
    ancestorGuard(lexical, model_key)
    # 심볼릭 링크를 따라간 실제 경로도 저장소 밖인지 확인
    ancestorGuard(resolved, model_key)
    # 해석한 경로 반환
    return resolved

# 저장소 내부 경로 차단
def repositoryGuard(path: Path, model_key: str) -> None:
    # 문자 경로에 파일 경로 객체 저장
    lexical = Path(os.path.abspath(os.fspath(path)))
    # 심볼릭 링크의 실제 목적지를 구해 저장소 내부 우회 여부 검사 준비
    resolved = lexical.resolve(strict=False)
    # 입력 경로의 상위 폴더에 저장소 표식이 없는지 확인
    ancestorGuard(lexical, model_key)
    # 심볼릭 링크를 따라간 실제 경로도 저장소 밖인지 확인
    ancestorGuard(resolved, model_key)

# 상위 버전 관리 저장소 차단
def ancestorGuard(path: Path, model_key: str) -> None:
    # 경로·상위 경로 목록의 펼친 값에서 상위 경로를 하나씩 읽음
    for ancestor in (path, *path.parents):
        # 표식에 상위 경로 및 지정 문자열의 비율 저장
        marker = ancestor / ".git"
        # 모델 경로 내부 저장소를 감지해 잘못된 입력의 후속 사용 차단
        if marker.is_file() or marker.is_dir() or marker.is_symlink():
            # 모델 경로 내부 저장소 오류 알림
            raise ValueError(
                f"{codePrefix(model_key)}_PATH_IN_REPOSITORY: {path}"
            )

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

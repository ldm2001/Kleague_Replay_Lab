# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 기록과 설정을 직렬화할 도구 읽음
import json
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 서버 인증서를 검증할 암호화 통신 도구 읽음
import ssl
# 충돌하지 않는 임시 경로 생성 도구 읽음
import tempfile
# 원본과 분리된 사본 생성 도구 읽음
from copy import deepcopy
# 패키지 자산 경로 조회 도구 읽음
from importlib import resources
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 웹 주소 처리 요청 관련 함수와 자료형 읽음
from urllib.request import Request, urlopen as _stdlib_urlopen
# 서버 인증서 검증에 사용할 신뢰 인증서 목록 읽음
import certifi


# 승인된 사람과 공 검출 모델 식별자를 지정 문자열 값으로 설정
MODEL_ID = "PekingU/rtdetr_r18vd"
# 승인 모델의 캐시 폴더 이름을 승인 검출 모델 값으로 설정
MODEL_SLUG = "rtdetr_r18vd"
# 승인 모델의 고정 판본 식별자를 고정 식별 문자열 값으로 설정
MODEL_REVISION = "ac77a11ff0170a41b771c03264987f8ce2b0d753"
# 모델 호스트를 지정 문자열 값으로 설정
MODEL_HOST = "https://huggingface.co"
# 읽기 제한 시간 초를 30 값으로 설정
READ_TIMEOUT_SECONDS = 30
# 읽기 묶음 크기에 1024 및 1024의 곱 저장
CHUNK_SIZE = 1024 * 1024
# 승인된 파일 이름 목록에 여러 값을 순서대로 모은 자료의 변경 불가 집합 변환 결과 저장
_APPROVED_FILENAMES = frozenset(
    {"config.json", "preprocessor_config.json", "model.safetensors", "README.md"}
)
# 주소 열기에 표준 라이브러리 주소 열기 저장
_urlopen = _stdlib_urlopen

# 관측 모델 자산 명세 읽음
def assetManifest() -> dict[str, Any]:
    # 자산 명세 경로에 하위 경로 결합 처리 결과 저장
    manifest_path = resources.files("replay_perception").joinpath("model-manifest.json")
    # 자산 명세에 직렬화 문자열을 해석한 자료 저장
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    # 자산 명세 입력 검사으로 자산 명세의 계약 확인
    manifestValidation(manifest)
    # 자산 명세 반환
    return manifest

# 승인 모델의 기본 로컬 캐시 경로를 반환
def directory() -> Path:
    # 사용자 캐시 아래 모델 이름과 고정 판본별 폴더 경로 반환
    return Path.home() / ".cache" / "replay-lab" / "models" / MODEL_SLUG / MODEL_REVISION

# 관측 모델 자산 무결성 확인
def verification(path: Path | str, sha256: str) -> None:
    # 후보에 파일 경로 객체 저장
    candidate = Path(path)
    # 모델 파일 없는을 감지해 잘못된 입력의 후속 사용 차단
    if not candidate.is_file():
        # 모델 파일 없는 오류 알림
        raise FileNotFoundError(f"MODEL_FILE_MISSING: {candidate.name}")

    # 해시 누적기에 내용 변경 검사용 해시 누적기 저장
    digest = hashlib.sha256()
    # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
    with candidate.open("rb") as stream:
        # 반복자에서 읽기 묶음을 하나씩 읽음
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            # 해시 누적기에 읽기 묶음 반영
            digest.update(chunk)
    # 고정 해시와 다르면 손상되거나 교체된 자산 사용 차단
    if digest.hexdigest() != sha256:
        # 모델 해시 불일치 오류 알림
        raise ValueError(f"MODEL_HASH_MISMATCH: {candidate.name}")

# 모델 자산 무결성 확인
def assetVerification(model_dir: Path | str) -> dict[str, Any]:
    # 폴더에 외부 폴더 처리 결과 저장
    directory = externalDirectory(model_dir)
    # 자산 명세에 자산 자산 명세 처리 결과 저장
    manifest = assetManifest()
    # 검증한을 모를 빈 자료 생성
    verified: dict[str, str] = {}
    # 자산 명세의 파일 목록에서 명세 항목을 하나씩 읽음
    for entry in manifest["files"]:
        # 경로에 폴더 및 명세 항목의 이름의 비율 저장
        path = directory / entry["name"]
        # 부정 조건 명세 항목의 필요한 및 부정 조건 경로 존재 여부 확인
        if not entry["required"] and not path.exists():
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 무결성 검증으로 경로의 계약 확인
        verification(path, entry["sha256"])
        # 모델 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if path.stat().st_size != entry["size"]:
            # 모델 크기 불일치 오류 알림
            raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")
        # 검증한의 선택 항목에 명세 항목의 내용 해시 저장
        verified[entry["name"]] = entry["sha256"]
    # 메타데이터 처리 결과 반환
    return metadata(manifest, verified)

# 관측 모델 자산 내려받음
def download(model_dir: Path | str) -> dict[str, Any]:
    # 폴더에 외부 폴더 처리 결과 저장
    directory = externalDirectory(model_dir)
    # 폴더에 필요한 출력 폴더 생성
    directory.mkdir(parents=True, exist_ok=True)
    # 자산 명세에 자산 자산 명세 처리 결과 저장
    manifest = assetManifest()

    # 자산 명세의 파일 목록에서 명세 항목을 하나씩 읽음
    for entry in manifest["files"]:
        # 대상 파일에 폴더 및 명세 항목의 이름의 비율 저장
        destination = directory / entry["name"]
        # 경로 존재 여부 확인
        if destination.exists():
            # 명세 항목 입력 검사으로 대상 파일의 계약 확인
            entryValidation(destination, entry)
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 명세 항목 내려받기에 필요한 입력을 전달해 처리
        entryDownload(destination, entry)

    # 고정 자산 무결성 확인 결과 반환
    return assetVerification(directory)

# 자산 항목 내려받음
def entryDownload(destination: Path, entry: dict[str, Any]) -> None:
    # 예상 크기에 명세 항목의 크기 저장
    expected_size = entry["size"]
    # 신뢰 인증서 목록을 사용해 서버 인증서 검증 문맥 생성
    context = ssl.create_default_context(cafile=certifi.where())
    # 요청에 요청 처리 결과 저장
    request = Request(
        entry["url"],
        headers={"User-Agent": "Replay-Lab-Perception/0.1"},
        method="GET",
    )
    # 파일 핸들 번호·임시 파일 이름에 고유 임시 파일 생성 처리 결과 저장
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.download-",
    )
    # 임시 파일에 파일 경로 객체 저장
    temporary = Path(temporary_name)
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 처리 종료 시 정리되도록 주소 열기 처리 결과 사용
            with _urlopen(
                request,
                timeout=READ_TIMEOUT_SECONDS,
                context=context,
            ) as response:
                # 선언된 크기에 지정 문자열의 키에 해당하는 값 저장
                declared_size = response.headers.get("Content-Length")
                # 선언된 크기가 있는지 확인
                if declared_size is not None:
                    # 실패 시 아래 예외 처리로 정리할 작업 시작
                    try:
                        # 해석한 크기에 선언된 크기의 정수 변환 결과 저장
                        parsed_size = int(declared_size)
                    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
                    except (TypeError, ValueError) as exc:
                        # 모델 크기 불일치 오류 알림
                        raise ValueError(
                            f"MODEL_SIZE_MISMATCH: {entry['name']}"
                        ) from exc
                    # 모델 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
                    if parsed_size != expected_size:
                        # 모델 크기 불일치 오류 알림
                        raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")

                # 해시 누적기에 내용 변경 검사용 해시 누적기 저장
                digest = hashlib.sha256()
                # 수신량을 0 값으로 설정
                received = 0
                # 처리 종료 시 정리되도록 파일 핸들의 스트림 연결 처리 결과 사용
                with os.fdopen(descriptor, "wb") as output:
                    # 파일 핸들 번호에 부호를 바꾼 1 저장
                    descriptor = -1
                    # 반복 종료 조건을 본문에서 확인
                    while True:
                        # 실패 시 아래 예외 처리로 정리할 작업 시작
                        try:
                            # 읽기 묶음에 한도 안에서 읽은 바이트 저장
                            chunk = response.read(CHUNK_SIZE)
                        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
                        except TimeoutError as exc:
                            # 모델 내려받기 제한 시간 오류 알림
                            raise TimeoutError(
                                f"MODEL_DOWNLOAD_TIMEOUT: {entry['name']}"
                            ) from exc
                        # 읽기 묶음이 비어 있거나 조건을 충족하지 않는지 확인
                        if not chunk:
                            # 더 처리할 항목이 없거나 종료 조건을 충족해 반복 종료
                            break
                        # 수신량에 읽기 묶음의 항목 수를 더해 누적
                        received += len(chunk)
                        # 모델 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
                        if received > expected_size:
                            # 모델 크기 불일치 오류 알림
                            raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")
                        # 해시 누적기에 읽기 묶음 반영
                        digest.update(chunk)
                        # 출력에 읽기 묶음 기록
                        output.write(chunk)
                    # 출력의 메모리 버퍼를 출력 스트림에 반영
                    output.flush()
                    # 버퍼의 파일 내용을 저장 장치에 동기화
                    os.fsync(output.fileno())

                # 모델 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
                if received != expected_size:
                    # 모델 크기 불일치 오류 알림
                    raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")
                # 고정 해시와 다르면 손상되거나 교체된 자산 사용 차단
                if digest.hexdigest() != entry["sha256"]:
                    # 모델 해시 불일치 오류 알림
                    raise ValueError(f"MODEL_HASH_MISMATCH: {entry['name']}")
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except TimeoutError as exc:
            # 모델 내려받기 제한 시간 및 예외의 문자열 변환 결과의 포함 조건 확인
            if "MODEL_DOWNLOAD_TIMEOUT" in str(exc):
                # 현재 오류를 호출자에게 전달
                raise
            # 모델 내려받기 제한 시간 오류 알림
            raise TimeoutError(f"MODEL_DOWNLOAD_TIMEOUT: {entry['name']}") from exc

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

# 자산 항목 무결성 확인
def entryValidation(path: Path, entry: dict[str, Any]) -> None:
    # 무결성 검증으로 경로의 계약 확인
    verification(path, entry["sha256"])
    # 모델 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
    if path.stat().st_size != entry["size"]:
        # 모델 크기 불일치 오류 알림
        raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")

# 모델 경로를 해석하고 저장소 밖의 안전한 위치인지 확인
def externalDirectory(model_dir: Path | str) -> Path:
    # 폴더에 심볼릭 링크를 해석한 경로 저장
    directory = Path(model_dir).expanduser().resolve(strict=False)
    # 폴더·상위 경로 목록의 펼친 값에서 상위 경로를 하나씩 읽음
    for ancestor in (directory, *directory.parents):
        # 버전 관리 표식에 상위 경로 및 지정 문자열의 비율 저장
        git_marker = ancestor / ".git"
        # 모델 경로 내부 저장소를 감지해 잘못된 입력의 후속 사용 차단
        if git_marker.is_file() or git_marker.is_dir():
            # 모델 경로 내부 저장소 오류 알림
            raise ValueError(f"MODEL_PATH_IN_REPOSITORY: {directory}")
    # 폴더 반환
    return directory

# 검증한 모델 파일의 해시와 고정 출처를 기록
def metadata(manifest: dict[str, Any], files: dict[str, str]) -> dict[str, Any]:
    # 필드별로 묶은 기록 반환
    return {
        # 자산 명세 버전 필드 기록
        "manifest_version": manifest["schema_version"],
        # 모델 식별자 필드 기록
        "model_id": manifest["model_id"],
        # 고정 판본 필드 기록
        "revision": manifest["revision"],
        # 사용 허가 필드 기록
        "license": manifest["license"],
        # 모델 구조 필드 기록
        "architecture": manifest["architecture"],
        # 비활성 사용자 정의 연산 커널 필드 기록
        "disable_custom_kernels": manifest["disable_custom_kernels"],
        # 파일 목록 필드 기록
        "files": dict(files),
        # 임계값 필드 기록
        "threshold": manifest["threshold"],
        # 레이블 목록 필드 기록
        "labels": list(manifest["labels"]),
        # 전처리 필드 기록
        "preprocessing": deepcopy(manifest["preprocessing"]),
    }

# 자산 명세 입력 검사
def manifestValidation(manifest: dict[str, Any]) -> None:
    # 모델 명세의 승인 값과 파일 계약에서 벗어난 항목이 있는지 확인
    if (
        manifest.get("schema_version") != 1
        or manifest.get("model_id") != MODEL_ID
        or manifest.get("revision") != MODEL_REVISION
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
    prefix = f"{MODEL_HOST}/{MODEL_ID}/resolve/{MODEL_REVISION}/"
    # 명세 항목 목록에서 명세 항목을 하나씩 읽음
    for entry in entries:
        # 이름에 이름의 키에 해당하는 값 저장
        name = entry.get("name")
        # 모델 자산 명세의 자료 형식과 허용 조건 확인
        if name not in _APPROVED_FILENAMES or name in seen:
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

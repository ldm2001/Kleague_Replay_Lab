# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 명령행 옵션과 자료형을 검증할 도구 읽음
import argparse
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
import math
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 서버 인증서를 검증할 암호화 통신 도구 읽음
import ssl
# 내려받기 시간 제한을 강제할 별도 프로세스 도구 읽음
import subprocess
# 실행 경로와 표준 입출력을 다룰 도구 읽음
import sys
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any, BinaryIO, Sequence
# 웹 주소 처리 오류 관련 함수와 자료형 읽음
from urllib.error import HTTPError, URLError
# 웹 주소 처리 해석 관련 함수와 자료형 읽음
from urllib.parse import urljoin, urlsplit
# 웹 주소 처리 요청 관련 함수와 자료형 읽음
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
# 서버 인증서 검증에 사용할 신뢰 인증서 목록 읽음
import certifi
# 승인 모델 키 목록과 파일 명세 조회 및 오류 코드 접두사 함수 읽음
from .catalog import MODEL_KEYS, approvedEntry, codePrefix


# 읽기 제한 시간 초를 30 값으로 설정
READ_TIMEOUT_SECONDS = 30
# 읽기 묶음 크기에 1024 및 1024의 곱 저장
CHUNK_SIZE = 1024 * 1024
# 최댓값 주소 이동 횟수를 5 값으로 설정
MAX_REDIRECTS = 5
# 주소 이동 상태 코드 목록에 여러 값을 순서대로 모은 자료의 변경 불가 집합 변환 결과 저장
_REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})
# 자식 프로세스가 부모에게 전달하는 거부 오류 코드 접미사 목록 저장
_REJECTED_CODES = (
    "SIZE_MISMATCH",
    "HASH_MISMATCH",
    "REDIRECT_SCHEME_INVALID",
    "REDIRECT_LIMIT",
    "REDIRECT_INVALID",
)


# 반환 주소 이동 응답의 필드와 동작을 묶을 자료형 선언
class _ReturnRedirectResponse(HTTPRedirectHandler):

    # 주소 이동 응답을 자동 추적하지 않고 호출자에게 반환
    def response(
        self,
        _request: Request,
        response: Any,
        _code: int,
        _message: str,
        _headers: Any,
    ) -> Any:
        # 응답 반환
        return response

    # 웹 통신 오류 301에 응답 저장
    http_error_301 = response
    # 웹 통신 오류 302에 응답 저장
    http_error_302 = response
    # 웹 통신 오류 303에 응답 저장
    http_error_303 = response
    # 웹 통신 오류 307에 응답 저장
    http_error_307 = response
    # 웹 통신 오류 308에 응답 저장
    http_error_308 = response

# 인증서를 검증하고 리다이렉트를 직접 통제하는 암호화 웹 통신 클라이언트를 생성
def httpsOpener() -> Any:
    # 맥락에 생성 기본 맥락 처리 결과 저장
    context = ssl.create_default_context(cafile=certifi.where())
    # 구성 웹 연결기 처리 결과 반환
    return build_opener(
        HTTPSHandler(context=context),
        _ReturnRedirectResponse(),
    )

# 승인 파일의 보안 연결 읽기와 주소 이동·용량 제한
def entryStream(entry: dict[str, Any], output: BinaryIO, model_key: str) -> None:
    # 파일 이름에 명세 항목의 이름 저장
    filename = entry["name"]
    # 접두사에 모델 키별 오류 코드 접두사 저장
    prefix = codePrefix(model_key)
    # 현재 주소에 명세 항목의 주소 저장
    current_url = entry["url"]
    # 안전 검사 주소으로 현재 주소의 계약 확인
    safeUrl(current_url, filename, model_key)
    # 웹 연결기에 암호화 웹 통신 웹 연결기 처리 결과 저장
    opener = httpsOpener()

    # 반복할 순번 범위에서 주소 이동 수량을 하나씩 읽음
    for redirect_count in range(MAX_REDIRECTS + 1):
        # 요청에 요청 처리 결과 저장
        request = Request(
            current_url,
            headers={"User-Agent": "Replay-Lab-Perception/0.1"},
            method="GET",
        )
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 응답에 열린 파일 또는 영상 스트림 저장
            response = opener.open(request, timeout=READ_TIMEOUT_SECONDS)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except OSError as exc:
            # 열기 오류를 고정 코드 예외로 바꿔 원인과 함께 알림
            raise openError(exc, filename, model_key) from exc

        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 상태에 응답 상태 처리 결과 저장
            status = responseStatus(response)
            # 상태 및 주소 이동 상태 코드 목록의 포함 조건 확인
            if status in _REDIRECT_CODES:
                # 모델주소 이동 한도를 감지해 잘못된 입력의 후속 사용 차단
                if redirect_count >= MAX_REDIRECTS:
                    # 모델주소 이동 한도 오류 알림
                    raise HTTPError(
                        current_url,
                        status,
                        f"{prefix}_REDIRECT_LIMIT: {filename}",
                        response.headers,
                        response,
                    )
                # 이동 주소에 이동 주소의 키에 해당하는 값 저장
                location = response.headers.get("Location")
                # 모델주소 이동의 자료 형식과 허용 조건 확인
                if not isinstance(location, str) or not location:
                    # 모델주소 이동 유효하지 않음 오류 알림
                    raise HTTPError(
                        current_url,
                        status,
                        f"{prefix}_REDIRECT_INVALID: {filename}",
                        response.headers,
                        response,
                    )
                # 현재 주소를 기준으로 상대 경로를 포함한 다음 이동 주소 생성
                next_url = urljoin(current_url, location)
                # 처음 주소뿐 아니라 이동할 주소도 암호화 통신과 자격 정보 제한 재검사
                safeUrl(next_url, filename, model_key, status=status)
                # 현재 주소에 다음 주소 저장
                current_url = next_url
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue

            # 모델웹 통신 상태의 자료 형식과 허용 조건 확인
            if status != 200:
                # 모델웹 통신 상태 유효하지 않음 오류 알림
                raise HTTPError(
                    current_url,
                    status,
                    f"{prefix}_HTTP_STATUS_INVALID: {filename}",
                    response.headers,
                    response,
                )
            # 응답 스트림에 필요한 입력을 전달해 처리
            responseStream(response, entry, output, model_key)
            # 현재 함수의 처리 종료
            return
        # 성공과 실패에 관계없이 남은 자원 정리
        finally:
            # 응답의 열린 자원 정리
            response.close()

    # 현재 오류를 호출자에게 전달
    raise AssertionError("unreachable redirect loop")

# 다운로드 응답을 크기와 해시를 검증하며 출력에 기록
def responseStream(
    response: Any, entry: dict[str, Any], output: BinaryIO, model_key: str
) -> None:
    # 파일 이름에 명세 항목의 이름 저장
    filename = entry["name"]
    # 접두사에 모델 키별 오류 코드 접두사 저장
    prefix = codePrefix(model_key)
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
            # 모델크기 불일치 오류 알림
            raise ValueError(
                f"{prefix}_SIZE_MISMATCH: {filename}"
            ) from exc
        # 모델크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if parsed_size != entry["size"]:
            # 모델크기 불일치 오류 알림
            raise ValueError(f"{prefix}_SIZE_MISMATCH: {filename}")

    # 해시 누적기에 내용 변경 검사용 해시 누적기 저장
    digest = hashlib.sha256()
    # 수신량을 0 값으로 설정
    received = 0
    # 읽기 사용 가능한에 응답의 속성 또는 기본값 저장
    read_available = getattr(response, "read1", response.read)
    # 반복 종료 조건을 본문에서 확인
    while True:
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 읽기 묶음에 읽기 사용 가능한 처리 결과 저장
            chunk = read_available(CHUNK_SIZE)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except TimeoutError as exc:
            # 모델내려받기 제한 시간 오류 알림
            raise TimeoutError(
                f"{prefix}_DOWNLOAD_TIMEOUT: {filename}"
            ) from exc
        # 읽기 묶음이 비어 있거나 조건을 충족하지 않는지 확인
        if not chunk:
            # 더 처리할 항목이 없거나 종료 조건을 충족해 반복 종료
            break
        # 서버가 선언한 크기와 별개로 실제 받은 바이트 수 누적
        received += len(chunk)
        # 예상 용량을 넘는 응답을 즉시 중단해 과도한 파일 기록 차단
        if received > entry["size"]:
            # 모델크기 불일치 오류 알림
            raise ValueError(f"{prefix}_SIZE_MISMATCH: {filename}")
        # 해시 누적기에 읽기 묶음 반영
        digest.update(chunk)
        # 출력에 읽기 묶음 기록
        output.write(chunk)

    # 너무 짧게 끝난 응답도 성공으로 처리하지 않도록 전체 수신 크기 확인
    if received != entry["size"]:
        # 모델크기 불일치 오류 알림
        raise ValueError(f"{prefix}_SIZE_MISMATCH: {filename}")
    # 모델해시 불일치를 감지해 잘못된 입력의 후속 사용 차단
    if digest.hexdigest() != entry["sha256"]:
        # 모델해시 불일치 오류 알림
        raise ValueError(f"{prefix}_HASH_MISMATCH: {filename}")

# 웹 통신 응답의 상태 코드를 정수로 확인
def responseStatus(response: Any) -> int:
    # 상태에 응답의 속성 또는 기본값 저장
    status = getattr(response, "status", None)
    # 상태가 없는지 확인
    if status is None:
        # 상태에 응답 상태 코드 처리 결과 저장
        status = response.getcode()
    # 상태의 정수 변환 결과 반환
    return int(status)

# 자격 정보나 미지원 프로토콜이 없는 안전한 암호화 웹 통신 주소인지 확인
def safeUrl(url: str, filename: str, model_key: str, *, status: int = 302) -> None:
    # 해석한에 주소 요소 분리 처리 결과 저장
    parsed = urlsplit(url)
    # 이동 주소의 암호화 방식과 자격 정보 또는 전달받은 시간 한도의 안전 조건 확인
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        # 모델주소 이동 통신 방식 유효하지 않음 오류 알림
        raise HTTPError(
            url,
            status,
            f"{codePrefix(model_key)}_REDIRECT_SCHEME_INVALID: {filename}",
            {},
            None,
        )

# 열기 오류의 고정 코드 예외 변환
def openError(exc: OSError, filename: str, model_key: str) -> Exception:
    # 접두사에 모델 키별 오류 코드 접두사 저장
    prefix = codePrefix(model_key)
    # 원인에 주소 오류가 감싼 원인 또는 예외 자체 저장
    reason = exc.reason if isinstance(exc, URLError) else exc
    # 원인의 제한 시간 초과 자료형 여부 확인
    if isinstance(reason, TimeoutError):
        # 모델 내려받기 제한 시간 오류 반환
        return TimeoutError(f"{prefix}_DOWNLOAD_TIMEOUT: {filename}")
    # 모델 내려받기 실패 오류 반환
    return RuntimeError(f"{prefix}_DOWNLOAD_FAILED: {filename}")

# 제한 시간 내 자식 프로세스 응답·종료 수집
def boundedCommunication(
    process: subprocess.Popen[str],
    *,
    timeout_seconds: float,
    filename: str,
    model_key: str,
) -> tuple[str, str]:
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 출력과 종료 상태 수집 처리 결과 반환
        return process.communicate(timeout=timeout_seconds)
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except subprocess.TimeoutExpired as exc:
        # 시간 제한을 넘긴 하위 프로세스 종료
        process.kill()
        # 하위 프로세스의 남은 출력과 종료 상태 수집
        process.communicate()
        # 모델 내려받기 제한 시간 오류 알림
        raise TimeoutError(
            f"{codePrefix(model_key)}_DOWNLOAD_TIMEOUT: {filename}"
        ) from exc

# 자식 프로세스가 부모에게 전달할 고정 오류 코드 선택
def failureCode(exc: BaseException, prefix: str) -> str:
    # 메시지에 주소 오류의 사유 또는 예외 자체 저장
    message = exc.reason if isinstance(exc, HTTPError) else exc
    # 코드에 메시지의 첫 구분 문자 앞 문자열 저장
    code = str(message).split(":", 1)[0].strip()
    # 전달 허용 코드 집합에 제한 시간 코드와 거부 코드 저장
    allowed = {
        f"{prefix}_DOWNLOAD_TIMEOUT",
        *(f"{prefix}_{name}" for name in _REJECTED_CODES),
    }
    # 코드의 전달 허용 집합 포함 여부 확인
    if code in allowed:
        # 허용된 코드 반환
        return code
    # 모델 내려받기 실패 코드 반환
    return f"{prefix}_DOWNLOAD_FAILED"

# 자식 프로세스의 오류 출력을 오류 종류별 예외로 변환
def childFailure(stderr: str, filename: str, model_key: str) -> Exception:
    # 접두사에 모델 키별 오류 코드 접두사 저장
    prefix = codePrefix(model_key)
    # 출력 줄 집합에 오류 출력의 앞뒤 공백을 제거한 줄 저장
    lines = {line.strip() for line in stderr.splitlines()}
    # 제한 시간 코드의 출력 줄 포함 여부 확인
    if f"{prefix}_DOWNLOAD_TIMEOUT" in lines:
        # 모델 내려받기 제한 시간 오류 반환
        return TimeoutError(f"{prefix}_DOWNLOAD_TIMEOUT: {filename}")
    # 거부 코드 접미사 목록에서 접미사를 하나씩 읽음
    for name in _REJECTED_CODES:
        # 코드에 접두사와 접미사를 결합한 거부 코드 저장
        code = f"{prefix}_{name}"
        # 거부 코드의 출력 줄 포함 여부 확인
        if code in lines:
            # 거부 코드별 오류 반환
            return ValueError(f"{code}: {filename}")
    # 모델 내려받기 실패 오류 반환
    return RuntimeError(f"{prefix}_DOWNLOAD_FAILED: {filename}")

# 시간 제한 자식 프로세스로 승인 파일 다운로드 격리
def boundedDownload(
    model_key: str,
    filename: str,
    descriptor: int,
    timeout_seconds: float,
) -> None:
    # 승인된 명세 항목으로 모델 키의 계약 확인
    approvedEntry(model_key, filename)
    # 접두사에 모델 키별 오류 코드 접두사 저장
    prefix = codePrefix(model_key)
    # 모델 내려받기 파일 핸들 번호의 자료 형식과 허용 조건 확인
    if not isinstance(descriptor, int) or isinstance(descriptor, bool) or descriptor < 0:
        # 모델 내려받기 파일 핸들 번호 유효하지 않음 오류 알림
        raise ValueError(f"{prefix}_DOWNLOAD_DESCRIPTOR_INVALID")
    # 이동 주소의 암호화 방식과 자격 정보 또는 전달받은 시간 한도의 안전 조건 확인
    if (
        not isinstance(timeout_seconds, (int, float))
        or isinstance(timeout_seconds, bool)
        or not math.isfinite(timeout_seconds)
        or timeout_seconds <= 0
    ):
        # 모델 내려받기 제한 시간 유효하지 않음 오류 알림
        raise ValueError(f"{prefix}_DOWNLOAD_TIMEOUT_INVALID")

    # 프로세스에 하위 프로세스 생성 처리 결과 저장
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            'replay_perception.transport',
            "_child",
            model_key,
            filename,
            str(descriptor),
        ],
        pass_fds=(descriptor,),
        close_fds=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    # 표준 출력·표준 오류 출력에 상한 적용 통신 처리 결과 저장
    _stdout, stderr = boundedCommunication(
        process,
        timeout_seconds=float(timeout_seconds),
        filename=filename,
        model_key=model_key,
    )
    # 프로세스의 종료 코드 및 0의 일치 조건 확인
    if process.returncode == 0:
        # 현재 함수의 처리 종료
        return

    # 자식 프로세스의 오류 출력을 오류 종류별 예외로 바꿔 호출자에게 전달
    raise childFailure(stderr, filename, model_key)

# 승인된 단일 모델 파일을 전달받은 출력 핸들에 내려받음
def child(model_key: str, filename: str, descriptor_text: str) -> int:
    # 접두사에 모델 키별 오류 코드 접두사 저장
    prefix = codePrefix(model_key)
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 파일 핸들 번호에 파일 핸들 번호 문자열의 정수 변환 결과 저장
        descriptor = int(descriptor_text)
        # 모델 내려받기 파일 핸들 번호의 자료 형식과 허용 조건 확인
        if descriptor < 0:
            # 모델 내려받기 파일 핸들 번호 유효하지 않음 오류 알림
            raise ValueError(f"{prefix}_DOWNLOAD_DESCRIPTOR_INVALID")
        # 명세 항목에 승인된 명세 항목 처리 결과 저장
        entry = approvedEntry(model_key, filename)
        # 처리 종료 시 정리되도록 파일 핸들의 스트림 연결 처리 결과 사용
        with os.fdopen(descriptor, "wb") as output:
            # 명세 항목 스트림에 필요한 입력을 전달해 처리
            entryStream(entry, output, model_key)
            # 출력의 메모리 버퍼를 출력 스트림에 반영
            output.flush()
            # 버퍼의 파일 내용을 저장 장치에 동기화
            os.fsync(output.fileno())
        # 0 반환
        return 0
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except BaseException as exc:
        # 예외의 자료형 일치 여부 확인
        if isinstance(exc, KeyboardInterrupt):
            # 현재 오류를 호출자에게 전달
            raise
        # 부모에게 전달할 고정 오류 코드만 지정 출력에 표시
        print(failureCode(exc, prefix), file=sys.stderr)
        # 1 반환
        return 1

# 명령행 인자 검증과 진단·영상 작업 실행
def main(argv: Sequence[str] | None = None) -> int:
    # 명령행 해석기에 인자 명령행 해석기 처리 결과 저장
    parser = argparse.ArgumentParser(add_help=False)
    # 명령행에서 받을 실행 방식의 형식과 기본값 등록
    parser.add_argument("mode", choices=("_child",))
    # 명령행에서 받을 모델 키의 형식과 기본값 등록
    parser.add_argument("model_key", choices=MODEL_KEYS)
    # 명령행에서 받을 파일 이름의 형식과 기본값 등록
    parser.add_argument("filename")
    # 명령행에서 받을 파일 핸들 번호의 형식과 기본값 등록
    parser.add_argument("descriptor")
    # 인자 목록에 해석 인자 처리 결과 저장
    arguments = parser.parse_args(argv)
    # 하위 프로세스 처리 결과 반환
    return child(
        arguments.model_key,
        arguments.filename,
        arguments.descriptor,
    )


# 실행 모듈 이름 및 주심의 일치 조건 확인
if __name__ == "__main__":
    # 현재 오류를 호출자에게 전달
    raise SystemExit(main())

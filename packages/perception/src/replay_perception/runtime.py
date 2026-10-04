# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 재현을 위한 실행 플랫폼 조회 도구 읽음
import platform
# 실패 사유 식별자 형식을 검사할 도구 읽음
import re
# 운영체제별 메모리 단위를 구분할 실행 환경 도구 읽음
import sys
# 설치 라이브러리 버전 조회 도구 읽음
from importlib.metadata import PackageNotFoundError, version
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path

# 파일의 상태 정보를 수집해 처리 중 변경 여부를 비교
def fingerprint(path: Path) -> tuple[int, int, int, int]:
    # 파일 상태에 현재 파일 상태 저장
    stat = path.stat()
    # 여러 값을 순서대로 모은 자료 반환
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns

# 진단용 설치 라이브러리 버전 수집
def versions() -> dict[str, str | None]:
    # 버전 목록을 다음 항목으로 구성
    versions = {
        # 파이썬 필드 기록
        "python": platform.python_version(),
        # 실행 플랫폼 필드 기록
        "platform": platform.platform(),
        # 장치 구조 필드 기록
        "machine": platform.machine(),
    }
    # 여러 값을 순서대로 모은 자료에서 이름을 하나씩 읽음
    for name in (
        "torch",
        "torchvision",
        "transformers",
        "trackers",
        "supervision",
        "av",
        "numpy",
        "opencv-python",
    ):
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 버전 목록의 선택 항목에 버전 처리 결과 저장
            versions[name] = version(name)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except PackageNotFoundError:
            # 버전 목록의 선택 항목을 아직 없는 상태로 초기화
            versions[name] = None
    # 버전 목록 반환
    return versions

# 현재 프로세스의 최대 메모리 사용량을 바이트로 반환
def peakMemory() -> int | None:
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 현재 프로세스의 자원 사용량 조회 도구 읽음
        import resource
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except ImportError:
        # 없음 반환
        return None
    # 최대에 프로세스 자원 사용량 처리 결과의 프로세스 자원 최대 상주 메모리 저장
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # 조건에 따라 선택한 최대의 정수 변환 결과 반환
    return int(peak if sys.platform == "darwin" else peak * 1024)

# 예외를 진단 계약에서 사용하는 실패 사유로 정리
def failureReason(error: Exception) -> str:
    # 문자열에 오류의 문자열 변환 결과 저장
    text = str(error)
    # 조건에 따라 선택한 문자열 반환
    return text if re.fullmatch(r"[A-Z][A-Z0-9_]{0,100}", text) else type(error).__name__

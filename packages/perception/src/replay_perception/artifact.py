# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 기록과 설정을 직렬화할 도구 읽음
import json
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any, BinaryIO
# 진단 기록을 상한 안에서 압축할 도구 읽음
import zlib
# 보고서 관련 함수와 자료형 읽음
from .report import gitWorktree


# 최댓값 원시 바이트에 512 및 1024의 곱 및 1024의 곱 저장
MAX_RAW_BYTES = 512 * 1024 * 1024
# 최댓값 압축된 바이트에 128 및 1024의 곱 및 1024의 곱 저장
MAX_COMPRESSED_BYTES = 128 * 1024 * 1024
# 최댓값 기록 바이트에 8 및 1024의 곱 및 1024의 곱 저장
MAX_RECORD_BYTES = 8 * 1024 * 1024
# 압축 종료부 예비 용량을 128 값으로 설정
_FOOTER_RESERVE = 128


# 진단 산출물의 필드와 동작을 묶을 자료형 선언
class DiagnosticArtifact:
    """완전한 줄 단위 직렬화 자료 기록 추가와 실패 시 읽을 수 있는 부분 압축 파일 보존"""

    # 초기 상태·입력 계약 구성
    def __init__(self, path: Path) -> None:
        # 경로에 절대 경로 저장
        self.path = Path(path).expanduser().absolute()
        # 파일을 아직 없는 상태로 초기화
        self._file: BinaryIO | None = None
        # 압축기에 압축기 생성 처리 결과 저장
        self._compressor = zlib.compressobj(level=6, wbits=31)
        # 원시 바이트를 0 값으로 설정
        self._raw_bytes = 0
        # 압축된 바이트를 0 값으로 설정
        self._compressed_bytes = 0
        # 메타데이터를 아직 없는 상태로 초기화
        self._metadata: dict[str, Any] | None = None
        # 최초 오류를 아직 없는 상태로 초기화
        self._primary_error: Exception | None = None

    # 처리 자원 준비
    def __enter__(self) -> DiagnosticArtifact:
        # 진단 이미 열린 상태를 감지해 잘못된 입력의 후속 사용 차단
        if self._file is not None or self._metadata is not None:
            # 진단 이미 열린 상태 오류 알림
            raise RuntimeError("DIAGNOSTIC_ALREADY_OPENED")
        # 출력 내부 버전 관리 작업 폴더를 감지해 잘못된 입력의 후속 사용 차단
        if gitWorktree(self.path):
            # 출력 내부 버전 관리 작업 폴더 오류 알림
            raise ValueError("OUTPUT_INSIDE_GIT_WORKTREE")
        # 경로의 상위 경로에 필요한 출력 폴더 생성
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # 파일에 열린 파일 또는 영상 스트림 저장
        self._file = self.path.open("xb")
        # 현재 객체 반환
        return self

    # 행 크기·압축 전 용량 제한과 비공개 압축 기록
    def append(self, record: dict[str, Any]) -> None:
        # 진단 아닌 활성을 감지해 잘못된 입력의 후속 사용 차단
        if self._file is None or self._file.closed or self._metadata is not None:
            # 진단 아닌 활성 오류 알림
            raise RuntimeError("DIAGNOSTIC_NOT_ACTIVE")
        # 진단 기록의 자료 형식과 허용 조건 확인
        if not isinstance(record, dict):
            # 진단 기록 유효하지 않음 오류 알림
            raise ValueError("DIAGNOSTIC_RECORD_INVALID")
        # 원시에 문자열의 바이트 자료 저장
        raw = (
            json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
        ).encode()
        # 진단 기록 한도를 감지해 잘못된 입력의 후속 사용 차단
        if len(raw) > MAX_RECORD_BYTES:
            # 진단 기록 한도 오류 알림
            raise ValueError("DIAGNOSTIC_RECORD_LIMIT")
        # 진단 원시 한도를 감지해 잘못된 입력의 후속 사용 차단
        if self._raw_bytes + len(raw) > MAX_RAW_BYTES:
            # 진단 원시 한도 오류 알림
            raise ValueError("DIAGNOSTIC_RAW_LIMIT")
        # 제한된 단일 기록의 시험 압축과 크기 초과 시 실제 스트림 보존
        proposed = self._compressor.copy()
        # 읽기 묶음에 압축 처리 결과 및 버퍼 비우기 처리 결과의 합 저장
        chunk = proposed.compress(raw) + proposed.flush(zlib.Z_SYNC_FLUSH)
        # 진단 압축된 한도를 감지해 잘못된 입력의 후속 사용 차단
        if self._compressed_bytes + len(chunk) + _FOOTER_RESERVE > MAX_COMPRESSED_BYTES:
            # 진단 압축된 한도 오류 알림
            raise ValueError("DIAGNOSTIC_COMPRESSED_LIMIT")
        # 쓰기가 도중에 실패하면 불완전한 끝부분을 되돌릴 위치 보존
        position = self._file.tell()
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 파일에 읽기 묶음 기록
            self._file.write(chunk)
            # 파일의 메모리 버퍼를 출력 스트림에 반영
            self._file.flush()
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except OSError:
            # 파일의 읽기 또는 쓰기 위치를 기록 위치으로 이동
            self._file.seek(position)
            # 파일의 현재 위치 뒤 불완전한 기록 제거
            self._file.truncate()
            # 현재 오류를 호출자에게 전달
            raise
        # 압축기에 시험 적용한 저장
        self._compressor = proposed
        # 원시 바이트에 원시의 항목 수를 더해 누적
        self._raw_bytes += len(raw)
        # 압축된 바이트에 읽기 묶음의 항목 수를 더해 누적
        self._compressed_bytes += len(chunk)

    # 진단 기록 중 발생한 오류를 최종 실패 상태에 보존
    def failure(self, error: Exception) -> None:
        # 호출 측에서 추론 오류 처리 후 부분 보고서 반환 가능
        # 부분 산출물 마감도 실패하면 최초 오류 보존
        if self._primary_error is None:
            # 최초 오류에 오류 저장
            self._primary_error = error

    # 처리 자원 정리
    def __exit__(self, error_type, _error, _traceback) -> None:
        # 파일이 없는지 또는 파일의 닫힘 여부 확인
        if self._file is None or self._file.closed:
            # 현재 함수의 처리 종료
            return
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 압축 종료 바이트에 버퍼 비우기 처리 결과 저장
            tail = self._compressor.flush(zlib.Z_FINISH)
            # 진단 압축된 한도를 감지해 잘못된 입력의 후속 사용 차단
            if self._compressed_bytes + len(tail) > MAX_COMPRESSED_BYTES:
                # 진단 압축된 한도 오류 알림
                raise ValueError("DIAGNOSTIC_COMPRESSED_LIMIT")
            # 파일에 압축 종료 바이트 기록
            self._file.write(tail)
            # 파일의 메모리 버퍼를 출력 스트림에 반영
            self._file.flush()
            # 파일의 열린 자원 정리
            self._file.close()
            # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
            with self.path.open("rb") as stream:
                # 해시 누적기에 문자열로 표현한 내용 해시 저장
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            # 메타데이터를 다음 항목으로 구성
            self._metadata = {
                # 경로 필드 기록
                "path": str(self.path),
                # 내용 자료형 필드 기록
                "contentType": "application/gzip",
                # 내용 해시 256 필드 기록
                "contentSha256": digest,
                # 크기 바이트 필드 기록
                "sizeBytes": self.path.stat().st_size,
            }
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception as finalization_error:
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 파일의 열린 자원 정리
                self._file.close()
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception:
                # 이 분기에서 추가 작업 없이 기존 처리 흐름 유지
                pass
            # 오류 자료형이 없는지 확인
            if error_type is None:
                # 최초 오류가 있는지 확인
                if self._primary_error is not None:
                    # 현재 오류를 호출자에게 전달
                    raise self._primary_error from finalization_error
                # 현재 오류를 호출자에게 전달
                raise

    # 검증한 모델 파일의 해시와 고정 출처를 기록
    def metadata(self) -> dict[str, Any]:
        # 진단 아닌 마감 상태를 감지해 잘못된 입력의 후속 사용 차단
        if self._metadata is None:
            # 진단 아닌 마감 상태 오류 알림
            raise RuntimeError("DIAGNOSTIC_NOT_FINALIZED")
        # 메타데이터의 사전 사본 변환 결과 반환
        return dict(self._metadata)

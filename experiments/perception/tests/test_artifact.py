# 압축 진단 기록 읽기 도구 읽음
import gzip
# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 기록 직렬화와 읽기 도구 읽음
import json
# 시험에 필요한 검증 도구와 의존성 읽음
import random
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest

# 인터페이스 반환
def api():
    # 검사할 인식 구현 모듈 반환
    return importlib.import_module('replay_perception.artifact')

# 스트리밍 행 자료의 정확한 해시와 로컬 파일명 없는 왕복 확인
def test_streamed_jsonl_roundtrips_with_exact_digest_and_no_local_filename(tmp_path):
    # 파일 경로 준비
    path = tmp_path / "perception.jsonl.gz"
    # 내부 진단을 저장할 기록기의 사용 구간 시작
    with api().DiagnosticArtifact(path) as writer:
        # 보고서 기록기에 현재 관측 추가
        writer.append({"kind": "HEADER", "sourceSha256": "a" * 64})
        # 보고서 기록기에 현재 관측 추가
        writer.append({"kind": "FRAME", "pts": 100, "unknown": None})
    # 시험 영상 메타데이터 생성
    result = writer.metadata()
    # 처리 결과의 기대 자료 일치 확인
    assert result == {"path": str(path), "contentType": "application/gzip",
                      # 전송 본문 해시의 기대값 지정
                      "contentSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                      # 파일 바이트 크기의 시험값 지정
                      "sizeBytes": path.stat().st_size}
    # 기록 행 목록의 조건별 항목 수집
    rows = [json.loads(line) for line in gzip.decompress(path.read_bytes()).splitlines()]
    # 관측 종류 목록의 기대 자료 일치 확인
    assert [row["kind"] for row in rows] == ["HEADER", "FRAME"]
    # 파일의 원래 바이트 자료에 문자열을 인코딩한 바이트 미포함 확인
    assert path.name.encode() not in path.read_bytes()

# 원시 크기 초과 시 행 전체 거부와 유효한 부분 압축 보존 확인
def test_raw_limit_rejects_whole_record_and_preserves_valid_partial_gzip(tmp_path, monkeypatch):
    # 원시 크기 초과 시 행 전체 거부와 유효한 부분 압축 보존 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "MAX_RAW_BYTES", 100)
    # 파일 경로 준비
    path = tmp_path / "perception.jsonl.gz"
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="DIAGNOSTIC_RAW_LIMIT"):
        # 내부 진단을 저장할 기록기의 사용 구간 시작
        with api().DiagnosticArtifact(path) as writer:
            # 보고서 기록기에 현재 관측 추가
            writer.append({"kind": "HEADER"})
            # 보고서 기록기에 현재 관측 추가
            writer.append({"large": "x" * 100})
    # 압축을 해제한 기록 자료의 기대 자료 일치 확인
    assert gzip.decompress(path.read_bytes()) == b'{"kind":"HEADER"}\n'
    # 기록한 진단 파일의 바이트 크기가 영보다 큰지 확인
    assert writer.metadata()["sizeBytes"] > 0

# 압축 크기 제한 시 읽을 수 있는 앞부분 보존 확인
def test_compressed_limit_never_leaves_an_unreadable_prefix(tmp_path, monkeypatch):
    # 압축 크기 제한 시 읽을 수 있는 앞부분 보존 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "MAX_COMPRESSED_BYTES", 300)
    # 파일 경로 준비
    path = tmp_path / "perception.jsonl.gz"
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="DIAGNOSTIC_COMPRESSED_LIMIT"):
        # 내부 진단을 저장할 기록기의 사용 구간 시작
        with api().DiagnosticArtifact(path) as writer:
            # 보고서 기록기에 현재 관측 추가
            writer.append({"kind": "HEADER"})
            # 보고서 기록기에 현재 관측 추가
            writer.append({"large": random.Random(7).randbytes(1000).hex()})
    # 압축 진단 파일 크기가 설정한 300바이트 이내인지 확인
    assert path.stat().st_size <= 300
    # 압축을 해제한 기록 자료의 기대 자료 일치 확인
    assert gzip.decompress(path.read_bytes()) == b'{"kind":"HEADER"}\n'

# 실패 시 완료 행과 주 오류 보존 확인
def test_failure_keeps_completed_records_and_does_not_mask_primary_error(tmp_path):
    # 파일 경로 준비
    path = tmp_path / "perception.jsonl.gz"
    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="INFERENCE_FAILED"):
        # 내부 진단을 저장할 기록기의 사용 구간 시작
        with api().DiagnosticArtifact(path) as writer:
            # 보고서 기록기에 현재 관측 추가
            writer.append({"kind": "HEADER"})
            # 실패 시 완료 행과 주 오류 보존의 예외 상황 재현
            raise RuntimeError("INFERENCE_FAILED")
    # 직렬화 문자열에서 읽은 자료의 기대 자료 일치 확인
    assert json.loads(gzip.decompress(path.read_bytes())) == {"kind": "HEADER"}

# 스트림 변경 전 비유한 행 거부 확인
def test_nonfinite_record_rejected_before_mutating_stream(tmp_path):
    # 내부 진단을 저장할 기록기의 사용 구간 시작
    with api().DiagnosticArtifact(tmp_path / "perception.jsonl.gz") as writer:
        # 입력값 오류 발생 기대
        with pytest.raises(ValueError):
            # 보고서 기록기에 현재 관측 추가
            writer.append({"score": float("nan")})
        # 보고서 기록기에 현재 관측 추가
        writer.append({"score": None})
    # 직렬화 문자열에서 읽은 자료의 기대 자료 일치 확인
    assert json.loads(gzip.decompress((tmp_path / "perception.jsonl.gz").read_bytes())) == {
        # 검출 신뢰 점수의 값 없음 시험값 지정
        "score": None
    }

# 기존 출력과 저장소 출력 거부 확인
def test_existing_output_and_repository_output_are_rejected(tmp_path):
    # 이미 존재하는 파일 준비
    existing = tmp_path / "perception.jsonl.gz"
    # 이미 존재하는 파일에 시험 바이트 기록
    existing.write_bytes(b"preserve")
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 내부 진단을 저장할 기록기의 사용 구간 시작
        with api().DiagnosticArtifact(existing):
            # 추가 동작 없는 모의 구현 유지
            pass
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert existing.read_bytes() == b"preserve"
    # 시험 파일 경로 생성
    (tmp_path / ".git").mkdir()
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OUTPUT_INSIDE_GIT_WORKTREE"):
        # 내부 진단을 저장할 기록기의 사용 구간 시작
        with api().DiagnosticArtifact(tmp_path / "new.jsonl.gz"):
            # 추가 동작 없는 모의 구현 유지
            pass

# 마감 후 추가와 마감 전 메타데이터 읽기 거부 확인
def test_cannot_append_after_finalization_or_read_metadata_before_it(tmp_path):
    # 내부 진단을 저장할 기록기의 사용 구간 시작
    with api().DiagnosticArtifact(tmp_path / "perception.jsonl.gz") as writer:
        # 실행 실패 발생 기대
        with pytest.raises(RuntimeError, match="DIAGNOSTIC_NOT_FINALIZED"):
            # 시험 영상 메타데이터 실행
            writer.metadata()
        # 보고서 기록기에 현재 관측 추가
        writer.append({"kind": "HEADER"})
    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="DIAGNOSTIC_NOT_ACTIVE"):
        # 보고서 기록기에 현재 관측 추가
        writer.append({"kind": "FRAME"})

# 마감·닫기 실패 시 주 추론 오류 보존 확인
def test_finalization_and_close_failures_do_not_replace_primary_inference_failure(tmp_path):
    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="INFERENCE_FAILED"):
        # 내부 진단을 저장할 기록기의 사용 구간 시작
        with api().DiagnosticArtifact(tmp_path / "perception.jsonl.gz") as writer:
            # 보고서 기록기에 현재 관측 추가
            writer.append({"kind": "HEADER"})
            # 변경 전 자료 준비
            original = writer._file
            # 실제 외부 실행을 대신할 시험 객체 정의
            class BrokenFinalizer:

                # 닫힘 상태 반환
                @property
                def closed(self):
                    # 자원 종료 여부 반환
                    return original.closed

                # 자료 기록
                def write(self, data):
                    # 자료의 예외 상황 재현
                    raise OSError("FINALIZE_FAILED")

                # 자원 닫기
                def close(self):
                    # 변경 전 자료의 사용 자원 정리
                    original.close()
                    # 자원 닫기의 예외 상황 재현
                    raise OSError("CLOSE_FAILED")
            # 기록할 파일 준비
            writer._file = BrokenFinalizer()
            # 마감·닫기 실패 시 주 추론 오류 보존의 예외 상황 재현
            raise RuntimeError("INFERENCE_FAILED")
    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="DIAGNOSTIC_NOT_FINALIZED"):
        # 시험 영상 메타데이터 실행
        writer.metadata()

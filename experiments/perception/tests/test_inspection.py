# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 기록 직렬화와 읽기 도구 읽음
import json
# 격리 명령 실행 도구 읽음
import subprocess
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection

# 실증 처리 실행
def run_inspection(*args, **kwargs):
    # 실증 처리의 실패 가능 구간 처리
    try:
        # 검사할 처리 동작 준비
        operation = importlib.import_module('replay_perception.inspection').inspection
    except ModuleNotFoundError:
        # 실증 처리의 금지 경로 실행 실패 처리
        pytest.fail("The standalone perception inspection is not implemented")
    # 검사할 처리 동작 반환
    return operation(*args, **kwargs)

# 시험 영상 생성
def make_video(path):
    # 시험 명령 실행 결과 생성
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x48:r=10:d=1.5",
            "-c:v",
            "ffv1",
            str(path),
        ],
        capture_output=True,
        # 문자열 자료의 호출 조건 지정
        text=True,
        # 제한 시간의 호출 조건 지정
        timeout=20,
    )
    # 외부 명령 종료 코드 값이 0인지 확인
    assert result.returncode == 0, result.stderr


# 실제 외부 실행을 대신할 시험 객체 정의
class Detector:
    # 원본과 모델 출처의 시험 항목 구성
    provenance = {"model_id": "synthetic-test-double", "device": "cpu"}

    # 초기 상태와 입력 계약 구성
    def __init__(self, *, fail_after=None, empty=False):
        # 호출 이력의 0 설정
        self.calls = 0
        # 실패 전 허용할 처리 수 준비
        self.fail_after = fail_after
        # 빈 검출 결과 준비
        self.empty = empty

    # 모의 예측 반환
    def predict(self, rgb):
        # 모의 예측 입력의 조건에 따른 분기
        if self.fail_after is not None and self.calls >= self.fail_after:
            # 모의 예측의 예외 상황 재현
            raise RuntimeError("synthetic inference failure")
        # 호출 이력 갱신
        self.calls += 1
        # 배열 차원 값이 48 · 64 · 3인지 확인
        assert rgb.shape == (48, 64, 3)
        # 빈 검출 결과의 조건에 따른 분기
        if self.empty:
            # 빈 목록 반환
            return ()
        # 상자와 점수를 가진 원시 검출 반환
        return (
            # 사람 후보의 상자와 점수 지정
            Detection(0, "person", (2, 2, 20, 35), 0.99),
            # 공 후보의 상자와 점수 지정
            Detection(1, "sports ball", (40, 30, 48, 38), 0.95),
        )

# 실제 디코딩의 검출·추적과 영속 진단 확인
def test_real_decode_runs_detection_tracking_and_durable_diagnostics(tmp_path):
    # 원본 입력과 출력 자료의 시험 항목 구성
    source, output = tmp_path / "source.mkv", tmp_path / "result"
    # 디코더 검사용 합성 영상 실행
    make_video(source)
    # 모의 검출기 생성
    model = Detector()
    # 저장된 원본 검출의 재관측 실행 결과 읽음
    summary = run_inspection(source, output, model, max_previews=3)
    # 직렬화 문자열에서 읽은 자료 읽음
    persisted = json.loads((output / "summary.json").read_text())
    # 기록 행 목록의 조건별 항목 수집
    rows = [json.loads(line) for line in (output / "frames.jsonl").read_text().splitlines()]
    # 실행 요약의 기대 자료 일치 확인
    assert summary == persisted
    # 처리 상태 값이 처리 완료 상태인지 확인
    assert summary["status"] == "COMPLETE"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert summary["admission"] == "NOT_ADMITTED"
    # 파일 무결성 해시의 기대 자료 일치 확인
    assert summary["source"]["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    # 밀리초 원본 시각 목록 값이 0 · 500 · 1000인지 확인
    assert [row["timestampMs"] for row in rows] == [0, 500, 1000]
    # 기록 행 목록의 개수의 기대 자료 일치 확인
    assert len(rows) == model.calls == summary["counts"]["recordedFrameCount"] == 3
    # 모델 추론한 프레임 수 값이 3인지 확인
    assert summary["timings"]["inferredFrameCount"] == 3
    # 추적 식별자 부재 확인
    assert rows[0]["detections"][0]["trackId"] is None
    # 추적 식별자 존재 확인
    assert rows[1]["detections"][0]["trackId"] is not None
    # 추적 식별자의 기대 자료 일치 확인
    assert rows[1]["detections"][0]["trackId"] == rows[2]["detections"][0]["trackId"]
    # 모든 재관측 프레임의 재생 장면 여부가 미확정인지 확인
    assert all(row["replayState"] == "UNKNOWN" for row in rows)
    # 재관측한 원시 검출의 행위자 역할이 모두 미검증인지 확인
    assert all(d["actorRole"] == "UNPROVEN" for row in rows for d in row["detections"])
    # 생성한 미리보기가 최소 2개이며 최대 3개인지 확인
    assert 2 <= len(summary["previews"]) <= 3
    # 밀리초 원본 시각 값이 0인지 확인
    assert summary["previews"][0]["timestampMs"] == 0
    # 밀리초 원본 시각 값이 1000인지 확인
    assert summary["previews"][-1]["timestampMs"] == 1000
    # 요약에서 가리키는 모든 미리보기 파일이 실제로 존재하는지 확인
    assert all((output / preview["path"]).is_file() for preview in summary["previews"])

# 추론 실패 시 부분 기록과 실패 요약 보존 확인
def test_inference_failure_preserves_partial_trace_and_failed_summary(tmp_path):
    # 원본 입력과 출력 자료의 시험 항목 구성
    source, output = tmp_path / "source.mkv", tmp_path / "partial"
    # 디코더 검사용 합성 영상 실행
    make_video(source)
    # 저장된 원본 검출의 재관측 실행 결과 읽음
    summary = run_inspection(source, output, Detector(fail_after=1))
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 조건 충족 확인
    assert summary["failureReason"]
    # 저장된 프레임 수 값이 1인지 확인
    assert summary["counts"]["recordedFrameCount"] == 1
    # 모델 추론한 프레임 수 값이 1인지 확인
    assert summary["timings"]["inferredFrameCount"] == 1
    # 원본 표본 수 값이 2인지 확인
    assert summary["video"]["sampleCount"] == 2
    # 파일을 한 줄씩 나눈 기록의 개수 값이 1인지 확인
    assert len((output / "frames.jsonl").read_text().splitlines()) == 1

# 빈 모델 출력의 반칙 없음 판단 방지 확인
def test_empty_model_output_is_not_a_no_foul_judgment(tmp_path):
    # 원본 입력과 출력 자료의 시험 항목 구성
    source, output = tmp_path / "source.mkv", tmp_path / "empty"
    # 디코더 검사용 합성 영상 실행
    make_video(source)
    # 저장된 원본 검출의 재관측 실행 결과 읽음
    summary = run_inspection(source, output, Detector(empty=True))
    # 처리 상태 값이 처리 완료 상태인지 확인
    assert summary["status"] == "COMPLETE"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert summary["admission"] == "NOT_ADMITTED"
    # 검출 개수 값이 0인지 확인
    assert summary["counts"]["detectionCount"] == 0
    # 실행 요약에 지정한 항목 미포함 확인
    assert "judgment" not in summary
    # 저장용으로 직렬화한 문자열에 지정한 항목 미포함 확인
    assert "NO_FOUL" not in json.dumps(summary)

# 기존 출력 보존과 모델 실행 방지 확인
def test_existing_output_is_not_modified_and_does_not_run_model(tmp_path):
    # 원본 입력과 출력 자료의 시험 항목 구성
    source, output = tmp_path / "source.mkv", tmp_path / "existing"
    # 디코더 검사용 합성 영상 실행
    make_video(source)
    # 출력 자료 생성
    output.mkdir()
    # 시험 파일 경로에 시험 문자열 기록
    (output / "keep.txt").write_text("existing owner")
    # 모의 검출기 생성
    model = Detector()
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 저장된 원본 검출의 재관측 실행 결과 실행
        run_inspection(source, output, model)
    # 호출 이력 값이 0인지 확인
    assert model.calls == 0
    # 파일에 저장한 문자열의 기대 자료 일치 확인
    assert (output / "keep.txt").read_text() == "existing owner"
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (output / "summary.json").exists()

# 손상 영상의 빈 성공 대신 실패 보고 확인
def test_corrupt_media_creates_failed_report_not_empty_success(tmp_path):
    # 원본 입력과 출력 자료의 시험 항목 구성
    source, output = tmp_path / "bad.mp4", tmp_path / "bad-result"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"not a video")
    # 저장된 원본 검출의 재관측 실행 결과 읽음
    summary = run_inspection(source, output, Detector())
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "VIDEO_OPEN_FAILED"
    # 저장된 프레임 수 값이 0인지 확인
    assert summary["counts"]["recordedFrameCount"] == 0
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert source.read_bytes() == b"not a video"

# 부작용 전 끊어진 기존 출력 링크 거부 확인
def test_existing_dangling_output_link_is_rejected_before_side_effects(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    make_video(source)
    # 대상 경로과 후보 연결 기록의 시험 항목 구성
    target, link = tmp_path / "absent-target", tmp_path / "existing-link"
    # 후보 연결 기록의 링크 경로 생성
    link.symlink_to(target, target_is_directory=True)
    # 모의 검출기 생성
    model = Detector()
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 저장된 원본 검출의 재관측 실행 결과 실행
        run_inspection(source, link, model)
    # 심볼릭 링크 여부의 조건 충족 확인
    assert link.is_symlink()
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not target.exists()
    # 호출 이력 값이 0인지 확인
    assert model.calls == 0

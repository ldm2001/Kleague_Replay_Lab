# 불변 관측 복사와 수정 오류 도구 읽음
from dataclasses import replace
# 압축 진단 기록 읽기 도구 읽음
import gzip
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
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import RoleDetection
# 시험에 필요한 검증 도구와 의존성 읽음
from test_objects import scene

# 인터페이스 반환
def api():
    # 검사할 인식 구현 모듈 반환
    return importlib.import_module("replay_perception.operational")

# 시험 영상 생성
def video(path, duration="0.5", fps="10"):
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
            f"color=c=0x2d822d:s=320x360:r={fps}:d={duration}",
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
    provenance = {
        # 승인 모델 식별자의 시험값 지정
        "model_id": "synthetic-detector",
        # 고정 모델 판본의 시험값 지정
        "revision": "test",
        # 자산 파일 명세의 시험값 지정
        "files": {"model.safetensors": "a" * 64},
    }

    # 초기 상태와 입력 계약 구성
    def __init__(self, empty=False):
        # 호출 이력의 0 설정
        self.calls = 0
        # 빈 검출 결과 준비
        self.empty = empty

    # 모의 예측 반환
    def predict(self, rgb):
        # 호출 이력 갱신
        self.calls += 1
        # 배열 차원 값이 360 · 320 · 3인지 확인
        assert rgb.shape == (360, 320, 3)
        # 모의 예측 결과 반환
        return () if self.empty else (Detection(0, "person", (100, 55, 180, 278), .99),)


# 실제 외부 실행을 대신할 시험 객체 정의
class Roles:
    # 원본과 모델 출처의 시험 항목 구성
    provenance = {
        # 승인 모델 식별자의 시험값 지정
        "model_id": "synthetic-role",
        # 고정 모델 판본의 시험값 지정
        "revision": "test",
        # 자산 파일 명세의 시험값 지정
        "files": {"yolo-football-player-detection.pt": "b" * 64},
    }
    # 마지막 입력 좌표 변환의 값 없음 설정
    last_transform = None

    # 초기 상태와 입력 계약 구성
    def __init__(self):
        # 호출 이력의 0 설정
        self.calls = 0

    # 모의 예측 반환
    def predict(self, rgb):
        # 호출 이력 갱신
        self.calls += 1
        # 역할 모델의 상자와 점수 관측 반환
        return (RoleDetection(0, "referee", (100, 55, 180, 278), .99),)


# 실제 외부 실행을 대신할 시험 객체 정의
class Poses:
    # 원본과 모델 출처의 시험 항목 구성
    provenance = {
        # 승인 모델 식별자의 시험값 지정
        "model_id": "synthetic-pose",
        # 고정 모델 판본의 시험값 지정
        "revision": "test",
        # 자산 파일 명세의 시험값 지정
        "files": {"model.safetensors": "c" * 64},
    }

    # 초기 상태와 입력 계약 구성
    def __init__(self, fail_after=None):
        # 호출 이력의 0 설정
        self.calls = 0
        # 실패 전 허용할 처리 수 준비
        self.fail_after = fail_after

    # 모의 예측 반환
    def predict(self, rgb, detections):
        # 모의 예측 입력의 조건에 따른 분기
        if self.fail_after is not None and self.calls >= self.fail_after:
            # 모의 예측의 예외 상황 재현
            raise RuntimeError("POSE_INFERENCE_FAILED")
        # 호출 이력 갱신
        self.calls += 1
        # 기준 시험 객체 준비
        prototype = scene(kind="none", boundary=False)[2][0]
        # 지정 필드만 바꾼 시험 관측 목록의 비교 자료 반환
        return tuple(
            replace(prototype, detection_id=item.detection_id, source_box=item.box)
            for item in detections
        )

# 모델 묶음 생성
def bundle(**kwargs):
    # 모델 묶음 결과 반환
    return api().ObserverModels(
        Detector(empty=kwargs.get("empty", False)),
        Roles(),
        Poses(fail_after=kwargs.get("fail_after")),
    )

# 저장 기록 읽음
def records(result):
    # 파일 또는 연결 자원의 사용 구간 시작
    with gzip.open(result["artifact"]["path"], "rt") as stream:
        # 직렬화 문자열에서 읽은 자료 목록 반환
        return [json.loads(line) for line in stream]

# 동일 원본 시각의 세 관측기와 비공개 산출물 연결 확인
def test_same_pts_stream_runs_three_existing_observer_ports_and_private_artifact(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle()
    # 처리 진행 상황의 빈 누적 공간 생성
    progress = []
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source, tmp_path / "output", models, duration_ms=500, progress=progress.append
    )
    # 처리 완료 상태 값이 처리 완료 상태인지 확인
    assert result["processingStatus"] == "COMPLETE"
    # 처리 범위의 기대 자료 일치 확인
    assert result["coverage"] == {"startMs": 0, "endMs": 500, "sampleIntervalMs": 100,
                                  # 예상 표본 수의 5 시험값 지정
                                  "expectedSamples": 5, "processedSamples": 5, "failedSamples": 0}
    # 원본 무결성 해시의 기대 자료 일치 확인
    assert result["sourceSha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    # 호출 이력의 기대 자료 일치 확인
    assert models.detector.calls == models.role.calls == models.pose.calls == 5
    # 저장된 기록 목록 읽음
    rows = records(result)
    # 관측 종류의 기대 자료 일치 확인
    assert rows[0]["kind"] == "HEADER"
    # 밀리초 원본 시각 목록의 기대 자료 일치 확인
    assert [row["frame"]["timestampMs"] for row in rows if row["kind"] == "FRAME"] == [
        0,
        100,
        200,
        300,
        400,
    ]
    # 모든 처리 프레임의 재생 장면 여부가 미확정인지 확인
    assert all(row["replayState"] == "UNKNOWN" for row in rows[1:])
    # 자세 관측 수 값이 5인지 확인
    assert result["summary"]["poseObservationCount"] == 5
    # 심판 단서 수 값이 1인지 확인
    assert result["summary"]["officialCueCount"] == 1
    # 인식 관측 목록의 개수 값이 1인지 확인
    assert len(result["observations"]) == 1
    # 심판 세부 역할 후보 값이 주심 후보인지 확인
    assert result["observations"][0]["officialRole"] == "MAIN_CANDIDATE"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert result["observations"][0]["admission"] == "NOT_ADMITTED"
    # 처리한 표본 수 값이 5인지 확인
    assert progress[-1]["processedSamples"] == 5
    # 저장용으로 직렬화한 문자열에 지정한 항목 미포함 확인
    assert "NO_FOUL" not in json.dumps(result)
    # 직렬화 문자열에서 읽은 자료의 기대 자료 일치 확인
    assert json.loads((tmp_path / "output" / "summary.json").read_text()) == result

# 모델 단계 실패 시 이전 행과 명시적 누락 범위 보존 확인
def test_model_stage_failure_preserves_prior_rows_and_explicit_missing_coverage(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle(fail_after=2)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", models, duration_ms=500)
    # 처리 완료 상태 값이 일부만 처리한 상태인지 확인
    assert result["processingStatus"] == "PARTIAL"
    # 처리한 표본 수 값이 2인지 확인
    assert result["coverage"]["processedSamples"] == 2
    # 실패한 표본 수 값이 3인지 확인
    assert result["coverage"]["failedSamples"] == 3
    # 판단 보류 이유에 지정한 항목 포함 확인
    assert "POSE_INFERENCE_FAILED" in result["summary"]["reasons"]
    # 실패 처리 결과 준비
    failed = records(result)[-1]
    # 관측 종류의 기대 자료 일치 확인
    assert failed["kind"] == "FRAME_FAILURE"
    # 실패 단계의 기대 자료 일치 확인
    assert failed["failedStage"] == "POSE"
    # 자세 처리 실패 기록에도 검출과 역할 관측이 보존됐는지 확인
    assert failed["detections"] and failed["roles"]
    # 호출 이력의 기대 자료 일치 확인
    assert models.detector.calls == models.role.calls == 3

# 임대 상실 시 다음 추론 중단과 부분 결과 보존 확인
def test_lease_loss_check_stops_before_next_inference_and_preserves_partial(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle()
    # 검사 호출 목록의 빈 누적 공간 생성
    checks = []

    # 처리 취소 모사
    def cancellation():
        # 검사 호출 목록에 현재 관측 추가
        checks.append(True)
        # 호출 이력의 비교 결과별 분기
        if models.detector.calls >= 2:
            # 처리 취소 모사의 예외 상황 재현
            raise RuntimeError("WORKER_LEASE_LOST")
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source, tmp_path / "output", models, duration_ms=500, check_cancelled=cancellation
    )
    # 처리 완료 상태 값이 일부만 처리한 상태인지 확인
    assert result["processingStatus"] == "PARTIAL"
    # 판단 보류 이유에 지정한 항목 포함 확인
    assert "WORKER_LEASE_LOST" in result["summary"]["reasons"]
    # 호출 이력 값이 2인지 확인
    assert models.detector.calls == 2
    # 중단될 때까지 처리한 전체 표본 수가 2개를 넘지 않음 확인
    assert result["coverage"]["processedSamples"] <= 2
    # 중단 여부 점검이 적어도 3회 수행됐는지 확인
    assert len(checks) >= 3
    # 관측 종류의 기대 자료 일치 확인
    assert records(result)[0]["kind"] == "HEADER"

# 희소 영상의 전체 표본 범위 완료 주장 방지 확인
def test_sparse_video_cannot_claim_complete_sampling_coverage(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source, "1.0", "2")
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", bundle(empty=True), duration_ms=1000)
    # 처리 완료 상태 값이 일부만 처리한 상태인지 확인
    assert result["processingStatus"] == "PARTIAL"
    # 예상 표본 수 값이 10인지 확인
    assert result["coverage"]["expectedSamples"] == 10
    # 처리한 표본 수 값이 2인지 확인
    assert result["coverage"]["processedSamples"] == 2
    # 실패한 표본 수 값이 8인지 확인
    assert result["coverage"]["failedSamples"] == 8
    # 판단 보류 이유에 지정한 항목 포함 확인
    assert "SAMPLING_COVERAGE_INCOMPLETE" in result["summary"]["reasons"]

# 빈 검출의 유효 처리와 반칙 부정 사실 분리 확인
def test_empty_detection_is_valid_processing_not_a_negative_foul_fact(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle(empty=True)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", models, duration_ms=500)
    # 처리 완료 상태 값이 처리 완료 상태인지 확인
    assert result["processingStatus"] == "COMPLETE"
    # 자세 관측 수 값이 0인지 확인
    assert result["summary"]["poseObservationCount"] == 0
    # 인식 관측 목록의 기대 자료 일치 확인
    assert result["observations"] == result["interactions"] == result["links"] == []
    # 호출 이력 값이 0인지 확인
    assert models.pose.calls == 0
    # 금지 항목과 겹치는 키 집합의 부재 또는 비활성 확인
    assert not {"facts", "judgment", "contactDetected"}.intersection(result)

# 모델 호출 전 기존 출력 거부 확인
def test_existing_output_rejected_before_model_calls(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 출력 자료 준비
    output = tmp_path / "output"
    # 출력 자료 생성
    output.mkdir()
    # 시험 식별 값 준비
    marker = output / "keep.txt"
    # 시험 식별 값에 시험 문자열 기록
    marker.write_text("preserve")
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle()
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 시험 프레임의 관측 결과 실행
        api().observations(source, output, models, duration_ms=500)
    # 파일에 저장한 문자열의 기대 자료 일치 확인
    assert marker.read_text() == "preserve"
    # 호출 이력 값이 0인지 확인
    assert models.detector.calls == 0

# 실행 시간 초과의 부분 상태와 추가 표본 추론 방지 확인
def test_runtime_limit_is_partial_and_does_not_infer_extra_sample(tmp_path, monkeypatch):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle()
    # 실행 시간 초과의 부분 상태와 추가 표본 추론 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "MAX_RUNTIME_SECONDS", 0)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", models, duration_ms=500)
    # 처리 완료 상태 값이 일부만 처리한 상태인지 확인
    assert result["processingStatus"] == "PARTIAL"
    # 호출 이력 값이 0인지 확인
    assert models.detector.calls == 0
    # 판단 보류 이유에 지정한 항목 포함 확인
    assert "OBSERVATION_RUNTIME_LIMIT" in result["summary"]["reasons"]

# 관측 중 원본 변경 결과의 원본 귀속 반환 방지 확인
def test_source_change_during_observation_is_not_returned_as_source_bound_result(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)

    # 원본 변경 모사
    def changed(event):
        # 처리한 표본 수의 비교 결과별 분기
        if event["processedSamples"] == 1:
            # 파일 또는 연결 자원의 사용 구간 시작
            with source.open("ab") as stream:
                # 원본 변경 모사 대상 동작 실행
                stream.write(b"changed")
    # 원본 일치 오류 발생 기대
    with pytest.raises(ValueError, match="VIDEO_SOURCE_CHANGED"):
        # 시험 프레임의 관측 결과 실행
        api().observations(source, tmp_path / "output", bundle(), duration_ms=500, progress=changed)

# 재등장 연결 식별자의 단일 사건 집계 확인
def test_reappearing_link_id_is_counted_once_not_as_another_episode():
    # 보존한 관측 기록 생성
    retained = api()._Retained()
    # 보존한 자료에 현재 입력 반영
    retained.update([{"id": "link-one", "endMs": 300}])
    # 보존한 자료에 현재 입력 반영
    retained.update([])
    # 보존한 자료에 현재 입력 반영
    retained.update([{"id": "link-one", "endMs": 500}])
    # 항목 수 값이 1인지 확인
    assert retained.count == 1
    # 구간 종료 시각 값이 500인지 확인
    assert retained.rows["link-one"]["endMs"] == 500

# 사건 식별 색인의 크기 제한과 변경 전 거부 확인
def test_episode_identity_index_is_bounded_and_rejects_before_mutation(monkeypatch):
    # 사건 식별 색인의 크기 제한과 변경 전 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "MAX_INDEXED_EPISODES", 1)
    # 보존한 관측 기록 생성
    retained = api()._Retained()
    # 보존한 자료에 현재 입력 반영
    retained.update([{"id": "one"}])
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="EPISODE_INDEX_LIMIT"):
        # 보존한 자료에 현재 입력 반영
        retained.update([{"id": "two"}])
    # 항목 수 값이 1인지 확인
    assert retained.count == 1
    # 기록 행 목록의 비교 자료의 기대 자료 일치 확인
    assert list(retained.rows) == ["one"]

# 헤더의 간접 동작 소스 지문 기록 확인
def test_header_fingerprints_transitive_behavior_sources(tmp_path):
    # 시험 파일 경로 도구 읽음
    from pathlib import Path
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", bundle(empty=True), duration_ms=500)
    # 파일별 해시 목록 준비
    hashes = records(result)[0]["implementation"]["sourceFilesSha256"]
    # 헤더의 간접 동작 소스 지문 기록 입력 목록의 항목별 순회
    for name in ("continuity.py", "signals.py", "observations.py", "frames.py"):
        # 파일별 해시 목록에 항목 이름 포함 확인
        assert name in hashes
        # 파일별 해시 목록의 선택 항목의 기대 자료 일치 확인
        assert (
            hashes[name]
            == hashlib.sha256((Path(api().__file__).parent / name).read_bytes()).hexdigest()
        )

# 후속 디코딩 실패 시 이전 성공 프레임 상태 보존 확인
def test_next_decode_failure_does_not_relabel_previously_successful_frame(tmp_path, monkeypatch):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 실제 영상 읽기 객체 준비
    actual_reader = api().VideoReader
    # 실제 외부 실행을 대신할 시험 객체 정의
    class FailedReader:

        # 초기 상태와 입력 계약 구성
        def __init__(self, *args, **kwargs):
            # 실제 영상 읽기 객체 생성
            self.actual = actual_reader(*args, **kwargs)

        # 처리 자원 준비
        def __enter__(self):
            # 읽기 자원 시작 결과 실행
            self.actual.__enter__()
            # 상태를 기록한 현재 모의 객체 반환
            return self

        # 원본 순서의 표본 반환
        def __iter__(self):
            # 원본 순서의 표본의 시험 단계 실행
            yield next(iter(self.actual))
            # 원본 순서의 표본의 예외 상황 재현
            raise ValueError("VIDEO_DECODE_FAILED")

        # 처리 자원 정리
        def __exit__(self, *args):
            # 사용 자원의 종료 처리 실행
            self.actual.__exit__(*args)
    # 원본 표시 시각을 보존할 영상 읽기 객체의 시험 대역 주입
    monkeypatch.setattr(api(), "VideoReader", FailedReader)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", bundle(empty=True), duration_ms=500)
    # 저장된 기록 목록 읽음
    rows = records(result)
    # 처리 완료 상태 값이 일부만 처리한 상태인지 확인
    assert result["processingStatus"] == "PARTIAL"
    # 처리한 표본 수 값이 1인지 확인
    assert result["coverage"]["processedSamples"] == 1
    # 마지막 요약 앞에 원본 시각 영의 프레임 기록이 보존됐는지 확인
    assert rows[-2]["kind"] == "FRAME" and rows[-2]["frame"]["timestampMs"] == 0
    # 관측 종류의 기대 자료 일치 확인
    assert rows[-1]["kind"] == "RUN_FAILURE"
    # 실패 단계의 기대 자료 일치 확인
    assert rows[-1]["failedStage"] == "DECODING"
    # 기록 행 목록의 선택 항목에 지정한 항목 미포함 확인
    assert "frame" not in rows[-1]

# 산출물 마감 동시 실패 시 추론 오류 보존 확인
def test_inference_error_survives_simultaneous_artifact_finalize_error(tmp_path, monkeypatch):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source, "0.1")
    # 실제 진단 파일 기록기 준비
    actual_artifact = api().DiagnosticArtifact
    # 실제 외부 실행을 대신할 시험 객체 정의
    class BrokenArtifact(actual_artifact):

        # 처리 자원 정리
        def __exit__(self, *args):
            # 실제 외부 실행을 대신할 시험 객체 정의
            class BrokenCompressor:

                # 버퍼 내보내기
                def flush(self, mode):
                    # 버퍼 내보내기의 예외 상황 재현
                    raise OSError("FINALIZE_FAILED")
            # 압축 기록기 준비
            self._compressor = BrokenCompressor()
            # 사용 자원의 종료 처리 반환
            return super().__exit__(*args)
    # 내부 진단을 저장할 기록기의 시험 대역 주입
    monkeypatch.setattr(api(), "DiagnosticArtifact", BrokenArtifact)
    # 자세 관측 오류 발생 기대
    with pytest.raises(RuntimeError, match="POSE_INFERENCE_FAILED") as caught:
        # 시험 프레임의 관측 결과 실행
        api().observations(source, tmp_path / "output", bundle(fail_after=0), duration_ms=100)
    # 요구 자료형 충족 여부의 조건 충족 확인
    assert isinstance(caught.value.__cause__, OSError)
    # 문자열로 변환한 값의 기대 자료 일치 확인
    assert str(caught.value.__cause__) == "FINALIZE_FAILED"

# 마지막 관측 단계 시간 초과의 완료 보고 방지 확인
def test_final_observation_stage_over_deadline_cannot_report_complete(tmp_path, monkeypatch):
    # 가벼운 모의 객체 생성 도구 읽음
    from types import SimpleNamespace
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source, "0.1")
    # 제어 가능한 시험 시계의 시험 항목 구성
    clock = [0.]
    # 마지막 관측 단계 시간 초과의 완료 보고 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "time", SimpleNamespace(perf_counter=lambda: clock[0]))
    # 실제 외부 실행을 대신할 시험 객체 정의
    class SlowLinker:

        # 모의 갱신 결과 반환
        def update(self, *args):
            # 제어 가능한 시험 시계의 첫 항목의 1801점0 설정
            clock[0] = 1801.
            # 빈 목록 반환
            return ()
    # 선수 근접과 심판 신호를 연결할 후보 연결기의 시험 대역 주입
    monkeypatch.setattr(api(), "IncidentLinker", SlowLinker)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", bundle(empty=True), duration_ms=100)
    # 처리 완료 상태 값이 일부만 처리한 상태인지 확인
    assert result["processingStatus"] == "PARTIAL"
    # 판단 보류 이유에 지정한 항목 포함 확인
    assert "OBSERVATION_RUNTIME_LIMIT" in result["summary"]["reasons"]

# 추가 표본 시도 없는 정확한 표본 상한의 성공 확인
def test_exact_sample_cap_is_successful_when_no_extra_sample_is_attempted(tmp_path, monkeypatch):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source, "0.1")
    # 추가 표본 시도 없는 정확한 표본 상한의 성공 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "MAX_PROCESSED_FRAMES", 1)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(source, tmp_path / "output", bundle(empty=True), duration_ms=100)
    # 처리 완료 상태 값이 처리 완료 상태인지 확인
    assert result["processingStatus"] == "COMPLETE"
    # 처리한 표본 수 값이 1인지 확인
    assert result["coverage"]["processedSamples"] == 1

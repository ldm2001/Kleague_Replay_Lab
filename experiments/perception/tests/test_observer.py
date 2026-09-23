# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 기록 직렬화와 읽기 도구 읽음
import json
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 시험 파일 복사 도구 읽음
import shutil
# 격리 명령 실행 도구 읽음
import subprocess
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.media import VideoReader
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import KEYPOINT_NAMES, Keypoint, PoseObservation, RoleDetection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.report import ReportWriter


# 고정 사람 검출 목록의 시험 항목 구성
PEOPLE = (
    # 사람 후보의 상자와 점수 지정
    Detection(1, "person", (20, 20, 80, 150), 0.9, "0:0:person:1"),
    # 사람 후보의 상자와 점수 지정
    Detection(2, "person", (120, 20, 180, 150), 0.9, "0:0:person:2"),
)

# 인터페이스 반환
def api():
    # 검사할 인식 구현 모듈 반환
    return importlib.import_module('replay_perception.observer')

# 대상 자세 관측 생성
def pose_for(person):
    # 좌표 이동량 준비
    shift = person.box[0] - 20
    # 시간별 위치 목록의 시험 항목 구성
    positions = {
        5: (35 + shift, 50),
        7: (35 + shift, 30),
        9: (35 + shift, 5),
        11: (35 + shift, 110),
        6: (65 + shift, 50),
        8: (65 + shift, 80),
        10: (65 + shift, 110),
        12: (65 + shift, 110),
    }
    # 좌표와 점수를 가진 단일 관절 목록의 비교 자료 생성
    points = tuple(
        Keypoint(index, name, *positions.get(index, (50 + shift, 80)), 0.9)
        for index, name in enumerate(KEYPOINT_NAMES)
    )
    # 원본 상자와 관절 좌표를 가진 자세 관측 반환
    return PoseObservation(person.detection_id, person.box, points, ((1., 0., 0.), (0., 1., 0.)))


# 실제 외부 실행을 대신할 시험 객체 정의
class RoleModel:
    # 원본과 모델 출처의 시험 항목 구성
    provenance = {"id": "test-role", "kind": "TEST_DOUBLE"}

    # 초기 상태와 입력 계약 구성
    def __init__(self, *, empty=False, fail_on=None, effect=None):
        # 호출 이력의 0 설정
        self.calls = 0
        # 빈 검출 결과 준비
        self.empty = empty
        # 실패를 주입할 순번 준비
        self.fail_on = fail_on
        # 입력 변경 효과 준비
        self.effect = effect
        # 마지막 입력 좌표 변환의 값 없음 설정
        self.last_transform = None

    # 모의 예측 반환
    def predict(self, rgb):
        # 호출 이력 갱신
        self.calls += 1
        # 입력 변경 효과의 비교 결과별 분기
        if self.effect is not None:
            # 입력 변경 효과 실행
            self.effect(self.calls)
        # 호출 이력의 비교 결과별 분기
        if self.calls == self.fail_on:
            # 모의 예측의 예외 상황 재현
            raise ValueError("TEST_ROLE_FAILED")
        # 마지막 입력 좌표 변환의 시험 항목 구성
        self.last_transform = {
            # 원본 영상 너비의 시험값 지정
            "sourceWidth": rgb.shape[1],
            # 원본 영상 높이의 시험값 지정
            "sourceHeight": rgb.shape[0],
            # 관측 종류의 시험값 지정
            "kind": "TEST_DOUBLE",
        }
        # 빈 검출 결과의 조건에 따른 분기
        if self.empty:
            # 빈 목록 반환
            return ()
        # 역할 모델의 상자와 점수 관측 반환
        return (
            # 심판 후보의 상자와 점수 지정
            RoleDetection(10, "referee", PEOPLE[0].box, 0.8),
            # 골키퍼 후보의 상자와 점수 지정
            RoleDetection(20, "goalkeeper", PEOPLE[1].box, 0.9),
        )


# 실제 외부 실행을 대신할 시험 객체 정의
class PoseModel:
    # 원본과 모델 출처의 시험 항목 구성
    provenance = {"id": "test-pose", "kind": "TEST_DOUBLE"}

    # 초기 상태와 입력 계약 구성
    def __init__(self, *, fail_on=None, missing=False):
        # 호출 이력의 0 설정
        self.calls = 0
        # 실패를 주입할 순번 준비
        self.fail_on = fail_on
        # 누락 입력 준비
        self.missing = missing

    # 모의 예측 반환
    def predict(self, _rgb, detections):
        # 호출 이력 갱신
        self.calls += 1
        # 호출 이력의 비교 결과별 분기
        if self.calls == self.fail_on:
            # 모의 예측의 예외 상황 재현
            raise ValueError("TEST_POSE_FAILED")
        # 목록의 비교 자료 생성
        values = tuple(pose_for(person) for person in detections)
        # 모의 예측 결과 반환
        return values[:-1] if self.missing else values

# 시험 입력 생성
@pytest.fixture
def inputs(tmp_path):
    # 시험 입력 입력의 비교 결과별 분기
    if shutil.which("ffmpeg") is None:
        # 시험 입력 대상 동작 실행
        pytest.skip("FFmpeg required for original-PTS integration fixture")
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 시험 명령 실행 결과 실행
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=green:size=200x160:rate=10:duration=0.4",
            "-c:v",
            "ffv1",
            str(source),
        ],
        check=True,
    )
    # 상위 실행 기록 준비
    upstream = tmp_path / "upstream"
    # 원본 영상 정보의 시험 항목 구성
    source_info = {
        # 파일 경로의 시험값 지정
        "path": str(source),
        # 파일 무결성 해시의 시험값 지정
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        # 파일 바이트 크기의 시험값 지정
        "sizeBytes": source.stat().st_size,
    }
    # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
    with ReportWriter(
        upstream,
        # 원본 입력의 호출 조건 지정
        source=source_info,
        # 모의 모델의 호출 조건 지정
        model={"id": "TEST_DOUBLE"},
        # 시간축 추적기의 호출 조건 지정
        tracker={},
        # 실행 설정의 호출 조건 지정
        settings={"startMs": 0, "endMs": None, "sampleIntervalMs": 100},
    ) as writer:
        # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
        with VideoReader(source, interval_ms=100) as reader:
            # 영상 읽기 객체의 항목별 순회
            for frame in reader:
                # 보고서 기록기에 현재 관측 추가
                writer.append(frame, PEOPLE, 0, .001)
        # 보고서 기록기의 종료 상태 기록
        writer.finish("COMPLETE", video=reader.as_record(), timings={})
    # 원본 입력과 상위 실행 기록 반환
    return source, upstream, tmp_path / "observed"

# 요약 자료 읽음
def read_summary(output):
    # 직렬화 문자열에서 읽은 자료 반환
    return json.loads((output / "summary.json").read_text())

# 실제 디코딩 보고의 원시 검출과 별도 심판 후보 보존 확인
def test_real_decode_to_derivative_report_keeps_raw_detections_and_separate_referee_candidate(
    inputs,
):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 파일의 원래 바이트 자료 읽음
    source_before = source.read_bytes()
    # 파일의 원래 바이트 자료 읽음
    upstream_before = (upstream / "frames.jsonl").read_bytes()
    # 단일 프레임의 관측 결과 생성
    summary = api().observation(source, upstream, output, RoleModel(), PoseModel(), max_previews=3)
    # 실행 요약의 기대 자료 일치 확인
    assert summary == read_summary(output)
    # 처리 상태 값이 처리 완료 상태인지 확인
    assert summary["status"] == "COMPLETE"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert summary["admission"] == "NOT_ADMITTED"
    # 보고서 종류의 기대 자료 일치 확인
    assert summary["reportType"] == "REFEREE_OBSERVATIONS"
    # 저장된 프레임 수 값이 4인지 확인
    assert summary["counts"]["recordedFrameCount"] == 4
    # 자세 관측 수 값이 8인지 확인
    assert summary["counts"]["poseCount"] == 8
    # 후보 개수 값이 1인지 확인
    assert summary["counts"]["candidateCount"] == 1
    # 역할 추론한 프레임 수 값이 4인지 확인
    assert summary["timings"]["roleInferredFrameCount"] == 4
    # 자세 추론한 사람 수 값이 8인지 확인
    assert summary["timings"]["poseInferredPersonCount"] == 8
    # 재생한 원본 프레임 수 값이 4인지 확인
    assert summary["replay"]["replayedFrameCount"] == 4
    # 기록 행 목록의 조건별 항목 수집
    rows = [json.loads(line) for line in (output / "observations.jsonl").read_text().splitlines()]
    # 밀리초 원본 시각 목록 값이 0 · 100 · 200 · 300인지 확인
    assert [row["timestampMs"] for row in rows] == [0, 100, 200, 300]
    # 원본 사람 검출의 역할이 모두 미검증 상태로 보존됐는지 확인
    assert all(item["actorRole"] == "UNPROVEN" for row in rows for item in row["sourceDetections"])
    # 원본 영상 너비 값이 200인지 확인
    assert rows[0]["roleInputTransform"]["sourceWidth"] == 200
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert source.read_bytes() == source_before
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (upstream / "frames.jsonl").read_bytes() == upstream_before
    # 후보 관측 목록의 조건별 항목 수집
    candidates = [
        json.loads(line) for line in (output / "arm-candidates.jsonl").read_text().splitlines()
    ]
    # 추적 식별자의 기대 자료 일치 확인
    assert candidates[0]["trackId"] == PEOPLE[0].track_id
    # 구간 시작 시각 값이 0인지 확인
    assert candidates[0]["startMs"] == 0
    # 지속 조건 충족 시각 값이 200인지 확인
    assert candidates[0]["confirmedMs"] == 200
    # 구간 종료 시각 값이 300인지 확인
    assert candidates[0]["endMs"] == 300
    # 관측을 뒷받침한 프레임 수 값이 4인지 확인
    assert candidates[0]["supportFrameCount"] == 4

# 빈 역할의 반칙 없음 해석과 자세 모델 실행 방지 확인
def test_empty_roles_are_not_no_foul_and_do_not_run_pose_model(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 고정 관절 좌표를 반환할 모의 자세 모델 생성
    pose = PoseModel()
    # 단일 프레임의 관측 결과 생성
    result = api().observation(source, upstream, output, RoleModel(empty=True), pose)
    # 처리 상태 값이 처리 완료 상태인지 확인
    assert result["status"] == "COMPLETE"
    # 후보 개수 값이 0인지 확인
    assert result["counts"]["candidateCount"] == 0
    # 연결되지 않은 역할 수 값이 8인지 확인
    assert result["counts"]["unmatchedRoleCount"] == 8
    # 평가하지 않은 항목에 지정한 항목 포함 확인
    assert "foul" in result["notAssessed"]
    # 호출 이력 값이 0인지 확인
    assert pose.calls == 0
    # 자세 추론한 사람 수 값이 0인지 확인
    assert result["timings"]["poseInferredPersonCount"] == 0

# 추론 전 기존 출력 거부 확인
def test_existing_output_is_rejected_before_inference(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 출력 자료 생성
    output.mkdir()
    # 시험 식별 값 준비
    marker = output / "owned.txt"
    # 시험 식별 값에 시험 문자열 기록
    marker.write_text("preserve")
    # 고정 역할을 반환할 모의 역할 모델 생성
    role = RoleModel()
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 단일 프레임의 관측 결과 실행
        api().observation(source, upstream, output, role, PoseModel())
    # 호출 이력 값이 0인지 확인
    assert role.calls == 0
    # 파일에 저장한 문자열의 기대 자료 일치 확인
    assert marker.read_text() == "preserve"

# 끊어진 출력 심볼릭 링크 추적 방지 확인
def test_dangling_output_symlink_is_not_followed(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 대상 경로 준비
    target = output.parent / "missing-target"
    # 출력 자료의 링크 경로 생성
    output.symlink_to(target)
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 단일 프레임의 관측 결과 실행
        api().observation(source, upstream, output, RoleModel(), PoseModel())
    # 심볼릭 링크 여부의 조건 충족 확인
    assert output.is_symlink()
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not target.exists()

# 모델 실패의 완료 대신 부분 작업 기록 확인
@pytest.mark.parametrize("failed_stage", ["role", "pose"])
def test_model_failure_records_partial_work_not_complete(inputs, failed_stage):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 고정 역할을 반환할 모의 역할 모델 생성
    role = RoleModel(fail_on=2 if failed_stage == "role" else None)
    # 고정 관절 좌표를 반환할 모의 자세 모델 생성
    pose = PoseModel(fail_on=2 if failed_stage == "pose" else None)
    # 단일 프레임의 관측 결과 생성
    result = api().observation(source, upstream, output, role, pose)
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert result["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert result["failureReason"] == f"TEST_{failed_stage.upper()}_FAILED"
    # 저장된 프레임 수 값이 1인지 확인
    assert result["counts"]["recordedFrameCount"] == 1
    # 역할 추론한 프레임 수의 기대 자료 일치 확인
    assert result["timings"]["roleInferredFrameCount"] == (1 if failed_stage == "role" else 2)
    # 자세 추론한 사람 수 값이 2인지 확인
    assert result["timings"]["poseInferredPersonCount"] == 2
    # 재생한 원본 프레임 수 값이 2인지 확인
    assert result["replay"]["replayedFrameCount"] == 2

# 자세 배치 실패 시 시도 인원과 유효 출력 분리 확인
def test_failed_pose_batch_keeps_attempted_people_separate_from_valid_outputs(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 단일 프레임의 관측 결과 생성
    result = api().observation(source, upstream, output, RoleModel(), PoseModel(fail_on=2))
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert result["status"] == "FAILED"
    # 자세 추론 시도한 사람 수 값이 4인지 확인
    assert result["timings"]["poseAttemptedPersonCount"] == 4
    # 자세 추론한 사람 수 값이 2인지 확인
    assert result["timings"]["poseInferredPersonCount"] == 2

# 자세 출력 누락의 암묵적 인원 제외 대신 실패 확인
def test_missing_pose_output_fails_instead_of_silently_omitting_person(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 단일 프레임의 관측 결과 생성
    result = api().observation(source, upstream, output, RoleModel(), PoseModel(missing=True))
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert result["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert result["failureReason"] == "POSE_OUTPUT_MISMATCH"
    # 저장된 프레임 수 값이 0인지 확인
    assert result["counts"]["recordedFrameCount"] == 0

# 모델 실행 중 입력 변경의 완료 요약 방지 확인
def test_input_change_during_model_execution_prevents_complete_summary(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs

    # 원본 수정 시각 변경
    def touch_source(call):
        # 관측한 호출의 비교 결과별 분기
        if call == 4:
            # 원본 수정 시각 변경 대상 동작 실행
            source.touch()

    # 단일 프레임의 관측 결과 생성
    result = api().observation(
        source, upstream, output, RoleModel(effect=touch_source), PoseModel()
    )
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert result["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert result["failureReason"] == "INPUT_CHANGED_DURING_REPLAY"
    # 저장된 프레임 수 값이 4인지 확인
    assert result["counts"]["recordedFrameCount"] == 4

# 모델 실행 전 시간 예산 점검 확인
def test_runtime_budget_is_checked_before_model_execution(inputs, monkeypatch):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 모델 실행 전 시간 예산 점검 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "MAX_RUNTIME_SECONDS", 0)
    # 고정 역할을 반환할 모의 역할 모델 생성
    role = RoleModel()
    # 단일 프레임의 관측 결과 생성
    result = api().observation(source, upstream, output, role, PoseModel())
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert result["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert result["failureReason"] == "OBSERVATION_RUNTIME_LIMIT"
    # 호출 이력 값이 0인지 확인
    assert role.calls == 0

# 표본 예산 소진 시 유효한 기록 앞부분 보존 확인
def test_sample_budget_keeps_valid_written_prefix(inputs, monkeypatch):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 표본 예산 소진 시 유효한 기록 앞부분 보존 의존성의 시험 대역 주입
    monkeypatch.setattr(api(), "MAX_PROCESSED_FRAMES", 1)
    # 단일 프레임의 관측 결과 생성
    result = api().observation(source, upstream, output, RoleModel(), PoseModel())
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert result["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert result["failureReason"] == "OBSERVATION_SAMPLE_LIMIT"
    # 저장된 프레임 수 값이 1인지 확인
    assert result["counts"]["recordedFrameCount"] == 1

# 진행 보고 실패 시 이미 기록한 프레임 수 보존 확인
def test_progress_failure_keeps_already_recorded_frame_count(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs

    # 진행 보고 실패 모사
    def fail_progress(_event):
        # 진행 보고 실패 모사의 예외 상황 재현
        raise ValueError("TEST_PROGRESS_FAILED")

    # 단일 프레임의 관측 결과 생성
    result = api().observation(
        source, upstream, output, RoleModel(), PoseModel(), progress=fail_progress
    )
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert result["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert result["failureReason"] == "TEST_PROGRESS_FAILED"
    # 저장된 프레임 수 값이 1인지 확인
    assert result["counts"]["recordedFrameCount"] == 1

# 내용과 원본 시각 기준 이름 변경 원본 허용 확인
def test_renamed_original_is_accepted_using_content_and_pts(inputs):
    # 원본 입력과 상위 실행 기록 준비
    source, upstream, output = inputs
    # 파일 이름만 바꾼 시험 경로 생성
    renamed = source.with_name("renamed.mkv")
    # 이름을 바꾼 시험 파일 실행
    source.rename(renamed)
    # 단일 프레임의 관측 결과 생성
    result = api().observation(renamed, upstream, output, RoleModel(), PoseModel())
    # 처리 상태 값이 처리 완료 상태인지 확인
    assert result["status"] == "COMPLETE"
    # 파일 경로의 기대 자료 일치 확인
    assert result["source"]["path"] == str(renamed.resolve())

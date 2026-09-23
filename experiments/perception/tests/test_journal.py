# 형식 주석의 지연 해석 사용
from __future__ import annotations
# 중첩 시험 자료 복사 도구 읽음
from copy import deepcopy
# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 기록 직렬화와 읽기 도구 읽음
import json
# 각도와 비유한 수치 시험 도구 읽음
import math
# 파일과 프로세스 상태 점검 도구 읽음
import os
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.media import VideoSample
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.journal import ObservationReport
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import (
    KEYPOINT_NAMES,
    Keypoint,
    PoseObservation,
    RoleDetection,
    RoleHypothesis,
)
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.frames import RecordedFrame

# 표본 생성
def _sample(index: int, *, width: int = 160, height: int = 120) -> VideoSample:
    # 원본 표시 시각과 픽셀을 가진 표본 반환
    return VideoSample(
        decoded_index=index * 3,
        stream_index=2,
        # 원본 표시 시각의 호출 조건 지정
        pts=9000 + index * 4500,
        # 원본 시간 단위의 호출 조건 지정
        time_base=Fraction(1, 90000),
        # 원본 시작 시각의 호출 조건 지정
        origin_pts=9000,
        origin_time_base=Fraction(1, 90000),
        # 밀리초 원본 시각의 호출 조건 지정
        timestamp_ms=index * 50,
        # 색상 영상 배열의 호출 조건 지정
        rgb=np.zeros((height, width, 3), dtype=np.uint8),
    )

# 프레임 생성
def _frame(index: int = 0) -> RecordedFrame:
    # 검출 목록의 시험 항목 구성
    detections = (
        # 사람 후보의 상자와 점수 지정
        Detection(7, "person", (10, 12, 80, 110), 0.91, "0:person:17"),
        # 공 후보의 상자와 점수 지정
        Detection(8, "sports ball", (100, 30, 112, 42), 0.73),
    )
    # 원본 표본과 검출을 묶은 기록 프레임 반환
    return RecordedFrame(_sample(index), detections, continuity_id=3, record_index=40 + index)

# 자세 관측 생성
def _pose() -> PoseObservation:
    # 좌표와 점수를 가진 단일 관절 목록의 비교 자료 생성
    points = tuple(
        Keypoint(index, name, 20.0 + index * 2, 30.0 + index, 0.9)
        for index, name in enumerate(KEYPOINT_NAMES)
    )
    # 원본 상자와 관절 좌표를 가진 자세 관측 반환
    return PoseObservation(7, (10, 12, 80, 110), points, ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)))

# 메타데이터 생성
def _metadata(tmp_path: Path) -> dict:
    # 원본 파일 경로 준비
    source_path = tmp_path / "source.mp4"
    # 원본 파일 경로에 시험 바이트 기록
    source_path.write_bytes(b"original-source")
    # 상위 실행 요약 준비
    upstream_summary = tmp_path / "upstream-summary.json"
    # 상위 실행 프레임 기록 준비
    upstream_rows = tmp_path / "upstream-frames.jsonl"
    # 상위 실행 요약에 시험 바이트 기록
    upstream_summary.write_bytes(b'{"unchanged":true}\n')
    # 상위 실행 프레임 기록에 시험 바이트 기록
    upstream_rows.write_bytes(b'{"unchanged":true}\n')
    # 메타데이터 결과 반환
    return {
        # 원본 입력의 시험값 지정
        "source": {"path": str(source_path), "sha256": "a" * 64, "sizeBytes": 15},
        # 상위 실행 기록의 시험값 지정
        "upstream": {
            # 요약 파일 경로의 시험값 지정
            "summaryPath": str(upstream_summary),
            # 프레임 기록 경로의 시험값 지정
            "framesJsonlPath": str(upstream_rows),
            # 요약 파일 해시의 시험값 지정
            "summarySha256": "b" * 64,
            # 프레임 기록 파일 해시의 시험값 지정
            "framesJsonlSha256": "c" * 64,
        },
        # 모델 목록의 시험값 지정
        "models": {
            # 역할 가설의 시험값 지정
            "role": {"id": "fixed-role", "sha256": "d" * 64},
            # 자세 관측의 시험값 지정
            "pose": {"id": "fixed-pose", "sha256": "e" * 64},
        },
        # 실행 설정의 시험값 지정
        "settings": {"roleThreshold": 0.5, "poseJointThreshold": 0.5},
    }

# 시험 입력 생성
def _inputs():
    # 원시 출력의 시험 항목 구성
    raw = (
        # 공 후보의 상자와 점수 지정
        RoleDetection(20, "ball", (100, 30, 112, 42), 0.8),
        # 심판 후보의 상자와 점수 지정
        RoleDetection(21, "referee", (11, 13, 79, 109), 0.82),
    )
    # 연결된 관측의 시험 항목 구성
    matched = (RoleHypothesis(7, "MATCHED", "referee", 0.82, 21, 0.9),)
    # 팔 동작 관측의 시험 항목 구성
    arms = (
        {"detectionId": 7, "side": "LEFT", "state": "ARM_RAISED", "reasonCode": "FIXTURE"},
        {"detectionId": 7, "side": "RIGHT", "state": "NOT_RAISED", "reasonCode": "FIXTURE"},
    )
    # 지속 관측 구간의 시험 항목 구성
    episode = {
        # 관측 종류의 시험값 지정
        "kind": "ARM_RAISED",
        # 별도 역할 가설의 심판 시험값 지정
        "actorRoleHypothesis": "referee",
        # 규정 입력 채택 상태의 규정 입력에 채택하지 않은 상태 시험값 지정
        "admission": "NOT_ADMITTED",
        # 화면 연속성 식별자의 3 시험값 지정
        "continuityId": 3,
        # 추적 식별자의 시험값 지정
        "trackId": "0:person:17",
        # 관측한 팔 방향의 시험값 지정
        "side": "LEFT",
        # 구간 시작 시각의 0 시험값 지정
        "startMs": 0,
        # 구간 종료 시각의 250 시험값 지정
        "endMs": 250,
        # 지속 조건 충족 시각의 200 시험값 지정
        "confirmedMs": 200,
        # 관측을 뒷받침한 프레임 수의 3 시험값 지정
        "supportFrameCount": 3,
        # 구간 시작 프레임의 시험값 지정
        "startFrame": {"pts": 9000, "timeBase": {"numerator": 1, "denominator": 90000}},
        # 구간 종료 프레임의 시험값 지정
        "endFrame": {"pts": 31500, "timeBase": {"numerator": 1, "denominator": 90000}},
        # 지속 조건 충족 프레임의 시험값 지정
        "confirmedFrame": {"pts": 27000, "timeBase": {"numerator": 1, "denominator": 90000}},
        # 지속 관측 구간 식별자의 시험값 지정
        "episodeId": "3:0:person:17:LEFT:9000",
        # 분석 범위의 시험값 지정
        "scope": "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY",
    }
    # 원시 출력과 연결된 관측 반환
    return raw, matched, arms, episode

# 직렬화 자료 읽음
def _read_json(path: Path) -> dict:
    # 직렬화 문자열에서 읽은 자료 반환
    return json.loads(path.read_text(encoding="utf-8"))

# 완료 보고의 정확한 관측과 별도 사건 스트림 기록 확인
def test_complete_report_writes_exact_observation_and_separate_episode_streams(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 중첩 자료까지 분리한 복사본 생성
    originals = deepcopy(metadata)
    # 파일의 원래 바이트 자료 읽음
    source_before = Path(metadata["source"]["path"]).read_bytes()
    # 변경 전 상위 실행 기록의 조건별 항목 수집
    upstream_before = {
        key: Path(metadata["upstream"][key]).read_bytes()
        for key in ("summaryPath", "framesJsonlPath")
    }
    # 영상과 검출의 시험 입력 묶음 생성
    raw, matched, arms, episode = _inputs()
    # 저장 계약에 맞춘 직렬화 자료 생성
    source_detection_record = _frame().detections[0].as_record()
    # 출력 자료 준비
    output = tmp_path / "observation-output"

    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata, max_previews=2) as report:
        # 마감 시 지연 읽음 대신 생성 시 메타데이터 복제 확인
        metadata["models"]["role"]["id"] = "mutated-after-start"
        # 관측 보고서에 현재 관측 추가
        report.append(
            _frame(),
            raw,
            matched,
            (_pose(),),
            arms,
            (episode,),
            {"roleSeconds": 0.01, "poseSeconds": 0.02},
            role_input_transform={
                # 원본 입력의 시험값 지정
                "source": {"width": 160, "height": 120},
                # 가로 여백의 시험값 지정
                "letterbox": {"padX": 0},
            },
        )
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish(
            "COMPLETE",
            # 원본 재생 기록의 호출 조건 지정
            replay={"selectedRecordCount": 1, "replayedFrameCount": 1},
            # 처리 시간 기록의 호출 조건 지정
            timings={"totalSeconds": 0.04},
        )

    # 기록 행 목록의 조건별 항목 수집
    rows = [json.loads(line) for line in (output / "observations.jsonl").read_text().splitlines()]
    # 후보 관측 목록의 조건별 항목 수집
    candidates = [
        json.loads(line) for line in (output / "arm-candidates.jsonl").read_text().splitlines()
    ]
    # 기록 행 목록의 기대 자료 일치 확인
    assert rows == [{
        # 원본 무결성 해시의 시험값 지정
        "sourceSha256": "a" * 64,
        **_sample(0).as_record(),
        # 상위 실행의 기록 순번의 40 시험값 지정
        "upstreamRecordIndex": 40,
        # 화면 연속성 식별자의 3 시험값 지정
        "continuityId": 3,
        # 재생 상태의 알 수 없는 상태 시험값 지정
        "replayState": "UNKNOWN",
        # 원본 검출 목록의 시험값 지정
        "sourceDetections": [item.as_record() for item in _frame().detections],
        # 역할 모델 검출 목록의 시험값 지정
        "roleDetections": [item.as_record() for item in raw],
        # 역할 가설 목록의 기대값 지정
        "roleHypotheses": [item.as_record() for item in matched],
        # 자세 관측 목록의 시험값 지정
        "poses": [_pose().as_record()],
        # 팔 동작 관측의 시험값 지정
        "arms": list(arms),
        # 역할 모델 입력 변환의 시험값 지정
        "roleInputTransform": {"source": {"width": 160, "height": 120}, "letterbox": {"padX": 0}},
        # 자세 모델 처리 시간의 기대값 지정
        "stageTimings": {"roleSeconds": 0.01, "poseSeconds": 0.02},
    }]
    # 후보 관측 목록의 기대 자료 일치 확인
    assert candidates == [episode]
    # 원본 검출 목록의 첫 항목의 기대 자료 일치 확인
    assert rows[0]["sourceDetections"][0] == source_detection_record
    # 원시 검출의 행위자 역할 값이 검증되지 않은 역할인지 확인
    assert rows[0]["sourceDetections"][0]["actorRole"] == "UNPROVEN"
    # 역할 가설 값이 공인지 확인
    assert rows[0]["roleDetections"][0]["role"] == "ball"
    # 실행 요약의 기대 자료 일치 확인
    assert summary == _read_json(output / "summary.json")
    # 기록 형식 판본 값이 1인지 확인
    assert summary["schemaVersion"] == 1
    # 보고서 종류의 기대 자료 일치 확인
    assert summary["reportType"] == "REFEREE_OBSERVATIONS"
    # 분석 범위의 기대 자료 일치 확인
    assert summary["scope"] == "ROLE_POSE_AND_ARM_OBSERVATION_ONLY"
    # 처리 상태 값이 처리 완료 상태인지 확인
    assert summary["status"] == "COMPLETE"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert summary["admission"] == "NOT_ADMITTED"
    # 원본 입력의 기대 자료 일치 확인
    assert summary["source"] == originals["source"]
    # 상위 실행 기록의 기대 자료 일치 확인
    assert summary["upstream"] == originals["upstream"]
    # 모델 목록의 기대 자료 일치 확인
    assert summary["models"] == originals["models"]
    # 실행 설정의 기대 자료 일치 확인
    assert summary["settings"] == originals["settings"]
    # 원본 재생 기록의 기대 자료 일치 확인
    assert summary["replay"] == {"selectedRecordCount": 1, "replayedFrameCount": 1}
    # 처리 건수 요약의 기대 자료 일치 확인
    assert summary["counts"] == {
        # 저장된 프레임 수의 1 시험값 지정
        "recordedFrameCount": 1,
        # 원본 사람 검출 수의 1 시험값 지정
        "sourcePersonCount": 1,
        # 원시 역할 검출 수의 기대값 지정
        "rawRoleDetectionCount": 2,
        # 심판 후보의 1 시험값 지정
        "rawRolesByLabel": {"ball": 1, "goalkeeper": 0, "player": 0, "referee": 1},
        # 연결된 역할 수의 기대값 지정
        "matchedRoleCount": 1,
        # 심판 후보의 1 시험값 지정
        "matchedRolesByLabel": {"goalkeeper": 0, "player": 0, "referee": 1},
        # 연결되지 않은 역할 수의 0 시험값 지정
        "unmatchedRoleCount": 0,
        # 모호한 역할 수의 기대값 지정
        "ambiguousRoleCount": 0,
        # 자세 관측 수의 1 시험값 지정
        "poseCount": 1,
        # 상태별 팔 동작 수의 기대값 지정
        "armStatesByState": {"ARM_RAISED": 1, "NOT_RAISED": 1, "UNOBSERVABLE": 0},
        # 후보 개수의 1 시험값 지정
        "candidateCount": 1,
    }
    # 평가하지 않은 항목의 기대 자료 일치 확인
    assert summary["notAssessed"] == [
        "mainVsAssistantReferee", "flagObject", "cards", "declaredDecision",
        "contact", "foul", "restarts", "liveReplay",
    ]
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert Path(metadata["source"]["path"]).read_bytes() == source_before
    # 모든 상위 실행 파일의 바이트가 실행 전과 동일한지 확인
    assert all(
        Path(metadata["upstream"][key]).read_bytes() == value
        for key, value in upstream_before.items()
    )

# 관측 없음의 반칙 없음 보고 방지 확인
def test_zero_observations_are_not_reported_as_no_foul(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / "empty"
    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata) as report:
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish(
            # 재생한 원본 프레임 수의 0 시험값 지정
            "COMPLETE", replay={"replayedFrameCount": 0}, timings={"totalSeconds": 0.0}
        )

    # 저장된 프레임 수 값이 0인지 확인
    assert summary["counts"]["recordedFrameCount"] == 0
    # 후보 개수 값이 0인지 확인
    assert summary["counts"]["candidateCount"] == 0
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert summary["admission"] == "NOT_ADMITTED"
    # 관측 요약에 파울 여부나 선언된 판정 필드가 없는지 확인
    assert not any(key in summary for key in ("foul", "hasFoul", "noFoul", "declaredDecision"))

# 미완료 처리의 성공 앞부분과 실패 요약만 보존 확인
def test_unfinished_context_persists_only_successful_prefix_and_failed_summary(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 영상과 검출의 시험 입력 묶음 생성
    raw, matched, arms, episode = _inputs()
    # 출력 자료 준비
    output = tmp_path / "failed"

    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="pose stopped"):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(output, **metadata) as report:
            # 관측 보고서에 현재 관측 추가
            report.append(_frame(), raw, matched, (_pose(),), arms, (episode,), {})
            # 미완료 처리의 성공 앞부분과 실패 요약만 보존의 예외 상황 재현
            raise RuntimeError("pose stopped")

    # 파일을 한 줄씩 나눈 기록의 개수 값이 1인지 확인
    assert len((output / "observations.jsonl").read_text().splitlines()) == 1
    # 파일을 한 줄씩 나눈 기록의 개수 값이 1인지 확인
    assert len((output / "arm-candidates.jsonl").read_text().splitlines()) == 1
    # 파일에서 읽은 직렬화 자료 읽음
    summary = _read_json(output / "summary.json")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "RuntimeError"
    # 저장된 프레임 수 값이 1인지 확인
    assert summary["counts"]["recordedFrameCount"] == 1
    # 후보 개수 값이 1인지 확인
    assert summary["counts"]["candidateCount"] == 1
    # 원본 재생 기록 값이 빈 사전인지 확인
    assert summary["replay"] == {}
    # 처리 시간 기록 값이 빈 사전인지 확인
    assert summary["timings"] == {}


# 실제 외부 실행을 대신할 시험 객체 정의
class _PartialFailingStream:

    # 초기 상태와 입력 계약 구성
    def __init__(self, wrapped):
        # 다른 예외로 감싼 오류 준비
        self.wrapped = wrapped
        # 실패 처리 결과의 거짓 설정
        self.failed = False

    # 닫힘 상태 반환
    @property
    def closed(self):
        # 자원 종료 여부 반환
        return self.wrapped.closed

    # 현재 위치 반환
    def tell(self):
        # 현재 위치 결과 반환
        return self.wrapped.tell()

    # 위치 이동
    def seek(self, *args):
        # 위치 이동 결과 반환
        return self.wrapped.seek(*args)

    # 자료 길이 조정
    def truncate(self, *args):
        # 자료 길이 조정 결과 반환
        return self.wrapped.truncate(*args)

    # 버퍼 내보내기
    def flush(self):
        # 버퍼 내보내기 결과 반환
        return self.wrapped.flush()

    # 자원 닫기
    def close(self):
        # 자원 닫기 결과 반환
        return self.wrapped.close()

    # 자료 기록
    def write(self, value):
        # 실패 처리 결과의 조건에 따른 분기
        if not self.failed:
            # 실패 처리 결과의 참 설정
            self.failed = True
            # 자료 대상 동작 실행
            self.wrapped.write(value[: max(1, len(value) // 2)])
            # 자료의 예외 상황 재현
            raise OSError("disk stopped")
        # 자료 결과 반환
        return self.wrapped.write(value)


# 실제 외부 실행을 대신할 시험 객체 정의
class _CloseFailsOnce:

    # 초기 상태와 입력 계약 구성
    def __init__(self, wrapped):
        # 다른 예외로 감싼 오류 준비
        self.wrapped = wrapped
        # 자원 닫기 호출 수의 0 설정
        self.close_calls = 0

    # 닫힘 상태 반환
    @property
    def closed(self):
        # 자원 종료 여부 반환
        return self.wrapped.closed

    # 대상 속성 반환
    def __getattr__(self, name):
        # 선택한 객체 속성 반환
        return getattr(self.wrapped, name)

    # 자원 닫기
    def close(self):
        # 자원 닫기 호출 수 갱신
        self.close_calls += 1
        # 다른 예외로 감싼 오류의 사용 자원 정리
        self.wrapped.close()
        # 자원 닫기의 예외 상황 재현
        raise OSError("trace close failed")

# 부분 행 실패의 되돌림과 집계 제외 확인
def test_failed_partial_line_is_rolled_back_and_not_counted(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / "partial-line"
    # 영상과 검출의 시험 입력 묶음 생성
    raw, matched, arms, _ = _inputs()

    # 지정한 예외 발생 기대
    with pytest.raises(OSError, match="disk stopped"):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(output, **metadata) as report:
            # 인식 관측 목록 준비
            report._observations = _PartialFailingStream(report._observations)
            # 관측 보고서에 현재 관측 추가
            report.append(_frame(), raw, matched, (_pose(),), arms, (), {})

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (output / "observations.jsonl").read_bytes() == b""
    # 파일에서 읽은 직렬화 자료 읽음
    summary = _read_json(output / "summary.json")
    # 저장된 프레임 수 값이 0인지 확인
    assert summary["counts"]["recordedFrameCount"] == 0
    # 원본 사람 검출 수 값이 0인지 확인
    assert summary["counts"]["sourcePersonCount"] == 0

# 마감 중 미리보기 충돌 시 유효 재생·시간 기록 보존 확인
def test_preview_collision_during_finish_preserves_valid_replay_and_timings(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / "preview-collision"
    # 원본 재생 기록의 시험 항목 구성
    replay = {"selectedRecordCount": 1, "replayedFrameCount": 1}
    # 처리 시간 기록의 시험 항목 구성
    timings = {"totalSeconds": 1.25, "roleSeconds": 0.4}

    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata, max_previews=2) as report:
        # 관측 보고서에 현재 관측 추가
        report.append(_frame(), (), (), (), (), (), {})
        # 기존 파일 충돌 경로 준비
        collision = output / "frames" / "preview-0000-frame-00000000.jpg"
        # 기존 파일 충돌 경로에 시험 바이트 기록
        collision.write_bytes(b"existing-child")
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish("COMPLETE", replay=replay, timings=timings)

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert collision.read_bytes() == b"existing-child"
    # 실행 요약의 기대 자료 일치 확인
    assert summary == _read_json(output / "summary.json")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "FileExistsError"
    # 원본 재생 기록의 기대 자료 일치 확인
    assert summary["replay"] == replay
    # 처리 시간 기록의 기대 자료 일치 확인
    assert summary["timings"] == timings

# 관측 스트림 닫기 실패 시 완료 공개 방지 확인
def test_complete_is_not_published_when_observation_stream_close_fails(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / "close-failure"
    # 원본 재생 기록의 시험 항목 구성
    replay = {"selectedRecordCount": 1, "replayedFrameCount": 1}
    # 처리 시간 기록의 시험 항목 구성
    timings = {"totalSeconds": 0.25}

    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata) as report:
        # 관측 보고서에 현재 관측 추가
        report.append(_frame(), (), (), (), (), (), {})
        # 실패를 주입할 입력 준비
        failing = _CloseFailsOnce(report._observations)
        # 인식 관측 목록 준비
        report._observations = failing
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish("COMPLETE", replay=replay, timings=timings)

    # 자원 닫기 호출 수 값이 1인지 확인
    assert failing.close_calls == 1
    # 실행 요약의 기대 자료 일치 확인
    assert summary == _read_json(output / "summary.json")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "OSError"
    # 원본 재생 기록의 기대 자료 일치 확인
    assert summary["replay"] == replay
    # 처리 시간 기록의 기대 자료 일치 확인
    assert summary["timings"] == timings
    # 저장된 프레임 수 값이 1인지 확인
    assert summary["counts"]["recordedFrameCount"] == 1

# 실패 실행의 미리보기 마감 동시 실패 시 주 사유 보존 확인
def test_failed_run_keeps_primary_reason_when_preview_finalization_also_fails(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / "primary-failure"
    # 원본 재생 기록의 시험 항목 구성
    replay = {"selectedRecordCount": 2, "replayedFrameCount": 2}
    # 처리 시간 기록의 시험 항목 구성
    timings = {"roleInferredFrameCount": 1, "totalSeconds": 0.5}

    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata, max_previews=2) as report:
        # 관측 보고서에 현재 관측 추가
        report.append(_frame(), (), (), (), (), (), {})
        # 기존 파일 충돌 경로 준비
        collision = output / "frames" / "preview-0000-frame-00000000.jpg"
        # 기존 파일 충돌 경로에 시험 바이트 기록
        collision.write_bytes(b"existing-child")
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish(
            "FAILED",
            # 원본 재생 기록의 호출 조건 지정
            replay=replay,
            # 처리 시간 기록의 호출 조건 지정
            timings=timings,
            failure_reason="TEST_ROLE_FAILED",
        )

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert collision.read_bytes() == b"existing-child"
    # 실행 요약의 기대 자료 일치 확인
    assert summary == _read_json(output / "summary.json")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "TEST_ROLE_FAILED"
    # 마무리 기록 실패 이유의 기대 자료 일치 확인
    assert summary["finalizationFailureReason"] == "FileExistsError"
    # 원본 재생 기록의 기대 자료 일치 확인
    assert summary["replay"] == replay
    # 처리 시간 기록의 기대 자료 일치 확인
    assert summary["timings"] == timings
    # 저장된 프레임 수 값이 1인지 확인
    assert summary["counts"]["recordedFrameCount"] == 1

# 시간 기록 형식 오류 시 실패 실행의 주 사유 보존 확인
def test_failed_run_keeps_primary_reason_when_timing_json_is_invalid(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / "invalid-final-timings"
    # 원본 재생 기록의 시험 항목 구성
    replay = {"selectedRecordCount": 1, "replayedFrameCount": 1}

    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata) as report:
        # 관측 보고서에 현재 관측 추가
        report.append(_frame(), (), (), (), (), (), {})
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish(
            "FAILED",
            # 원본 재생 기록의 호출 조건 지정
            replay=replay,
            # 처리 시간 기록의 호출 조건 지정
            timings={"roleSeconds": math.nan},
            failure_reason="TEST_ROLE_FAILED",
        )

    # 실행 요약의 기대 자료 일치 확인
    assert summary == _read_json(output / "summary.json")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "TEST_ROLE_FAILED"
    # 마무리 기록 실패 이유의 기대 자료 일치 확인
    assert summary["finalizationFailureReason"] == "ValueError"
    # 원본 재생 기록의 기대 자료 일치 확인
    assert summary["replay"] == replay
    # 처리 시간 기록 값이 빈 사전인지 확인
    assert summary["timings"] == {}
    # 파일에 저장한 문자열에 지정한 항목 미포함 확인
    assert "NaN" not in (output / "summary.json").read_text(encoding="utf-8")

# 비유한 메타데이터·행의 비수치 직렬화 방지 확인
def test_nonfinite_metadata_and_rows_never_emit_json_nan(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 역할과 자세 관측을 저장할 보고서 실행
        ObservationReport(
            tmp_path / "invalid-metadata", **{**metadata, "settings": {"bad": math.nan}}
        )
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "invalid-metadata").exists()

    # 출력 자료 준비
    output = tmp_path / "invalid-row"
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(output, **metadata) as report:
            # 관측 보고서에 현재 관측 추가
            report.append(_frame(), (), (), (), ({"state": "ARM_RAISED", "bad": math.inf},), (), {})
    # 파일에 저장한 문자열에 지정한 항목 미포함 확인
    assert "NaN" not in (output / "observations.jsonl").read_text()
    # 파일에 저장한 문자열에 지정한 항목 미포함 확인
    assert "Infinity" not in (output / "summary.json").read_text()

# 원본 해시의 정확한 대문자·소문자 16진수 요구 확인
@pytest.mark.parametrize("bad_sha", ["", "a" * 63, "g" * 64, 123])
def test_source_sha256_must_be_exact_lower_or_upper_hex(tmp_path, bad_sha):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 파일 무결성 해시 준비
    metadata["source"]["sha256"] = bad_sha
    # 원본 일치 오류 발생 기대
    with pytest.raises(ValueError, match="SOURCE_SHA256_INVALID"):
        # 역할과 자세 관측을 저장할 보고서 실행
        ObservationReport(tmp_path / "bad-sha", **metadata)

# 출력 생성 전 엄격한 미리보기 상한 확인
@pytest.mark.parametrize("max_previews", [True, 1, 25])
def test_preview_limit_is_strict_before_creating_output(tmp_path, max_previews):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / f"bad-limit-{max_previews}"
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="MAX_PREVIEWS_INVALID"):
        # 역할과 자세 관측을 저장할 보고서 실행
        ObservationReport(output, **metadata, max_previews=max_previews)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not output.exists()

# 기존 출력·끊어진 링크·작업 트리 경로 거부 확인
def test_existing_output_dangling_symlink_and_worktree_paths_are_refused(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 이미 존재하는 파일 준비
    existing = tmp_path / "existing"
    # 이미 존재하는 파일 생성
    existing.mkdir()
    # 시험 식별 값 준비
    marker = existing / "keep"
    # 시험 식별 값에 시험 바이트 기록
    marker.write_bytes(b"keep")
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(existing, **metadata):
            # 추가 동작 없는 모의 구현 유지
            pass
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert marker.read_bytes() == b"keep"

    # 대상이 없는 링크 준비
    dangling = tmp_path / "dangling"
    # 대상이 없는 링크의 링크 경로 생성
    dangling.symlink_to(tmp_path / "missing-target", target_is_directory=True)
    # 링크 자체의 존재 여부의 조건 충족 확인
    assert os.path.lexists(dangling)
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(dangling, **metadata):
            # 추가 동작 없는 모의 구현 유지
            pass

    # 모델 파일 저장 위치 준비
    checkout = tmp_path / "checkout"
    # 모델 파일 저장 위치 생성
    checkout.mkdir()
    # 시험 파일 경로에 시험 문자열 기록
    (checkout / ".git").write_text("gitdir: elsewhere", encoding="utf-8")
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OUTPUT_INSIDE_GIT_WORKTREE"):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(checkout / "output", **metadata):
            # 추가 동작 없는 모의 구현 유지
            pass

# 동시 생성 요약의 덮어쓰기 방지 확인
def test_concurrently_created_summary_is_not_overwritten(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 출력 자료 준비
    output = tmp_path / "summary-collision"
    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(output, **metadata) as report:
            # 시험 식별 값 준비
            marker = output / "summary.json"
            # 시험 식별 값에 시험 문자열 기록
            marker.write_text("somebody else's data", encoding="utf-8")
            # 관측 보고서의 종료 상태 기록
            report.finish("COMPLETE", replay={}, timings={})
    # 파일에 저장한 문자열의 기대 자료 일치 확인
    assert marker.read_text(encoding="utf-8") == "somebody else's data"

# 완료 조작 없는 사건 추가와 마감 내보내기 확인
def test_append_episodes_supports_finish_flush_without_fabricating_completion(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 영상과 검출의 시험 입력 묶음 생성
    _, _, _, episode = _inputs()
    # 출력 자료 준비
    output = tmp_path / "finish-episodes"
    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata) as report:
        # 저장된 지속 관측 구간 실행
        report.episodes((episode,))
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish("COMPLETE", replay={}, timings={})

    # 저장된 프레임 수 값이 0인지 확인
    assert summary["counts"]["recordedFrameCount"] == 0
    # 후보 개수 값이 1인지 확인
    assert summary["counts"]["candidateCount"] == 1
    # 직렬화 문자열에서 읽은 자료의 기대 자료 일치 확인
    assert json.loads((output / "arm-candidates.jsonl").read_text()) == episode
    # 지속 관측 구간에 지정한 항목 미포함 확인
    assert "declaredDecision" not in episode

# 잘못된 사건의 기록·집계 제외 확인
def test_invalid_episode_is_not_written_or_counted(tmp_path):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 영상과 검출의 시험 입력 묶음 생성
    _, _, _, episode = _inputs()
    # 출력 자료 준비
    output = tmp_path / "invalid-episode"
    # 잘못된 시험 입력의 시험 항목 구성
    invalid = {**episode, "admission": "ADMITTED"}
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="EPISODE_ADMISSION_INVALID"):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(output, **metadata) as report:
            # 저장된 지속 관측 구간 실행
            report.episodes((invalid,))

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (output / "arm-candidates.jsonl").read_bytes() == b""
    # 후보 개수 값이 0인지 확인
    assert _read_json(output / "summary.json")["counts"]["candidateCount"] == 0

# 사건의 심판 역할 가설 필수 확인
@pytest.mark.parametrize("actor_role", [None, "player", "goalkeeper"])
def test_episode_requires_referee_role_hypothesis(tmp_path, actor_role):
    # 시험 영상 메타데이터 생성
    metadata = _metadata(tmp_path)
    # 영상과 검출의 시험 입력 묶음 생성
    _, _, _, episode = _inputs()
    # 출력 자료 준비
    output = tmp_path / f"invalid-episode-role-{actor_role}"
    # 키별로 모은 자료 생성
    invalid = dict(episode)
    # 사건의 심판 역할 가설 필수 입력의 비교 결과별 분기
    if actor_role is None:
        # 대기 목록에서 꺼낸 첫 항목 실행
        invalid.pop("actorRoleHypothesis")
    else:
        # 별도 역할 가설 준비
        invalid["actorRoleHypothesis"] = actor_role

    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="EPISODE_ACTOR_ROLE_INVALID"):
        # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
        with ObservationReport(output, **metadata) as report:
            # 저장된 지속 관측 구간 실행
            report.episodes((invalid,))

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (output / "arm-candidates.jsonl").read_bytes() == b""
    # 후보 개수 값이 0인지 확인
    assert _read_json(output / "summary.json")["counts"]["candidateCount"] == 0

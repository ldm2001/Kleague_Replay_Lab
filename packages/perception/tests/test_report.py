# 형식 주석의 지연 해석 사용
from __future__ import annotations
# 기록 직렬화와 읽기 도구 읽음
import json
# 각도와 비유한 수치 시험 도구 읽음
import math
# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.media import VideoSample
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.report import ReportWriter

# 표본 생성
def sample(index: int, *, width: int = 80, height: int = 60) -> VideoSample:
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

# 메타데이터 생성
def metadata(source_path):
    # 메타데이터 결과 반환
    return {
        # 원본 입력의 시험값 지정
        "source": {"path": str(source_path), "sha256": "a" * 64, "sizeBytes": 12},
        # 모의 모델의 시험값 지정
        "model": {"id": "PekingU/rtdetr_r18vd", "revision": "fixed", "sha256": "b" * 64},
        # 시간축 추적기의 시험값 지정
        "tracker": {"name": "ByteTrackTracker", "version": "fixed"},
        # 실행 설정의 시험값 지정
        "settings": {"intervalMs": 500, "device": "cpu", "dtype": "float32"},
    }

# 직렬화 자료 읽음
def read_json(path):
    # 직렬화 문자열에서 읽은 자료 반환
    return json.loads(path.read_text(encoding="utf-8"))

# 원본·대상 변경 없는 기존 출력 거부 확인
def test_existing_output_is_refused_without_changing_source_or_target(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"original-video")
    # 출력 자료 준비
    output = tmp_path / "existing-output"
    # 출력 자료 생성
    output.mkdir()
    # 시험 식별 값 준비
    marker = output / "keep.txt"
    # 시험 식별 값에 시험 문자열 기록
    marker.write_text("existing", encoding="utf-8")

    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(output, **metadata(source)):
            # 추가 동작 없는 모의 구현 유지
            pass

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert source.read_bytes() == b"original-video"
    # 파일에 저장한 문자열의 기대 자료 일치 확인
    assert marker.read_text(encoding="utf-8") == "existing"

# 출력 입출력 전 미리보기 절대 상한 초과 거부 확인
def test_preview_limit_above_hard_cap_is_rejected_before_output_io(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "must-not-exist"

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="MAX_PREVIEWS_INVALID"):
        # 원본 검출을 보존할 보고서 기록기 실행
        ReportWriter(output, **metadata(source), max_previews=25)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not output.exists()

# 작업 트리 내부 출력 거부 확인
def test_output_inside_git_worktree_is_refused(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 가중치 저장 폴더 준비
    repository = tmp_path / "checkout"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 파일 경로에 시험 문자열 기록
    (repository / ".git").write_text("gitdir: elsewhere", encoding="utf-8")

    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OUTPUT_INSIDE_GIT_WORKTREE"):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(repository / "diagnostics", **metadata(source)):
            # 추가 동작 없는 모의 구현 유지
            pass

# 완료 보고의 관측 스트리밍과 범위 분리 확인
def test_complete_report_streams_observations_and_separates_scope(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"original-video")
    # 출력 자료 준비
    output = tmp_path / "run"
    # 상자와 점수를 가진 원시 검출 생성
    person = Detection(0, "person", (1, 2, 20, 40), 0.9, "0:person:7")
    # 상자와 점수를 가진 원시 검출 생성
    ball = Detection(1, "sports ball", (30, 10, 38, 18), 0.7)

    # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
    with ReportWriter(output, **metadata(source), max_previews=2) as writer:
        # 보고서 기록기에 현재 관측 추가
        writer.append(sample(0), (person, ball), continuity_id=0, inference_seconds=0.125)
        # 보고서 기록기에 현재 관측 추가
        writer.append(
            sample(1),
            (Detection(0, "person", (2, 2, 21, 40), 0.8, "0:person:7"),),
            # 화면 연속성 식별자의 호출 조건 지정
            continuity_id=0,
            inference_seconds=0.1,
        )
        # 종료 시점까지 정리한 관측 결과 생성
        result = writer.finish(
            "COMPLETE",
            # 시험 영상의 호출 조건 지정
            video={"decodedFrameCount": 8, "sampleCount": 2},
            # 처리 시간 기록의 호출 조건 지정
            timings={"totalSeconds": 0.5, "inferenceSeconds": 0.225},
        )

    # 기록 행 목록의 조건별 항목 수집
    rows = [
        json.loads(line)
        for line in (output / "frames.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    # 기록 행 목록의 첫 항목의 기대 자료 일치 확인
    assert rows[0] == {
        # 원본 무결성 해시의 시험값 지정
        "sourceSha256": "a" * 64,
        **sample(0).as_record(),
        # 화면 연속성 식별자의 0 시험값 지정
        "continuityId": 0,
        # 재생 상태의 알 수 없는 상태 시험값 지정
        "replayState": "UNKNOWN",
        # 검출 목록의 시험값 지정
        "detections": [person.as_record(), ball.as_record()],
        # 모델 추론 시간의 기대값 지정
        "inferenceSeconds": 0.125,
    }
    # 검출 상자 좌표 값이 2점0 · 2점0 · 21점0 · 40점0인지 확인
    assert rows[1]["detections"][0]["box"] == [2.0, 2.0, 21.0, 40.0]
    # 처리 결과의 기대 자료 일치 확인
    assert result == read_json(output / "summary.json")
    # 기록 형식 판본 값이 1인지 확인
    assert result["schemaVersion"] == 1
    # 처리 상태 값이 처리 완료 상태인지 확인
    assert result["status"] == "COMPLETE"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert result["admission"] == "NOT_ADMITTED"
    # 분석 범위의 기대 자료 일치 확인
    assert result["scope"] == "OBJECT_DETECTION_AND_TRACKING_ONLY"
    # 평가하지 않은 항목의 기대 자료 일치 확인
    assert result["notAssessed"] == [
        "actorRoles", "refereeSignals", "contact", "foul", "restarts", "liveReplay",
    ]
    # 처리 건수 요약의 기대 자료 일치 확인
    assert result["counts"] == {
        # 저장된 프레임 수의 2 시험값 지정
        "recordedFrameCount": 2,
        # 검출 개수의 3 시험값 지정
        "detectionCount": 3,
        # 분류별 검출 수의 시험값 지정
        "detectionsByLabel": {"person": 2, "sports ball": 1},
        # 분류별 검출 프레임 수의 시험값 지정
        "framesWithDetectionByLabel": {"person": 2, "sports ball": 1},
        # 추적된 관측 수의 2 시험값 지정
        "trackedObservationCount": 2,
        # 고유 추적 수의 1 시험값 지정
        "uniqueTrackIdCount": 1,
        # 분류별 고유 추적 수의 시험값 지정
        "uniqueTrackIdCountByLabel": {"person": 1, "sports ball": 0},
    }
    # 시험 영상의 기대 자료 일치 확인
    assert result["video"] == {"decodedFrameCount": 8, "sampleCount": 2}
    # 처리 시간 기록의 기대 자료 일치 확인
    assert result["timings"] == {"totalSeconds": 0.5, "inferenceSeconds": 0.225}
    # 미리보기 목록의 개수 값이 2인지 확인
    assert len(result["previews"]) == 2
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert source.read_bytes() == b"original-video"

# 빈 검출의 반칙 부정 판단 승격 방지 확인
def test_empty_detections_are_not_promoted_to_negative_foul_judgments(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
    with ReportWriter(output, **metadata(source)) as writer:
        # 보고서 기록기에 현재 관측 추가
        writer.append(sample(0), (), continuity_id=0, inference_seconds=0.01)
        # 종료 시점까지 정리한 관측 결과 생성
        summary = writer.finish(
            # 원본 표본 수의 1 시험값 지정
            "COMPLETE", video={"sampleCount": 1}, timings={"totalSeconds": 0.02}
        )

    # 직렬화 문자열에서 읽은 자료 읽음
    row = json.loads((output / "frames.jsonl").read_text(encoding="utf-8"))
    # 검출 목록 값이 빈 목록인지 확인
    assert row["detections"] == []
    # 검출 개수 값이 0인지 확인
    assert summary["counts"]["detectionCount"] == 0
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert summary["admission"] == "NOT_ADMITTED"
    # 검출 보고서가 파울과 접촉 및 재생 여부를 판정하지 않음 확인
    assert not any(key in summary for key in ("foul", "hasFoul", "noFoul", "contact", "isReplay"))

# 예외 시 오류를 가리지 않는 부분 기록 실패 저장 확인
def test_exception_persists_partial_trace_as_failed_without_masking_error(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="detector stopped"):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(output, **metadata(source)) as writer:
            # 보고서 기록기에 현재 관측 추가
            writer.append(sample(0), (), continuity_id=4, inference_seconds=0.01)
            # 예외 시 오류를 가리지 않는 부분 기록 실패 저장의 예외 상황 재현
            raise RuntimeError("detector stopped")

    # 파일에서 읽은 직렬화 자료 읽음
    summary = read_json(output / "summary.json")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "RuntimeError"
    # 저장된 프레임 수 값이 1인지 확인
    assert summary["counts"]["recordedFrameCount"] == 1
    # 시험 영상 값이 빈 사전인지 확인
    assert summary["video"] == {}
    # 처리 시간 기록 값이 빈 사전인지 확인
    assert summary["timings"] == {}

# 완료의 실패 사유 금지와 실패의 사유 필수 확인
def test_complete_forbids_failure_reason_and_failed_requires_one(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="COMPLETE_FORBIDS_FAILURE_REASON"):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(tmp_path / "complete", **metadata(source)) as writer:
            # 보고서 기록기의 종료 상태 기록
            writer.finish("COMPLETE", video={}, timings={}, failure_reason="not really complete")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert read_json(tmp_path / "complete" / "summary.json")["status"] == "FAILED"

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="FAILED_REQUIRES_FAILURE_REASON"):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(tmp_path / "failed", **metadata(source)) as writer:
            # 보고서 기록기의 종료 상태 기록
            writer.finish("FAILED", video={}, timings={}, failure_reason="  ")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert read_json(tmp_path / "failed" / "summary.json")["status"] == "FAILED"

# 비유한 프레임 값의 기록·집계 제외 확인
def test_nonfinite_frame_value_is_not_written_or_counted(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(output, **metadata(source)) as writer:
            # 보고서 기록기에 현재 관측 추가
            writer.append(sample(0), (), continuity_id=0, inference_seconds=math.nan)

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (output / "frames.jsonl").read_bytes() == b""
    # 파일에서 읽은 직렬화 자료 읽음
    summary = read_json(output / "summary.json")
    # 저장된 프레임 수 값이 0인지 확인
    assert summary["counts"]["recordedFrameCount"] == 0
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"

# 비유한 요약 값의 비수치 직렬화 방지 확인
def test_nonfinite_summary_value_cannot_be_serialized_as_json_nan(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(output, **metadata(source)) as writer:
            # 보고서 기록기의 종료 상태 기록
            writer.finish("COMPLETE", video={}, timings={"totalSeconds": math.inf})

    # 파일에 저장한 문자열 생성
    text = (output / "summary.json").read_text(encoding="utf-8")
    # 문자열 자료에 지정한 항목 미포함 확인
    assert "Infinity" not in text
    # 문자열 자료에 지정한 항목 미포함 확인
    assert "NaN" not in text
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert json.loads(text)["status"] == "FAILED"

# 미리보기 마감 실패 시 검증된 영상·시간 기록 보존 확인
def test_preview_finalization_failure_preserves_validated_video_and_timings(tmp_path, monkeypatch):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"
    # 시험 영상의 시험 항목 구성
    video = {"decodedFrameCount": 12, "sampleCount": 3}
    # 처리 시간 기록의 시험 항목 구성
    timings = {"inferredFrameCount": 3, "totalSeconds": 1.25}

    # 지정한 예외 발생 기대
    with pytest.raises(OSError, match="jpeg destination unavailable"):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(output, **metadata(source)) as writer:
            # 보고서 기록기에 현재 관측 추가
            writer.append(sample(0), (), continuity_id=0, inference_seconds=0.01)
            # 구체화한 결과 자료 준비
            materialize = writer.previewFiles

            # 완료 미리보기 기록 실패 모사
            def fail_complete_preview_write(*, strict):
                # 완료 미리보기 기록 실패 모사 입력의 조건에 따른 분기
                if strict:
                    # 완료 미리보기 기록 실패 모사의 예외 상황 재현
                    raise OSError("jpeg destination unavailable")
                # 구체화한 결과 자료 반환
                return materialize(strict=False)

            # 미리보기 마감 실패 시 검증된 영상·시간 기록 보존 의존성의 시험 대역 주입
            monkeypatch.setattr(writer, 'previewFiles', fail_complete_preview_write)
            # 보고서 기록기의 종료 상태 기록
            writer.finish("COMPLETE", video=video, timings=timings)

    # 파일에서 읽은 직렬화 자료 읽음
    summary = read_json(output / "summary.json")
    # 처리 상태 값이 처리 실패 상태인지 확인
    assert summary["status"] == "FAILED"
    # 처리 실패 이유의 기대 자료 일치 확인
    assert summary["failureReason"] == "OSError"
    # 시험 영상의 기대 자료 일치 확인
    assert summary["video"] == video
    # 처리 시간 기록의 기대 자료 일치 확인
    assert summary["timings"] == timings
    # 저장된 프레임 수 값이 1인지 확인
    assert summary["counts"]["recordedFrameCount"] == 1

# 동시 생성 요약의 덮어쓰기 방지 확인
def test_concurrently_created_summary_is_never_overwritten(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 기존 파일 충돌 발생 기대
    with pytest.raises(FileExistsError):
        # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
        with ReportWriter(output, **metadata(source)) as writer:
            # 시험 식별 값 준비
            marker = output / "summary.json"
            # 시험 식별 값에 시험 문자열 기록
            marker.write_text("somebody else's file", encoding="utf-8")
            # 보고서 기록기의 종료 상태 기록
            writer.finish("COMPLETE", video={}, timings={})

    # 파일에 저장한 문자열의 기대 자료 일치 확인
    assert (output / "summary.json").read_text(encoding="utf-8") == "somebody else's file"

# 단 한 번의 마감 허용 확인
def test_finish_is_allowed_only_once(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
    with ReportWriter(output, **metadata(source)) as writer:
        # 보고서 기록기의 종료 상태 기록
        writer.finish("COMPLETE", video={}, timings={})
        # 실행 실패 발생 기대
        with pytest.raises(RuntimeError, match="REPORT_ALREADY_FINISHED"):
            # 보고서 기록기의 종료 상태 기록
            writer.finish("COMPLETE", video={}, timings={})

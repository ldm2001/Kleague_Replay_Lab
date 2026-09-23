# 형식 주석의 지연 해석 사용
from __future__ import annotations
# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 기록 직렬화와 읽기 도구 읽음
import json
# 각도와 비유한 수치 시험 도구 읽음
import math
# 파일과 프로세스 상태 점검 도구 읽음
import os
# 격리 명령 실행 도구 읽음
import subprocess
# 불변 관측 복사와 수정 오류 도구 읽음
from dataclasses import FrozenInstanceError
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.media import VideoReader
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.frames import RecordedFrame, RecordedFrames
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.report import ReportWriter

# 파일 해시 계산
def _sha256(path: Path) -> str:
    # 원본 무결성을 비교할 해시 누적기 생성
    digest = hashlib.sha256()
    # 파일 또는 연결 자원의 사용 구간 시작
    with path.open("rb") as source:
        # 입력을 차례대로 읽을 반복자의 항목별 순회
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            # 파일 해시 누적기에 현재 입력 반영
            digest.update(chunk)
    # 파일 무결성 비교용 해시 문자열 반환
    return digest.hexdigest()

# 시험 영상 생성
def _make_video(path: Path, *, color: str = "red") -> None:
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
            f"color=c={color}:s=64x48:r=10:d=1",
            "-fps_mode",
            "passthrough",
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

# 원본 기록 생성
def _source_record(path: Path) -> dict:
    # 원본 기록 결과 반환
    return {
        # 파일 경로의 시험값 지정
        "path": str(path.resolve()),
        # 파일 무결성 해시의 시험값 지정
        "sha256": _sha256(path),
        # 파일 바이트 크기의 시험값 지정
        "sizeBytes": path.stat().st_size,
        # 시험 자료 표식의 시험값 지정
        "identity": {"fixture": "recorded-frames"},
    }

# 시험 보고서 생성
def _create_report(source: Path, run_dir: Path) -> tuple[tuple[Detection, ...], ...]:
    # 경로와 해시를 갖춘 원본 식별 기록 생성
    source_record = _source_record(source)
    # 변경 전 자료의 빈 누적 공간 생성
    original: list[tuple[Detection, ...]] = []
    # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
    with ReportWriter(
        run_dir,
        # 원본 입력의 호출 조건 지정
        source=source_record,
        # 모의 모델의 호출 조건 지정
        model={"id": "fixed-test-detector", "sha256": "b" * 64},
        # 시간축 추적기의 호출 조건 지정
        tracker={"name": "fixed-test-tracker"},
        # 실행 설정의 호출 조건 지정
        settings={"startMs": 0, "endMs": 1000, "sampleIntervalMs": 200, "fixture": True},
        max_previews=2,
    ) as writer:
        # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
        with VideoReader(source, start_ms=0, end_ms=1000, interval_ms=200) as reader:
            # 순번을 붙인 시험 자료의 항목별 순회
            for index, sample in enumerate(reader):
                # 검출 목록의 시험 항목 구성
                detections = (
                    # 사람 후보의 상자와 점수 지정
                    Detection(index, "person", (1, 2, 20, 40), 0.9, f"0:person:{index}"),
                    # 공 후보의 상자와 점수 지정
                    Detection(index + 100, "sports ball", (30, 10, 38, 18), 0.7),
                )
                # 변경 전 자료에 현재 관측 추가
                original.append(detections)
                # 보고서 기록기에 현재 관측 추가
                writer.append(sample, detections, continuity_id=index // 3, inference_seconds=0.01)
        # 보고서 기록기의 종료 상태 기록
        writer.finish("COMPLETE", video=reader.as_record(), timings={"totalSeconds": 0.1})
    # 변경 전 자료의 비교 자료 반환
    return tuple(original)

# 기록된 실행 생성
@pytest.fixture
def recorded_run(tmp_path):
    # 기록된 실행의 선택적 의존성 유무 확인
    pytest.importorskip("av")
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 실행 결과 폴더 준비
    run_dir = tmp_path / "upstream"
    # 디코더 검사용 합성 영상 실행
    _make_video(source)
    # 합성 영상에서 만든 검출 보고서 생성
    detections = _create_report(source, run_dir)
    # 원본 입력과 실행 결과 폴더 반환
    return source, run_dir, detections

# 요약 자료 읽음
def _read_summary(run_dir: Path) -> dict:
    # 직렬화 문자열에서 읽은 자료 반환
    return json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))

# 요약 자료 기록
def _write_summary(run_dir: Path, summary: dict) -> None:
    # 시험 파일 경로에 시험 문자열 기록
    (run_dir / "summary.json").write_text(
        json.dumps(summary, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )

# 행 자료 읽음
def _read_rows(run_dir: Path) -> list[dict]:
    # 직렬화 문자열에서 읽은 자료 목록 반환
    return [
        json.loads(line)
        for line in (run_dir / "frames.jsonl").read_text(encoding="utf-8").splitlines()
    ]

# 행 자료 기록
def _write_rows(run_dir: Path, rows: list[dict]) -> None:
    # 시험 파일 경로에 시험 문자열 기록
    (run_dir / "frames.jsonl").write_text(
        "".join(json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n" for row in rows),
        encoding="utf-8",
    )

# 행 기준 요약 조정
def _adjust_summary_for_rows(run_dir: Path, rows: list[dict]) -> None:
    # 저장된 실행 요약 읽음
    summary = _read_summary(run_dir)
    # 기록 행 목록의 개수 생성
    summary["counts"]["recordedFrameCount"] = len(rows)
    # 기록 행 목록의 개수 생성
    summary["video"]["sampleCount"] = len(rows)
    # 모든 프레임의 검출 목록의 조건별 항목 수집
    all_detections = [detection for row in rows for detection in row["detections"]]
    # 모든 프레임의 검출 목록의 개수 생성
    summary["counts"]["detectionCount"] = len(all_detections)
    # 행 기준 요약 조정 입력 목록의 항목별 순회
    for label in ("person", "sports ball"):
        # 목록의 합계 생성
        summary["counts"]["detectionsByLabel"][label] = sum(
            detection["label"] == label for detection in all_detections
        )
        # 조건을 충족한 항목 존재 여부 목록의 합계 생성
        summary["counts"]["framesWithDetectionByLabel"][label] = sum(
            any(detection["label"] == label for detection in row["detections"]) for row in rows
        )
    # 추적 식별자가 있는 관측의 조건별 항목 수집
    tracked = [detection for detection in all_detections if detection["trackId"] is not None]
    # 추적 식별자가 있는 관측의 개수 생성
    summary["counts"]["trackedObservationCount"] = len(tracked)
    # 서로 다른 추적 식별자의 조건별 항목 수집
    track_ids = {detection["trackId"] for detection in tracked}
    # 서로 다른 추적 식별자의 개수 생성
    summary["counts"]["uniqueTrackIdCount"] = len(track_ids)
    # 행 기준 요약 조정 입력 목록의 항목별 순회
    for label in ("person", "sports ball"):
        # 추적 식별자 목록의 개수 생성
        summary["counts"]["uniqueTrackIdCountByLabel"][label] = len(
            {detection["trackId"] for detection in tracked if detection["label"] == label}
        )
    # 변경한 시험 실행 요약 실행
    _write_summary(run_dir, summary)

# 입력 변경 없는 원본 색상 메타데이터와 검출 재현 확인
def test_replays_original_rgb_metadata_and_detections_without_changing_inputs(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, original_detections = recorded_run
    # 파일의 원래 바이트 자료 읽음
    original_source = source.read_bytes()
    # 파일의 원래 바이트 자료 읽음
    original_summary = (run_dir / "summary.json").read_bytes()
    # 파일의 원래 바이트 자료 읽음
    original_rows = (run_dir / "frames.jsonl").read_bytes()
    # 저장된 프레임 기록 목록 읽음
    expected_rows = _read_rows(run_dir)

    # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
    with RecordedFrames(source, run_dir) as recorded:
        # 저장 프레임 읽기 객체의 비교 자료 생성
        frames = tuple(recorded)
        # 원본과 모델 출처 준비
        provenance = recorded.provenance
        # 저장 계약에 맞춘 직렬화 자료 생성
        replay = recorded.as_record()

    # 영상 프레임 목록의 개수의 기대 자료 일치 확인
    assert len(frames) == len(expected_rows) == 5
    # 저장된 프레임 순번 목록의 기대 자료 일치 확인
    assert [frame.record_index for frame in frames] == list(range(5))
    # 화면 연속성 식별자 목록의 기대 자료 일치 확인
    assert [frame.continuity_id for frame in frames] == [
        row["continuityId"] for row in expected_rows
    ]
    # 원본 표시 시각 목록의 기대 자료 일치 확인
    assert [frame.sample.pts for frame in frames] == [row["pts"] for row in expected_rows]
    # 밀리초 원본 시각 목록의 기대 자료 일치 확인
    assert [frame.sample.timestamp_ms for frame in frames] == [
        row["timestampMs"] for row in expected_rows
    ]
    # 검출 목록 목록의 기대 자료 일치 확인
    assert [frame.detections for frame in frames] == list(original_detections)
    # 배열 차원 값이 48 · 64 · 3인지 확인
    assert frames[0].sample.rgb.shape == (48, 64, 3)
    # 재생한 빨간 원본의 빨강 채널이 파랑 채널보다 큰지 확인
    assert frames[0].sample.rgb[0, 0, 0] > frames[0].sample.rgb[0, 0, 2]
    # 원본 입력의 기대 자료 일치 확인
    assert provenance["source"] == _read_summary(run_dir)["source"]
    # 요약 파일 해시의 기대 자료 일치 확인
    assert provenance["upstream"]["summarySha256"] == _sha256(run_dir / "summary.json")
    # 프레임 기록 파일 해시의 기대 자료 일치 확인
    assert provenance["upstream"]["framesJsonlSha256"] == _sha256(run_dir / "frames.jsonl")
    # 실행 설정의 기대 자료 일치 확인
    assert provenance["settings"] == {"startMs": 0, "endMs": 1000, "sampleIntervalMs": 200}
    # 선택한 기록 수 값이 5인지 확인
    assert replay["selectedRecordCount"] == 5
    # 재생한 원본 프레임 수 값이 5인지 확인
    assert replay["replayedFrameCount"] == 5
    # 파일 무결성 해시의 기대 자료 일치 확인
    assert replay["source"]["sha256"] == _sha256(source)
    # 원본 표본 수 값이 5인지 확인
    assert replay["video"]["sampleCount"] == 5
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert source.read_bytes() == original_source
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (run_dir / "summary.json").read_bytes() == original_summary
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (run_dir / "frames.jsonl").read_bytes() == original_rows

# 기록된 프레임의 불변성 확인
def test_recorded_frame_is_frozen(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
    with RecordedFrames(source, run_dir) as recorded:
        # 조건에 맞는 다음 항목 생성
        frame = next(iter(recorded))
        # 불변 자료 수정 오류 발생 기대
        with pytest.raises(FrozenInstanceError):
            # 저장된 프레임 순번의 9 설정
            frame.record_index = 9

# 이름 변경 후 동일 원본 바이트 재현 확인
def test_same_source_bytes_can_be_replayed_after_rename(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 파일 이름만 바꾼 시험 경로 생성
    renamed = source.with_name("renamed-source.mkv")
    # 이름을 바꾼 시험 파일 실행
    source.rename(renamed)

    # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
    with RecordedFrames(renamed, run_dir) as recorded:
        # 저장 프레임 읽기 객체의 비교 자료 생성
        frames = tuple(recorded)

    # 영상 프레임 목록의 개수 값이 5인지 확인
    assert len(frames) == 5
    # 파일 경로의 기대 자료 일치 확인
    assert recorded.as_record()["source"]["path"] == str(renamed.resolve())
    # 파일 경로의 기대 자료 일치 확인
    assert recorded.provenance["source"]["path"] == str(source.resolve())

# 잘못된 요약 계약 거부 확인
@pytest.mark.parametrize(
    ("change", "reason"),
    [
        (lambda value: value.update(schemaVersion=2), "UPSTREAM_SCHEMA_INVALID"),
        (lambda value: value.update(status="FAILED"), "UPSTREAM_STATUS_INVALID"),
        (lambda value: value.update(admission="ADMITTED"), "UPSTREAM_ADMISSION_INVALID"),
        (lambda value: value.update(scope="REFEREE_DECISION"), "UPSTREAM_SCOPE_INVALID"),
        (lambda value: value["settings"].update(startMs=-1), "UPSTREAM_SETTINGS_INVALID"),
        (lambda value: value["settings"].update(endMs=0), "UPSTREAM_SETTINGS_INVALID"),
        (lambda value: value["settings"].update(sampleIntervalMs=0), "UPSTREAM_SETTINGS_INVALID"),
        (lambda value: value["source"].update(sha256="not-a-sha"), "UPSTREAM_SOURCE_INVALID"),
        (lambda value: value["counts"].update(recordedFrameCount=4), "UPSTREAM_COUNT_MISMATCH"),
        (lambda value: value["video"].update(sampleCount=4), "UPSTREAM_COUNT_MISMATCH"),
    ],
)
def test_invalid_summary_contract_is_rejected(recorded_run, change, reason):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 실행 요약 읽음
    summary = _read_summary(run_dir)
    # 잘못된 요약 계약 거부 대상 동작 실행
    change(summary)
    # 변경한 시험 실행 요약 실행
    _write_summary(run_dir, summary)

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match=reason):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

# 저장 파일명 대신 내용 기준 원본 불일치 거부 확인
def test_mismatched_source_is_rejected_by_content_not_stored_filename(recorded_run):
    # 실행 결과 폴더 준비
    _, run_dir, _ = recorded_run
    # 다른 원본 영상 준비
    different_source = run_dir.parent / "different.mkv"
    # 디코더 검사용 합성 영상 실행
    _make_video(different_source, color="blue")

    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="SOURCE_HASH_MISMATCH"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(different_source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

# 중복 키와 비유한 직렬화 값 거부 확인
@pytest.mark.parametrize("target", ["summary", "row"])
@pytest.mark.parametrize("bad_token", ["duplicate", "nan"])
def test_duplicate_keys_and_nonfinite_json_are_rejected(recorded_run, target, bad_token):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 파일 경로 준비
    path = run_dir / ("summary.json" if target == "summary" else "frames.jsonl")
    # 파일에 저장한 문자열 생성
    text = path.read_text(encoding="utf-8")
    # 중복 키와 비유한 직렬화 값 거부 입력의 비교 결과별 분기
    if bad_token == "duplicate":
        # 바꿀 바이트 패턴의 시험 조건별 값 선택
        needle = '"schemaVersion":1' if target == "summary" else '"sourceSha256"'
        # 대체할 바이트 패턴의 시험 조건별 값 선택
        replacement = (
            '"schemaVersion":1,"schemaVersion":1'
            if target == "summary"
            else '"sourceSha256":"x","sourceSha256"'
        )
        # 지정 필드만 바꾼 시험 관측 생성
        text = text.replace(needle, replacement, 1)
    else:
        # 대상 경로의 비교 결과별 분기
        if target == "summary":
            # 지정 필드만 바꾼 시험 관측 생성
            text = text.replace('"totalSeconds":0.1', '"totalSeconds":NaN', 1)
        else:
            # 지정 필드만 바꾼 시험 관측 생성
            text = text.replace('"score":0.9', '"score":NaN', 1)
    # 파일 경로에 시험 문자열 기록
    path.write_text(text, encoding="utf-8")

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="JSON_INVALID"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

# 전체 재현 전 미사용 요약 메타데이터의 지수 넘침 거부 확인
def test_overflow_exponent_in_unused_summary_metadata_is_rejected_before_full_replay(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 파일 경로 준비
    path = run_dir / "summary.json"
    # 지정 필드만 바꾼 시험 관측 생성
    text = path.read_text(encoding="utf-8").replace('"totalSeconds":0.1', '"totalSeconds":1e309', 1)
    # 파일 경로에 시험 문자열 기록
    path.write_text(text, encoding="utf-8")

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="JSON_INVALID"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir) as recorded:
            # 저장 프레임 읽기 객체의 비교 자료의 개수 값이 5인지 확인
            assert len(tuple(recorded)) == 5

# 엄격한 직렬화 검증의 프레임 행 지수 넘침 거부 확인
def test_overflow_exponent_in_frame_row_is_rejected_by_strict_json(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 파일 경로 준비
    path = run_dir / "frames.jsonl"
    # 지정 필드만 바꾼 시험 관측 생성
    text = path.read_text(encoding="utf-8").replace(
        '"inferenceSeconds":0.01', '"inferenceSeconds":1e309', 1
    )
    # 파일 경로에 시험 문자열 기록
    path.write_text(text, encoding="utf-8")

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="JSON_INVALID"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

# 모든 요약 집계의 정확한 음이 아닌 정수 요구 확인
@pytest.mark.parametrize(
    "mutate",
    [
        lambda counts: counts.update(detectionCount=10.0),
        lambda counts: counts["detectionsByLabel"].update(person=5.0),
        lambda counts: counts["framesWithDetectionByLabel"].update(person=5.0),
        lambda counts: counts.update(trackedObservationCount=5.0),
        lambda counts: counts.update(uniqueTrackIdCount=5.0),
        lambda counts: counts["uniqueTrackIdCountByLabel"].update(person=5.0),
        lambda counts: counts["uniqueTrackIdCountByLabel"].update(**{"sports ball": False}),
    ],
)
def test_every_summary_counter_requires_an_exact_nonnegative_integer(recorded_run, mutate):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 실행 요약 읽음
    summary = _read_summary(run_dir)
    # 검사할 항목을 바꾼 시험 입력 실행
    mutate(summary["counts"])
    # 변경한 시험 실행 요약 실행
    _write_summary(run_dir, summary)

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="UPSTREAM_COUNT_MISMATCH"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

# 잘못된 검출과 행 의미 거부 확인
@pytest.mark.parametrize("mutation", ["bounds", "duplicate_detection", "actor_role", "source"])
def test_invalid_detection_or_row_semantics_are_rejected(recorded_run, mutation):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 프레임 기록 목록 읽음
    rows = _read_rows(run_dir)
    # 잘못된 검출과 행 의미 거부 입력의 비교 결과별 분기
    if mutation == "bounds":
        # 검출 상자 좌표의 선택 항목 준비
        rows[0]["detections"][0]["box"][2] = rows[0]["width"] + 0.1
    # 잘못된 검출과 행 의미 거부 입력의 비교 결과별 분기
    elif mutation == "duplicate_detection":
        # 검출 목록에 현재 관측 추가
        rows[0]["detections"].append(dict(rows[0]["detections"][0]))
    # 잘못된 검출과 행 의미 거부 입력의 비교 결과별 분기
    elif mutation == "actor_role":
        # 원시 검출의 행위자 역할 준비
        rows[0]["detections"][0]["actorRole"] = "REFEREE"
    else:
        # 원본 무결성 해시 준비
        rows[0]["sourceSha256"] = "f" * 64
    # 변경한 시험 프레임 기록 실행
    _write_rows(run_dir, rows)

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="UPSTREAM_ROW_INVALID"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

# 저장 행 누락의 빈 행 조작 방지 확인
def test_missing_saved_row_is_not_fabricated_as_empty(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 프레임 기록 목록 읽음
    rows = _read_rows(run_dir)
    # 대기 목록에서 꺼낸 첫 항목 실행
    rows.pop()
    # 변경한 시험 프레임 기록 실행
    _write_rows(run_dir, rows)
    # 변경된 기록과 맞춘 요약 통계 실행
    _adjust_summary_for_rows(run_dir, rows)

    # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
    with RecordedFrames(source, run_dir) as recorded:
        # 입력값 오류 발생 기대
        with pytest.raises(ValueError, match="REPLAY_RECORD_MISSING"):
            # 저장 프레임 읽기 객체의 비교 자료 실행
            tuple(recorded)

# 원본 표본 종료 시 초과 저장 행 실패 확인
def test_extra_saved_row_fails_when_source_samples_end(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 프레임 기록 목록 읽음
    rows = _read_rows(run_dir)
    # 직렬화 문자열에서 읽은 자료 읽음
    extra = json.loads(json.dumps(rows[-1]))
    # 디코딩 프레임 순번 갱신
    extra["decodedIndex"] += 2
    # 원본 표시 시각 갱신
    extra["pts"] += 200
    # 밀리초 원본 시각 갱신
    extra["timestampMs"] += 200
    # 기록 행 목록에 현재 관측 추가
    rows.append(extra)
    # 변경한 시험 프레임 기록 실행
    _write_rows(run_dir, rows)
    # 변경된 기록과 맞춘 요약 통계 실행
    _adjust_summary_for_rows(run_dir, rows)

    # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
    with RecordedFrames(source, run_dir) as recorded:
        # 원본 일치 오류 발생 기대
        with pytest.raises(ValueError, match="REPLAY_SOURCE_EARLY_EOF"):
            # 저장 프레임 읽기 객체의 비교 자료 실행
            tuple(recorded)

# 반올림 밀리초 일치 시에도 원본 시각 차이 거부 확인
def test_different_pts_is_rejected_even_when_rounded_milliseconds_match(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 프레임 기록 목록 읽음
    rows = _read_rows(run_dir)
    # 원본 표시 시각 갱신
    rows[0]["pts"] += 1
    # 변경 전 원본 시각 준비
    original_timestamp = rows[0]["timestampMs"]
    # 변경한 시험 프레임 기록 실행
    _write_rows(run_dir, rows)

    # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
    with RecordedFrames(source, run_dir) as recorded:
        # 프레임 계약 오류 발생 기대
        with pytest.raises(ValueError, match="REPLAY_FRAME_MISMATCH"):
            # 저장 프레임 읽기 객체의 비교 자료 실행
            tuple(recorded)
    # 밀리초 원본 시각의 기대 자료 일치 확인
    assert rows[0]["timestampMs"] == original_timestamp

# 부분 순회와 본문 예외 시 디코더 닫기 확인
def test_partial_iteration_and_body_exception_close_decoder(recorded_run, monkeypatch):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    import replay_perception.frames as module

    # 변경 전 영상 읽기 객체 준비
    original_reader = module.VideoReader
    # 자원 종료 호출 기록의 빈 누적 공간 생성
    closes: list[str] = []

    # 실제 외부 실행을 대신할 시험 객체 정의
    class TrackingReader:

        # 초기 상태와 입력 계약 구성
        def __init__(self, *args, **kwargs):
            # 변경 전 영상 읽기 객체 생성
            self.wrapped = original_reader(*args, **kwargs)

        # 처리 자원 준비
        def __enter__(self):
            # 읽기 자원 시작 결과 실행
            self.wrapped.__enter__()
            # 상태를 기록한 현재 모의 객체 반환
            return self

        # 원본 순서의 표본 반환
        def __iter__(self):
            # 입력을 차례대로 읽을 반복자 반환
            return iter(self.wrapped)

        # 처리 자원 정리
        def __exit__(self, *args):
            # 자원 종료 호출 기록에 현재 관측 추가
            closes.append("closed")
            # 사용 자원의 종료 처리 반환
            return self.wrapped.__exit__(*args)

        # 기록 형태 반환
        def as_record(self):
            # 저장 계약에 맞춘 직렬화 자료 반환
            return self.wrapped.as_record()

    # 원본 표시 시각을 보존할 영상 읽기 객체의 시험 대역 주입
    monkeypatch.setattr(module, "VideoReader", TrackingReader)
    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="stop downstream"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir) as recorded:
            # 조건에 맞는 다음 항목 실행
            next(iter(recorded))
            # 부분 순회와 본문 예외 시 디코더 닫기의 예외 상황 재현
            raise RuntimeError("stop downstream")
    # 자원 종료 호출 기록의 기대 자료 일치 확인
    assert closes == ["closed"]

# 부분 처리 중 원본·상위 입력 변경의 명시적 실패 확인
def test_source_and_upstream_changes_during_partial_context_fail_explicitly(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="INPUT_CHANGED_DURING_REPLAY"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir) as recorded:
            # 조건에 맞는 다음 항목 실행
            next(iter(recorded))
            # 시험 파일 경로에 시험 바이트 기록
            (run_dir / "frames.jsonl").write_bytes((run_dir / "frames.jsonl").read_bytes() + b"\n")

# 바이트 동일 시에도 원본 파일 상태 변경 거부 확인
def test_source_stat_change_is_rejected_even_when_bytes_are_unchanged(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 파일의 크기와 상태 생성
    source_stat = source.stat()
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="INPUT_CHANGED_DURING_REPLAY"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 바이트 동일 시에도 원본 파일 상태 변경 거부 대상 동작 실행
            os.utime(source, ns=(source_stat.st_atime_ns, source_stat.st_mtime_ns + 1_000_000))

# 무제한 직렬화 자료 읽기 전 크기 제한 확인
def test_size_limits_are_checked_before_unbounded_json_reads(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 파일 또는 연결 자원의 사용 구간 시작
    with (run_dir / "summary.json").open("ab") as summary:
        # 무제한 직렬화 자료 읽기 전 크기 제한 대상 동작 실행
        summary.write(b" " * (8 * 1024 * 1024))
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="UPSTREAM_SUMMARY_TOO_LARGE"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

# 개행 없는 정확한 8메비바이트 마지막 행 허용 확인
def test_jsonl_accepts_an_exact_eight_mib_final_line_without_newline(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 프레임 기록 목록 읽음
    rows = _read_rows(run_dir)
    # 문자열을 인코딩한 바이트 읽음
    prefix = "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows[:-1]).encode()
    # 문자열을 인코딩한 바이트 읽음
    final = json.dumps(rows[-1], separators=(",", ":")).encode()
    # 여백을 채우기 전 마지막 기록 행이 8메비바이트 미만인지 확인
    assert len(final) < 8 * 1024 * 1024
    # 마지막 응답 또는 관측 갱신
    final += b" " * (8 * 1024 * 1024 - len(final))
    # 시험 파일 경로에 시험 바이트 기록
    (run_dir / "frames.jsonl").write_bytes(prefix + final)

    # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
    with RecordedFrames(source, run_dir):
        # 추가 동작 없는 모의 구현 유지
        pass

# 기록 프레임의 비유한 검출 값 유입 방지 확인
def test_nonfinite_detection_values_cannot_enter_a_recorded_frame(recorded_run):
    # 원본 입력과 실행 결과 폴더 준비
    source, run_dir, _ = recorded_run
    # 저장된 프레임 기록 목록 읽음
    rows = _read_rows(run_dir)
    # 검출 신뢰 점수 준비
    rows[0]["detections"][0]["score"] = math.inf
    # 파일 경로 준비
    path = run_dir / "frames.jsonl"
    # 파일 경로에 시험 문자열 기록
    path.write_text(json.dumps(rows[0], allow_nan=True) + "\n", encoding="utf-8")
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="JSON_INVALID"):
        # 저장된 검출과 원본 영상을 대조할 읽기 객체의 사용 구간 시작
        with RecordedFrames(source, run_dir):
            # 추가 동작 없는 모의 구현 유지
            pass

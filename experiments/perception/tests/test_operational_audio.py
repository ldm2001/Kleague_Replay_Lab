# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 격리 명령 실행 도구 읽음
import subprocess
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 검증 도구와 의존성 읽음
from test_operational import api, bundle, records, video

# 음향 포함 시험 영상 생성
def video_with_audio(path):
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
            "color=c=0x2d822d:s=320x360:r=10:d=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1800:duration=0.5:sample_rate=48000",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "ffv1",
            "-c:a",
            "pcm_s16le",
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

# 음향 입력 생성
def audio_input(source, *, status="COMPLETE", count=2, duration_ms=500):
    # 파일 무결성 비교용 해시 문자열 생성
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    # 음향 단서 목록의 조건별 항목 수집
    cues = [
        {
            # 관측 식별자의 시험값 지정
            "id": f"cue-{index}",
            # 구간 시작 시각의 시험값 지정
            "startMs": index * 300,
            # 구간 종료 시각의 시험값 지정
            "endMs": index * 300 + 200,
            # 두드러진 음향 주파수의 시험값 지정
            "peakFrequenciesHz": [3700, 4100],
            # 프레임 수의 시험값 지정
            "frameCount": 2,
        }
        for index in range(count)
    ]
    # 누락 입력 준비
    absent = status == "ABSENT"
    # 음향 입력 결과 반환
    return {
        # 인식 관측 목록의 시험값 지정
        "observations": {
            # 의존성 판본의 시험값 지정
            "version": "audio-observations-v1",
            # 원본 무결성 해시의 시험값 지정
            "sourceSha256": source_sha,
            # 처리 상태의 시험값 지정
            "status": status,
            # 관측 방법의 시험값 지정
            "method": "spectral-multitone-v1",
            # 발화 해석 상태의 시험값 지정
            "speechStatus": "NOT_ANALYZED",
            # 원본 음향 표본 주파수의 시험값 지정
            "sourceSampleRateHz": None if absent else 48000,
            # 원본 음향 채널 수의 시험값 지정
            "sourceChannels": None if absent else 2,
            # 원본 시간축의 시험값 지정
            "timeline": {
                # 영상 원본 시작 시각의 시험값 지정
                "videoOriginSeconds": None if absent else 0.0,
                # 원본 대비 음향 시각 차이의 시험값 지정
                "audioOffsetMs": None if absent else 0,
                # 분석한 시작 시각의 시험값 지정
                "scannedStartMs": None if absent else 0,
                # 분석한 종료 시각의 시험값 지정
                "scannedEndMs": None if absent else duration_ms,
                # 디코딩한 프레임 수의 시험값 지정
                "decodedFrameCount": 0 if absent else duration_ms // 100,
                # 단일 프레임 길이의 시험값 지정
                "frameDurationMs": 100,
                # 시간 공백 처리 정책의 시험값 지정
                "gapPolicy": "PRESERVED_WITH_SYNTHETIC_SILENCE",
            },
            # 음향 단서 수의 시험값 지정
            "cueCount": count,
            # 음향 단서 목록의 시험값 지정
            "cues": cues,
            # 관측 간 시간 연결의 시험값 지정
            "associations": [],
            # 기록 잘림 여부의 거짓 시험값 지정
            "truncated": False,
            # 판단 보류 이유의 빈 목록 시험값 지정
            "reasons": [],
        },
        # 구현 식별 정보의 시험값 지정
        "implementation": {
            # 원본 파일별 해시의 시험값 지정
            "sourceFilesSha256": {"audio.py": "a" * 64, "audio_observations.py": "b" * 64}
        },
    }

# 시각 프레임 전 버전 2 헤더와 음향 단서 기록 확인
def test_audio_run_writes_v2_header_and_cue_rows_before_visual_frames(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source, tmp_path / "audio-output", bundle(), duration_ms=500, audio_input=supplied
    )
    # 저장된 기록 목록 읽음
    rows = records(result)
    # 기록 형식 판본의 기대 자료 일치 확인
    assert result["schemaVersion"] == rows[0]["schemaVersion"] == "perception-run-v2"
    # 파이프라인 판본의 기대 자료 일치 확인
    assert (
        result["pipelineVersion"]
        == rows[0]["implementation"]["pipelineVersion"]
        == "video-local-observers-av-v1"
    )
    # 음향 단서 수 값이 2인지 확인
    assert rows[0]["audio"]["cueCount"] == 2
    # 음향 관측 자료에 지정한 항목 미포함 확인
    assert "cues" not in rows[0]["audio"]
    # 음향 관측 자료의 기대 자료 일치 확인
    assert rows[0]["implementation"]["audio"] == supplied["implementation"]
    # 관측 종류 목록의 기대 자료 일치 확인
    assert [row["kind"] for row in rows[:4]] == ["HEADER", "AUDIO_CUE", "AUDIO_CUE", "FRAME"]
    # 관측 식별자 목록의 기대 자료 일치 확인
    assert [row["id"] for row in rows[1:3]] == ["cue-0", "cue-1"]
    # 시간 연결한 음향 기록들의 원본 해시가 결과 원본 해시와 같은지 확인
    assert all(row["sourceSha256"] == result["sourceSha256"] for row in rows[1:3])
    # 음향 관측 자료의 기대 자료 일치 확인
    assert result["audio"] == supplied["observations"]

# 음향 요약 크기 제한과 모든 원시 단서 보존 확인
def test_audio_summary_is_bounded_while_every_cue_is_raw(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source, duration="90.0")
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source, count=300, duration_ms=90_000)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source,
        tmp_path / "output",
        bundle(empty=True),
        # 영상 길이 밀리초의 호출 조건 지정
        duration_ms=90_000,
        # 종료 시각의 호출 조건 지정
        end_ms=500,
        # 음향 시험 입력의 호출 조건 지정
        audio_input=supplied,
    )
    # 기록 행 목록의 개수 값이 300인지 확인
    assert len([row for row in records(result) if row["kind"] == "AUDIO_CUE"]) == 300
    # 음향 단서 수 값이 300인지 확인
    assert result["audio"]["cueCount"] == 300
    # 음향 단서 목록의 개수 값이 256인지 확인
    assert len(result["audio"]["cues"]) == 256
    # 기록 잘림 여부 값이 참인지 확인
    assert result["audio"]["truncated"] is True
    # 판단 보류 이유에 지정한 항목 포함 확인
    assert "AUDIO_SUMMARY_TRUNCATED_RAW_PRESERVED" in result["audio"]["reasons"]
    # 처리 완료 상태 값이 처리 완료 상태인지 확인
    assert result["processingStatus"] == "COMPLETE"

# 산출물 생성 전 음향 구간의 영상 길이·탐색 범위 확인
@pytest.mark.parametrize("mutate", [
    lambda audio: audio["timeline"].update(scannedEndMs=501),
    lambda audio: audio["cues"][0].update(endMs=501),
    lambda audio: audio["timeline"].update(scannedStartMs=101),
    lambda audio: audio["timeline"].update(scannedEndMs=199),
])
def test_audio_intervals_must_fit_duration_and_scanned_range_before_artifact(tmp_path, mutate):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source)
    # 검사할 항목을 바꾼 시험 입력 실행
    mutate(supplied["observations"])
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle()
    # 출력 자료 준비
    output = tmp_path / "output"
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="AUDIO_INPUT_INVALID"):
        # 시험 프레임의 관측 결과 실행
        api().observations(source, output, models, duration_ms=500, audio_input=supplied)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not output.exists()
    # 호출 이력의 기대 자료 일치 확인
    assert models.detector.calls == models.role.calls == models.pose.calls == 0

# 음향 실패 시 완료된 시각 실행의 부분 상태 확인
@pytest.mark.parametrize("status", ["FAILED", "UNSUPPORTED"])
def test_audio_failure_makes_complete_visual_run_partial(tmp_path, status):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source, status=status, count=0)
    # 판단 보류 이유의 시험 항목 구성
    supplied["observations"]["reasons"] = [f"AUDIO_{status}"]
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source, tmp_path / "output", bundle(empty=True), duration_ms=500, audio_input=supplied
    )
    # 처리한 표본 수 값이 5인지 확인
    assert result["coverage"]["processedSamples"] == 5
    # 처리 완료 상태 값이 일부만 처리한 상태인지 확인
    assert result["processingStatus"] == "PARTIAL"
    # 판단 보류 이유에 지정한 항목 포함 확인
    assert f"AUDIO_{status}" in result["summary"]["reasons"]

# 음향 부재 시 완료된 시각 실행 상태 유지 확인
def test_absent_audio_does_not_make_complete_visual_run_partial(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source,
        tmp_path / "output",
        bundle(empty=True),
        # 영상 길이 밀리초의 호출 조건 지정
        duration_ms=500,
        # 음향 시험 입력의 호출 조건 지정
        audio_input=audio_input(source, status="ABSENT", count=0),
    )
    # 처리 완료 상태 값이 처리 완료 상태인지 확인
    assert result["processingStatus"] == "COMPLETE"
    # 처리 상태의 기대 자료 일치 확인
    assert result["audio"]["status"] == "ABSENT"

# 산출물·모델 실행 전 음향 원본 불일치 거부 확인
def test_wrong_audio_source_rejected_before_artifact_or_models(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source)
    # 원본 무결성 해시 준비
    supplied["observations"]["sourceSha256"] = "0" * 64
    # 검사에 필요한 시험 자료 묶음 생성
    models = bundle()
    # 출력 자료 준비
    output = tmp_path / "output"
    # 원본 일치 오류 발생 기대
    with pytest.raises(ValueError, match="AUDIO_SOURCE_MISMATCH"):
        # 시험 프레임의 관측 결과 실행
        api().observations(source, output, models, duration_ms=500, audio_input=supplied)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not output.exists()
    # 호출 이력의 기대 자료 일치 확인
    assert models.detector.calls == models.role.calls == models.pose.calls == 0

# 산출물 생성 전 잘못된 음향 입력 거부 확인
@pytest.mark.parametrize("mutate", [
    lambda value: value.pop("implementation"),
    lambda value: value["implementation"]["sourceFilesSha256"].pop("audio.py"),
    lambda value: value["observations"].update(cueCount=999),
    lambda value: value["observations"].update(speechStatus="TRANSCRIBED"),
])
def test_malformed_audio_input_rejected_before_artifact(tmp_path, mutate):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source)
    # 검사할 항목을 바꾼 시험 입력 실행
    mutate(supplied)
    # 출력 자료 준비
    output = tmp_path / "output"
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="AUDIO_INPUT_INVALID"):
        # 시험 프레임의 관측 결과 실행
        api().observations(source, output, bundle(), duration_ms=500, audio_input=supplied)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not output.exists()

# 음향 헤더의 알 수 없는 시간축 내용 복사 방지 확인
def test_audio_header_does_not_copy_unknown_timeline_payload(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source)
    # 큰 내부 시험 자료 준비
    supplied["observations"]["timeline"]["largeInternalPayload"] = ["x"] * 1000
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source, tmp_path / "output", bundle(empty=True), duration_ms=500, audio_input=supplied
    )
    # 원본 시간축에 지정한 항목 미포함 확인
    assert "largeInternalPayload" not in records(result)[0]["audio"]["timeline"]
    # 원본 시간축에 지정한 항목 미포함 확인
    assert "largeInternalPayload" not in result["audio"]["timeline"]

# 음수 음향 오프셋의 유효한 원본 시간축 인정 확인
def test_negative_audio_offset_is_valid_source_timeline_metadata(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source)
    # 원본 대비 음향 시각 차이 준비
    supplied["observations"]["timeline"]["audioOffsetMs"] = -50
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source, tmp_path / "output", bundle(empty=True), duration_ms=500, audio_input=supplied
    )
    # 원본 대비 음향 시각 차이의 기대 자료 일치 확인
    assert result["audio"]["timeline"]["audioOffsetMs"] == -50

# 늦은 시작점과 디코딩 프레임 없는 완료 음향 허용 확인
def test_complete_audio_with_late_origin_and_zero_decoded_frames_is_valid(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source, count=0)
    # 원본 시간축에 현재 입력 반영
    supplied["observations"]["timeline"].update(
        # 원본 대비 음향 시각 차이의 호출 조건 지정
        audioOffsetMs=600, scannedStartMs=500, scannedEndMs=500, decodedFrameCount=0
    )
    # 시험 프레임의 관측 결과 생성
    result = api().observations(
        source, tmp_path / "output", bundle(empty=True), duration_ms=500, audio_input=supplied
    )
    # 처리 완료 상태 값이 처리 완료 상태인지 확인
    assert result["processingStatus"] == "COMPLETE"
    # 음향 단서 수 값이 0인지 확인
    assert result["audio"]["cueCount"] == 0

# 산출물 생성 전 잘못된 음향 메타데이터 거부 확인
@pytest.mark.parametrize("field, value", [
    ("sourceSampleRateHz", -1), ("sourceChannels", 0),
    ("timeline", {"videoOriginSeconds": float("nan"), "audioOffsetMs": 0,
                  # 분석한 종료 시각의 시험값 지정
                  "scannedStartMs": 0, "scannedEndMs": 500,
                  # 단일 프레임 길이의 시험값 지정
                  "decodedFrameCount": 5, "frameDurationMs": 100,
                  # 시간 공백 처리 정책의 시험값 지정
                  "gapPolicy": "PRESERVED_WITH_SYNTHETIC_SILENCE"}),
])
def test_invalid_audio_metadata_rejected_before_artifact(tmp_path, field, value):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 디코더 검사용 합성 영상 실행
    video(source)
    # 원본 시간에 맞춘 음향 시험 입력 생성
    supplied = audio_input(source)
    # 인식 관측 목록의 선택 항목 준비
    supplied["observations"][field] = value
    # 출력 자료 준비
    output = tmp_path / "output"
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="AUDIO_INPUT_INVALID"):
        # 시험 프레임의 관측 결과 실행
        api().observations(source, output, bundle(), duration_ms=500, audio_input=supplied)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not output.exists()

# 음향 확장 전후 시각 관측 불변 확인
def test_audio_extension_does_not_change_visual_observations(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mkv"
    # 음향 확장 전후 시각 관측 불변 대상 동작 실행
    video_with_audio(source)
    # 시험 프레임의 관측 결과 생성
    old = api().observations(source, tmp_path / "old", bundle(), duration_ms=500)
    # 시험 프레임의 관측 결과 생성
    new = api().observations(
        source, tmp_path / "new", bundle(), duration_ms=500, audio_input=audio_input(source)
    )
    # 기록 형식 판본의 기대 자료 일치 확인
    assert old["schemaVersion"] == "perception-run-v1"
    # 파이프라인 판본의 기대 자료 일치 확인
    assert old["pipelineVersion"] == "video-local-observers-v1"
    # 변경 전 입력에 지정한 항목 미포함 확인
    assert "audio" not in old
    # 음향 확장 전후 시각 관측 불변 입력 목록의 항목별 순회
    for key in ("coverage", "models", "summary", "observations", "interactions", "links"):
        # 변경 후 입력의 선택 항목의 기대 자료 일치 확인
        assert new[key] == old[key]
    # 기록 행 목록의 기대 자료 일치 확인
    assert [row for row in records(new) if row["kind"] == "FRAME"] == [
        row for row in records(old) if row["kind"] == "FRAME"]

# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 격리 명령 실행 도구 읽음
import subprocess
# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 가벼운 모의 객체 생성 도구 읽음
from types import SimpleNamespace
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest

# 영상 모듈 반환
def media_module():
    # 영상 모듈의 실패 가능 구간 처리
    try:
        # 검사할 인식 구현 모듈 반환
        return importlib.import_module("replay_perception.media")
    except ModuleNotFoundError:
        # 영상 모듈의 금지 경로 실행 실패 처리
        pytest.fail("The source PTS reader is not implemented")

# 각 시간 값의 개별 시간 기준 사용 확인
def test_timestamp_uses_each_values_own_time_base():
    # 원본 시간축의 시각 값이 200인지 확인
    assert media_module().timestamp(45_000, Fraction(1, 90_000), 300, Fraction(1, 1_000)) == 200

# 잘못된 시각의 명목 프레임률 대체 방지 확인
@pytest.mark.parametrize("pts,base,origin,origin_base,reason", [
    (None, Fraction(1, 1000), 0, Fraction(1, 1000), "TIMELINE_PTS_MISSING"),
    (True, Fraction(1, 1000), 0, Fraction(1, 1000), "TIMELINE_PTS_MISSING"),
    (1, None, 0, Fraction(1, 1000), "TIMELINE_TIMEBASE_INVALID"),
    (1, Fraction(-1, 1000), 0, Fraction(1, 1000), "TIMELINE_TIMEBASE_INVALID"),
    (1, Fraction(1, 1000), None, Fraction(1, 1000), "TIMELINE_ORIGIN_MISSING"),
])
def test_invalid_timestamps_are_never_replaced_with_nominal_fps(
    pts, base, origin, origin_base, reason
):
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match=reason):
        # 원본 시간축의 시각 실행
        media_module().timestamp(pts, base, origin, origin_base)

# 첨부 이미지의 영상 선택 제외 확인
def test_attached_picture_is_not_selected_as_the_video():
    # 필요한 속성만 갖춘 모의 객체 생성
    picture = SimpleNamespace(index=0, type="video", disposition=1024)
    # 필요한 속성만 갖춘 모의 객체 생성
    audio = SimpleNamespace(index=1, type="audio", disposition=0)
    # 필요한 속성만 갖춘 모의 객체 생성
    video = SimpleNamespace(index=2, type="video", disposition=0)
    # 선택한 원본 영상 스트림의 기대 자료 일치 확인
    assert media_module().videoStream((picture, audio, video)) is video

# 첨부 이미지만 있는 입력의 영상 거부 확인
def test_attached_picture_alone_is_not_a_supported_video():
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="VIDEO_STREAM_ABSENT"):
        # 선택한 원본 영상 스트림 실행
        media_module().videoStream((SimpleNamespace(type="video", disposition=1024),))

# 시험 영상 생성
def make_video(path, *, offset=0):
    # 실행 명령의 시험 항목 구성
    command = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-n",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x48:r=10:d=1",
    ]
    # 앞선 표본 수의 조건에 따른 분기
    if offset:
        # 실행 명령에 시험 항목 추가
        command.extend(["-vf", f"settb=1/1000,setpts=PTS+{round(offset * 1000)}"])
    # 실행 명령에 시험 항목 추가
    command.extend(["-fps_mode", "passthrough", "-c:v", "ffv1", str(path)])
    # 시험 명령 실행 결과 생성
    result = subprocess.run(command, capture_output=True, text=True, timeout=20)
    # 외부 명령 종료 코드 값이 0인지 확인
    assert result.returncode == 0, result.stderr

# 실제 디코더의 원본 시각 오프셋 보존과 영상 상대 시간 표본화 확인
def test_real_decoder_preserves_offset_pts_and_samples_video_relative_time(tmp_path):
    # 실제 디코더의 원본 시각 오프셋 보존과 영상 상대 시간 표본화의 선택적 의존성 유무 확인
    pytest.importorskip("av")
    # 파일 경로 준비
    path = tmp_path / "offset.mkv"
    # 디코더 검사용 합성 영상 실행
    make_video(path, offset=.3)
    # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
    with media_module().VideoReader(path) as reader:
        # 영상 읽기 객체의 비교 자료 생성
        samples = list(reader)
        # 저장 계약에 맞춘 직렬화 자료 생성
        info = reader.as_record()
    # 밀리초 원본 시각 목록 값이 0 · 500인지 확인
    assert [sample.timestamp_ms for sample in samples] == [0, 500]
    # 원본 표시 시각 값이 300인지 확인
    assert samples[0].pts == 300
    # 원본 시간 단위의 기대 자료 일치 확인
    assert samples[0].time_base == Fraction(1, 1000)
    # 원본 시작 시각 값이 300인지 확인
    assert samples[0].origin_pts == 300
    # 원본 시각 시작점의 근거가 스트림 시작 시각인지 확인
    assert info["originSource"] == "STREAM_START_TIME"
    # 디코딩한 프레임 수 값이 10인지 확인
    assert info["decodedFrameCount"] == 10
    # 원본 표본 수 값이 2인지 확인
    assert info["sampleCount"] == 2
    # 영상 읽기가 파일 끝에 도달했는지 확인
    assert info["reachedEof"] is True
    # 배열 차원 값이 48 · 64 · 3인지 확인
    assert samples[0].rgb.shape == (48, 64, 3)
    # 빨간 원본 영상의 빨강 채널이 파랑 채널보다 큰지 확인
    assert samples[0].rgb[0, 0, 0] > samples[0].rgb[0, 0, 2]

# 원본 영상 시간 기준 구간과 끝점 제외 확인
@pytest.mark.parametrize(
    "end,expected_ms,expected_pts", [(800, [200, 700], [500, 1000]), (700, [200], [500])]
)
def test_requested_range_uses_original_video_time_and_excludes_end(
    tmp_path, end, expected_ms, expected_pts
):
    # 원본 영상 시간 기준 구간과 끝점 제외의 선택적 의존성 유무 확인
    pytest.importorskip("av")
    # 파일 경로 준비
    path = tmp_path / "range.mkv"
    # 디코더 검사용 합성 영상 실행
    make_video(path, offset=.3)
    # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
    with media_module().VideoReader(path, start_ms=200, end_ms=end) as reader:
        # 영상 읽기 객체의 비교 자료 생성
        samples = list(reader)
    # 밀리초 원본 시각 목록의 기대 자료 일치 확인
    assert [sample.timestamp_ms for sample in samples] == expected_ms
    # 원본 표시 시각 목록의 기대 자료 일치 확인
    assert [sample.pts for sample in samples] == expected_pts

# 잘못된 탐색 구간 거부 확인
@pytest.mark.parametrize(
    "start,end,interval",
    [
        (-1, None, 500),
        (True, None, 500),
        (500, 100, 500),
        (0, 0, 500),
        (0, None, 0),
        (0, None, True),
    ],
)
def test_invalid_scan_range_is_rejected(tmp_path, start, end, interval):
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="SCAN_RANGE_INVALID"):
        # 원본 표시 시각을 보존할 영상 읽기 객체 실행
        media_module().VideoReader(
            tmp_path / "video.mp4", start_ms=start, end_ms=end, interval_ms=interval
        )

# 잘못된 입력의 명시적 오류와 원본 보존 확인
def test_bad_input_is_an_explicit_error_and_original_is_unchanged(tmp_path):
    # 잘못된 입력의 명시적 오류와 원본 보존의 선택적 의존성 유무 확인
    pytest.importorskip("av")
    # 파일 경로 준비
    path = tmp_path / "broken.mp4"
    # 변경 전 자료 준비
    original = b"not a video"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(original)
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="VIDEO_OPEN_FAILED"):
        # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
        with media_module().VideoReader(path):
            # 추가 동작 없는 모의 구현 유지
            pass
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert path.read_bytes() == original

# 빈 요청 구간의 사람·공 부재 해석 방지 확인
def test_empty_requested_range_does_not_mean_no_people_or_ball(tmp_path):
    # 빈 요청 구간의 사람·공 부재 해석 방지의 선택적 의존성 유무 확인
    pytest.importorskip("av")
    # 파일 경로 준비
    path = tmp_path / "short.mkv"
    # 디코더 검사용 합성 영상 실행
    make_video(path)
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="NO_VIDEO_FRAMES_IN_RANGE"):
        # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
        with media_module().VideoReader(path, start_ms=2000) as reader:
            # 영상 읽기 객체의 비교 자료 실행
            list(reader)

# 가변 프레임 시각의 표본 일정 대체 방지 확인
def test_variable_frame_timestamps_are_not_replaced_by_sampling_schedule(tmp_path):
    # 가변 프레임 시각의 표본 일정 대체 방지의 선택적 의존성 유무 확인
    pytest.importorskip("av")
    # 파일 경로 준비
    path = tmp_path / "vfr.mkv"
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
            "color=c=red:s=64x48:r=10:d=1",
            "-vf",
            r"settb=1/1000,setpts=if(lt(N\,3)\,N*100\,N*100+300)",
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
    # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
    with media_module().VideoReader(path) as reader:
        # 영상 읽기 객체의 비교 자료 생성
        samples = list(reader)
    # 밀리초 원본 시각 목록 값이 0 · 600 · 1000인지 확인
    assert [sample.timestamp_ms for sample in samples] == [0, 600, 1000]
    # 선택한 표본의 디코딩 순번이 0 · 3 · 7인지 확인
    assert [sample.decoded_index for sample in samples] == [0, 3, 7]

# 실제 첨부 이미지 건너뜀 확인
def test_real_attached_picture_is_skipped(tmp_path):
    # 영상 디코더 의존성 준비
    av = pytest.importorskip("av")
    # 포함 영역 준비
    cover = tmp_path / "cover.png"
    # 시험 명령 실행 결과 생성
    picture = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x48",
            "-frames:v",
            "1",
            str(cover),
        ],
        capture_output=True,
        # 문자열 자료의 호출 조건 지정
        text=True,
        # 제한 시간의 호출 조건 지정
        timeout=20,
    )
    # 외부 명령 종료 코드 값이 0인지 확인
    assert picture.returncode == 0, picture.stderr
    # 파일 경로 준비
    path = tmp_path / "with-cover.mp4"
    # 시험 명령 실행 결과 생성
    encode = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-n",
            "-i",
            str(cover),
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x48:r=10:d=1",
            "-map",
            "0:v:0",
            "-map",
            "1:v:0",
            "-c:v:0",
            "png",
            "-disposition:v:0",
            "attached_pic",
            "-c:v:1",
            "libx264",
            str(path),
        ],
        capture_output=True,
        # 문자열 자료의 호출 조건 지정
        text=True,
        # 제한 시간의 호출 조건 지정
        timeout=20,
    )
    # 외부 명령 종료 코드 값이 0인지 확인
    assert encode.returncode == 0, encode.stderr
    # 파일 또는 연결 자원의 사용 구간 시작
    with av.open(str(path)) as container:
        # 부속 이미지 스트림의 조건별 항목 수집
        attached = {
            stream.index for stream in container.streams.video if int(stream.disposition) & 1024
        }
    # 부속 이미지 스트림의 조건 충족 확인
    assert attached
    # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
    with media_module().VideoReader(path) as reader:
        # 영상 읽기 객체의 비교 자료 생성
        samples = list(reader)
    # 부속 이미지 스트림에 영상 스트림 순번 미포함 확인
    assert reader.stream_index not in attached
    # 원본 표본 목록의 개수 값이 2인지 확인
    assert len(samples) == 2
    # 빨간 원본 영상의 빨강 채널이 파랑 채널보다 큰지 확인
    assert samples[0].rgb[0, 0, 0] > samples[0].rgb[0, 0, 2]

# 잘못된 디코더 시간축의 실패와 컨테이너 닫기 확인
@pytest.mark.parametrize(
    "timestamps,reason",
    [([0, None], "TIMELINE_PTS_MISSING"), ([500, 400], "TIMELINE_NON_MONOTONIC")],
)
def test_bad_decoder_timeline_fails_and_closes_container(tmp_path, monkeypatch, timestamps, reason):
    # 영상 디코더 의존성 준비
    av = pytest.importorskip("av")
    # 영상과 좌표의 수치 배열 도구 읽음
    import numpy as np
    # 파일 경로 준비
    path = tmp_path / "fake-decoder.media"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(b"test decoder input")
    # 필요한 속성만 갖춘 모의 객체 생성
    stream = SimpleNamespace(
        type="video",
        # 현재 순번의 호출 조건 지정
        index=0,
        disposition=0,
        start_time=0,
        # 원본 시간 단위의 호출 조건 지정
        time_base=Fraction(1, 1000),
        codec_context=SimpleNamespace(thread_count=0),
    )
    # 영상 프레임 목록의 조건별 항목 수집
    frames = [
        SimpleNamespace(
            # 원본 표시 시각의 호출 조건 지정
            pts=pts,
            # 원본 시간 단위의 호출 조건 지정
            time_base=Fraction(1, 1000),
            is_corrupt=False,
            # 영상 너비의 호출 조건 지정
            width=64,
            # 영상 높이의 호출 조건 지정
            height=48,
            to_ndarray=lambda **_: np.zeros((48, 64, 3), dtype=np.uint8),
        )
        for pts in timestamps
    ]
    # 자원 종료 여부의 빈 누적 공간 생성
    closed = []
    # 필요한 속성만 갖춘 모의 객체 생성
    container = SimpleNamespace(
        streams=[stream], decode=lambda _: iter(frames), close=lambda: closed.append(True)
    )
    # 파일 또는 연결 자원의 시험 대역 주입
    monkeypatch.setattr(av, "open", lambda *_args, **_kwargs: container)
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match=reason):
        # 원본 표시 시각을 보존할 영상 읽기 객체의 사용 구간 시작
        with media_module().VideoReader(path) as reader:
            # 영상 읽기 객체의 비교 자료 실행
            list(reader)
    # 자원 종료 여부 값이 참인지 확인
    assert closed == [True]

# 색상 변환 실패 표본의 전달 수 제외 확인
def test_failed_rgb_conversion_is_not_counted_as_a_delivered_sample(tmp_path, monkeypatch):
    # 영상 디코더 의존성 준비
    av = pytest.importorskip("av")
    # 파일 경로 준비
    path = tmp_path / "rgb-error.media"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(b"test decoder input")
    # 필요한 속성만 갖춘 모의 객체 생성
    stream = SimpleNamespace(
        type="video",
        # 현재 순번의 호출 조건 지정
        index=0,
        disposition=0,
        start_time=0,
        # 원본 시간 단위의 호출 조건 지정
        time_base=Fraction(1, 1000),
        codec_context=SimpleNamespace(thread_count=0),
    )

    # 색상 변환 실패 모사
    def fail_conversion(**_kwargs):
        # 색상 변환 실패 모사의 예외 상황 재현
        raise RuntimeError("conversion failed")
    # 필요한 속성만 갖춘 모의 객체 생성
    frame = SimpleNamespace(
        # 원본 표시 시각의 호출 조건 지정
        pts=0,
        # 원본 시간 단위의 호출 조건 지정
        time_base=Fraction(1, 1000),
        is_corrupt=False,
        # 영상 너비의 호출 조건 지정
        width=64,
        # 영상 높이의 호출 조건 지정
        height=48,
        to_ndarray=fail_conversion,
    )
    # 자원 종료 여부의 빈 누적 공간 생성
    closed = []
    # 필요한 속성만 갖춘 모의 객체 생성
    container = SimpleNamespace(
        streams=[stream], decode=lambda _: iter([frame]), close=lambda: closed.append(True)
    )
    # 파일 또는 연결 자원의 시험 대역 주입
    monkeypatch.setattr(av, "open", lambda *_args, **_kwargs: container)
    # 원본 표시 시각을 보존할 영상 읽기 객체 생성
    reader = media_module().VideoReader(path)
    # 실행 실패 발생 기대
    with pytest.raises(RuntimeError, match="conversion failed"):
        # 영상 읽기 객체의 사용 구간 시작
        with reader:
            # 영상 읽기 객체의 비교 자료 실행
            list(reader)
    # 원본 표본 수 값이 0인지 확인
    assert reader.as_record()["sampleCount"] == 0
    # 변환 실패로 첫 표본 시각이 기록되지 않았는지 확인
    assert reader.as_record()["firstSampleMs"] is None
    # 변환 실패로 마지막 표본 시각이 기록되지 않았는지 확인
    assert reader.as_record()["lastSampleMs"] is None
    # 자원 종료 여부 값이 참인지 확인
    assert closed == [True]

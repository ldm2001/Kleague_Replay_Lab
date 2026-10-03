from fractions import Fraction
import json
from pathlib import Path
import subprocess
from unittest.mock import Mock
import cv2
import numpy as np
import pytest
from replay_video.domain.models import Candidate, VideoMetadata
from replay_video.infrastructure.evidence import evidence, frame
import replay_video.infrastructure.frames as decoder

# 화면 밝기로 프레임 번호를 구별하는 실제 시험 영상 생성
def fixture(path: Path) -> None:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (64, 64))
    assert writer.isOpened()
    try:
        for index in range(10):
            writer.write(np.full((64, 64, 3), 20 + index * 20, dtype=np.uint8))
    finally:
        writer.release()

# 독립 검사기의 정수 프레임 시각과 영상 시간 원점 반환
def timeline(source: Path) -> tuple[Fraction, tuple[Fraction, ...]]:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
            "-show_streams", "-show_entries", "frame=pts:stream=start_pts,time_base",
            "-of", "json", str(source),
        ],
        capture_output=True,
        text=True,
        timeout=20,
        check=True,
    )
    data = json.loads(result.stdout)
    stream = data["streams"][0]
    scale = Fraction(stream["time_base"])
    origin = stream["start_pts"] * scale
    return origin, tuple(item["pts"] * scale for item in data["frames"])

# 독립 프레임 시각과 실제 저장 화면이 같은 단일 시점으로 기록되는지 확인
def test_evidence_uses_actual_decoded_pts(tmp_path):
    source = tmp_path / "synthetic.mp4"
    fixture(source)
    origin, timestamps = timeline(source)
    candidate = Candidate(0, "OTHER", 0, 500, 155, 0.5, "MEDIUM", (), (0,))
    metadata = VideoMetadata(source, 1000, 64, 64, 10.0, 10, "mpeg4")

    saved = evidence(source, tmp_path, metadata, (candidate,), max_clips=0)[0]

    pixel_mean = float(cv2.imread(str(saved.path)).mean())
    index = min(range(10), key=lambda value: abs(20 + value * 20 - pixel_mean))
    actual_ms = round((timestamps[index] - origin) * 1000)
    assert actual_ms == 200
    assert saved.timestamp_ms == actual_ms
    assert saved.start_ms == saved.end_ms == actual_ms
    assert (candidate.start_ms, candidate.end_ms, candidate.anchor_ms) == (0, 500, 155)

# 가변 프레임 간격과 영이 아닌 시간 원점에서도 실제 정수 PTS 반환 확인
@pytest.mark.parametrize("offset,variable,requested,expected", [
    (0, False, 155, 200),
    (5.3, False, 155, 200),
    (0, True, 255, 600),
    (5.3, True, 255, 600),
])
def test_frame_preserves_source_timeline(tmp_path, offset, variable, requested, expected):
    original = tmp_path / "original.mp4"
    source = tmp_path / "source.mkv"
    destination = tmp_path / "frame.jpg"
    fixture(original)
    filters = "select='lt(n,3)+gte(n,6)'," if variable else ""
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error", "-i", str(original),
            "-vf", f"{filters}setpts=PTS+{offset}/TB", "-fps_mode", "passthrough",
            "-c:v", "ffv1", str(source),
        ],
        capture_output=True,
        timeout=20,
        check=True,
    )
    origin, timestamps = timeline(source)
    target = origin + Fraction(requested, 1000)
    independent = next(timestamp for timestamp in timestamps if timestamp >= target)

    actual = frame(source, destination, requested)

    assert actual == round((independent - origin) * 1000) == expected
    image = cv2.imread(str(destination))
    assert image is not None
    assert abs(float(image.mean()) - (20 + expected // 100 * 20)) < 8

# 디코더 결과가 없거나 정수가 아닌 경우 요청 시각으로 대체하지 않는지 확인
@pytest.mark.parametrize("actual", [None, True, False, 155.0, "155", Mock()])
def test_evidence_rejects_invalid_frame_timestamp(tmp_path, monkeypatch, actual):
    source = tmp_path / "source.mp4"
    candidate = Candidate(0, "OTHER", 0, 500, 155, 0.5, "MEDIUM", (), (0,))
    metadata = VideoMetadata(source, 1000, 64, 64, 10.0, 10, "test")
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", lambda *_args: actual)

    with pytest.raises(RuntimeError, match="frame-timestamp-invalid"):
        evidence(source, tmp_path, metadata, (candidate,), max_clips=0)

# 실제 프레임 시각이 후보나 원본 경계를 벗어나면 명시적 오류 확인
@pytest.mark.parametrize("actual,start,end,duration", [
    (-1, 0, 500, 1000),
    (100, 120, 500, 1000),
    (501, 0, 500, 1000),
    (1100, 0, 1200, 1000),
    (154, 0, 500, 1000),
])
def test_evidence_rejects_out_of_bounds_pts(tmp_path, monkeypatch, actual, start, end, duration):
    source = tmp_path / "source.mp4"
    candidate = Candidate(0, "OTHER", start, end, 155, 0.5, "MEDIUM", (), (0,))
    metadata = VideoMetadata(source, duration, 64, 64, 10.0, 10, "test")
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", lambda *_args: actual)

    with pytest.raises(RuntimeError, match="frame-timestamp-out-of-bounds"):
        evidence(source, tmp_path, metadata, (candidate,), max_clips=0)

# 후보와 원본의 정수 밀리초 경계에 놓인 실제 시점 수용 확인
@pytest.mark.parametrize("start,end,anchor,duration", [
    (0, 200, 155, 200),
    (200, 500, 200, 500),
])
def test_evidence_accepts_inclusive_integer_bounds(
    tmp_path, monkeypatch, start, end, anchor, duration
):
    source = tmp_path / "source.mp4"
    candidate = Candidate(0, "OTHER", start, end, anchor, 0.5, "MEDIUM", (), (0,))
    metadata = VideoMetadata(source, duration, 64, 64, 10.0, 10, "test")
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", lambda *_args: 200)

    saved = evidence(source, tmp_path, metadata, (candidate,), max_clips=0)[0]

    assert (saved.timestamp_ms, saved.start_ms, saved.end_ms) == (200, 200, 200)
    assert (candidate.start_ms, candidate.end_ms, candidate.anchor_ms) == (start, end, anchor)

# 원본 PTS와 밝기 표식이 긴 탐색 뒤에도 일치하는지 확인
@pytest.mark.parametrize("offset", [0, 5.3])
def test_frame_seek_keeps_actual_pts_with_b_frames(tmp_path, offset):
    original = tmp_path / "original.mp4"
    source = tmp_path / "source.mkv"
    destination = tmp_path / "frame.jpg"
    fixture(original)
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error", "-stream_loop", "4",
            "-i", str(original), "-vf", f"setpts=PTS+{offset}/TB",
            "-c:v", "libx264", "-bf", "3", "-g", "20", "-fps_mode", "passthrough",
            str(source),
        ],
        capture_output=True,
        timeout=20,
        check=True,
    )
    origin, timestamps = timeline(source)
    target = origin + Fraction(3355, 1000)
    independent = next(timestamp for timestamp in timestamps if timestamp >= target)

    actual = frame(source, destination, 3355)

    assert actual == round((independent - origin) * 1000) == 3400
    assert abs(float(cv2.imread(str(destination)).mean()) - 100) < 8

# 디코더 경계 시험에 사용할 실제 영상 스트림 자료 반환
def stream() -> dict:
    return {"index": 2, "codec_type": "video", "start_pts": 5300, "time_base": "1/1000"}

# 같은 디코딩 실행의 시간 단위와 단일 정수 PTS 기록 반환
def log(pts="5500", scale="1/1000") -> str:
    return (
        f"[showinfo@evidence @ 0x1] [info] config in time_base: {scale}, frame_rate: 10/1\n"
        f"[showinfo@evidence @ 0x1] [info] n:   0 pts: {pts} pts_time:5.5 fmt:yuv420p\n"
    )

# 성공한 디코딩 대역과 호출 기록 반환
def setup(monkeypatch, *, details=None, output_log=None, content=True, code=0):
    monkeypatch.setattr(
        decoder, "mediaStreams", lambda _source: [stream()] if details is None else details
    )
    calls = []

    # 실제 JPEG 저장과 외부 디코더 결과 반환
    def process(command, **options):
        calls.append((command, options))
        if isinstance(content, bytes):
            Path(command[-1]).write_bytes(content)
        elif content:
            assert cv2.imwrite(command[-1], np.full((64, 64, 3), 60, dtype=np.uint8))
        return subprocess.CompletedProcess(
            command, code, "", log() if output_log is None else output_log
        )

    monkeypatch.setattr(decoder.subprocess, "run", process)
    return calls

# 첫 실제 영상 선택과 안전한 단일 프레임 디코딩 인자 확인
def test_frame_selects_video_and_binds_timestamp_to_decoder(tmp_path, monkeypatch):
    calls = setup(monkeypatch, details=[
        {"index": 0, "codec_type": "audio"},
        {"index": 1, "codec_type": "video", "disposition": {"attached_pic": 1}},
        stream(),
    ])
    destination = tmp_path / "frame.jpg"

    assert frame(tmp_path / "source.mkv", destination, 155) == 200

    assert destination.is_file()
    assert len(calls) == 1
    command, options = calls[0]
    assert command[command.index("-map") + 1] == "0:2"
    assert command[command.index("-vf") + 1] == (
        "trim=start_pts=5455,trim=end_frame=1,showinfo@evidence=checksum=0"
    )
    assert command[command.index("-frames:v") + 1] == "1"
    assert command[command.index("-fps_mode") + 1] == "passthrough"
    assert "-copyts" in command
    assert "-nostdin" in command
    assert "-xerror" in command
    assert "-nostats" in command
    assert "-r" not in command
    assert "-start_at_zero" not in command
    assert 0 < options["timeout"] <= 60
    assert not options.get("shell", False)
    assert str(destination) not in command
    assert not list(tmp_path.glob(".frame-*"))

# 누락되거나 잘못된 원점으로 요청 시각을 추정하지 않는지 확인
@pytest.mark.parametrize("field,value", [
    ("start_pts", None), ("start_pts", "N/A"), ("start_pts", True),
    ("start_pts", 0.5), ("start_pts", -(2 ** 63)),
    ("time_base", None), ("time_base", "0/1"), ("time_base", "1/0"),
    ("time_base", "nan"), ("time_base", "-1/1000"), ("time_base", True),
])
def test_frame_rejects_unknown_origin(tmp_path, monkeypatch, field, value):
    details = stream()
    if value is None:
        del details[field]
    else:
        details[field] = value
    calls = setup(monkeypatch, details=[details])

    with pytest.raises(RuntimeError, match="frame-timeline-origin-unavailable"):
        frame(tmp_path / "source.mp4", tmp_path / "frame.jpg", 155)

    assert calls == []

# 화면 표지뿐인 원본에서 실제 영상이 없음을 확인
def test_frame_rejects_cover_only_stream(tmp_path, monkeypatch):
    calls = setup(monkeypatch, details=[{
        "index": 0, "codec_type": "video", "disposition": {"attached_pic": 1},
    }])
    with pytest.raises(RuntimeError, match="video-stream-missing"):
        frame(tmp_path / "cover.mp4", tmp_path / "frame.jpg", 0)
    assert calls == []

# 디코더 PTS와 시간 단위의 누락 및 중복과 무효값을 명시적으로 거부하는지 확인
@pytest.mark.parametrize("output_log", [
    "", log("NOPTS"), log("N/A"), log("nan"), log(str(-(2 ** 63))),
    log(scale="0/1"), log(scale="1/0"), log(scale="-1/1000"),
    log().splitlines()[0], log().splitlines()[1], log() + log(),
    log().replace("pts: 5500", "pts: 5500.5"),
])
def test_frame_rejects_missing_or_ambiguous_decoder_pts(tmp_path, monkeypatch, output_log):
    setup(monkeypatch, output_log=output_log)
    destination = tmp_path / "frame.jpg"
    destination.write_bytes(b"existing evidence")

    with pytest.raises(RuntimeError, match="frame-timestamp-unavailable"):
        frame(tmp_path / "source.mp4", destination, 155)

    assert destination.read_bytes() == b"existing evidence"
    assert not list(tmp_path.glob(".frame-*"))

# 밀리초 반올림으로 요청 이전 PTS를 정당화하지 않는지 확인
def test_frame_rejects_pts_before_request_before_rounding(tmp_path, monkeypatch):
    setup(monkeypatch, output_log=log("54549", "1/10000"))
    with pytest.raises(RuntimeError, match="frame-timestamp-out-of-bounds"):
        frame(tmp_path / "source.mp4", tmp_path / "frame.jpg", 155)

# 시간 단위가 바뀌거나 원점이 커도 유리수 차이로 시각을 계산하는지 확인
def test_frame_uses_exact_origin_and_decoder_timebase(tmp_path, monkeypatch):
    details = {**stream(), "start_pts": 9007199254740993, "time_base": "1/90000"}
    setup(monkeypatch, details=[details], output_log=log("18014398509517986", "1/180000"))
    assert frame(tmp_path / "source.mp4", tmp_path / "frame.jpg", 155) == 200

# 영상 탐색 없이 영이 아닌 음수 원점을 정확히 정규화하는지 확인
def test_frame_accepts_negative_origin(tmp_path, monkeypatch):
    setup(monkeypatch, details=[{**stream(), "start_pts": -5300}], output_log=log("-5100"))
    assert frame(tmp_path / "source.mp4", tmp_path / "frame.jpg", 155) == 200

# 종료 코드와 오류 로그 및 빈 JPEG를 성공으로 바꾸지 않는지 확인
@pytest.mark.parametrize("code,output_log,content,error", [
    (1, "secret decoder path", True, "frame-decode-failed"),
    (0, log() + "[error] secret decoder path", True, "frame-decode-failed"),
    (0, log(), False, "frame-write-failed"),
    (0, log(), b"", "frame-write-failed"),
    (0, log(), b"not jpeg", "frame-write-failed"),
    (0, log(), b"\xff\xd8broken jpeg", "frame-write-failed"),
])
def test_frame_rejects_failed_output(tmp_path, monkeypatch, code, output_log, content, error):
    setup(monkeypatch, output_log=output_log, content=content, code=code)
    destination = tmp_path / "frame.jpg"
    destination.write_bytes(b"existing evidence")

    with pytest.raises(RuntimeError, match=error) as caught:
        frame(tmp_path / "source.mp4", destination, 155)

    assert "secret" not in str(caught.value)
    assert destination.read_bytes() == b"existing evidence"
    assert not list(tmp_path.glob(".frame-*"))

# 표지 속성이 비어 있는 실제 영상 스트림 선택 확인
def test_frame_accepts_video_without_disposition(tmp_path, monkeypatch):
    setup(monkeypatch, details=[{**stream(), "disposition": None}])
    assert frame(tmp_path / "source.mp4", tmp_path / "frame.jpg", 155) == 200

# 마지막 프레임 이후 요청에 기존 파일을 성공 산출물로 재사용하지 않는지 확인
def test_frame_rejects_request_after_last_decoded_frame(tmp_path):
    source = tmp_path / "source.mp4"
    destination = tmp_path / "frame.jpg"
    fixture(source)
    destination.write_bytes(b"existing evidence")

    # 도구 판본별 빈 출력 종료 상태와 무관하게 성공 산출물 거부 확인
    with pytest.raises(RuntimeError, match="frame-(timestamp-unavailable|decode-failed)"):
        frame(source, destination, 950)

    assert destination.read_bytes() == b"existing evidence"
    assert not list(tmp_path.glob(".frame-*"))

# 음수가 아닌 정수 이외의 요청을 디코더 실행 전에 거부하는지 확인
@pytest.mark.parametrize("requested", [None, True, -1, 155.0, "155"])
def test_frame_rejects_invalid_request(tmp_path, monkeypatch, requested):
    calls = setup(monkeypatch)
    with pytest.raises(ValueError, match="frame-request-invalid"):
        frame(tmp_path / "source.mp4", tmp_path / "frame.jpg", requested)
    assert calls == []

# 디코더 시간 초과 시 부분 파일 정리와 기존 증거 보존 확인
def test_frame_timeout_is_bounded_and_preserves_destination(tmp_path, monkeypatch):
    setup(monkeypatch)
    destination = tmp_path / "frame.jpg"
    destination.write_bytes(b"existing evidence")

    # 부분 JPEG를 만든 뒤 비밀 오류 출력을 포함한 시간 초과 발생
    def timeout(command, **options):
        assert 0 < options["timeout"] <= 60
        Path(command[-1]).write_bytes(b"partial")
        raise subprocess.TimeoutExpired(command, options["timeout"], stderr="secret")

    monkeypatch.setattr(decoder.subprocess, "run", timeout)
    with pytest.raises(RuntimeError, match="^frame-timeout$") as caught:
        frame(tmp_path / "source.mp4", destination, 155)

    assert caught.value.__suppress_context__
    assert destination.read_bytes() == b"existing evidence"
    assert not list(tmp_path.glob(".frame-*"))

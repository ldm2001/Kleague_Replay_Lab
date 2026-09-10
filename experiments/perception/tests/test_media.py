import importlib
import subprocess
from fractions import Fraction
from types import SimpleNamespace

import pytest


def media_module():
    try:
        return importlib.import_module("replay_perception.media")
    except ModuleNotFoundError:
        pytest.fail("The source PTS reader is not implemented")


def test_timestamp_uses_each_values_own_time_base():
    assert media_module().timestamp_ms(45_000, Fraction(1, 90_000), 300, Fraction(1, 1_000)) == 200


@pytest.mark.parametrize("pts,base,origin,origin_base,reason", [
    (None, Fraction(1, 1000), 0, Fraction(1, 1000), "TIMELINE_PTS_MISSING"),
    (True, Fraction(1, 1000), 0, Fraction(1, 1000), "TIMELINE_PTS_MISSING"),
    (1, None, 0, Fraction(1, 1000), "TIMELINE_TIMEBASE_INVALID"),
    (1, Fraction(-1, 1000), 0, Fraction(1, 1000), "TIMELINE_TIMEBASE_INVALID"),
    (1, Fraction(1, 1000), None, Fraction(1, 1000), "TIMELINE_ORIGIN_MISSING"),
])
def test_invalid_timestamps_are_never_replaced_with_nominal_fps(pts, base, origin, origin_base, reason):
    with pytest.raises(ValueError, match=reason):
        media_module().timestamp_ms(pts, base, origin, origin_base)


def test_attached_picture_is_not_selected_as_the_video():
    picture = SimpleNamespace(index=0, type="video", disposition=1024)
    audio = SimpleNamespace(index=1, type="audio", disposition=0)
    video = SimpleNamespace(index=2, type="video", disposition=0)
    assert media_module().select_video_stream((picture, audio, video)) is video


def test_attached_picture_alone_is_not_a_supported_video():
    with pytest.raises(ValueError, match="VIDEO_STREAM_ABSENT"):
        media_module().select_video_stream((SimpleNamespace(type="video", disposition=1024),))


def make_video(path, *, offset=0):
    command = ["ffmpeg", "-nostdin", "-v", "error", "-n", "-f", "lavfi", "-i", "color=c=red:s=64x48:r=10:d=1"]
    if offset:
        command.extend(["-vf", f"settb=1/1000,setpts=PTS+{round(offset * 1000)}"])
    command.extend(["-fps_mode", "passthrough", "-c:v", "ffv1", str(path)])
    result = subprocess.run(command, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr


def test_real_decoder_preserves_offset_pts_and_samples_video_relative_time(tmp_path):
    pytest.importorskip("av")
    path = tmp_path / "offset.mkv"
    make_video(path, offset=.3)
    with media_module().VideoReader(path) as reader:
        samples = list(reader)
        info = reader.as_record()
    assert [sample.timestamp_ms for sample in samples] == [0, 500]
    assert samples[0].pts == 300
    assert samples[0].time_base == Fraction(1, 1000)
    assert samples[0].origin_pts == 300
    assert info["originSource"] == "STREAM_START_TIME"
    assert info["decodedFrameCount"] == 10
    assert info["sampleCount"] == 2
    assert info["reachedEof"] is True
    assert samples[0].rgb.shape == (48, 64, 3)
    assert samples[0].rgb[0, 0, 0] > samples[0].rgb[0, 0, 2]


@pytest.mark.parametrize("end,expected_ms,expected_pts", [(800, [200, 700], [500, 1000]), (700, [200], [500])])
def test_requested_range_uses_original_video_time_and_excludes_end(tmp_path, end, expected_ms, expected_pts):
    pytest.importorskip("av")
    path = tmp_path / "range.mkv"
    make_video(path, offset=.3)
    with media_module().VideoReader(path, start_ms=200, end_ms=end) as reader:
        samples = list(reader)
    assert [sample.timestamp_ms for sample in samples] == expected_ms
    assert [sample.pts for sample in samples] == expected_pts


@pytest.mark.parametrize("start,end,interval", [(-1, None, 500), (True, None, 500), (500, 100, 500), (0, 0, 500), (0, None, 0), (0, None, True)])
def test_invalid_scan_range_is_rejected(tmp_path, start, end, interval):
    with pytest.raises(ValueError, match="SCAN_RANGE_INVALID"):
        media_module().VideoReader(tmp_path / "video.mp4", start_ms=start, end_ms=end, interval_ms=interval)


def test_bad_input_is_an_explicit_error_and_original_is_unchanged(tmp_path):
    pytest.importorskip("av")
    path = tmp_path / "broken.mp4"
    original = b"not a video"
    path.write_bytes(original)
    with pytest.raises(ValueError, match="VIDEO_OPEN_FAILED"):
        with media_module().VideoReader(path):
            pass
    assert path.read_bytes() == original


def test_empty_requested_range_does_not_mean_no_people_or_ball(tmp_path):
    pytest.importorskip("av")
    path = tmp_path / "short.mkv"
    make_video(path)
    with pytest.raises(ValueError, match="NO_VIDEO_FRAMES_IN_RANGE"):
        with media_module().VideoReader(path, start_ms=2000) as reader:
            list(reader)


def test_variable_frame_timestamps_are_not_replaced_by_sampling_schedule(tmp_path):
    pytest.importorskip("av")
    path = tmp_path / "vfr.mkv"
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-n", "-f", "lavfi", "-i", "color=c=red:s=64x48:r=10:d=1",
        "-vf", r"settb=1/1000,setpts=if(lt(N\,3)\,N*100\,N*100+300)",
        "-fps_mode", "passthrough", "-c:v", "ffv1", str(path),
    ], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    with media_module().VideoReader(path) as reader:
        samples = list(reader)
    assert [sample.timestamp_ms for sample in samples] == [0, 600, 1000]
    assert [sample.decoded_index for sample in samples] == [0, 3, 7]


def test_real_attached_picture_is_skipped(tmp_path):
    av = pytest.importorskip("av")
    cover = tmp_path / "cover.png"
    picture = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-n", "-f", "lavfi", "-i", "color=c=blue:s=64x48",
        "-frames:v", "1", str(cover),
    ], capture_output=True, text=True, timeout=20)
    assert picture.returncode == 0, picture.stderr
    path = tmp_path / "with-cover.mp4"
    encode = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-n", "-i", str(cover),
        "-f", "lavfi", "-i", "color=c=red:s=64x48:r=10:d=1", "-map", "0:v:0", "-map", "1:v:0",
        "-c:v:0", "png", "-disposition:v:0", "attached_pic", "-c:v:1", "libx264", str(path),
    ], capture_output=True, text=True, timeout=20)
    assert encode.returncode == 0, encode.stderr
    with av.open(str(path)) as container:
        attached = {stream.index for stream in container.streams.video if int(stream.disposition) & 1024}
    assert attached
    with media_module().VideoReader(path) as reader:
        samples = list(reader)
    assert reader.stream_index not in attached
    assert len(samples) == 2
    assert samples[0].rgb[0, 0, 0] > samples[0].rgb[0, 0, 2]


@pytest.mark.parametrize("timestamps,reason", [([0, None], "TIMELINE_PTS_MISSING"), ([500, 400], "TIMELINE_NON_MONOTONIC")])
def test_bad_decoder_timeline_fails_and_closes_container(tmp_path, monkeypatch, timestamps, reason):
    av = pytest.importorskip("av")
    import numpy as np
    path = tmp_path / "fake-decoder.media"
    path.write_bytes(b"test decoder input")
    stream = SimpleNamespace(type="video", index=0, disposition=0, start_time=0, time_base=Fraction(1, 1000), codec_context=SimpleNamespace(thread_count=0))
    frames = [SimpleNamespace(pts=pts, time_base=Fraction(1, 1000), is_corrupt=False, width=64, height=48, to_ndarray=lambda **_: np.zeros((48, 64, 3), dtype=np.uint8)) for pts in timestamps]
    closed = []
    container = SimpleNamespace(streams=[stream], decode=lambda _: iter(frames), close=lambda: closed.append(True))
    monkeypatch.setattr(av, "open", lambda *_args, **_kwargs: container)
    with pytest.raises(ValueError, match=reason):
        with media_module().VideoReader(path) as reader:
            list(reader)
    assert closed == [True]


def test_failed_rgb_conversion_is_not_counted_as_a_delivered_sample(tmp_path, monkeypatch):
    av = pytest.importorskip("av")
    path = tmp_path / "rgb-error.media"
    path.write_bytes(b"test decoder input")
    stream = SimpleNamespace(type="video", index=0, disposition=0, start_time=0, time_base=Fraction(1, 1000), codec_context=SimpleNamespace(thread_count=0))
    def fail_conversion(**_kwargs):
        raise RuntimeError("conversion failed")
    frame = SimpleNamespace(pts=0, time_base=Fraction(1, 1000), is_corrupt=False, width=64, height=48, to_ndarray=fail_conversion)
    closed = []
    container = SimpleNamespace(streams=[stream], decode=lambda _: iter([frame]), close=lambda: closed.append(True))
    monkeypatch.setattr(av, "open", lambda *_args, **_kwargs: container)
    reader = media_module().VideoReader(path)
    with pytest.raises(RuntimeError, match="conversion failed"):
        with reader:
            list(reader)
    assert reader.as_record()["sampleCount"] == 0
    assert reader.as_record()["firstSampleMs"] is None
    assert reader.as_record()["lastSampleMs"] is None
    assert closed == [True]

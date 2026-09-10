from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

import cv2
import numpy as np

from replay_perception.media import VideoSample
from replay_perception.models import Detection
from replay_perception.preview import render_preview
from replay_perception.report import ReportWriter


def sample(index: int, *, width: int = 2000, height: int = 1000) -> VideoSample:
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    return VideoSample(
        decoded_index=10 + index,
        stream_index=1,
        pts=3000 + index * 1000,
        time_base=Fraction(1, 1000),
        origin_pts=3000,
        origin_time_base=Fraction(1, 1000),
        timestamp_ms=index * 1000,
        rgb=rgb,
    )


def metadata(source):
    return {
        "source": {"path": str(source), "sha256": "1" * 64, "sizeBytes": 5},
        "model": {"id": "PekingU/rtdetr_r18vd"},
        "tracker": {"name": "ByteTrackTracker"},
        "settings": {"intervalMs": 500},
    }


def test_renderer_outputs_real_jpeg_with_declared_scaling_and_source_annotations():
    frame = sample(0)
    detection = Detection(0, "sports ball", (1000, 400, 1500, 800), 0.88, "0:sports ball:2")

    jpeg, record = render_preview(frame, (detection,), max_width=1280)
    raster = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)

    assert jpeg[:2] == b"\xff\xd8"
    assert raster.shape == (640, 1280, 3)
    assert record == {
        "decodedIndex": 10,
        "streamIndex": 1,
        "pts": 3000,
        "timeBase": {"numerator": 1, "denominator": 1000},
        "originPts": 3000,
        "originTimeBase": {"numerator": 1, "denominator": 1000},
        "timestampMs": 0,
        "timestampSource": "DECODER_PTS",
        "sourceWidth": 2000,
        "sourceHeight": 1000,
        "outputWidth": 1280,
        "outputHeight": 640,
        "outputScale": {"x": 0.64, "y": 0.64},
        "annotationCoordinateSpace": "SOURCE_XYXY_PIXELS",
    }
    # The source-space x=1000 box edge lands near x=640 only after the annotation is resized.
    edge_patch = raster[250:520, 636:645]
    assert int(edge_patch.max()) > 100


def test_untracked_annotation_includes_frame_local_detection_id(monkeypatch):
    labels = []
    original_put_text = cv2.putText

    def capture_text(image, text, *args, **kwargs):
        labels.append(text)
        return original_put_text(image, text, *args, **kwargs)

    monkeypatch.setattr(cv2, "putText", capture_text)
    detection = Detection(17, "sports ball", (40, 40, 80, 80), 0.88)

    render_preview(sample(0, width=160, height=90), (detection,))

    assert "d17 sports ball 0.88" in labels


def test_right_edge_annotation_shifts_full_label_inside_source_frame(monkeypatch):
    placements = []
    original_put_text = cv2.putText

    def capture_placement(image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs):
        placements.append((text, origin, font_face, font_scale, thickness))
        return original_put_text(
            image,
            text,
            origin,
            font_face,
            font_scale,
            color,
            thickness,
            *args,
            **kwargs,
        )

    monkeypatch.setattr(cv2, "putText", capture_placement)
    detection = Detection(17, "sports ball", (620, 100, 638, 130), 0.88, "0:sports ball:137")

    render_preview(sample(0, width=640, height=360), (detection,))

    text, origin, font_face, font_scale, thickness = next(
        placement for placement in placements if placement[0].startswith("d17 ")
    )
    (text_width, _), _ = cv2.getTextSize(text, font_face, font_scale, thickness)
    assert origin[0] >= 0
    assert origin[0] + text_width <= 640


def test_preview_selection_is_bounded_and_spans_first_to_last_frame(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with ReportWriter(output, **metadata(source), max_previews=4) as writer:
        for index in range(101):
            writer.append(sample(index, width=160, height=90), (), continuity_id=0, inference_seconds=0.001)
        summary = writer.finish("COMPLETE", video={"sampleCount": 101}, timings={"totalSeconds": 1.0})

    previews = summary["previews"]
    assert len(previews) <= 4
    assert previews[0]["timestampMs"] == 0
    assert previews[-1]["timestampMs"] == 100_000
    assert any(0 < preview["timestampMs"] < 100_000 for preview in previews)
    for preview in previews:
        relative = Path(preview["path"])
        assert not relative.is_absolute()
        assert relative.parts[0] == "frames"
        raster = cv2.imread(str(output / relative))
        assert raster is not None
        assert raster.shape[1] == preview["outputWidth"]
        assert raster.shape[0] == preview["outputHeight"]
    disk_previews = list((output / "frames").glob("*.jpg"))
    assert len(disk_previews) == len(previews)
    assert json.loads((output / "summary.json").read_text(encoding="utf-8"))["previews"] == previews


def test_concurrently_created_preview_is_not_overwritten(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with ReportWriter(output, **metadata(source), max_previews=2) as writer:
        writer.append(sample(0, width=160, height=90), (), continuity_id=0, inference_seconds=0.001)
        collision = output / "frames" / "preview-0000-frame-00000000.jpg"
        collision.write_bytes(b"existing-child")
        try:
            writer.finish("COMPLETE", video={}, timings={})
        except FileExistsError:
            pass
        else:
            raise AssertionError("exclusive preview creation was not enforced")

    assert collision.read_bytes() == b"existing-child"

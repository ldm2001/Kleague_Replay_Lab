from __future__ import annotations

from fractions import Fraction

import cv2
import numpy as np

from replay_perception.media import VideoSample
from replay_perception.models import Detection
from replay_perception.observation_preview import render_observation_preview
from replay_perception.observations import KEYPOINT_NAMES, Keypoint, PoseObservation, RoleHypothesis
from replay_perception.recorded_frames import RecordedFrame


def _frame(index: int = 0, *, width: int = 200, height: int = 120) -> RecordedFrame:
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    sample = VideoSample(
        decoded_index=10 + index,
        stream_index=1,
        pts=3000 + index * 1000,
        time_base=Fraction(1, 1000),
        origin_pts=3000,
        origin_time_base=Fraction(1, 1000),
        timestamp_ms=index * 1000,
        rgb=rgb,
    )
    return RecordedFrame(
        sample,
        (Detection(7, "person", (40, 45, 185, 116), 0.9, "0:person:long-fragment"),),
        continuity_id=2,
        record_index=20 + index,
    )


def _pose() -> PoseObservation:
    coordinates = {index: (80.0 + index, 75.0 + index) for index in range(17)}
    coordinates.update({5: (65.0, 75.0), 6: (175.0, 105.0), 7: (65.0, 60.0), 9: (65.0, 47.0)})
    points = tuple(
        Keypoint(index, name, *coordinates[index], 0.1 if index == 6 else 0.9)
        for index, name in enumerate(KEYPOINT_NAMES)
    )
    return PoseObservation(7, (40, 45, 185, 116), points, ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)))


def test_renderer_outputs_real_jpeg_with_exact_pts_scale_and_source_space_overlay():
    frame = _frame(width=2000, height=1000)
    original = frame.sample.rgb.copy()
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)

    jpeg, record = render_observation_preview(
        frame, (), (role,), (), ({"detectionId": 7, "side": "LEFT", "state": "ARM_RAISED"},),
        max_width=1280,
    )
    raster = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)

    assert jpeg[:2] == b"\xff\xd8"
    assert raster.shape == (640, 1280, 3)
    assert record["pts"] == 3000
    assert record["timeBase"] == {"numerator": 1, "denominator": 1000}
    assert record["originPts"] == 3000
    assert record["upstreamRecordIndex"] == 20
    assert record["sourceWidth"] == 2000
    assert record["sourceHeight"] == 1000
    assert record["outputWidth"] == 1280
    assert record["outputHeight"] == 640
    assert record["outputScale"] == {"x": 0.64, "y": 0.64}
    assert record["annotationCoordinateSpace"] == "SOURCE_XYXY_PIXELS"
    assert np.array_equal(frame.sample.rgb, original)
    # Source-space x=40 is drawn before resizing and lands near x=26.
    assert int(raster[25:90, 23:30].max()) > 50


def test_banner_role_label_track_fragment_and_raw_arm_state_are_explicit(monkeypatch):
    texts = []
    original_put_text = cv2.putText

    def capture(image, text, *args, **kwargs):
        texts.append(text)
        return original_put_text(image, text, *args, **kwargs)

    monkeypatch.setattr(cv2, "putText", capture)
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)
    render_observation_preview(
        _frame(), (), (role,), (_pose(),),
        ({"detectionId": 7, "side": "LEFT", "state": "ARM_RAISED"},),
    )

    assert any(text.startswith("NOT ADMITTED | ROLE/POSE HYPOTHESES") for text in texts)
    assert any("d7" in text and "hyp:referee" in text and "track-fragment=" in text for text in texts)
    assert not any(text.strip() == "referee" for text in texts)
    assert any("raw-arm LEFT=ARM_RAISED" in text for text in texts)


def test_joint_overlay_uses_source_coordinates_and_suppresses_low_score_points():
    frame = _frame()
    original = frame.sample.rgb.copy()
    jpeg, _ = render_observation_preview(frame, (), (), (_pose(),), ())
    raster = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)

    # High-score left shoulder at source (65,75) is annotated.
    assert int(raster[70:81, 60:71].max()) > 50
    # Low-score right shoulder at source (175,105) is suppressed; metadata stays in JSONL, not raster.
    assert int(raster[101:110, 171:180].max()) < 50
    assert np.array_equal(frame.sample.rgb, original)


def test_finite_out_of_image_keypoints_remain_metadata_not_preview_failures():
    pose = _pose()
    points = list(pose.keypoints)
    points[5] = Keypoint(5, KEYPOINT_NAMES[5], 1e300, -1e300, 0.9)
    outside = PoseObservation(
        pose.detection_id,
        pose.source_box,
        tuple(points),
        pose.source_to_input,
    )

    jpeg, _ = render_observation_preview(_frame(), (), (), (outside,), ())

    assert jpeg[:2] == b"\xff\xd8"
    assert outside.as_record()["keypoints"][5]["x"] == 1e300


def test_right_edge_role_label_is_measured_and_clamped(monkeypatch):
    placements = []
    original_put_text = cv2.putText

    def capture(image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs):
        placements.append((text, origin, font_face, font_scale, thickness))
        return original_put_text(
            image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs,
        )

    monkeypatch.setattr(cv2, "putText", capture)
    frame = _frame(width=200, height=120)
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)
    render_observation_preview(frame, (), (role,), (), ())

    text, origin, face, scale, thickness = next(item for item in placements if item[0].startswith("d7 "))
    (text_width, _), _ = cv2.getTextSize(text, face, scale, thickness)
    assert origin[0] >= 0
    assert origin[0] + text_width <= 200


def test_tiny_frame_text_is_fitted_with_glyph_height_and_baseline_or_skipped(monkeypatch):
    placements = []
    original_put_text = cv2.putText

    def capture(image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs):
        placements.append((text, origin, font_face, font_scale, thickness, image.shape[:2]))
        return original_put_text(
            image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs,
        )

    monkeypatch.setattr(cv2, "putText", capture)
    base = _frame(width=400, height=12)
    tiny = RecordedFrame(
        base.sample,
        (Detection(7, "person", (300, 1, 399, 11), 0.9, "0:person:tiny"),),
        base.continuity_id,
        base.record_index,
    )
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)

    render_observation_preview(tiny, (), (role,), (), ())

    assert placements
    for text, (x, y), face, scale, thickness, (height, width) in placements:
        (text_width, text_height), baseline = cv2.getTextSize(text, face, scale, thickness)
        assert 0 <= x and x + text_width <= width
        assert 0 <= y - text_height
        assert y + baseline <= height


def test_preview_omits_not_raised_clutter_but_keeps_actionable_raw_arm_states(monkeypatch):
    texts = []
    original_put_text = cv2.putText

    def capture(image, text, *args, **kwargs):
        texts.append(text)
        return original_put_text(image, text, *args, **kwargs)

    monkeypatch.setattr(cv2, "putText", capture)
    base = _frame()
    detections = base.detections + (
        Detection(9, "person", (5, 45, 35, 116), 0.8, "0:person:other"),
    )
    frame = RecordedFrame(base.sample, detections, base.continuity_id, base.record_index)
    arms = (
        {"detectionId": 7, "side": "LEFT", "state": "NOT_RAISED"},
        {"detectionId": 7, "side": "RIGHT", "state": "ARM_RAISED"},
        {"detectionId": 9, "side": "LEFT", "state": "UNOBSERVABLE"},
    )

    render_observation_preview(frame, (), (), (), arms)

    assert not any("NOT_RAISED" in text for text in texts)
    assert any("RIGHT=ARM_RAISED" in text for text in texts)
    assert any("LEFT=UNOBSERVABLE" in text for text in texts)


def test_preview_selection_is_bounded_at_24_and_spans_first_interior_last(tmp_path):
    from replay_perception.observation_report import ObservationReport

    source = tmp_path / "source"
    source.write_bytes(b"source")
    metadata = {
        "source": {"path": str(source), "sha256": "a" * 64},
        "upstream": {"summarySha256": "b" * 64, "framesJsonlSha256": "c" * 64},
        "models": {"role": {"id": "role"}, "pose": {"id": "pose"}},
        "settings": {"fixture": True},
    }
    output = tmp_path / "previews"
    with ObservationReport(output, **metadata, max_previews=24) as report:
        for index in range(101):
            report.append(_frame(index), (), (), (), (), (), {})
        summary = report.finish("COMPLETE", replay={"replayedFrameCount": 101}, timings={})

    previews = summary["previews"]
    assert len(previews) <= 24
    assert previews[0]["timestampMs"] == 0
    assert previews[-1]["timestampMs"] == 100_000
    assert any(0 < item["timestampMs"] < 100_000 for item in previews)
    assert len(list((output / "frames").glob("*.jpg"))) == len(previews)

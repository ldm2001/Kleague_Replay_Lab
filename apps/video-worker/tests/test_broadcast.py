import cv2
import numpy as np
import pytest

from replay_video.infrastructure.broadcast import BroadcastCueRecognizer, goal_graphic


def broadcast(text="GOAL", scale=1.0, band=True, origin=(88, 46), font=cv2.FONT_HERSHEY_DUPLEX):
    image = np.full((540, 960, 3), (45, 112, 48), dtype=np.uint8)
    if band:
        cv2.rectangle(image, (29, 22), (260, 50), (125, 53, 9), -1)
        cv2.rectangle(image, (190, 22), (260, 50), (20, 12, 175), -1)
        cv2.rectangle(image, (29, 51), (260, 68), (83, 20, 18), -1)
    cv2.putText(image, text, origin, font, 0.9, (250, 250, 250), 2, cv2.LINE_AA)
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


@pytest.mark.parametrize("scale", [1.0, 2.0, 1280 / 960])
@pytest.mark.parametrize("font", [cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_SIMPLEX])
def test_goal_letters_on_supported_scorebug_are_resolution_normalized(scale, font):
    assert goal_graphic(broadcast(scale=scale, font=font))


@pytest.mark.parametrize("text", ["", "2 2", "FOUL", "GOAT", "COAL", "6001", "GOALS", "GQAL", "G0AL", "GO4L", "GAOL"])
@pytest.mark.parametrize("font", [cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_SIMPLEX])
def test_colour_and_similar_words_are_not_goal_cues(text, font):
    assert not goal_graphic(broadcast(text, font=font))


def test_goal_text_without_broadcast_band_is_not_a_supported_cue():
    assert not goal_graphic(broadcast(band=False))


def test_goal_advertisement_outside_scorebug_is_not_a_supported_cue():
    assert not goal_graphic(broadcast(origin=(100, 410)))


def test_neighbouring_bold_glyphs_can_touch_without_becoming_arbitrary_text():
    image = broadcast("")
    for index, letter in enumerate("GOAL"):
        cv2.putText(image, letter, (88 + index * 17, 46), cv2.FONT_HERSHEY_DUPLEX,
                    0.9, (250, 250, 250), 2, cv2.LINE_AA)
    assert goal_graphic(image)


def test_goal_letters_need_the_navy_clock_strip_not_only_red_and_blue():
    image = broadcast()
    cv2.rectangle(image, (29, 51), (260, 68), (45, 112, 48), -1)
    assert not goal_graphic(image)


@pytest.mark.parametrize("frame", [np.zeros((10, 10, 3), np.uint8), np.zeros((540, 960), np.uint8), np.zeros((960, 540, 3), np.uint8)])
def test_unsupported_frame_geometry_is_not_a_goal_graphic(frame):
    assert not goal_graphic(frame)


def test_single_frame_flash_does_not_confirm_a_cue():
    detector = BroadcastCueRecognizer()
    assert detector.update(broadcast(), 1000, 0) is None
    assert detector.update(broadcast("2 2"), 1500, 0) is None
    assert detector.update(broadcast("2 2"), 3500, 0) is None
    assert detector.finish() is None


def test_repeated_glyph_observations_emit_once_without_claiming_a_goal_or_var():
    detector = BroadcastCueRecognizer()
    events = [detector.update(broadcast(), timestamp, 0) for timestamp in [1000, 1500, 2000, 3000]]
    events = [event for event in events if event is not None]
    assert events == [{
        "kind": "GOAL_GRAPHIC",
        "method": "broadcast-goal-glyphs-v1",
        "startMs": 1000,
        "endMs": 1500,
        "evidenceTimestampsMs": [1000, 1500],
    }]
    assert detector.finish() is None


def test_duplicate_or_nearby_timestamps_do_not_supply_temporal_confirmation():
    detector = BroadcastCueRecognizer()
    for timestamp in [1000, 1000, 1001, 1067]:
        assert detector.update(broadcast(), timestamp, 0) is None


def test_shot_cut_does_not_join_single_unconfirmed_observations():
    detector = BroadcastCueRecognizer()
    assert detector.update(broadcast(), 1000, 0) is None
    assert detector.update(broadcast(), 1500, 1) is None
    assert detector.update(broadcast(), 2000, 1) is not None


def test_confirmed_overlay_surviving_shot_cut_is_not_duplicated():
    detector = BroadcastCueRecognizer()
    detector.update(broadcast(), 1000, 0)
    assert detector.update(broadcast(), 1500, 0) is not None
    assert detector.update(broadcast(), 2000, 1) is None
    assert detector.update(broadcast(), 2500, 1) is None


def test_brief_occlusion_does_not_rearm_but_two_seconds_absence_does():
    detector = BroadcastCueRecognizer()
    detector.update(broadcast(), 1000, 0)
    assert detector.update(broadcast(), 1500, 0) is not None
    assert detector.update(broadcast("2 2"), 2000, 0) is None
    assert detector.update(broadcast(), 2500, 0) is None
    assert detector.update(broadcast("2 2"), 3000, 0) is None
    assert detector.update(broadcast("2 2"), 5000, 0) is None
    assert detector.update(broadcast(), 5500, 0) is None
    assert detector.update(broadcast(), 6000, 0) is not None


def test_long_unsampled_gap_does_not_confirm_an_unobserved_interval():
    detector = BroadcastCueRecognizer()
    assert detector.update(broadcast(), 1000, 0) is None
    assert detector.update(broadcast(), 5000, 0) is None


def test_moving_text_cannot_confirm_a_stable_broadcast_overlay():
    detector = BroadcastCueRecognizer()
    assert detector.update(broadcast(), 1000, 0) is None
    assert detector.update(broadcast(origin=(135, 46)), 1500, 0) is None


def test_resolution_change_preserves_normalized_stable_glyph_positions():
    detector = BroadcastCueRecognizer()
    assert detector.update(broadcast(), 1000, 0) is None
    assert detector.update(broadcast(scale=2), 1500, 0) is not None

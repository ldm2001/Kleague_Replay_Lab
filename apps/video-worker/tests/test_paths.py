import pytest

from replay_video.domain.ball import BallCandidate
from replay_video.domain.paths import BallPaths
from replay_video.application.track import CandidateTracker


def p(x, y=50):
    return BallCandidate(x, y, 4, 0.8)


def test_selects_supported_path_while_transient_candidates_appear():
    paths = BallPaths()
    for frame in range(5):
        result = paths.update(frame * 100, 0, 640, 360, (p(100 + frame * 4), p(400 + frame * 40)))
    assert result.candidate is not None
    assert result.candidate.x == 116
    assert result.support >= 3


def test_equal_supported_paths_remain_ambiguous():
    paths = BallPaths()
    for frame in range(6):
        result = paths.update(frame * 100, 0, 640, 360, (p(100 + frame * 4), p(400 + frame * 4)))
    assert result.candidate is None
    assert result.reason == "AMBIGUOUS_PATHS"


def test_no_observed_coordinate_is_returned_for_an_occluded_frame():
    paths = BallPaths()
    for frame in range(4):
        result = paths.update(frame * 100, 0, 640, 360, (p(100 + frame * 4),))
    identifier = result.track_id
    assert paths.update(400, 0, 640, 360, ()).candidate is None
    assert paths.update(500, 0, 640, 360, (p(120),)).track_id == identifier


@pytest.mark.parametrize("time, scene", [(1000, 0), (400, 1)])
def test_gap_and_cut_drop_old_support(time, scene):
    paths = BallPaths()
    for frame in range(4):
        paths.update(frame * 100, 0, 640, 360, (p(100),))
    assert paths.update(time, scene, 640, 360, (p(100),)).candidate is None


def test_ambiguous_association_does_not_select_by_input_order():
    for alternatives in ((p(98), p(102)), (p(102), p(98))):
        paths = BallPaths()
        for frame in range(4):
            paths.update(frame * 100, 0, 640, 360, (p(100),))
        assert paths.update(400, 0, 640, 360, alternatives).candidate is None


def test_position_path_survives_camera_failure_without_motion_claim():
    tracker = CandidateTracker()
    for frame in range(10):
        selection, motion = tracker.update(frame * 100, 0, 640, 360, (p(100 + frame * 4),), None)
        assert motion.motion_onset_ms is None
        assert motion.compensated_displacement_px is None
    assert selection.candidate is not None
    assert motion.candidate == selection.candidate


def test_motion_requires_stationary_history_after_path_acquisition():
    tracker = CandidateTracker()
    for frame in range(12):
        tracker.update(frame * 100, 0, 640, 360, (p(100),), (1, 0, 0, 0, 1, 0))
    _, first = tracker.update(1200, 0, 640, 360, (p(104),), (1, 0, 0, 0, 1, 0))
    _, second = tracker.update(1300, 0, 640, 360, (p(108),), (1, 0, 0, 0, 1, 0))
    assert first.motion_onset_ms is None
    assert second.motion_onset_ms == 1200

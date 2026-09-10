import importlib

import numpy as np
import pytest


def continuity():
    try:
        return importlib.import_module("replay_perception.continuity").AppearanceContinuity()
    except ModuleNotFoundError:
        pytest.fail("The sampled appearance boundary is not implemented")


def test_same_appearance_keeps_context_but_a_large_change_resets_it():
    value = continuity()
    black = np.zeros((48, 64, 3), dtype=np.uint8)
    white = np.full_like(black, 255)
    assert value.update(black) == 0
    assert value.update(black) == 0
    assert value.update(white) == 1
    assert value.update(white) == 1
    assert value.boundary_count == 1
    assert value.provenance["method"] == "sampled-appearance-delta-v1"


def test_small_brightness_change_does_not_claim_a_cut():
    value = continuity()
    assert value.update(np.full((48, 64, 3), 100, dtype=np.uint8)) == 0
    assert value.update(np.full((48, 64, 3), 110, dtype=np.uint8)) == 0


def test_source_resolution_change_resets_pixel_tracks_even_if_colours_match():
    value = continuity()
    assert value.update(np.zeros((48, 64, 3), dtype=np.uint8)) == 0
    assert value.update(np.zeros((96, 128, 3), dtype=np.uint8)) == 1


@pytest.mark.parametrize("bad", [np.zeros((1, 1)), np.zeros((0, 5, 3), dtype=np.uint8), np.zeros((5, 5, 4), dtype=np.uint8), np.zeros((5, 5, 3), dtype=np.float32), None])
def test_invalid_frame_does_not_mutate_context(bad):
    value = continuity()
    frame = np.zeros((48, 64, 3), dtype=np.uint8)
    assert value.update(frame) == 0
    with pytest.raises(ValueError, match="FRAME_INVALID"):
        value.update(bad)
    assert value.update(frame) == 0

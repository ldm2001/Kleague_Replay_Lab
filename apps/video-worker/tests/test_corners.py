import cv2
import numpy as np

from replay_video.infrastructure.corners import CornerRecognizer, corner_geometry


def field(ball=None, pole=True):
    image = np.full((540, 960, 3), (45, 35, 35), dtype=np.uint8)
    cv2.fillConvexPoly(image, np.array([(20, 170), (850, 350), (20, 530)]), (35, 115, 45))
    cv2.line(image, (20, 170), (850, 350), (230, 230, 230), 3)
    cv2.line(image, (20, 530), (850, 350), (230, 230, 230), 3)
    if pole:
        cv2.line(image, (854, 317), (854, 350), (20, 240, 200), 3)
    if ball:
        cv2.circle(image, ball, 4, (240, 240, 240), -1)
    return image


def test_geometry_requires_boundary_and_pole():
    geometry = corner_geometry(field())
    assert geometry is not None
    assert abs(geometry.x - 850) < 12
    assert corner_geometry(field(pole=False)) is None


def test_yellow_person_away_from_boundary_intersection_is_not_corner_pole():
    image = field(pole=False)
    cv2.line(image, (820, 325), (820, 355), (20, 240, 200), 3)
    assert corner_geometry(image) is None


def test_steep_goal_frame_is_not_a_pair_of_supported_pitch_boundaries():
    image = np.full((540, 960, 3), (45, 35, 35), dtype=np.uint8)
    cv2.rectangle(image, (0, 350), (550, 539), (35, 115, 45), -1)
    cv2.fillConvexPoly(image, np.array([(684, 319), (950, 362), (750, 503)]), (35, 115, 45))
    cv2.line(image, (684, 319), (950, 362), (230, 230, 230), 3)
    cv2.line(image, (684, 319), (750, 503), (230, 230, 230), 3)
    cv2.line(image, (680, 286), (680, 319), (20, 240, 200), 3)
    assert corner_geometry(image) is None


def test_stationary_spare_ball_does_not_create_a_corner_event():
    detector = CornerRecognizer()
    for frame in range(12):
        assert detector.update(field((800, 340)), frame * 67, 0) is None


def test_corner_departure_connects_real_state_machine():
    detector = CornerRecognizer()
    events = []
    for frame in range(12):
        ball = (820, 337) if frame < 5 else (820 - (frame - 4) * 35, 337 - (frame - 4) * 8)
        event = detector.update(field(ball), frame * 67, 0)
        if event:
            events.append(event)
    assert len(events) == 1
    assert events[0]["kind"] == "CORNER_KICK"
    assert events[0]["status"] == "OBSERVED"
    assert events[0]["startMs"] < events[0]["restartMs"] < events[0]["endMs"]


def test_long_continuous_preparation_does_not_become_an_observation_gap():
    detector = CornerRecognizer()
    events = []
    for frame in range(82):
        ball = (820, 337) if frame < 75 else (820 - (frame - 74) * 35, 337 - (frame - 74) * 8)
        event = detector.update(field(ball), frame * 67, 0)
        if event:
            events.append(event)
    assert len(events) == 1
    assert events[0]["startMs"] == 0
    assert events[0]["restartMs"] > 5000


def test_moving_ball_without_corner_geometry_has_no_event():
    detector = CornerRecognizer()
    for frame in range(12):
        assert detector.update(field((800 - frame * 35, 330 - frame * 8), pole=False), frame * 67, 0) is None


def test_camera_pan_of_static_corner_is_not_a_kick():
    detector = CornerRecognizer()
    image = field((800, 340))
    for frame in range(12):
        moved = cv2.warpAffine(image, np.float32([[1, 0, frame * 2], [0, 1, 0]]), (960, 540))
        assert detector.update(moved, frame * 67, 0) is None


def test_cut_does_not_connect_preparation_to_unrelated_flight():
    detector = CornerRecognizer()
    for frame in range(5):
        assert detector.update(field((820, 337)), frame * 67, 0) is None
    for frame in range(5, 9):
        assert detector.update(field((820 - (frame - 4) * 35, 337 - (frame - 4) * 8)), frame * 67, 1) is None

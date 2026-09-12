import importlib

import pytest

from replay_perception.models import Detection
from replay_perception.observations import RoleDetection


def assign(*args):
    return importlib.import_module("replay_perception.role_matching").assign_roles(*args)


def person(identifier=1, box=(10, 20, 30, 100)):
    return Detection(identifier, "person", box, .9, f"1:1:person:{identifier}")


def test_matching_preserves_raw_person_box_score_and_unproven_role():
    source = person()
    before = source.as_record()
    result = assign((source,), (RoleDetection(8, "referee", source.box, .7),))
    assert result[0].as_record()["role"] == "referee"
    assert result[0].role_detection_id == 8
    assert result[0].score == .7
    assert result[0].iou == 1.
    assert source.as_record() == before
    assert source.as_record()["actorRole"] == "UNPROVEN"


def test_matching_keeps_original_person_order_and_excludes_raw_ball():
    second = person(20, (100, 20, 120, 100))
    ball = Detection(99, "sports ball", (0, 0, 2, 2), .8)
    result = assign((second, ball, person(1)), (
        RoleDetection(0, "referee", person().box, .8),
        RoleDetection(3, "player", second.box, .9),
        RoleDetection(9, "ball", ball.box, .9),
    ))
    assert tuple(item.detection_id for item in result) == (20, 1)
    assert tuple(item.role for item in result) == ("player", "referee")


@pytest.mark.parametrize("roles", [
    (), (RoleDetection(0, "referee", (200, 20, 220, 100), .9),),
    (RoleDetection(0, "referee", (10, 20, 30, 100), .499),),
    (RoleDetection(0, "ball", (10, 20, 30, 100), .9),),
])
def test_missing_low_score_wrong_place_or_ball_role_stays_unknown(roles):
    result = assign((person(),), roles)
    assert result[0].status == "UNMATCHED"
    assert result[0].role is None


def test_equal_roles_on_one_person_are_ambiguous():
    result = assign((person(),), (
        RoleDetection(0, "referee", person().box, .99),
        RoleDetection(1, "goalkeeper", person().box, .7),
    ))
    assert result[0].status == "AMBIGUOUS"
    assert result[0].role is None


def test_two_duplicate_people_cannot_share_one_role_detection():
    result = assign((person(1), person(2)), (RoleDetection(0, "referee", person().box, .9),))
    assert tuple(item.status for item in result) == ("AMBIGUOUS", "AMBIGUOUS")


def test_best_role_candidate_requires_minimum_overlap_margin():
    result = assign((person(),), (
        RoleDetection(0, "referee", person().box, .9),
        RoleDetection(1, "player", (10, 20, 30, 104), .9),
    ))
    assert result[0].status == "AMBIGUOUS"


def test_unique_best_match_uses_role_at_exact_score_boundary():
    result = assign((person(),), (
        RoleDetection(0, "referee", person().box, .5),
        RoleDetection(1, "player", (15, 20, 35, 100), .9),
    ))
    assert result[0].status == "MATCHED"
    assert result[0].role == "referee"


def test_exact_iou_boundary_is_allowed():
    result = assign((person(),), (RoleDetection(0, "referee", (10, 20, 30, 180), .8),))
    assert result[0].status == "MATCHED"
    assert result[0].iou == pytest.approx(.5)


def test_empty_people_produces_no_hypotheses():
    assert assign((), ()) == ()


@pytest.mark.parametrize("case", ["people", "roles", "wrong_person_type", "wrong_role_type"])
def test_duplicate_ids_and_invalid_types_are_rejected(case):
    people = (person(),)
    roles = (RoleDetection(0, "referee", person().box, .9),)
    if case == "people":
        people = (person(), person())
    elif case == "roles":
        roles = roles + roles
    elif case == "wrong_person_type":
        people = (object(),)
    else:
        roles = (object(),)
    with pytest.raises(ValueError):
        assign(people, roles)


def test_iou_does_not_overflow_finite_boxes():
    source = person(box=(0, 0, 1e200, 1e200))
    result = assign((source,), (RoleDetection(0, "referee", source.box, .9),))
    assert result[0].iou == 1.


@pytest.mark.parametrize("box", [(0, 0, 1e-200, 1e200), (0, 0, 1e200, 1e-200)])
def test_identical_anisotropic_boxes_keep_iou_one(box):
    source = person(box=box)
    result = assign((source,), (RoleDetection(0, "referee", source.box, .9),))
    assert result[0].status == "MATCHED"
    assert result[0].iou == 1.

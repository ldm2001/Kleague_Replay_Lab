from __future__ import annotations

from .models import Detection
from .observations import RoleDetection, RoleHypothesis


MIN_ROLE_SCORE = 0.50
MIN_IOU = 0.50
MIN_IOU_MARGIN = 0.10


def _iou(first: tuple[float, ...], second: tuple[float, ...]) -> float:
    scale_x = max(first[0], first[2], second[0], second[2])
    scale_y = max(first[1], first[3], second[1], second[3])
    a = tuple(value / (scale_x if index % 2 == 0 else scale_y) for index, value in enumerate(first))
    b = tuple(value / (scale_x if index % 2 == 0 else scale_y) for index, value in enumerate(second))
    intersection = max(0., min(a[2], b[2]) - max(a[0], b[0])) * max(0., min(a[3], b[3]) - max(a[1], b[1]))
    first_area = (a[2] - a[0]) * (a[3] - a[1])
    second_area = (b[2] - b[0]) * (b[3] - b[1])
    union = first_area + second_area - intersection
    return min(1., intersection / union) if union > 0 else 0.


def _best(values: list[float]) -> tuple[int, float, float]:
    ordered = sorted(enumerate(values), key=lambda pair: (-pair[1], pair[0]))
    index, score = ordered[0]
    runner_up = ordered[1][1] if len(ordered) > 1 else 0.
    return index, score, score - runner_up


def assign_roles(detections: tuple[Detection, ...], roles: tuple[RoleDetection, ...]) -> tuple[RoleHypothesis, ...]:
    if (not isinstance(detections, tuple) or not isinstance(roles, tuple)
            or any(not isinstance(item, Detection) for item in detections)
            or any(not isinstance(item, RoleDetection) for item in roles)):
        raise ValueError("ROLE_MATCH_INPUT_INVALID")
    if len({item.detection_id for item in detections}) != len(detections):
        raise ValueError("ROLE_MATCH_DUPLICATE_SOURCE_ID")
    if len({item.role_detection_id for item in roles}) != len(roles):
        raise ValueError("ROLE_MATCH_DUPLICATE_ROLE_ID")
    people = tuple(item for item in detections if item.label == "person")
    candidates = tuple(item for item in roles if item.role != "ball" and item.score >= MIN_ROLE_SCORE)
    if not people:
        return ()
    if not candidates:
        return tuple(RoleHypothesis(person.detection_id, "UNMATCHED") for person in people)

    overlaps = [[_iou(person.box, role.box) for role in candidates] for person in people]
    reverse = [_best([row[index] for row in overlaps]) for index in range(len(candidates))]
    result = []
    for source_index, person in enumerate(people):
        role_index, overlap, margin = _best(overlaps[source_index])
        if overlap + 1e-12 < MIN_IOU:
            result.append(RoleHypothesis(person.detection_id, "UNMATCHED"))
            continue
        best_source, _, reverse_margin = reverse[role_index]
        if (best_source != source_index or margin + 1e-12 < MIN_IOU_MARGIN
                or reverse_margin + 1e-12 < MIN_IOU_MARGIN):
            result.append(RoleHypothesis(person.detection_id, "AMBIGUOUS"))
            continue
        role = candidates[role_index]
        result.append(RoleHypothesis(person.detection_id, "MATCHED", role.role, role.score,
                                     role.role_detection_id, overlap))
    return tuple(result)

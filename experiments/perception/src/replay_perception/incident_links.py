from __future__ import annotations

from dataclasses import dataclass
from copy import copy
from enum import Enum
from fractions import Fraction
from hashlib import sha256
from itertools import combinations
import json
from math import hypot, isfinite
from typing import Any

from .media import timestamp_ms
from .observations import RoleHypothesis
from .recorded_frames import RecordedFrame


MAX_GAP_MS = 250
MAX_LINK_DELAY_MS = 3000


class DecisionPhase(str, Enum):
    UNKNOWN = "UNKNOWN"
    INITIAL = "INITIAL"
    REVISED = "REVISED"
    FINAL = "FINAL"


@dataclass(frozen=True, slots=True)
class ContactObservation:
    # Image proximity supplies no measurement of contact, part or intensity.
    state: str = "UNVERIFIED"


@dataclass(frozen=True, slots=True)
class OriginalDecisionObservation:
    # No approved signal-meaning producer currently supplies a declared value.
    phase: DecisionPhase = DecisionPhase.UNKNOWN
    value: str | None = None
    independent_evidence_ids: tuple[str, ...] = ()

    def as_record(self) -> dict[str, Any]:
        return {"phase": self.phase.value, "value": self.value,
                "independentEvidenceIds": list(self.independent_evidence_ids)}


@dataclass(frozen=True, slots=True)
class RestartObservation:
    state: str = "UNVERIFIED"
    kind: str | None = None

    def as_record(self) -> dict[str, Any]:
        return {"state": self.state, "kind": self.kind}


def _identifier(kind: str, value: object) -> str:
    digest = sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    return f"{kind}-{digest}"


class _Timeline:
    def __init__(self) -> None:
        self.last_ms: int | None = None
        self.last_time: Fraction | None = None
        self.continuity_id: int | None = None
        self.source = None

    def advance(self, frame: RecordedFrame) -> bool:
        sample = frame.sample
        relative_time = sample.pts * sample.time_base - sample.origin_pts * sample.origin_time_base
        if sample.timestamp_ms != timestamp_ms(sample.pts, sample.time_base, sample.origin_pts, sample.origin_time_base):
            raise ValueError("FRAME_TIMESTAMP_PTS_MISMATCH")
        source = (sample.stream_index, sample.origin_pts, sample.origin_time_base)
        if self.source is not None and source != self.source:
            raise ValueError("SOURCE_SCOPE_CHANGED")
        if self.last_ms is not None and sample.timestamp_ms <= self.last_ms:
            raise ValueError("TIMELINE_NON_MONOTONIC")
        boundary = (self.continuity_id != frame.continuity_id
                    or (self.last_time is not None
                        and relative_time - self.last_time > Fraction(MAX_GAP_MS, 1000)))
        self.last_ms, self.continuity_id, self.source = sample.timestamp_ms, frame.continuity_id, source
        self.last_time = relative_time
        return boundary


class InteractionTracker:
    def __init__(self) -> None:
        self._timeline = _Timeline()
        self._active: dict[tuple[str, str], dict[str, Any]] = {}

    def update(self, frame: RecordedFrame, roles: tuple[RoleHypothesis, ...]) -> tuple[dict[str, Any], ...]:
        timeline = copy(self._timeline)
        boundary = timeline.advance(frame)
        active = {} if boundary else self._active
        role_by_id = {item.detection_id: item for item in roles}
        if len(role_by_id) != len(roles):
            raise ValueError("ROLE_ID_DUPLICATE")
        role_ids = [item.role_detection_id for item in roles if item.status == "MATCHED"]
        if len(role_ids) != len(set(role_ids)):
            raise ValueError("ROLE_ASSOCIATION_AMBIGUOUS")
        ids = [item.detection_id for item in frame.detections]
        tracks = [item.track_id for item in frame.detections if item.track_id is not None]
        if len(ids) != len(set(ids)) or len(tracks) != len(set(tracks)):
            raise ValueError("INTERACTION_ID_DUPLICATE")
        players = []
        for item in frame.detections:
            role = role_by_id.get(item.detection_id)
            if (item.label == "person" and item.track_id is not None and role is not None
                    and role.status == "MATCHED" and role.role == "player"):
                players.append(item)
        if len(players) > 64:
            raise ValueError("INTERACTION_PERSON_LIMIT")
        current = {}
        for first, second in combinations(players, 2):
            ax1, ay1, ax2, ay2 = first.box
            bx1, by1, bx2, by2 = second.box
            scale = ((ay2 - ay1) + (by2 - by1)) / 2
            if scale < 64:
                continue
            horizontal_gap = max(ax1 - bx2, bx1 - ax2, 0)
            vertical_gap = max(ay1 - by2, by1 - ay2, 0)
            gap = hypot(horizontal_gap, vertical_gap)
            foot_depth = abs(ay2 - by2)
            if gap > .12 * scale or foot_depth > .4 * scale:
                continue
            pair = tuple(sorted((first.track_id, second.track_id)))
            previous = active.get(pair)
            ms = frame.sample.timestamp_ms
            start = previous["startMs"] if previous is not None else ms
            identity = [frame.sample.stream_index, frame.sample.origin_pts,
                        str(frame.sample.origin_time_base), frame.continuity_id, pair, start]
            current[pair] = {
                "id": _identifier("interaction", identity), "kind": "IMAGE_PROXIMITY",
                "continuityId": frame.continuity_id, "actorTrackIds": list(pair),
                "startMs": start, "endMs": ms,
                "supportFrameCount": previous["supportFrameCount"] + 1 if previous else 1,
                "footPoint": [(ax1 + ax2 + bx1 + bx2) / 4, (ay2 + by2) / 2],
                "personHeightPx": scale, "boxGapPx": gap, "footDepthDifferencePx": foot_depth,
                "contact": ContactObservation().state, "admission": "NOT_ADMITTED",
                "method": "tracked-player-image-proximity-v1",
                "lastFrame": frame.sample.as_record(),
                "reasons": ["BOX_PROXIMITY_NOT_CONTACT", "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY"],
            }
        if len(current) > 128:
            raise ValueError("INTERACTION_PAIR_LIMIT")
        self._active = current
        self._timeline = timeline
        return tuple(current.values())


def _point(value: object) -> bool:
    return (isinstance(value, (list, tuple)) and len(value) == 2
            and all(type(item) in (int, float) and isfinite(item) for item in value))


def _record_time(value: dict[str, Any]) -> Fraction:
    base, origin = value["timeBase"], value["originTimeBase"]
    return (value["pts"] * Fraction(base["numerator"], base["denominator"])
            - value["originPts"] * Fraction(origin["numerator"], origin["denominator"]))


class IncidentLinker:
    def __init__(self) -> None:
        self._timeline = _Timeline()
        self._recent: dict[str, dict[str, Any]] = {}

    def update(self, frame: RecordedFrame, interactions: tuple[dict[str, Any], ...],
               officials: tuple[dict[str, Any], ...], *,
               restart_patterns: tuple[dict[str, Any], ...] = ()) -> tuple[dict[str, Any], ...]:
        timeline = copy(self._timeline)
        boundary = timeline.advance(frame)
        ms = frame.sample.timestamp_ms
        previous = {} if boundary else self._recent
        ids = [item.detection_id for item in frame.detections]
        tracks = [item.track_id for item in frame.detections if item.track_id is not None]
        if len(ids) != len(set(ids)) or len(tracks) != len(set(tracks)):
            raise ValueError("INTERACTION_ID_DUPLICATE")
        current_tracks = {item.track_id: item for item in frame.detections if item.track_id is not None}
        current_time = _record_time(frame.sample.as_record())
        recent = {key: value for key, value in previous.items()
                  if 0 <= current_time - _record_time(value["lastFrame"]) <= Fraction(MAX_LINK_DELAY_MS, 1000)
                  and all(track in current_tracks for track in value["actorTrackIds"])}
        for item in interactions:
            if item.get("lastFrame") != frame.sample.as_record():
                raise ValueError("OBSERVATION_FRAME_MISMATCH")
            if item["continuityId"] == frame.continuity_id and item["endMs"] == ms:
                recent[item["id"]] = item
        if len(recent) > 512:
            raise ValueError("INCIDENT_LINK_LIMIT")
        links = []
        for official in officials:
            if official.get("lastFrame") != frame.sample.as_record():
                raise ValueError("OBSERVATION_FRAME_MISMATCH")
            if (official.get("continuityId") != frame.continuity_id
                    or official.get("timestampMs") != ms or official.get("sustained") is not True
                    or official.get("officialRole") not in ("MAIN_CANDIDATE", "ASSISTANT_CANDIDATE")
                    or official.get("trackId") not in current_tracks
                    or not _point(official.get("footPoint"))):
                continue
            possibilities = []
            for interaction in recent.values():
                actors = [current_tracks.get(track) for track in interaction["actorTrackIds"]]
                if len(actors) != 2 or any(actor is None for actor in actors):
                    continue
                # Reproject the same track fragments into this frame; never reuse old
                # image coordinates across a moving camera as a ground location.
                point = [sum((actor.box[0] + actor.box[2]) / 2 for actor in actors) / 2,
                         sum(actor.box[3] for actor in actors) / 2]
                scale = sum(actor.box[3] - actor.box[1] for actor in actors) / 2
                if scale < 64 or abs(actors[0].box[3] - actors[1].box[3]) > .4 * scale:
                    continue
                dx, dy = official["footPoint"][0] - point[0], official["footPoint"][1] - point[1]
                normalized_distance = hypot(dx, dy) / scale
                if normalized_distance <= 2:
                    possibilities.append((interaction, normalized_distance))
            # Nearest does not mean linked: abstain if more than one plausible incident exists.
            if len(possibilities) != 1:
                continue
            interaction, distance = possibilities[0]
            reasons = ["BOX_PROXIMITY_NOT_CONTACT", "SIGNAL_MEANING_UNVALIDATED",
                       "LIVE_REPLAY_UNVERIFIED", "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY",
                       "RESTART_PATTERN_NOT_LINKED" if restart_patterns else "RESTART_NOT_VISIBLE"]
            links.append({
                "id": _identifier("link", [interaction["id"], official["trackId"], official["startMs"],
                                            official["signalKind"]]),
                "linkState": "CANDIDATE_LINK", "continuityId": frame.continuity_id,
                "startMs": min(interaction["startMs"], official["startMs"]), "endMs": ms,
                "interactionId": interaction["id"], "actorTrackIds": interaction["actorTrackIds"],
                "officialTrackId": official["trackId"], "officialRole": official["officialRole"],
                "signalKind": official["signalKind"], "imageDistanceBodyRatio": distance,
                "delayMs": ms - interaction["endMs"], "contact": ContactObservation().state,
                "originalDecision": OriginalDecisionObservation().as_record(),
                "restart": RestartObservation().as_record(), "reasons": reasons,
                "admission": "NOT_ADMITTED", "method": "same-context-observation-link-v1",
            })
        self._recent, self._timeline = recent, timeline
        return tuple(links)

from copy import deepcopy

from .models import Candidate, Evidence


MAX_ASSOCIATIONS = 512


def associate_audio(audio: dict, candidates: tuple[Candidate, ...], evidence: tuple[Evidence, ...]) -> dict:
    """Link only existing windows and covering clips, without changing visual candidates."""
    result = deepcopy(audio)
    result["associations"] = []
    missing_clip = False
    for cue in result["cues"]:
        for candidate in candidates:
            if not candidate.start_ms <= cue["startMs"] < cue["endMs"] <= candidate.end_ms:
                continue
            indices = [index for index, item in enumerate(evidence)
                       if item.kind == "CLIP" and item.audio_status == "PRESERVED" and item.candidate_index == candidate.index
                       and item.start_ms <= cue["startMs"] and item.end_ms >= cue["endMs"]][:16]
            if not indices:
                missing_clip = True
                continue
            if len(result["associations"]) >= MAX_ASSOCIATIONS:
                result["truncated"] = True
                if "AUDIO_ASSOCIATION_LIMIT" not in result["reasons"]:
                    result["reasons"].append("AUDIO_ASSOCIATION_LIMIT")
                continue
            result["associations"].append({"cueId": cue["id"], "candidateIndex": candidate.index,
                                           "evidenceIndices": indices, "relation": "TEMPORAL_OVERLAP_ONLY"})
    if result["associations"] and "AUDIOVISUAL_ASSOCIATION_NOT_VERIFIED" not in result["reasons"]:
        result["reasons"].append("AUDIOVISUAL_ASSOCIATION_NOT_VERIFIED")
    if missing_clip and "AUDIO_CUE_WITHOUT_COVERING_CLIP" not in result["reasons"]:
        result["reasons"].append("AUDIO_CUE_WITHOUT_COVERING_CLIP")
    return result

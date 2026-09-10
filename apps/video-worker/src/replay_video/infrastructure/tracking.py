from dataclasses import replace
import json
from pathlib import Path
from typing import Iterable

from ..domain.models import Candidate, VideoMetadata


def tracking_summaries(samples: Iterable[dict], candidates: tuple[Candidate, ...], complete: bool) -> tuple[Candidate, ...]:
    # 원본 후보 구간 안에서 관찰된 값만 요약해 다른 사건의 움직임이 섞이지 않게 한다
    summaries = [{
        "version": "ball-path-v1", "coverage": "COMPLETE" if complete else "PARTIAL",
        "sampleCount": 0, "selectedCount": 0, "cameraCount": 0, "motionOnsetsMs": [],
    } for _ in candidates]
    for sample in samples:
        timestamp = sample["timestamp_ms"]
        motion = sample["ball_track"]
        for candidate, summary in zip(candidates, summaries):
            if not candidate.start_ms <= timestamp <= candidate.end_ms:
                continue
            summary["sampleCount"] += 1
            if motion["candidate"] is not None:
                summary["selectedCount"] += 1
            if motion["compensated_displacement_px"] is not None:
                summary["cameraCount"] += 1
            onset = motion["motion_onset_ms"]
            if onset is not None and candidate.start_ms <= onset <= candidate.end_ms and onset not in summary["motionOnsetsMs"]:
                summary["motionOnsetsMs"].append(onset)
    return tuple(replace(candidate, tracking=summary) for candidate, summary in zip(candidates, summaries))


def tracking(source: Path | str, output: Path | str, metadata: VideoMetadata,
             candidates: tuple[Candidate, ...]) -> tuple[Candidate, ...]:
    # 진단과 Worker가 같은 추출기를 사용하며 임시 결과는 작업 폴더 안에 보관한다
    from ..inspect import inspect_video

    summary_path = inspect_video(source, Path(output) / "tracking")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    # 관찰된 사건은 정점 상위 개수 제한과 무관하게 원본 전후 구간을 확보한다
    combined = list(candidates)
    for event in summary.get("scene_events", []):
        start = max(0, event["startMs"] - 800)
        end = min(metadata.duration_ms, event["restartMs"] + 8000)
        overlap = next((index for index, item in enumerate(combined)
                        if item.scene_event is None and item.start_ms <= event["endMs"] and item.end_ms >= event["startMs"]), None)
        if overlap is not None:
            item = combined[overlap]
            combined[overlap] = replace(item, start_ms=min(item.start_ms, start), end_ms=max(item.end_ms, end), anchor_ms=event["restartMs"],
                                        scene_event=event, reasons=item.reasons + ("corner_geometry_motion",))
        else:
            combined.append(Candidate(max((item.index for item in combined), default=0) + 1, "OTHER", start, end,
                                      event["restartMs"], 0.0, "MEDIUM", ("corner_geometry_motion",), (), scene_event=event))
    for cue in summary.get("broadcast_cues", []):
        start = max(0, cue["startMs"] - 20000)
        end = min(metadata.duration_ms, cue["endMs"] + 12000)
        overlap = next((index for index, item in enumerate(combined)
                        if item.broadcast_cue is None and item.start_ms <= cue["endMs"] and item.end_ms >= cue["startMs"]), None)
        if overlap is not None:
            item = combined[overlap]
            combined[overlap] = replace(item, start_ms=min(item.start_ms, start), end_ms=max(item.end_ms, end),
                                        anchor_ms=cue["startMs"], broadcast_cue=cue,
                                        reasons=item.reasons + ("broadcast_goal_graphic",))
        else:
            combined.append(Candidate(max((item.index for item in combined), default=0) + 1, "OTHER", start, end,
                                      cue["startMs"], 0.0, "MEDIUM", ("broadcast_goal_graphic",), (), broadcast_cue=cue))
    candidates = tuple(combined)
    with (summary_path.parent / "context.jsonl").open(encoding="utf-8") as stream:
        return tracking_summaries((json.loads(line) for line in stream), candidates, summary["coverage_status"] == "MATCHES_METADATA")

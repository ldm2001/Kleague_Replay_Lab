from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .candidates import candidates
from .evidence import evidence
from .models import Candidate, Evidence, PipelineResult, Shot, VideoMetadata
from .probe import MediaError, probe
from .shots import shots


def _video(metadata: VideoMetadata) -> dict[str, Any]:
    return {
        "source_name": metadata.source.name,
        "duration_ms": metadata.duration_ms,
        "width": metadata.width,
        "height": metadata.height,
        "fps": metadata.fps,
        "frame_count": metadata.frame_count,
        "codec": metadata.codec,
    }


def _shot(item: Shot) -> dict[str, Any]:
    return asdict(item)


def _candidate(item: Candidate) -> dict[str, Any]:
    value = asdict(item)
    value["reasons"] = list(item.reasons)
    value["shot_indices"] = list(item.shot_indices)
    return value


def _evidence(item: Evidence, output: Path) -> dict[str, Any]:
    value = asdict(item)
    value["path"] = str(item.path.relative_to(output))
    return value


def run(source: Path | str, output: Path | str, *, pipeline_version: str = "video-baseline-v1") -> PipelineResult:
    metadata = probe(source)
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    shot_list = shots(metadata.source, metadata)
    candidate_list = candidates(metadata.source, metadata, shot_list)
    evidence_list = evidence(metadata.source, root, metadata, candidate_list)
    result = PipelineResult(1, pipeline_version, metadata, shot_list, candidate_list, evidence_list, root / "report.json")
    payload = {
        "schema_version": result.schema_version,
        "pipeline_version": result.pipeline_version,
        "limitations": [
            "replay_detection_pending",
            "incident_category_classification_pending",
            "pose_tracking_pending",
        ],
        "video": _video(metadata),
        "shots": [_shot(item) for item in shot_list],
        "candidates": [_candidate(item) for item in candidate_list],
        "evidence": [_evidence(item, root) for item in evidence_list],
    }
    result.report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return result

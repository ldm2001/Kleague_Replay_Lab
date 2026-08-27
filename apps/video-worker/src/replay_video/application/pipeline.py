from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ..domain.models import Candidate, Evidence, PipelineResult, Shot, VideoMetadata
from ..infrastructure.candidates import candidates
from ..infrastructure.evidence import evidence
from ..infrastructure.probe import MediaError, probe
from ..infrastructure.shots import shots


def video(metadata: VideoMetadata) -> dict[str, Any]:
    return {
        "source_name": metadata.source.name,
        "duration_ms": metadata.duration_ms,
        "width": metadata.width,
        "height": metadata.height,
        "fps": metadata.fps,
        "frame_count": metadata.frame_count,
        "codec": metadata.codec,
    }


def shot(item: Shot) -> dict[str, Any]:
    return asdict(item)


def candidate(item: Candidate) -> dict[str, Any]:
    value = asdict(item)
    value["reasons"] = list(item.reasons)
    value["shot_indices"] = list(item.shot_indices)
    return value


def entry(item: Evidence, output: Path) -> dict[str, Any]:
    value = asdict(item)
    value["path"] = str(item.path.relative_to(output))
    return value


def pipeline(source: Path | str, output: Path | str, *, pipeline_version: str = "video-baseline-v1") -> PipelineResult:
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
        "video": video(metadata),
        "shots": [shot(item) for item in shot_list],
        "candidates": [candidate(item) for item in candidate_list],
        "evidence": [entry(item, root) for item in evidence_list],
    }
    result.report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return result

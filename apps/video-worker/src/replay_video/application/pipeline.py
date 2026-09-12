from __future__ import annotations

import json
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any, Callable

from ..domain.models import Candidate, Evidence, LOCAL_OBSERVER_PIPELINE_VERSION, PipelineResult, Shot, VideoMetadata
from .ports import PipelinePorts


# 영상 메타데이터 직렬화
def video(metadata: VideoMetadata) -> dict[str, Any]:
    # 메타데이터 필드 추출
    return {
        "source_name": metadata.source.name,
        "duration_ms": metadata.duration_ms,
        "width": metadata.width,
        "height": metadata.height,
        "fps": metadata.fps,
        "frame_count": metadata.frame_count,
        "codec": metadata.codec,
    }


# 샷 데이터 직렬화
def shot(item: Shot) -> dict[str, Any]:
    # 샷 필드 추출
    return asdict(item)


# 후보 데이터 직렬화
def candidate(item: Candidate) -> dict[str, Any]:
    # 후보 필드 추출
    value = asdict(item)
    # 이유 목록 변환
    value["reasons"] = list(item.reasons)
    # 샷 인덱스 변환
    value["shot_indices"] = list(item.shot_indices)
    # 후보 결과 반환
    return value


# 증거 경로 직렬화
def entry(item: Evidence, output: Path) -> dict[str, Any]:
    # 증거 필드 추출
    value = asdict(item)
    # 출력 기준 상대 경로 계산
    value["path"] = str(item.path.relative_to(output))
    # 증거 결과 반환
    return value


# 영상 파이프라인 조립
def pipeline(
    source: Path | str,
    output: Path | str,
    *,
    ports: PipelinePorts,
    pipeline_version: str = "video-baseline-v1",
    progress: Callable[[str, int, str], None] | None = None,
) -> PipelineResult:
    if pipeline_version == LOCAL_OBSERVER_PIPELINE_VERSION and ports.perception is None:
        raise ValueError("PERCEPTION_PORT_REQUIRED")
    if ports.perception is not None:
        if pipeline_version not in ("video-baseline-v1", LOCAL_OBSERVER_PIPELINE_VERSION):
            raise ValueError("PERCEPTION_PIPELINE_VERSION_INVALID")
        pipeline_version = LOCAL_OBSERVER_PIPELINE_VERSION
    # 영상 메타데이터 확인
    metadata = ports.probe(source)
    # 출력 경로 정규화
    root = Path(output).resolve()
    # 출력 폴더 생성
    root.mkdir(parents=True, exist_ok=True)
    if progress:
        progress("SEGMENTING", 20, "shot-boundary")
    # 샷 경계 계산
    shot_list = ports.shots(metadata.source, metadata)
    if progress:
        progress("DETECTING", 45, "visual-change")
    # 움직임 후보 계산
    candidate_list = ports.candidates(metadata.source, metadata, shot_list)
    if progress:
        progress("EXTRACTING_FACTS", 55, "candidate-metadata")
    if ports.tracking:
        candidate_list = ports.tracking(metadata.source, root, metadata, candidate_list)
    perception = None
    if ports.perception:
        observed = ports.perception(metadata.source, root, metadata, candidate_list, shot_list)
        candidate_list, perception = observed.candidates, observed.perception
    if ports.tracking or ports.perception:
        # 사건 구간 확장 뒤 실제로 겹치는 샷 식별자를 다시 연결한다
        candidate_list = tuple(replace(item, shot_indices=tuple(shot.index for shot in shot_list
            if shot.end_ms >= item.start_ms and shot.start_ms <= item.end_ms)) for item in candidate_list)
    if progress:
        progress("BUILDING_EVIDENCE", 70, "candidate-evidence")
    # 프레임과 클립 생성
    evidence_list = ports.evidence(metadata.source, root, metadata, candidate_list)
    if perception is not None:
        for incident in perception["incidents"]:
            incident["evidenceIndices"] = [index for index, item in enumerate(evidence_list)
                                            if item.kind == "CLIP" and item.candidate_index == incident["candidateIndex"]
                                            and item.start_ms <= incident["startMs"] and item.end_ms >= incident["endMs"]][:16]
            if not incident["evidenceIndices"]:
                incident["reasons"].append("EVIDENCE_CLIP_MISSING")
    # 규정 필터는 저장된 산출물을 읽는 서버에서 실행
    # 파이프라인 결과 조립
    result = PipelineResult(2 if perception is not None else 1, pipeline_version, metadata, shot_list, candidate_list, evidence_list, root / "report.json")
    # 결과 보고서 구성
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
    if perception is not None:
        payload["perception"] = perception
        payload["limitations"] = ["replay_detection_pending", "incident_category_classification_pending",
                                  "pose_and_role_methods_unvalidated", "contact_fact_extraction_unverified",
                                  "referee_decision_interpretation_unverified", "restart_fact_linking_unverified"]
        if perception["processingStatus"] != "COMPLETE":
            payload["limitations"].append("perception_processing_partial")
    # 결과 보고서 기록
    result.report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    # 파이프라인 결과 반환
    return result

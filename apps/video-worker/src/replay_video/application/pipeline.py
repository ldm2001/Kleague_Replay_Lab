from __future__ import annotations
import json
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any, Callable
from ..domain.models import (
    AV_OBSERVER_PIPELINE_VERSION,
    Candidate,
    Evidence,
    LOCAL_OBSERVER_PIPELINE_VERSION,
    PipelineResult,
    Shot,
    VideoMetadata,
)
from ..domain.audio import association
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
    # 시각 전용과 시각·음향 결합 관측의 지원 판본 목록 생성
    observer_versions = (LOCAL_OBSERVER_PIPELINE_VERSION, AV_OBSERVER_PIPELINE_VERSION)
    # 관측 판본인데 실제 관측기가 빠진 조합인지 확인
    if pipeline_version in observer_versions and ports.perception is None:
        # 관측 없는 결과가 관측 완료로 기록되지 않도록 중단
        raise ValueError("PERCEPTION_PORT_REQUIRED")
    # 관측기가 연결된 경우에만 실행 판본 호환성 확인
    if ports.perception is not None:
        # 연결된 관측기로 처리할 수 없는 판본인지 확인
        if pipeline_version not in ("video-baseline-v1", *observer_versions):
            # 관측 자료 구조와 실행 판본이 어긋난 결과 거부
            raise ValueError("PERCEPTION_PIPELINE_VERSION_INVALID")
        # 기본 판본 요청을 연결된 관측기 판본으로 보완
        if pipeline_version == "video-baseline-v1":
            # 관측기가 명시한 판본을 읽고 없으면 시각 관측 판본 사용
            pipeline_version = getattr(
                ports.perception, "pipeline_version", LOCAL_OBSERVER_PIPELINE_VERSION
            )
    # 영상 메타데이터 확인
    metadata = ports.probe(source)
    # 출력 경로 정규화
    root = Path(output).resolve()
    # 출력 폴더 생성
    root.mkdir(parents=True, exist_ok=True)
    # 진행 알림을 받는 호출자가 있는지 확인
    if progress:
        # 샷 경계 분석 시작 상태 전달
        progress("SEGMENTING", 20, "shot-boundary")
    # 샷 경계 계산
    shot_list = ports.shots(metadata.source, metadata)
    # 진행 알림을 받는 호출자가 있는지 확인
    if progress:
        # 화면 변화 후보 탐색 시작 상태 전달
        progress("DETECTING", 45, "visual-change")
    # 움직임 후보 계산
    candidate_list = ports.candidates(metadata.source, metadata, shot_list)
    # 진행 알림을 받는 호출자가 있는지 확인
    if progress:
        # 후보 메타데이터와 관측 근거 수집 시작 상태 전달
        progress("EXTRACTING_FACTS", 55, "candidate-metadata")
    # 추적기가 연결된 경우 원시 움직임 요약 보강
    if ports.tracking:
        # 원본 추적을 실행하고 추적 요약이 붙은 후보 목록으로 교체
        candidate_list = ports.tracking(metadata.source, root, metadata, candidate_list)
    # 관측기 미실행 상태를 빈 관측 결과와 구별해 보존
    perception = None
    # 로컬 관측기 연결 여부 확인
    if ports.perception:
        # 원본 전체 관측과 후보 구간 연결 실행
        observed = ports.perception(metadata.source, root, metadata, candidate_list, shot_list)
        # 확장된 후보와 비공개 관측 자료를 분리해 읽음
        candidate_list, perception = observed.candidates, observed.perception
        # 음향 결합 판본의 필수 음향 자료 확인
        if pipeline_version == AV_OBSERVER_PIPELINE_VERSION:
            # 음향 관측을 담는 자료 판본과 사전 형식 확인
            if perception.get("schemaVersion") != "perception-run-v2" or not isinstance(
                perception.get("audio"), dict
            ):
                # 음향 필수 판본에서 누락된 음향 자료 거부
                raise ValueError("PERCEPTION_AUDIO_REQUIRED")
        # 시각 전용 결과에 다른 판본이나 음향 자료가 섞였는지 확인
        elif perception.get("schemaVersion") != "perception-run-v1" or "audio" in perception:
            # 관측 자료 구조와 실행 판본이 어긋난 결과 거부
            raise ValueError("PERCEPTION_PIPELINE_VERSION_INVALID")
    # 관측으로 후보 구간이 달라질 수 있는 경우 샷 연결 재계산
    if ports.tracking or ports.perception:
        # 사건 구간 확장 뒤 실제로 겹치는 샷 식별자를 다시 연결
        candidate_list = tuple(
            replace(
                item,
                shot_indices=tuple(
                    shot.index
                    for shot in shot_list
                    if shot.end_ms >= item.start_ms and shot.start_ms <= item.end_ms
                ),
            )
            for item in candidate_list
        )
    # 진행 알림을 받는 호출자가 있는지 확인
    if progress:
        # 후보별 프레임과 클립 생성 시작 상태 전달
        progress("BUILDING_EVIDENCE", 70, "candidate-evidence")
    # 프레임과 클립 생성
    evidence_list = ports.evidence(metadata.source, root, metadata, candidate_list)
    # 관측 결과가 있는 경우에만 관측 전용 근거와 제한사항 연결
    if perception is not None:
        # 각 관측 사건에 대응하는 증거 클립 탐색
        for incident in perception["incidents"]:
            # 같은 후보이면서 관측 구간 전체를 포함하는 클립 번호를 최대 열여섯 개 연결
            incident["evidenceIndices"] = [
                index
                for index, item in enumerate(evidence_list)
                if item.kind == "CLIP"
                and item.candidate_index == incident["candidateIndex"]
                and item.start_ms <= incident["startMs"]
                and item.end_ms >= incident["endMs"]
            ][:16]
            # 관측 구간을 뒷받침하는 클립이 없는지 확인
            if not incident["evidenceIndices"]:
                # 클립 누락을 사건 부재로 바꾸지 않고 한계 사유 추가
                incident["reasons"].append("EVIDENCE_CLIP_MISSING")
        # 음향 관측이 있는 경우 원본 시간 대응과 음향 한계 보강
        if "audio" in perception:
            # 소리 단서와 후보·클립을 시간 중첩 기준으로 연결
            perception["audio"] = association(perception["audio"], candidate_list, evidence_list)
        # 비공개 측정 확장기가 연결되어 있는지 확인
        if ports.private_observations:
            # 원시 관측에 화면 좌표 측정을 덧붙인 비공개 산출물 참조로 교체
            perception["artifact"] = ports.private_observations(
                root, perception["artifact"], perception["sourceSha256"], shot_list, evidence_list
            )
    # 규정 필터는 저장된 산출물을 읽는 서버에서 실행
    # 파이프라인 결과 조립
    result = PipelineResult(
        2 if perception is not None else 1,
        pipeline_version,
        metadata,
        shot_list,
        candidate_list,
        evidence_list,
        root / "report.json",
    )
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
    # 관측 결과가 있는 경우에만 관측 전용 근거와 제한사항 연결
    if perception is not None:
        # 규정 판단과 분리된 관측 결과를 보고서에 보존
        payload["perception"] = perception
        # 관측 판본에서 아직 검증되지 않은 사실 추출 범위 기록
        payload["limitations"] = [
            "replay_detection_pending",
            "incident_category_classification_pending",
            "pose_and_role_methods_unvalidated",
            "contact_fact_extraction_unverified",
            "referee_decision_interpretation_unverified",
            "restart_fact_linking_unverified",
        ]
        # 표본 처리가 완결되지 않은 관측인지 확인
        if perception["processingStatus"] != "COMPLETE":
            # 일부만 처리된 관측임을 보고서에 명시
            payload["limitations"].append("perception_processing_partial")
        # 음향 관측이 있는 경우 원본 시간 대응과 음향 한계 보강
        if "audio" in perception:
            # 음성 발화 미해석과 시간 연결만 수행한 한계 추가
            payload["limitations"].extend(
                [
                    "speech_not_analyzed",
                    "audio_cue_method_unverified",
                    "audiovisual_association_temporal_only",
                ]
            )
            # 생성된 증거 중 음향이 빠진 항목 존재 여부 확인
            if any(
                item.audio_status and item.audio_status.startswith("OMITTED_")
                for item in evidence_list
            ):
                # 원본 음향의 증거 보존이 불완전한 상태 기록
                payload["limitations"].append("audio_evidence_incomplete")
    # 결과 보고서 기록
    result.report_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # 파이프라인 결과 반환
    return result

from __future__ import annotations
from pathlib import Path
from ..domain.models import Candidate, Shot, VideoMetadata
from .signals import signals

# 시간대 샷 검색
def segment(timestamp_ms: int, items: tuple[Shot, ...]) -> Shot | None:
    # 시간에 맞는 샷 선택
    return next((item for item in items if item.start_ms <= timestamp_ms <= item.end_ms), None)

# 후보 장면 생성
def candidates(
    source: Path | str,
    metadata: VideoMetadata,
    shot_list: tuple[Shot, ...],
    *,
    motion_threshold: float = 0.18,
    min_gap_ms: int = 2500,
    max_candidates: int = 40,
) -> tuple[Candidate, ...]:
    # 변화 정점 결과 초기화
    peaks: list[tuple[int, float]] = []
    # 영상 변화 신호 순회
    for signal in signals(source, metadata):
        # 신호의 샷 확인
        shot = segment(signal.timestamp_ms, shot_list)
        # 샷 경계 신호 제외
        if shot is None or (shot.start_ms > 0 and abs(signal.timestamp_ms - shot.start_ms) < 250):
            # 샷 전환 또는 낮은 화면 변화 신호를 후보 정점에서 제외
            continue
        # 낮은 변화 신호 제외
        if signal.score < motion_threshold:
            # 샷 전환 또는 낮은 화면 변화 신호를 후보 정점에서 제외
            continue
        # 기존 정점과 거리 확인
        if peaks and signal.timestamp_ms - peaks[-1][0] < min_gap_ms:
            # 더 높은 정점으로 교체
            if signal.score > peaks[-1][1]:
                # 가까운 변화 중 더 큰 값을 대표 시각으로 보존
                peaks[-1] = (signal.timestamp_ms, signal.score)
        else:
            # 새 정점 추가
            peaks.append((signal.timestamp_ms, signal.score))

    # 높은 변화 신호 제한
    peaks = sorted(peaks, key=lambda item: item[1], reverse=True)[:max_candidates]
    # 선정한 강한 변화 정점을 원본 시간 순서로 재정렬
    peaks.sort(key=lambda item: item[0])
    # 후보 결과 초기화
    result: list[Candidate] = []
    # 정점별 후보 생성
    for index, (anchor_ms, score) in enumerate(peaks, start=1):
        # 후보 시작 시각 계산
        start_ms = max(0, anchor_ms - 1200)
        # 후보 종료 시각 계산
        end_ms = min(metadata.duration_ms, anchor_ms + 1200)
        # 관련 샷 목록 계산
        related = tuple(
            item.index for item in shot_list if item.end_ms >= start_ms and item.start_ms <= end_ms
        )
        # 후보 확신도 계산
        confidence = min(
            0.95,
            max(
                0.15, 0.15 + ((score - motion_threshold) / max(1.0 - motion_threshold, 0.01)) * 0.8
            ),
        )
        # 후보 결과 추가
        result.append(
            Candidate(
                index=index,
                # 변화 후보만으로 접촉·파울 사건 종류를 확정하지 않음
                category="OTHER",
                start_ms=start_ms,
                end_ms=end_ms,
                anchor_ms=anchor_ms,
                # 화면 변화 기반 후보 점수를 보존하며 파울 확률과 구별
                confidence=round(confidence, 4),
                camera_sufficiency="MEDIUM",
                reasons=("motion_spike", "baseline_detector"),
                shot_indices=related,
            )
        )
    # 후보 결과 반환
    return tuple(result)

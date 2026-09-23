from dataclasses import replace
import json
from pathlib import Path
from typing import Iterable
from ..domain.models import Candidate, VideoMetadata

# 후보별 표본 범위와 추적 성공 및 움직임 시작 근거를 집계
def summaries(
    samples: Iterable[dict], candidates: tuple[Candidate, ...], complete: bool
) -> tuple[Candidate, ...]:
    # 원본 후보 구간 내 관측만 요약
    summaries = [
        {
            "version": "ball-path-v1",
            "coverage": "COMPLETE" if complete else "PARTIAL",
            "sampleCount": 0,
            "selectedCount": 0,
            "cameraCount": 0,
            "motionOnsetsMs": [],
        }
        for _ in candidates
    ]
    # 원본 전체에서 수집한 추적 표본을 순서대로 읽음
    for sample in samples:
        # 현재 표본의 원본 상대 시각 읽음
        timestamp = sample["timestamp_ms"]
        # 현재 표본의 공 미확정 경로와 움직임 요약 읽음
        motion = sample["ball_track"]
        # 각 후보와 같은 위치의 추적 집계를 함께 갱신
        for candidate, summary in zip(candidates, summaries):
            # 표본 시각이 해당 후보 구간에 포함되는지 확인
            if not candidate.start_ms <= timestamp <= candidate.end_ms:
                # 후보 시간 범위 밖 추적 표본은 해당 집계에서 제외
                continue
            # 후보 구간에서 실제 읽은 추적 표본 수 증가
            summary["sampleCount"] += 1
            # 이 표본에서 연결할 화면 공 후보가 선택되었는지 확인
            if motion["candidate"] is not None:
                # 공 미확정 후보가 선택된 표본 수 증가
                summary["selectedCount"] += 1
            # 카메라 보정 변위를 계산할 근거가 있는지 확인
            if motion["compensated_displacement_px"] is not None:
                # 카메라 보정이 가능했던 표본 수 증가
                summary["cameraCount"] += 1
            # 경로에서 관측한 움직임 시작 시각 읽음
            onset = motion["motion_onset_ms"]
            # 움직임 시작이 현재 후보 안에 있고 아직 수집하지 않은 시각인지 확인
            if (
                onset is not None
                and candidate.start_ms <= onset <= candidate.end_ms
                and onset not in summary["motionOnsetsMs"]
            ):
                # 후보 안의 중복되지 않은 움직임 시작 시각 보존
                summary["motionOnsetsMs"].append(onset)
    # 원래 후보 내용에 구간별 추적 집계만 덧붙여 반환
    return tuple(
        replace(candidate, tracking=summary) for candidate, summary in zip(candidates, summaries)
    )

# 원본 프레임을 추적하고 후보별 추적 요약을 생성
def tracking(
    source: Path | str,
    output: Path | str,
    metadata: VideoMetadata,
    candidates: tuple[Candidate, ...],
) -> tuple[Candidate, ...]:
    # 진단·영상 작업의 추출기 공유와 작업 폴더 내 임시 결과 보관
    from ..inspection import inspection

    # 원본 전체의 비모델 추적 진단과 화면 단서 추출 실행
    summary_path = inspection(source, Path(output) / "tracking")
    # 추적 진단 요약과 관측된 화면 패턴 읽음
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    # 상위 정점 개수와 무관한 관측 사건 전후 구간 확보
    combined = list(candidates)
    # 관측된 코너 재개 화면 패턴에 증거 후보 연결
    for event in summary.get("scene_events", []):
        # 원본 시작을 넘지 않는 재개 관측 이전 맥락 계산
        start = max(0, event["startMs"] - 800)
        # 원본 끝을 넘지 않는 재개 관측 이후 맥락 계산
        end = min(metadata.duration_ms, event["restartMs"] + 8000)
        # 같은 종류 단서가 아직 없고 시간상 겹치는 기존 후보 탐색
        overlap = next(
            (
                index
                for index, item in enumerate(combined)
                if item.scene_event is None
                and item.start_ms <= event["endMs"]
                and item.end_ms >= event["startMs"]
            ),
            None,
        )
        # 현재 화면 단서를 연결할 기존 후보 존재 여부 확인
        if overlap is not None:
            # 증거 시간 구간을 확장할 기존 후보 읽음
            item = combined[overlap]
            # 기존 후보를 유지하며 단서 전후 맥락과 대표 시각 보강
            combined[overlap] = replace(
                item,
                start_ms=min(item.start_ms, start),
                end_ms=max(item.end_ms, end),
                anchor_ms=event["restartMs"],
                scene_event=event,
                reasons=item.reasons + ("corner_geometry_motion",),
            )
        else:
            # 겹치는 후보가 없으면 화면 단서를 위한 중립 후보 추가
            combined.append(
                Candidate(
                    max((item.index for item in combined), default=0) + 1,
                    "OTHER",
                    start,
                    end,
                    event["restartMs"],
                    0.0,
                    "MEDIUM",
                    ("corner_geometry_motion",),
                    (),
                    scene_event=event,
                )
            )
    # 득점 방송 표시 단서에 증거 후보 연결
    for cue in summary.get("broadcast_cues", []):
        # 방송 표시 이전 경기 맥락을 원본 범위 안에서 확보
        start = max(0, cue["startMs"] - 20000)
        # 방송 표시 이후 화면 맥락을 원본 범위 안에서 확보
        end = min(metadata.duration_ms, cue["endMs"] + 12000)
        # 같은 종류 단서가 아직 없고 시간상 겹치는 기존 후보 탐색
        overlap = next(
            (
                index
                for index, item in enumerate(combined)
                if item.broadcast_cue is None
                and item.start_ms <= cue["endMs"]
                and item.end_ms >= cue["startMs"]
            ),
            None,
        )
        # 현재 화면 단서를 연결할 기존 후보 존재 여부 확인
        if overlap is not None:
            # 증거 시간 구간을 확장할 기존 후보 읽음
            item = combined[overlap]
            # 기존 후보를 유지하며 단서 전후 맥락과 대표 시각 보강
            combined[overlap] = replace(
                item,
                start_ms=min(item.start_ms, start),
                end_ms=max(item.end_ms, end),
                anchor_ms=cue["startMs"],
                broadcast_cue=cue,
                reasons=item.reasons + ("broadcast_goal_graphic",),
            )
        else:
            # 겹치는 후보가 없으면 화면 단서를 위한 중립 후보 추가
            combined.append(
                Candidate(
                    max((item.index for item in combined), default=0) + 1,
                    "OTHER",
                    start,
                    end,
                    cue["startMs"],
                    0.0,
                    "MEDIUM",
                    ("broadcast_goal_graphic",),
                    (),
                    broadcast_cue=cue,
                )
            )
    # 화면 관측 단서가 연결된 최종 후보 묶음 생성
    candidates = tuple(combined)
    # 원시 추적 표본을 한 줄씩 읽어 확장된 후보 범위로 재집계
    with (summary_path.parent / "context.jsonl").open(encoding="utf-8") as stream:
        # 전체 원본 표본 범위의 완결 여부를 포함한 후보 추적 요약 반환
        return summaries(
            (json.loads(line) for line in stream),
            candidates,
            summary["coverage_status"] == "MATCHES_METADATA",
        )

from pathlib import Path
from dataclasses import replace
from unittest.mock import Mock
import pytest
from replay_video.domain.models import Candidate, VideoMetadata
from replay_video.infrastructure.evidence import evidence

# 시험용 후보 반환
def candidate(index: int, *, corner: bool) -> Candidate:
    # 후보 번호마다 다른 시작 시각 부여
    start = index * 1000
    # 코너 후보에만 영상 패턴 사건 정보를 연결
    event = (
        {
            "kind": "CORNER_KICK",
            "status": "OBSERVED",
            "startMs": start + 100,
            "endMs": start + 700,
            "restartMs": start + 400,
            "evidenceTimestampsMs": [start + 100, start + 400, start + 600],
            "method": "corner-geometry-motion-v1",
        }
        if corner
        else None
    )
    # 변화 구간과 대표 시각을 가진 시험 후보 결과 반환
    return Candidate(
        index,
        "OTHER",
        start,
        start + 800,
        start + 400,
        0.0 if corner else index / 100,
        "MEDIUM",
        (),
        (),
        scene_event=event,
    )

# 전체 코너 구간 클립의 잔여 용량 준수 확인
@pytest.mark.parametrize("corner_count", [9, 2, 0])
def test_all_corner_sequences_keep_clips_within_remaining_generic_budget(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    corner_count: int,
) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 60_000, 1920, 1080, 30.0, 1800, "h264")
    # 클립 우선 보존 대상인 코너 후보 목록 생성
    corners = tuple(candidate(index, corner=True) for index in range(1, corner_count + 1))
    # 남은 예산으로 선택할 일반 변화 후보 목록 생성
    generic = tuple(candidate(index, corner=False) for index in range(20, 30))
    # 실제 프레임 추출 대신 호출을 기록할 대역 생성
    frame_writer = Mock()
    # 실제 클립 인코딩 대신 호출을 기록할 대역 생성
    clip_writer = Mock()
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", frame_writer)
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.evidence.clip", clip_writer)

    # 변화 후보의 프레임과 클립 증거 생성
    result = evidence(source, tmp_path / "result", metadata, corners + generic)

    # 생성한 클립만 후보 번호별로 색인
    clips = {item.candidate_index: item for item in result if item.kind == "CLIP"}
    # 코너 수를 뺀 남은 클립 예산으로 선택할 일반 후보 계산
    expected_generic = set(range(30 - max(0, 8 - corner_count), 30))
    # 모든 코너와 예산 내 일반 후보가 클립으로 보존되는지 확인
    assert set(clips) == set(range(1, corner_count + 1)) | expected_generic
    # 클립 우선순위와 무관하게 모든 후보의 프레임 추출 확인
    assert frame_writer.call_count == len(corners + generic)
    # 코너가 기본 예산보다 많으면 코너 전체를 보존하는지 확인
    assert clip_writer.call_count == max(8, corner_count)
    # 각 코너 후보의 클립 구간과 추출 호출 확인
    for item in corners:
        # 해당 코너 번호에 연결된 증거 클립 선택
        clip = clips[item.index]
        # 코너 클립의 시작과 끝이 원래 후보 구간을 보존하는지 확인
        assert all(
            clip.start_ms <= time <= clip.end_ms
            for time in item.scene_event["evidenceTimestampsMs"]
        )
        # 해당 원본과 코너 구간으로 클립 인코더를 호출했는지 확인
        clip_writer.assert_any_call(source.resolve(), clip.path, item.start_ms, item.end_ms)

# 코너·움직임 후보 뒤 득점 표시 클립 보존 확인
def test_goal_graphic_clip_is_not_lost_behind_corner_or_motion_candidates(monkeypatch, tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 60_000, 1920, 1080, 30.0, 1800, "h264")
    # 기본 클립 예산을 넘는 아홉 개 코너 후보 생성
    corners = tuple(candidate(index, corner=True) for index in range(1, 10))
    # 코너와 경쟁할 높은 신뢰도의 득점 표시 후보 생성
    goal = replace(
        candidate(15, corner=False),
        confidence=0.0,
        broadcast_cue={
            "kind": "GOAL_GRAPHIC",
            "startMs": 15100,
            "endMs": 15400,
            "method": "broadcast-goal-glyphs-v1",
            "evidenceTimestampsMs": [15100, 15400],
        },
    )
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", Mock())
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.evidence.clip", Mock())
    # 변화 후보의 프레임과 클립 증거 생성
    result = evidence(source, tmp_path / "result", metadata, corners + (goal,))
    # 변화 후보 번호 목록이 예상 계약과 일치하는지 확인
    assert {item.candidate_index for item in result if item.kind == "CLIP"} == set(range(1, 10)) | {
        15
    }

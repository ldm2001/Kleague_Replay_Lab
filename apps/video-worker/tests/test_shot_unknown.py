from dataclasses import asdict
import json
from replay_video.domain.models import Shot
from replay_video.runner import report

# 미분류 샷의 본방송 주장 방지 확인
def test_unclassified_shot_does_not_claim_live_broadcast():
    # 시작과 끝 시각이 정해진 시험 샷 생성
    shot = Shot(index=0, start_ms=0, end_ms=1000)
    # 리플레이 여부가 비어 있는지 확인
    assert shot.is_replay is None
    # 리플레이 여부가 비어 있는지 확인
    assert asdict(shot)["is_replay"] is None

# 확인된 리플레이 상태 구분 유지 확인
def test_confirmed_replay_states_remain_distinct():
    # 리플레이 여부가 참인지 확인
    assert Shot(0, 0, 1000, is_replay=True).is_replay is True
    # 리플레이 여부가 거짓인지 확인
    assert Shot(0, 0, 1000, is_replay=False).is_replay is False

# 전송 자료의 리플레이 미확인 상태 보존 확인
def test_runner_preserves_unknown_replay_in_wire_payload(tmp_path):
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(
        json.dumps(
            {
                "pipeline_version": "video-baseline-v1",
                "limitations": ["replay_detection_pending"],
                "shots": [asdict(Shot(0, 0, 1000))],
                "candidates": [],
                "evidence": [],
            }
        ),
        encoding="utf-8",
    )
    # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
    value = report(None, {}, path)
    # 리플레이 여부가 비어 있는지 확인
    assert value["shots"][0]["isReplay"] is None

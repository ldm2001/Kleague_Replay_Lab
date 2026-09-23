from __future__ import annotations
from pathlib import Path
from test_pipeline import fixture
from replay_video.worker import job

# 검증 작업 결과 확인
def test_validation(tmp_path: Path) -> None:
    # 영상 작업 입력 준비
    source = tmp_path / "sample.mp4"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)

    # 검증 작업 실행
    result = job(
        {
            "job_id": "job-validate-1",
            "job_type": "VALIDATE_VIDEO",
            "source_path": str(source),
            "output_path": str(tmp_path / "result"),
        }
    )

    # 영상 작업 결과 메타데이터 확인
    assert result.job_id == "job-validate-1"
    # 작업 종류가 예상 계약과 일치하는지 확인
    assert result.job_type == "VALIDATE_VIDEO"
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert result.status == "SUCCEEDED"
    # 전송 본문이 예상 계약과 일치하는지 확인
    assert result.payload == {
        "kind": "VALIDATED",
        "duration_ms": 4000,
        "width": 320,
        "height": 180,
        "fps": 10.0,
        "frame_count": 40,
        "codec": "mpeg4",
    }

from __future__ import annotations

from pathlib import Path

from test_pipeline import fixture

from replay_video.worker import job


# 검증 작업 결과 확인
def test_validation(tmp_path: Path) -> None:
    # Worker 입력 영상 준비
    source = tmp_path / "sample.mp4"
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

    # Worker 결과 메타데이터 확인
    assert result.job_id == "job-validate-1"
    assert result.job_type == "VALIDATE_VIDEO"
    assert result.status == "SUCCEEDED"
    assert result.payload == {
        "kind": "VALIDATED",
        "duration_ms": 4000,
        "width": 320,
        "height": 180,
        "fps": 10.0,
        "frame_count": 40,
        "codec": "mpeg4",
    }

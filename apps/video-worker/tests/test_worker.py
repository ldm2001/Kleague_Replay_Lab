from __future__ import annotations

from pathlib import Path

from test_pipeline import fixture

from replay_video.worker import job


def test_validate_video_job_returns_verified_metadata(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    fixture(source)

    result = job(
        {
            "job_id": "job-validate-1",
            "job_type": "VALIDATE_VIDEO",
            "source_path": str(source),
            "output_path": str(tmp_path / "result"),
        }
    )

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

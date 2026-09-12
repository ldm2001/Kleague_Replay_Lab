import json
import os
from pathlib import Path
import subprocess
import sys


def run_cli(*args):
    project = Path(__file__).resolve().parents[1]
    environment = {**os.environ, "PYTHONPATH": str(project / "src"), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
    return subprocess.run([sys.executable, "-m", "replay_perception.observe", *map(str, args)],
                          cwd=project, env=environment, capture_output=True, text=True, timeout=30)


def test_cli_help_explains_inputs_without_loading_or_downloading_models():
    result = run_cli("--help")
    assert result.returncode == 0
    assert "--role-model-dir" in result.stdout
    assert "--pose-model-dir" in result.stdout
    assert "upstream" in result.stdout
    assert "Loading weights" not in result.stderr


def test_cli_rejects_unsupported_device_before_model_io():
    result = run_cli("source", "upstream", "output", "--device", "cuda")
    assert result.returncode == 2
    assert "invalid choice" in result.stderr


def test_cli_existing_output_preserves_file_without_loading_models(tmp_path):
    result = run_cli("source", "upstream", tmp_path)
    assert result.returncode == 1
    assert json.loads(result.stderr)["failureReason"] == "REPORT_PATH_EXISTS"
    assert not list(tmp_path.iterdir())


def test_cli_missing_input_fails_before_missing_model_cache(tmp_path):
    output = tmp_path / "output"
    result = run_cli(tmp_path / "missing.mkv", tmp_path / "upstream", output,
                     "--role-model-dir", tmp_path / "missing-model")
    assert result.returncode == 1
    assert json.loads(result.stderr)["failureReason"] == "SOURCE_NOT_FOUND"
    assert not output.exists()

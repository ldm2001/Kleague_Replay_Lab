# 기록 직렬화와 읽기 도구 읽음
import json
# 파일과 프로세스 상태 점검 도구 읽음
import os
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 격리 명령 실행 도구 읽음
import subprocess
# 현재 실행기와 모듈 경로 정보 읽음
import sys

# 명령 실행
def run_cli(*args):
    # 명령 입력 준비
    project = Path(__file__).resolve().parents[1]
    # 명령 입력의 시험 항목 구성
    environment = {
        **os.environ,
        # 하위 프로세스 모듈 탐색 경로의 시험값 지정
        "PYTHONPATH": str(project / "src"),
        # 모델 저장소 오프라인 설정의 시험값 지정
        "HF_HUB_OFFLINE": "1",
        # 모델 어댑터 오프라인 설정의 시험값 지정
        "TRANSFORMERS_OFFLINE": "1",
    }
    # 시험 명령 실행 결과 반환
    return subprocess.run(
        [sys.executable, "-m", 'replay_perception.observer', *map(str, args)],
        cwd=project,
        env=environment,
        capture_output=True,
        # 문자열 자료의 호출 조건 지정
        text=True,
        # 제한 시간의 호출 조건 지정
        timeout=30,
    )

# 모델 로드·다운로드 없는 입력 도움말 확인
def test_cli_help_explains_inputs_without_loading_or_downloading_models():
    # 명령줄 진입점 실행 결과 생성
    result = run_cli("--help")
    # 외부 명령 종료 코드 값이 0인지 확인
    assert result.returncode == 0
    # 외부 명령 표준 출력에 지정한 항목 포함 확인
    assert "--role-model-dir" in result.stdout
    # 외부 명령 표준 출력에 지정한 항목 포함 확인
    assert "--pose-model-dir" in result.stdout
    # 외부 명령 표준 출력에 지정한 항목 포함 확인
    assert "upstream" in result.stdout
    # 외부 명령 오류 출력에 지정한 항목 미포함 확인
    assert "Loading weights" not in result.stderr

# 모델 입출력 전 미지원 장치 거부 확인
def test_cli_rejects_unsupported_device_before_model_io():
    # 명령줄 진입점 실행 결과 생성
    result = run_cli("source", "upstream", "output", "--device", "cuda")
    # 외부 명령 종료 코드 값이 2인지 확인
    assert result.returncode == 2
    # 외부 명령 오류 출력에 지정한 항목 포함 확인
    assert "invalid choice" in result.stderr

# 모델 로드 없이 기존 출력 파일 보존 확인
def test_cli_existing_output_preserves_file_without_loading_models(tmp_path):
    # 명령줄 진입점 실행 결과 생성
    result = run_cli("source", "upstream", tmp_path)
    # 외부 명령 종료 코드 값이 1인지 확인
    assert result.returncode == 1
    # 처리 실패 이유의 기대 자료 일치 확인
    assert json.loads(result.stderr)["failureReason"] == "REPORT_PATH_EXISTS"
    # 출력 폴더 항목 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.iterdir())

# 모델 캐시 확인 전 입력 누락 실패 확인
def test_cli_missing_input_fails_before_missing_model_cache(tmp_path):
    # 출력 자료 준비
    output = tmp_path / "output"
    # 명령줄 진입점 실행 결과 생성
    result = run_cli(
        tmp_path / "missing.mkv",
        tmp_path / "upstream",
        output,
        "--role-model-dir",
        tmp_path / "missing-model",
    )
    # 외부 명령 종료 코드 값이 1인지 확인
    assert result.returncode == 1
    # 처리 실패 이유의 기대 자료 일치 확인
    assert json.loads(result.stderr)["failureReason"] == "SOURCE_NOT_FOUND"
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not output.exists()

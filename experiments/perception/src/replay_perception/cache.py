# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 명령행 옵션과 자료형을 검증할 도구 읽음
import argparse
# 기록과 설정을 직렬화할 도구 읽음
import json
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Sequence
# 모델 자산 관련 함수와 자료형 읽음
from .assets import directory, download

# 명령행 인자 검증과 진단·영상 작업 실행
def main(argv: Sequence[str] | None = None) -> int:
    # 명령행 해석기에 인자 명령행 해석기 처리 결과 저장
    parser = argparse.ArgumentParser(
        description="Fetch the fixed, verified RT-DETR-R18 experiment assets."
    )
    # 명령행에서 받을 대상 폴더의 형식과 기본값 등록
    parser.add_argument(
        "target_dir",
        nargs="?",
        type=Path,
        default=directory(),
    )
    # 인자 목록에 해석 인자 처리 결과 저장
    arguments = parser.parse_args(argv)
    # 메타데이터에 내려받기 처리 결과 저장
    metadata = download(arguments.target_dir)
    # 진행 또는 진단 결과를 지정 출력에 표시
    print(json.dumps(metadata, ensure_ascii=False, sort_keys=True))
    # 0 반환
    return 0


# 실행 모듈 이름 및 주심의 일치 조건 확인
if __name__ == "__main__":
    # 현재 오류를 호출자에게 전달
    raise SystemExit(main())

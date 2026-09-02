from __future__ import annotations

import argparse
import json
from pathlib import Path

from .application.pipeline import pipeline
from .infrastructure.ports import media


# 명령행 실행
def main() -> int:
    # 명령행 파서 생성
    parser = argparse.ArgumentParser(description="Run the Replay Lab video baseline pipeline")
    # 입력 영상 인자 등록
    parser.add_argument("source", type=Path)
    # 출력 경로 인자 등록
    parser.add_argument("output", type=Path)
    # 명령행 인자 해석
    args = parser.parse_args()
    # 파이프라인 실행
    result = pipeline(args.source, args.output, ports=media())
    # 요약 결과 출력
    print(json.dumps({"report": str(result.report_path), "candidates": len(result.candidates), "evidence": len(result.evidence)}, ensure_ascii=False))
    # 정상 종료 코드 반환
    return 0


if __name__ == "__main__":
    # CLI 진입점 실행
    raise SystemExit(main())

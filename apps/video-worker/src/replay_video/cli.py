# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 명령행 인자 읽기와 검증 도구 가져옴
import argparse
# 직렬화 자료 읽기와 기록 도구 가져옴
import json
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 영상 분석 단계 조립 함수 가져옴
from .application.pipeline import pipeline
# 영상 분석의 실제 구현 연결 함수 가져옴
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
    print(
        json.dumps(
            {
                # 생성된 분석 보고서 경로 기록
                "report": str(result.report_path),
                # 원시 변화 후보의 개수 기록과 파울 건수 해석 제외
                "candidates": len(result.candidates),
                # 생성한 증거 자료의 개수 기록
                "evidence": len(result.evidence),
            },
            ensure_ascii=False,
        )
    )
    # 정상 종료 코드 반환
    return 0


# 파일의 직접 실행 여부 확인
if __name__ == "__main__":
    # 명령줄 진입점 실행
    raise SystemExit(main())

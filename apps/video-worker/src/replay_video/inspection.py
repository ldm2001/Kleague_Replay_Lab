# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 명령행 인자 읽기와 검증 도구 가져옴
import argparse
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 진단과 운영 추적 요약이 공유하는 원시 신호 표본 기록 처리 가져옴
from .infrastructure.inspection import inspection

# 명령행 인자 검증과 진단·영상 작업 실행
def main() -> None:
    # 원시 신호 진단용 명령행 해석기 생성
    parser = argparse.ArgumentParser(description="모델 없는 영상 원시 신호 진단")
    # 원본 영상 경로 인자 등록
    parser.add_argument("source", type=Path)
    # 진단 출력 폴더 인자 등록
    parser.add_argument("output", type=Path)
    # 필수 경로 인자 읽음과 형식 확인
    args = parser.parse_args()
    # 진단을 실행하고 요약 경로 출력
    print(inspection(args.source, args.output))


# 파일의 직접 실행 여부 확인
if __name__ == "__main__":
    # 영상 진단 명령행 진입점 실행
    main()

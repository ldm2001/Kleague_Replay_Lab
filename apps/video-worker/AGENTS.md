# Video Worker 작업 지도

## 어디를 보는가

- `src/replay_video/application/` 파이프라인 조립과 포트
- `src/replay_video/domain/` 영상 메타데이터와 후보와 증거 모델
- `src/replay_video/infrastructure/` OpenCV 기반 probe와 shot과 candidate와 evidence 구현
- `src/replay_video/runner.py` API 작업 선점과 결과 제출
- `tests/` Worker 단위 테스트
- `README.md` 실행 계약과 산출물 형식

## 실행과 테스트

루트에서 `npm run test:video`를 사용한다
Worker 실행은 루트에서 `npm run dev:worker`를 사용한다
Python 패키지는 `apps/video-worker/pyproject.toml`을 기준으로 한다

## 핵심 제약

- AI 모델과 Gemma와 Ollama를 호출하지 않는다
- 사용자 입력과 사실 확인을 기다리지 않는다
- Worker는 영상에서 계산 가능한 메타데이터와 샷과 변화 후보와 프레임·클립만 만든다
- rules 적용은 웹 서버의 규정 엔진 책임이며 Worker가 파울을 판정하지 않는다
- `report.json`의 제한사항과 원본 시간축과 증거 경로를 보존한다
- 영상 파일은 저장소에 추가하지 않는다

상세 파이프라인 계약은 [README.md](README.md)와 [자동 처리 설계](../../docs/design/자동처리.md)를 본다
기존 Python 파일의 들여쓰기 정리는 필요한 줄만 한 줄씩 수정하고 전체 자동 포맷은 피한다

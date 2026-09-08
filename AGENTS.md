# Replay Lab 작업 지도

이 파일은 프로젝트를 설명하는 백과사전이 아니라 작업 시작점이다
세부 설계와 근거는 연결된 문서를 먼저 읽는다

## 구조

- `apps/web/` Next.js 프론트와 API와 PostgreSQL 어댑터와 rules 엔진
- `apps/video-worker/` Python 영상 처리 Worker
- `rules/` 원문 규정과 판본 메타데이터 원문은 저장소에 넣지 않음
- `docs/` 로컬 설계와 조사와 실행 기록
- `scripts/` Worker와 DB 마이그레이션 및 점검 스크립트
- `infra/` 로컬 인프라 설정

영역별 작업은 먼저 [apps/web/AGENTS.md](apps/web/AGENTS.md), [apps/video-worker/AGENTS.md](apps/video-worker/AGENTS.md), [rules/AGENTS.md](rules/AGENTS.md)를 읽는다

## 빌드와 테스트

```sh
npm run typecheck
npm test
npm run test:video
npm run check
```

개발 서버와 Worker는 각각 다음 명령으로 실행한다

```sh
npm run dev:web
npm run dev:worker
```

DB가 필요한 통합 테스트와 마이그레이션은 `DATABASE_URL`과 `npm run db:migrate`를 사용한다
실행 전 [docs/README.md](docs/README.md)와 [apps/video-worker/README.md](apps/video-worker/README.md)를 확인한다

## 절대 지키는 것

- 사용자가 대회와 시즌과 임계값과 사실을 설정하거나 확인하게 만들지 않는다
- Gemma와 Ollama와 생성형 모델과 새 AI 모델을 파이프라인에 추가하지 않는다
- 흐름은 `영상 → 파이프라인 → rules 필터 → 프론트 결과`다
- 화면 변화 점수와 후보 존재를 접촉이나 파울 판정으로 바꾸지 않는다
- 규정 판본을 업로드 날짜로 추정하지 않는다
- 규정 원문 PDF와 업로드 영상을 저장소에 추가하지 않는다
- 기존 마이그레이션을 수정하지 말고 새 마이그레이션을 추가한다
- 사용자의 미커밋 변경과 기존 테스트를 임의로 되돌리지 않는다

## 문서 진입점

- 제품과 현재 범위: [README.md](README.md)
- 문서 지도와 현재 작업 기준: [docs/README.md](docs/README.md)
- 자동 처리 계약: [docs/design/자동처리.md](docs/design/자동처리.md)
- 영상 조사와 설계: [docs/analysis/영상조사.md](docs/analysis/영상조사.md), [docs/design/영상설계.md](docs/design/영상설계.md)
- 규정 엔진: [docs/plans/규정엔진계획.md](docs/plans/규정엔진계획.md), [docs/design/아키텍처설계.md](docs/design/아키텍처설계.md)

## 작업 규칙

코드 위치를 찾을 때는 영역별 AGENTS.md와 docs 지도를 먼저 보고 그 다음 구현 파일을 연다
요구사항이 바뀌면 이 파일에는 방향과 링크만 갱신하고 세부 설명은 해당 문서에 기록한다
완료를 말하기 전 웹 타입체크와 테스트 및 Worker 테스트를 다시 실행한다
전체 포맷터로 파일을 일괄 재정렬하지 않는다
들여쓰기가 필요하면 필요한 줄만 한 줄씩 수정하고 각 변경을 diff로 확인한다

## 모델 교체 시 점검

모델을 바꿀 때는 모델 이름만 바꾸지 말고 모든 AGENTS.md와 `package.json`과 `.env.example`과 Worker 환경변수와 실행 문서와 테스트를 함께 검색한다
현재 제품 계약은 모델 미사용이므로 모델 도입은 별도 설계 승인 없이는 변경하지 않는다

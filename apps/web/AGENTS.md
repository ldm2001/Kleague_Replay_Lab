<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Web 앱 작업 지도

자동 생성된 Next.js 안내는 위 블록에 둔다
이 아래는 앱 탐색에 필요한 최소 정보만 둔다

## 어디를 보는가

- `src/app/` 라우트와 API 진입점
- `src/views/` 페이지 조립
- `src/components/` 화면 컴포넌트
- `src/application/` 유스케이스와 포트
- `src/adapters/` DB와 저장소 구현
- `src/rules/engine/` 규정 필터와 판정 로직
- `src/rules/data/` 실행용 정형 규정 데이터
- `test/` 애플리케이션·어댑터·규정 테스트

## 실행과 테스트

루트에서 `npm run dev:web`, `npm run typecheck`, `npm test`, `npm run check`를 사용한다
Next.js 상세 문서는 `node_modules/next/dist/docs/`에서 필요한 주제만 읽는다

## 핵심 제약

- 사용자는 영상 업로드 후 결과를 보며 분석 설정과 사실 입력을 하지 않는다
- AI 모델 호출과 Gemma와 Ollama 연결을 추가하지 않는다
- Worker 산출물을 rules 필터로 대조하고 프론트는 서버 결과를 표시한다
- 화면 변화 점수와 후보를 접촉·파울 판정으로 해석하지 않는다
- 규정 판본은 검증된 경기 정보로만 연결하고 업로드 날짜로 추정하지 않는다
- DB 마이그레이션은 기존 파일을 수정하지 않고 새 파일로 추가한다

현재 계약은 [자동 처리 설계](../../docs/design/자동처리.md), 규정은 [rules 지도](../../rules/AGENTS.md)를 본다

기존 파일의 들여쓰기 정리는 전체 포맷터를 사용하지 않고 필요한 줄만 한 줄씩 수정한다

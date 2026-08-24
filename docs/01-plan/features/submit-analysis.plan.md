# SubmitAnalysis 수직 슬라이스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증된 익명 세션 소유 영상으로 Analysis와 ANALYZE_VIDEO Job과 IdempotencyRecord를 한 PostgreSQL 트랜잭션에서 생성

**Architecture:** Application은 Clock Hasher SubmitAnalysisRepository Port만 사용한다. PostgreSQL Adapter는 Advisory Lock과 Drizzle Transaction을 사용해 같은 키 경합과 네 데이터 조회 및 저장을 처리한다. SQLSTATE와 Drizzle 타입은 Adapter 밖으로 노출하지 않는다.

**Tech Stack:** TypeScript · Drizzle ORM · PostgreSQL 16 · Vitest · postgres.js

---

### Task 1: Application Port와 SubmitAnalysis Use Case

**Files:**

- Create: `packages/application/package.json`
- Create: `packages/application/src/ports/clock/clock.ts`
- Create: `packages/application/src/ports/hashing/hasher.ts`
- Create: `packages/application/src/ports/repositories/submit-analysis-repository.ts`
- Create: `packages/application/src/use-cases/submit-analysis/submit-analysis.ts`
- Create: `packages/application/src/index.ts`
- Create: `packages/application/test/submit-analysis.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: 실패하는 Use Case 테스트 작성**

```ts
const repository = new RecordingSubmitAnalysisRepository({ kind: "CREATED", analysisId });
const submitAnalysis = createSubmitAnalysis({
  repository,
  clock: { now: () => new Date("2026-08-23T00:00:00.000Z") },
  hasher: { sha256: async (value) => new TextEncoder().encode(`hash:${value}`) },
  policy,
});

const result = await submitAnalysis(validInput);

expect(result).toEqual({ kind: "CREATED", analysisId });
expect(repository.lastCommand?.expiresAt).toBe("2026-08-24T00:00:00.000Z");
```

추가 테스트

- 빈 Idempotency Key는 `IDEMPOTENCY_KEY_REQUIRED`
- 200 UTF8 바이트 초과 키는 `IDEMPOTENCY_KEY_TOO_LONG`
- UUID 형식 오류는 `INVALID_ID`
- 선택 문자열은 trim하고 빈 값은 null
- 고정 필드 정규화 JSON을 해시 입력으로 전달
- Repository의 CREATED REPLAYED 충돌과 이용 불가 결과를 그대로 반환

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/application/test/submit-analysis.test.ts`

Expected: `createSubmitAnalysis` 모듈이 없어 실패

- [ ] **Step 3: Port와 Use Case 최소 구현**

```ts
export type SubmitAnalysisRepository = {
  submit(command: SubmitAnalysisCommand): Promise<SubmitAnalysisRepositoryResult>
}

export const createSubmitAnalysis = (dependencies: SubmitAnalysisDependencies) =>
  async (input: SubmitAnalysisInput): Promise<SubmitAnalysisResult> => {
    // 입력 검증 → 정규화 → 두 해시 → 시각 계산 → Repository 호출
  }
```

Repository Command에는 원문 Idempotency Key와 원문 정규화 JSON을 넣지 않고 두 SHA256 값만 포함

- [ ] **Step 4: Application 테스트와 타입 검사 통과 확인**

Run: `npx vitest run packages/application/test/submit-analysis.test.ts && npm run typecheck`

Expected: Application 테스트와 TypeScript 검사 통과

### Task 2: PostgreSQL SubmitAnalysis Repository Adapter

**Files:**

- Create: `packages/adapters/package.json`
- Create: `packages/adapters/src/database/postgres-submit-analysis-repository.ts`
- Create: `packages/adapters/src/hashing/node-sha256-hasher.ts`
- Create: `packages/adapters/src/index.ts`
- Create: `packages/adapters/test/postgres-submit-analysis-repository.integration.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: 실패하는 PostgreSQL 통합 테스트 작성**

```ts
const result = await repository.submit(command);

expect(result).toEqual({ kind: "CREATED", analysisId: expect.any(String) });
expect(await countRows("analyses")).toBe(1);
expect(await countRows("processing_jobs")).toBe(1);
expect(await countRows("idempotency_records")).toBe(1);
```

추가 테스트

- 같은 키와 같은 requestHash는 REPLAYED이며 행 수 불변
- 같은 키와 다른 requestHash는 IDEMPOTENCY_KEY_REUSED
- 다른 세션 영상과 REJECTED 영상과 만료 영상은 VIDEO_ASSET_UNAVAILABLE
- 규정 판본이 없는 경기는 RULE_VERSION_UNAVAILABLE
- 같은 영상에 다른 키는 VIDEO_ASSET_ALREADY_SUBMITTED
- 동시에 같은 요청 두 건은 CREATED 한 건과 REPLAYED 한 건으로 수렴

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://replay:replay@localhost:5432/replay_lab npx vitest run packages/adapters/test/postgres-submit-analysis-repository.integration.test.ts`

Expected: PostgreSQL Adapter 모듈이 없어 실패

- [ ] **Step 3: Drizzle Transaction 구현**

트랜잭션 순서

```text
pg_advisory_xact_lock
→ IdempotencyRecord 조회와 해시 비교
→ AnonymousSession 조회
→ 소유권과 상태와 만료를 포함한 VideoAsset 조회
→ Match 조회
→ 경기 날짜에 유효한 CompetitionRuleVersion 조회
→ Analysis INSERT RETURNING id
→ ANALYZE_VIDEO ProcessingJob INSERT
→ IdempotencyRecord INSERT
```

`analyses_video_asset_id_key` 유일 제약만 `VIDEO_ASSET_ALREADY_SUBMITTED`로 변환하고 나머지 DB 오류는 그대로 전파

- [ ] **Step 4: PostgreSQL 통합 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://replay:replay@localhost:5432/replay_lab npx vitest run packages/adapters/test/postgres-submit-analysis-repository.integration.test.ts`

Expected: 정상 멱등성 거부 경합 테스트 통과

- [ ] **Step 5: 전체 검증**

Run: `DATABASE_URL=postgresql://replay:replay@localhost:5432/replay_lab npm run check && npm audit --json`

Expected: 전체 테스트 통과와 취약점 0건

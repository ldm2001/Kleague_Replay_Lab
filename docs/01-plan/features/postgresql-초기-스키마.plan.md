# PostgreSQL 초기 스키마 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DBML의 16개 MVP 테이블을 PostgreSQL 16과 Drizzle ORM에서 같은 제약과 관계로 생성

**Architecture:** `packages/database`는 PostgreSQL 연결과 Drizzle 테이블 정의와 SQL 마이그레이션만 소유한다. 도메인과 Application 계층은 이 패키지를 직접 참조하지 않고 이후 Adapter를 통해 사용한다. DBML은 관계 설계 문서이고 마이그레이션 SQL은 PostgreSQL 제약의 실행 정의다.

**Tech Stack:** PostgreSQL 16 · Drizzle ORM · postgres.js · Vitest · Docker Compose

---

### Task 1: 데이터베이스 패키지와 의존성 계약

**Files:**

- Modify: `package.json`
- Create: `packages/database/package.json`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/test/schema-contract.test.ts`

- [ ] **Step 1: 실패하는 공개 API 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { schema } from "../src/index.js";

describe("database schema public contract", () => {
  it("exports every MVP table", () => {
    expect(Object.keys(schema).sort()).toEqual([
      "analyses", "anonymousSessions", "clubs", "competitionRuleVersions",
      "decisionResults", "evidenceAssets", "factRevisionShots", "factRevisions",
      "idempotencyRecords", "incidentCandidates", "matches", "officialVerdicts",
      "processingJobs", "rules", "shots", "videoAssets",
    ]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run packages/database/test/schema-contract.test.ts`

Expected: `Cannot find module ../src/index.js`

- [ ] **Step 3: 패키지 의존성과 빈 공개 진입점 추가**

`drizzle-orm`과 `postgres`를 런타임 의존성으로 추가한다

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run packages/database/test/schema-contract.test.ts`

Expected: 공개 테이블 계약 테스트 통과

### Task 2: 열거형과 관계형 테이블 정의

**Files:**

- Create: `packages/database/src/schema/enums.ts`
- Create: `packages/database/src/schema/tables.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/test/schema-contract.test.ts`

- [ ] **Step 1: 실패하는 제약 계약 테스트 추가**

```ts
it("keeps fact-shot evidence and idempotency as relational contracts", () => {
  expect(schema.factRevisionShots).toBeDefined();
  expect(schema.idempotencyRecords).toBeDefined();
  expect(schema.analyses).toBeDefined();
  expect(schema.processingJobs).toBeDefined();
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run packages/database/test/schema-contract.test.ts`

Expected: export assertion failure

- [ ] **Step 3: 최소 Drizzle 모델 작성**

`pgEnum`으로 DBML 열거형을 정의하고 `pgTable`로 16개 MVP 테이블을 정의한다

- UUID는 DB의 `gen_random_uuid()` 기본값을 사용한다
- 시간은 모두 `timestamp with time zone`으로 저장한다
- JSONB는 `facts` `citations` `evaluation_snapshot`에만 사용한다
- `fact_revision_shots`는 `(fact_revision_id, shot_id)` 복합 기본키를 사용한다
- FK와 유일 제약은 DBML의 소유권과 재현 경로에 맞춰 정의한다

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run packages/database/test/schema-contract.test.ts`

Expected: 16개 테이블과 관계형 연결 테이블 계약 통과

### Task 3: PostgreSQL 초기 마이그레이션

**Files:**

- Create: `packages/database/migrations/0000_initial_schema.sql`
- Create: `packages/database/migrations/meta/_journal.json`
- Create: `scripts/database/migrate.mjs`
- Create: `packages/database/test/migration.integration.test.ts`

- [ ] **Step 1: 실패하는 통합 테스트 작성**

```ts
it("creates all MVP tables and relational constraints", async () => {
  const tables = await database`
    select tablename from pg_tables
    where schemaname = 'public'
    order by tablename
  `;
  expect(tables.map((row) => row.tablename)).toContain("fact_revision_shots");
  expect(tables.map((row) => row.tablename)).toContain("processing_jobs");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `DATABASE_URL=postgresql://replay:replay@localhost:5432/replay_lab npx vitest run packages/database/test/migration.integration.test.ts`

Expected: 테이블이 없어 실패

- [ ] **Step 3: 마이그레이션 SQL 작성**

- `pgcrypto` 확장 활성화
- 열거형과 테이블과 FK와 유일 제약 생성
- Candidate 현재 Fact Revision 순환 FK는 테이블 생성 뒤 `DEFERRABLE INITIALLY DEFERRED` 제약으로 추가
- Candidate Fact Revision Evidence DecisionResult OfficialVerdict의 동일 Analysis 조건은 복합 FK로 추가
- TTL과 Job 선점 경로 인덱스 생성
- `citations` 비어 있음 방지 CHECK와 Job 대상 CHECK 추가
- 경쟁 대회 규정 적용 기간 겹침은 `daterange` exclusion constraint로 차단

- [ ] **Step 4: 마이그레이션 적용과 통합 테스트 통과 확인**

Run: `DATABASE_URL=postgresql://replay:replay@localhost:5432/replay_lab node scripts/database/migrate.mjs && DATABASE_URL=postgresql://replay:replay@localhost:5432/replay_lab npx vitest run packages/database/test/migration.integration.test.ts`

Expected: migration 성공과 스키마 통합 테스트 통과

### Task 4: 연결 구성과 회귀 검증

**Files:**

- Create: `packages/database/src/client/index.ts`
- Create: `packages/database/test/connection.test.ts`
- Modify: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: 실패하는 연결 테스트 작성**

```ts
it("fails clearly when DATABASE_URL is absent", async () => {
  await expect(createDatabaseClient(undefined)).rejects.toThrow("DATABASE_URL is required");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run packages/database/test/connection.test.ts`

Expected: `createDatabaseClient`를 찾지 못해 실패

- [ ] **Step 3: 최소 연결 팩토리 구현**

`createDatabaseClient`는 URL이 없으면 명확한 오류를 반환하고 URL이 있으면 postgres.js와 Drizzle 클라이언트를 생성한다

- [ ] **Step 4: 전체 검증 실행**

Run: `DATABASE_URL=postgresql://replay:replay@localhost:5432/replay_lab npm run check`

Expected: 타입 검사와 규정 검증과 기존 테스트와 DB 테스트 전체 통과

### Task 5: DBML과 실행 스키마 대조

**Files:**

- Modify: `docs/02-design/schema.dbml`
- Modify: `docs/02-design/schema-canvas.html`

- [ ] **Step 1: 관계와 삭제 정책 대조**

`schema.dbml`의 16개 테이블과 마이그레이션의 테이블 이름과 FK와 유일 제약을 대조한다

- [ ] **Step 2: VS Code DBML Canvas에서 렌더링 확인**

Run: VS Code에서 `docs/02-design/schema.dbml` 열기 → `DBML Canvas: Open Preview`

Expected: 16개 테이블과 `fact_revision_shots` 관계선이 렌더링되고 파서 오류 없음

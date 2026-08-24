# SubmitAnalysis 수직 슬라이스 설계

## 목표

검증이 끝난 익명 세션 소유 영상으로 Analysis와 ANALYZE_VIDEO ProcessingJob과 IdempotencyRecord를 하나의 PostgreSQL 트랜잭션에서 생성

같은 익명 세션에서 같은 Idempotency Key와 같은 요청을 다시 보내면 기존 Analysis 반환

같은 Idempotency Key에 다른 요청을 보내면 `IDEMPOTENCY_KEY_REUSED` 반환

## 범위

포함

- `SubmitAnalysis` Application Use Case
- 해시와 시각과 저장소 Port
- PostgreSQL SubmitAnalysis Repository Adapter
- 실제 PostgreSQL 통합 테스트
- 같은 키 동시 요청 직렬화
- VideoAsset 소유권과 상태와 만료 검증
- 경기 날짜 기준 규정 판본 선택
- Analysis와 Job과 IdempotencyRecord 원자적 생성

제외

- HTTP Route Handler
- 업로드 생성과 미디어 검증
- Worker Job 선점
- Object Storage 접근
- TTL Cleanup 실행
- 분석 결과 조회 화면

## 선택한 구조

### Application

`SubmitAnalysis`는 다음 Port에만 의존

- `Clock`
- `Hasher`
- `SubmitAnalysisRepository`

Use Case가 담당할 일

1 입력값 검증
2 Idempotency Key SHA256 생성
3 분석 요청의 정규화 JSON 생성과 SHA256 생성
4 현재 시각과 24시간 만료 시각 계산
5 Repository 호출
6 저장 결과를 Application 결과와 오류 코드로 변환

### PostgreSQL Adapter

`PostgresSubmitAnalysisRepository`가 Drizzle 트랜잭션 안에서 다음 순서 실행

1 `(anonymous_session_id, operation, key_hash)` 단위 `pg_advisory_xact_lock` 획득
2 기존 IdempotencyRecord 조회
3 기존 행의 request_hash가 같으면 기존 analysis_id 반환
4 기존 행의 request_hash가 다르면 Idempotency 충돌 반환
5 익명 세션이 만료되거나 취소되지 않았는지 확인
6 VideoAsset이 같은 세션 소유이며 `VALID`이고 만료되지 않았고 원본 바이트가 남아 있는지 확인
7 Match와 경기 날짜에 적용되는 CompetitionRuleVersion 조회
8 Analysis 생성
9 `ANALYZE_VIDEO` ProcessingJob 생성
10 IdempotencyRecord 생성
11 트랜잭션 커밋 후 새 analysis_id 반환

같은 영상을 다른 Idempotency Key로 다시 제출하면 `analyses.video_asset_id` 유일 제약에 따라 `VIDEO_ASSET_ALREADY_SUBMITTED` 반환

## 입력 계약

```ts
type SubmitAnalysisInput = {
  anonymousSessionId: string
  videoAssetId: string
  matchId: string
  idempotencyKey: string
  sourceUrl?: string
  sourcePlatform?: string
}
```

사용자가 제어하지 않는 값은 생성 시 주입한 정책에서 읽음

```ts
type SubmitAnalysisPolicy = {
  retentionMs: 86_400_000
  pipelineVersion: string
  mediaPolicyVersion: string
  jobPayloadVersion: number
  maxJobAttempts: number
}
```

## 결과 계약

```ts
type SubmitAnalysisResult =
  | { kind: "CREATED"; analysisId: string }
  | { kind: "REPLAYED"; analysisId: string }
  | { kind: "IDEMPOTENCY_KEY_REUSED" }
  | { kind: "VIDEO_ASSET_UNAVAILABLE" }
  | { kind: "VIDEO_ASSET_ALREADY_SUBMITTED" }
  | { kind: "MATCH_UNAVAILABLE" }
  | { kind: "RULE_VERSION_UNAVAILABLE" }
  | {
      kind: "INVALID_INPUT"
      reason: "IDEMPOTENCY_KEY_REQUIRED" | "IDEMPOTENCY_KEY_TOO_LONG" | "INVALID_ID"
    }
```

존재하지 않는 영상과 다른 세션 소유 영상과 만료된 영상은 모두 `VIDEO_ASSET_UNAVAILABLE`로 합쳐 소유권 정보를 노출하지 않음

## 요청 해시

request_hash 입력

- anonymousSessionId
- videoAssetId
- matchId
- sourceUrl 또는 null
- sourcePlatform 또는 null
- pipelineVersion
- mediaPolicyVersion

객체 키를 고정한 정규화 JSON의 UTF8 바이트를 SHA256으로 처리

Idempotency Key는 UTF8 기준 1바이트 이상 200바이트 이하로 제한

세 ID는 UUID 형식을 요구하고 선택 문자열은 앞뒤 공백을 제거한 뒤 빈 문자열을 null로 정규화

Idempotency Key 원문과 정규화 요청 원문은 DB와 로그에 저장하지 않음

## Analysis와 Job 초기값

Analysis

- status `QUEUED`
- retention_class `TEMPORARY`
- source_fingerprint `video_assets.content_sha256`
- applied_rule_version_id는 경기 날짜 기준 조회 결과
- state_version `0`
- expires_at `created_at + 24시간`

ProcessingJob

- job_type `ANALYZE_VIDEO`
- status `QUEUED`
- job_revision `0`
- attempt `0`
- max_attempts는 정책값
- next_attempt_at 현재 시각

## 실패와 경합 처리

- 동일 키 동시 요청은 Transaction Advisory Lock으로 직렬화
- DB 트랜잭션 밖에서 외부 호출을 수행하지 않음
- 트랜잭션 실패 시 Analysis Job IdempotencyRecord가 모두 롤백
- PostgreSQL `40001`과 `40P01`은 Adapter가 직접 무한 재시도하지 않고 상위 요청 경계가 제한된 재시도를 결정
- 유일 제약 위반은 제약 이름을 확인해 `VIDEO_ASSET_ALREADY_SUBMITTED`와 예기치 않은 오류를 구분

## 테스트

Application 단위 테스트

- 고정 Clock과 Hasher를 사용해 Repository Command 검증
- 빈 Idempotency Key 거부
- Repository 결과별 Application 결과 매핑

PostgreSQL 통합 테스트

- 정상 생성 시 세 테이블에 한 건씩 저장
- 같은 키와 같은 요청 재전송 시 행 수 증가 없음
- 같은 키와 다른 요청 시 충돌 반환
- 다른 세션 영상과 미검증 영상과 만료 영상 거부
- 규정 판본이 없는 경기 거부
- 같은 영상에 다른 키를 사용한 재요청 거부
- 두 동시 요청이 하나의 Analysis로 수렴
- Job 생성 실패를 유도하면 Analysis와 IdempotencyRecord도 남지 않음

## 의존 방향

```text
packages/application
  SubmitAnalysis Use Case와 Port
         ↑ 구현
packages/adapters
  PostgresSubmitAnalysisRepository
         ↓ 사용
packages/database
  Drizzle Query Schema와 PostgreSQL Client
```

Application은 Drizzle과 postgres.js와 SQLSTATE를 알지 않음

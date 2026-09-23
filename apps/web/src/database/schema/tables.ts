// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql } from "drizzle-orm";
// 저장소 질의와 자료 구조 정의 기능 가져옴
import {
    bigint,
    boolean,
    check,
    customType,
    date,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    real,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar
} from "drizzle-orm/pg-core";
// 저장 자료 구조와 허용 상태 목록 가져옴
import {
    announcedBy,
    cameraSufficiency,
    candidateReviewStatus,
    decisionMatch,
    disciplinaryAction,
    evidenceKind,
    factSource,
    foulDecision,
    idempotencyOperation,
    inconclusiveReason,
    jobEventType,
    jobStage,
    jobStatus,
    jobType,
    observedGoalDecision,
    observedRestartBeneficiary,
    observedRestartType,
    observedSource,
    officialVerdictStatus,
    officialVerdictValue,
    playbackSpeed,
    retentionClass,
    reviewScenario,
    severity,
    varCategory,
    varIntervention,
    varNoInterventionReason,
    varNotReviewableReason,
    varReviewProcedure,
    varThresholdResult,
    varWindowClosedReason,
    varWindowException,
    uploadIntentStatus,
    videoAssetStatus
} from "./enums";

// 데이터 접근 계층 조회 스키마와 마이그레이션 계약

// 파일 해시 바이트를 저장할 이진 열 자료형 생성
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    // 이진 바이트 열에 대응하는 데이터베이스 자료형
    dataType: () => "bytea",
});

// 시간 기본값
const stamp = () => timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow();

// 고유 식별자 기본값
const id = () => uuid().primaryKey().default(sql`gen_random_uuid()`);

// 익명 세션 테이블
export const anonymousSessions = pgTable("anonymous_sessions", {
    // 다른 기록과 구별하는 고유 식별자
    id: id(),
    // 원문 토큰 대신 비교에 사용하는 해시
    tokenHash: bytea("token_hash").notNull().unique(),
    // 기록이 처음 생성된 시각
    createdAt: stamp(),
    // 세션을 마지막으로 사용한 시각
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    // 세션 권한이 철회된 시각
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
});

// 구단 테이블
export const clubs = pgTable("clubs", {
    // 다른 기록과 구별하는 고유 식별자
    id: id(),
    // 경기 문맥 대조에 사용하는 정식 구단명
    canonicalName: text("canonical_name").notNull(),
    // 구단을 구별하는 짧은 코드
    shortCode: varchar("short_code", { length: 8 }).notNull().unique(),
    // 기록이 처음 생성된 시각
    createdAt: stamp(),
});

// 경기 기본 정보 테이블
export const matches = pgTable("matches", {
    // 다른 기록과 구별하는 고유 식별자
    id: id(),
    // 규정 적용 대상 대회
    competition: varchar({ length: 64 }).notNull(),
    // 규정 적용 대상 시즌
    season: varchar({ length: 16 }).notNull(),
    // 업로드 날짜와 구분한 실제 경기 날짜
    matchDate: date("match_date", { mode: "string" }).notNull(),
    // 홈 구단 기록의 식별자
    homeClubId: uuid("home_club_id").references(() => clubs.id),
    // 원정 구단 기록의 식별자
    awayClubId: uuid("away_club_id").references(() => clubs.id),
    // 확인된 홈 구단 점수
    scoreHome: smallint("score_home"),
    // 확인된 원정 구단 점수
    scoreAway: smallint("score_away"),
});

// 대회 규정 판본 테이블
export const competitionRuleVersions = pgTable("competition_rule_versions", {
    // 다른 기록과 구별하는 고유 식별자
    id: id(),
    // 규정 적용 대상 대회
    competition: varchar({ length: 64 }).notNull(),
    // 규정 적용 대상 시즌
    season: varchar({ length: 16 }).notNull(),
    // 규정 판본의 적용 시작 날짜
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    // 규정 판본의 적용 종료 날짜
    effectiveTo: date("effective_to", { mode: "string" }),
    // 국제 축구 규정의 판본
    ifabEdition: varchar("ifab_edition", { length: 16 }).notNull(),
    // 규정 검증에 사용한 원문 출처
    sourceDocument: text("source_document"),
    // 규정 문맥의 검증 상태
    verificationStatus: varchar("verification_status", { length: 32 }).notNull(),
});

// 업로드 영상 자산 테이블
export const videoAssets = pgTable("video_assets", {
    // 다른 기록과 구별하는 고유 식별자
    id: id(),
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: uuid("anonymous_session_id")
        .notNull()
        .references(() => anonymousSessions.id),
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: text("object_key").notNull().unique(),
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256: bytea("content_sha256").notNull(),
    // 파일의 실제 또는 허용 콘텐츠 형식
    contentType: varchar("content_type", { length: 128 }).notNull(),
    // 파일의 바이트 크기
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    // 영상 전체 길이의 밀리초 값
    durationMs: integer("duration_ms"),
    // 영상 또는 증거 이미지의 가로 크기
    width: integer(),
    // 영상 또는 증거 이미지의 세로 크기
    height: integer(),
    // 처리 상태 또는 요청 응답 상태
    status: videoAssetStatus().notNull(),
    // 규정 적용 대상 대회
    competition: varchar({ length: 64 }).notNull().default("K리그1"),
    // 규정 적용 대상 시즌
    season: varchar({ length: 16 }).notNull().default("2026"),
    // 동시 변경 충돌을 감지하는 상태 버전
    stateVersion: integer("state_version").notNull().default(0),
    // 영상 유효성 검사 실패 사유
    validationErrorCode: varchar("validation_error_code", { length: 64 }),
    // 영상 사용 권리를 확인한 시각
    rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true, mode: "string" }),
    // 기록이 처음 생성된 시각
    createdAt: stamp(),
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    // 저장 파일을 삭제한 시각
    objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true, mode: "string" })
});

// 업로드 의도 테이블
export const uploadIntents = pgTable(
    "upload_intents",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: uuid("anonymous_session_id")
            .notNull()
            .references(() => anonymousSessions.id),
        // 객체 저장소에서 파일을 찾는 경로
        objectKey: text("object_key").notNull().unique(),
        // 업로드 전에 신고한 파일 바이트 크기
        expectedSizeBytes: bigint("expected_size_bytes", { mode: "number" }).notNull(),
        // 업로드 전에 신고한 콘텐츠 형식
        declaredContentType: varchar("declared_content_type", { length: 128 }).notNull(),
        // 영상 사용 권리를 확인한 시각
        rightsConfirmedAt: timestamp("rights_confirmed_at", {
            // 시각 값의 시간대 포함 여부
            withTimezone: true,
            // 자료를 해석하거나 표시하는 방식
            mode: "string"
        }).notNull(),
        // 처리 상태 또는 요청 응답 상태
        status: uploadIntentStatus().notNull(),
        // 파일 보존과 허용 형식 정책의 버전
        mediaPolicyVersion: varchar("media_policy_version", { length: 64 }).notNull(),
        // 규정 적용 대상 대회
        competition: varchar({ length: 64 }).notNull().default("K리그1"),
        // 규정 적용 대상 시즌
        season: varchar({ length: 16 }).notNull().default("2026"),
        // 기록이 처음 생성된 시각
        createdAt: stamp(),
        // 접근과 보존을 허용하는 만료 시각
        expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
        // 해당 처리가 끝난 시각
        completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" })
    },
    (table) => [
        uniqueIndex("upload_intents_session_status_expiry_idx").on(
            table.anonymousSessionId,
            table.status,
            table.expiresAt
        )
    ]
);

// 분석 작업 테이블
export const analyses = pgTable(
    "analyses",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: uuid("anonymous_session_id").references(() => anonymousSessions.id),
        // 검증된 경기 기록의 식별자
        matchId: uuid("match_id").references(() => matches.id),
        // 업로드된 원본 영상 기록의 식별자
        videoAssetId: uuid("video_asset_id").references(() => videoAssets.id),
        // 처리 상태 또는 요청 응답 상태
        status: varchar({ length: 32 }).notNull(),
        // 영상과 결과에 적용하는 보존 분류
        retentionClass: retentionClass("retention_class").notNull(),
        // 원본 영상의 출처 주소
        sourceUrl: text("source_url"),
        // 원본 영상을 제공한 플랫폼
        sourcePlatform: varchar("source_platform", { length: 64 }),
        // 분석 대상 원본과의 일치 확인용 해시
        sourceFingerprint: bytea("source_fingerprint"),
        // 분석에 연결한 대회 규정 판본 식별자
        appliedRuleVersionId: uuid("applied_rule_version_id").references(
            () => competitionRuleVersions.id
        ),
        // 영상 처리 절차를 구별하는 버전
        pipelineVersion: varchar("pipeline_version", { length: 64 }),
        // 파일 보존과 허용 형식 정책의 버전
        mediaPolicyVersion: varchar("media_policy_version", { length: 64 }),
        // 동시 변경 충돌을 감지하는 상태 버전
        stateVersion: integer("state_version").notNull().default(0),
        // 처리 실패 원인을 구별하는 코드
        failureCode: varchar("failure_code", { length: 64 }),
        // 처리가 제공하지 못하는 관측의 한계
        limitations: jsonb()
            .$type<string[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        // 기록이 처음 생성된 시각
        createdAt: stamp(),
        // 해당 처리가 끝난 시각
        completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
        // 접근과 보존을 허용하는 만료 시각
        expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
    },
    (table) => [uniqueIndex("analyses_video_asset_id_unique").on(table.videoAssetId)]
);

// 작업자 처리 작업 테이블
export const processingJobs = pgTable("processing_jobs", {
    // 다른 기록과 구별하는 고유 식별자
    id: id(),
    // 분석 기록의 식별자
    analysisId: uuid("analysis_id").references(() => analyses.id),
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: uuid("video_asset_id").references(() => videoAssets.id),
    // 영상 검증과 분석의 작업 구분
    jobType: jobType("job_type").notNull(),
    // 처리 상태 또는 요청 응답 상태
    status: jobStatus().notNull(),
    // 작업 입력 자료 구조의 버전
    payloadVersion: integer("payload_version").notNull(),
    // 현재 영상 처리 단계
    stage: jobStage().notNull().default("QUEUED"),
    // 작업 진행률의 백분율
    progressPercent: smallint("progress_percent").notNull().default(0),
    // 작업자가 마지막으로 생존을 알린 시각
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "string" }),
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: integer("job_revision").notNull().default(0),
    // 현재 작업 실행 시도 횟수
    attempt: smallint().notNull().default(0),
    // 허용하는 최대 실행 시도 횟수
    maxAttempts: smallint("max_attempts").notNull(),
    // 현재 작업을 임대한 작업자 식별자
    leaseOwner: varchar("lease_owner", { length: 128 }),
    // 작업 임대 권한 비교용 토큰 해시
    leaseTokenHash: bytea("lease_token_hash"),
    // 현재 작업 임대의 유효 기한
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "string" }),
    // 실패한 작업을 다시 시도할 수 있는 시각
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "string" }),
    // 처리 실패 원인을 구별하는 코드
    failureCode: varchar("failure_code", { length: 64 }),
    // 실패 후 재시도 허용 여부
    retryable: boolean(),
    // 기록이 처음 생성된 시각
    createdAt: stamp(),
    // 기록이 마지막으로 변경된 시각
    updatedAt: stamp(),
});

// 비공개 운영 관측 결과 테이블
export const analysisAutomaticReviews = pgTable(
    "analysis_automatic_reviews",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: uuid("id").primaryKey().defaultRandom(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id")
            .notNull()
            .references(() => analyses.id, { onDelete: "cascade" }),
        // 처리 작업의 식별자
        jobId: uuid("job_id")
            .notNull()
            .references(() => processingJobs.id, { onDelete: "cascade" }),
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: integer("job_revision").notNull(),
        // 분석한 원본 영상의 내용 해시
        sourceSha256: bytea("source_sha256").notNull(),
        // 자동 평가 계약을 구별하는 버전
        evaluatorVersion: varchar("evaluator_version", { length: 32 }).notNull(),
        // 영상 처리 절차를 구별하는 버전
        pipelineVersion: varchar("pipeline_version", { length: 64 }).notNull(),
        // 세부 자료에서 보존할 처리 요약
        summary: jsonb("summary").notNull(),
        // 제출 증거 순서와 저장 식별자의 연결
        evidenceBindings: jsonb("evidence_bindings").notNull(),
        // 기록이 처음 생성된 시각
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        // 접근과 보존을 허용하는 만료 시각
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
    },
    (table) => [
        uniqueIndex("analysis_automatic_reviews_job_revision_unique").on(
            table.jobId,
            table.jobRevision
        ),
        index("analysis_automatic_reviews_analysis_idx").on(table.analysisId),
        check("analysis_automatic_reviews_revision_check", sql`${table.jobRevision} > 0`),
        check(
            "analysis_automatic_reviews_source_check",
            sql`octet_length(${table.sourceSha256}) = 32`
        ),
        check(
            "analysis_automatic_reviews_version_check",
            sql`${table.evaluatorVersion} = 'automatic-review-v1'`
        ),
        check(
            "analysis_automatic_reviews_expiry_check",
            sql`${table.expiresAt} > ${table.createdAt}`
        )
    ]
);

// 공개 사실과 분리한 모델 관측 실행 이력 테이블 정의
export const analysisPerceptionRuns = pgTable(
    "analysis_perception_runs",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id")
            .notNull()
            .references(() => analyses.id, { onDelete: "cascade" }),
        // 처리 작업의 식별자
        jobId: uuid("job_id")
            .notNull()
            .references(() => processingJobs.id),
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: integer("job_revision").notNull(),
        // 저장하거나 제출하는 자료 구조 버전
        schemaVersion: varchar("schema_version", { length: 32 }).notNull(),
        // 영상 처리 절차를 구별하는 버전
        pipelineVersion: varchar("pipeline_version", { length: 64 }).notNull(),
        // 분석한 원본 영상의 내용 해시
        sourceSha256: bytea("source_sha256").notNull(),
        // 비공개 관측 원문 파일의 저장 경로
        artifactObjectKey: text("artifact_object_key").notNull(),
        // 비공개 관측 원문 파일의 내용 해시
        artifactSha256: bytea("artifact_sha256").notNull(),
        // 비공개 관측 원문 파일의 바이트 크기
        artifactSizeBytes: bigint("artifact_size_bytes", { mode: "number" }).notNull(),
        // 사용한 모델과 고정 가중치의 출처
        modelProvenance: jsonb("model_provenance")
            .$type<import("@replay/shared-types").PerceptionModelProvenance[]>()
            .notNull(),
        // 세부 자료에서 보존할 처리 요약
        summary: jsonb().$type<Record<string, unknown>>().notNull(),
        // 기록이 처음 생성된 시각
        createdAt: stamp(),
        // 접근과 보존을 허용하는 만료 시각
        expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
        // 저장 파일을 삭제한 시각
        objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true, mode: "string" })
    },
    (table) => [
        uniqueIndex("analysis_perception_runs_job_revision_unique").on(
            table.jobId,
            table.jobRevision
        ),
        uniqueIndex("analysis_perception_runs_artifact_object_key_unique").on(
            table.artifactObjectKey
        ),
        index("analysis_perception_runs_analysis_idx").on(table.analysisId),
        check(
            "analysis_perception_runs_version_pair_check",
            sql`(${table.schemaVersion} = 'perception-run-v1' and ${table.pipelineVersion} = 'video-local-observers-v1') or (${table.schemaVersion} = 'perception-run-v2' and ${table.pipelineVersion} = 'video-local-observers-av-v1')`
        ),
        check("analysis_perception_runs_job_revision_check", sql`${table.jobRevision} > 0`),
        check(
            "analysis_perception_runs_source_sha256_check",
            sql`octet_length(${table.sourceSha256}) = 32`
        ),
        check(
            "analysis_perception_runs_artifact_sha256_check",
            sql`octet_length(${table.artifactSha256}) = 32`
        ),
        check(
            "analysis_perception_runs_artifact_key_check",
            sql`${table.artifactObjectKey} = 'perception/' || ${table.analysisId}::text || '/' || ${table.jobId}::text || '/' || ${table.jobRevision}::text || '/' || encode(${table.artifactSha256}, 'hex') || '.jsonl.gz'`
        ),
        check(
            "analysis_perception_runs_artifact_size_check",
            sql`${table.artifactSizeBytes} > 0 and ${table.artifactSizeBytes} <= 134217728`
        ),
        check(
            "analysis_perception_runs_model_provenance_check",
            sql`jsonb_typeof(${table.modelProvenance}) = 'array' and jsonb_array_length(${table.modelProvenance}) = 3 and octet_length(${table.modelProvenance}::text) <= 16384`
        ),
        check(
            "analysis_perception_runs_summary_check",
            sql`jsonb_typeof(${table.summary}) = 'object' and jsonb_typeof(${table.summary}->'incidents') = 'array' and jsonb_typeof(${table.summary}->'admission') = 'object' and octet_length(${table.summary}::text) <= 1048576 and ((${table.schemaVersion} = 'perception-run-v1' and not (${table.summary} ? 'audio')) or (${table.schemaVersion} = 'perception-run-v2' and coalesce(jsonb_typeof(${table.summary}->'audio') = 'object', false)))`
        ),
        check("analysis_perception_runs_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`)
    ]
);

// 작업자 처리 이벤트 테이블
export const processingJobEvents = pgTable(
    "processing_job_events",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 처리 작업의 식별자
        jobId: uuid("job_id")
            .notNull()
            .references(() => processingJobs.id),
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: integer("job_revision").notNull(),
        // 현재 작업 실행 시도 횟수
        attempt: smallint().notNull(),
        // 작업 상태 변화의 종류
        eventType: jobEventType("event_type").notNull(),
        // 현재 영상 처리 단계
        stage: jobStage().notNull(),
        // 작업 진행률의 백분율
        progressPercent: smallint("progress_percent").notNull(),
        // 처리 진행 또는 실패의 안내 문구
        message: text(),
        // 기록이 처음 생성된 시각
        createdAt: stamp()
    },
    (table) => [
        index("processing_job_events_job_time_idx").on(table.jobId, table.createdAt, table.id)
    ]
);

// 판정 후보 장면 테이블
export const incidentCandidates = pgTable(
    "incident_candidates",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id")
            .notNull()
            .references(() => analyses.id),
        // 처리 결과에서 후보 장면을 찾는 순번
        candidateIndex: integer("candidate_index").notNull(),
        // 후보 장면에 적용할 규정 검토 유형
        reviewScenario: reviewScenario("review_scenario").notNull(),
        // 원본 영상 기준 구간 시작 밀리초
        startMs: integer("start_ms").notNull(),
        // 원본 영상 기준 구간 종료 밀리초
        endMs: integer("end_ms").notNull(),
        // 장면을 대표하는 원본 영상 시각
        anchorMs: integer("anchor_ms"),
        // 방송 화면에 표시된 경기 시각
        broadcastClock: varchar("broadcast_clock", { length: 16 }),
        // 후보 검출의 신뢰도이며 파울 확률과 별개인 값
        detectionConfidence: real("detection_confidence"),
        // 관측에 필요한 화면의 충분성
        cameraSufficiency: cameraSufficiency("camera_sufficiency").notNull(),
        // 후보 생성 또는 처리 결과의 근거 사유
        reasons: jsonb()
            .$type<string[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        // 후보에 연결한 화면 구간 순번 목록
        shotIndices: jsonb("shot_indices")
            .$type<number[]>()
            .notNull()
            .default(sql`'[]'::jsonb`),
        // 현재 참조하는 사실 기록 판본 식별자
        currentFactRevisionId: uuid("current_fact_revision_id"),
        // 동일 물체의 연속 이동 관측
        tracking: jsonb().$type<import("@replay/shared-types").TrackingSummary>(),
        // 장면에서 인식한 사건과 근거
        sceneEvent: jsonb("scene_event").$type<import("@replay/shared-types").SceneEvent>(),
        // 규정 사실과 구분하여 보존하는 방송 단서
        broadcastCue: jsonb("broadcast_cue").$type<import("@replay/shared-types").BroadcastCue>(),
        // 과거 관찰 전송 자료 보존용 필드 현재 작업자는 채우지 않음
        observation: jsonb().$type<import("@replay/shared-types").SceneObservation>(),
        // 후보에 대한 규정 검토 진행 상태
        reviewStatus: candidateReviewStatus("review_status").notNull(),
        // 기록이 처음 생성된 시각
        createdAt: stamp()
    },
    (table) => [
        uniqueIndex("incident_candidates_analysis_index_unique").on(
            table.analysisId,
            table.candidateIndex
        ),
        uniqueIndex("incident_candidates_id_analysis_unique").on(table.id, table.analysisId)
    ]
);

// 영상 샷 테이블
export const shots = pgTable(
    "shots",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
        // 영상의 화면 구간 순번
        shotIndex: integer("shot_index").notNull(),
        // 원본 영상 기준 구간 시작 밀리초
        startMs: integer("start_ms").notNull(),
        // 원본 영상 기준 구간 종료 밀리초
        endMs: integer("end_ms").notNull(),
        // 일반 재생과 느린 재생의 구분
        playbackSpeed: playbackSpeed("playback_speed").notNull(),
        // 재방송 장면 여부와 미확정 상태
        isReplay: boolean("is_replay"),
        // 화면에서 확인한 촬영 시점 구분
        cameraAngleLabel: varchar("camera_angle_label", { length: 64 }),
    },
    (table) => [
        uniqueIndex("shots_analysis_index_unique").on(table.analysisId, table.shotIndex),
        uniqueIndex("shots_id_analysis_unique").on(table.id, table.analysisId),
    ],
);

// 사실 수정 이력 테이블
export const factRevisions = pgTable(
    "fact_revisions",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id")
            .notNull()
            .references(() => analyses.id),
        // 증거 또는 판단과 연결한 후보 식별자
        incidentCandidateId: uuid("incident_candidate_id")
            .notNull()
            .references(() => incidentCandidates.id),
        // 변경 이력을 구별하는 판본 번호
        revision: integer().notNull(),
        // 확인된 출처와 판본을 보존하는 규정 사실 자료
        facts: jsonb().$type<Record<string, unknown>>().notNull(),
        // 사실 입력 자료 구조의 버전
        factSchemaVersion: integer("fact_schema_version").notNull(),
        // 값의 출처 또는 원본 접근 수단
        source: factSource().notNull(),
        // 관측 또는 추출 결과의 신뢰도
        extractionConfidence: real("extraction_confidence"),
        // 관측에 사용한 모델 버전
        modelVersion: varchar("model_version", { length: 64 }),
        // 기록이 처음 생성된 시각
        createdAt: stamp()
    },
    (table) => [
        uniqueIndex("fact_revisions_candidate_revision_unique").on(
            table.incidentCandidateId,
            table.revision
        ),
        uniqueIndex("fact_revisions_id_analysis_unique").on(table.id, table.analysisId),
        uniqueIndex("fact_revisions_id_candidate_analysis_unique").on(
            table.id,
            table.incidentCandidateId,
            table.analysisId
        )
    ]
);

// 사실 이력과 샷 연결 테이블
export const factRevisionShots = pgTable(
    "fact_revision_shots",
    {
        // 평가에 사용한 사실 판본 식별자
        factRevisionId: uuid("fact_revision_id").notNull().references(() => factRevisions.id),
        // 증거와 연결한 화면 구간 식별자
        shotId: uuid("shot_id").notNull().references(() => shots.id),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    },
    (table) => [
        primaryKey({
            // 저장소 요청에서 사용하는 파일 이름
            name: "fact_revision_shots_pkey",
            // 키나 제약에 참여하는 저장 열 목록
            columns: [table.factRevisionId, table.shotId],
        }),
    ],
);

// 프레임과 클립 증거 테이블
export const evidenceAssets = pgTable(
    "evidence_assets",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
        // 증거 또는 판단과 연결한 후보 식별자
        incidentCandidateId: uuid("incident_candidate_id").references(() => incidentCandidates.id),
        // 처리 분기 또는 자료 종류를 구별하는 값
        kind: evidenceKind().notNull(),
        // 객체 저장소에서 파일을 찾는 경로
        objectKey: text("object_key").notNull().unique(),
        // 파일 내용의 동일성을 대조하는 해시
        contentSha256: bytea("content_sha256").notNull(),
        // 원본 영상 기준 구간 시작 밀리초
        startMs: integer("start_ms"),
        // 원본 영상 기준 구간 종료 밀리초
        endMs: integer("end_ms"),
        // 영상 또는 증거 이미지의 가로 크기
        width: integer(),
        // 영상 또는 증거 이미지의 세로 크기
        height: integer(),
        // 기록이 처음 생성된 시각
        createdAt: stamp(),
        // 접근과 보존을 허용하는 만료 시각
        expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
        // 저장 파일을 삭제한 시각
        objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true, mode: "string" }),
    },
    (table) => [uniqueIndex("evidence_assets_id_analysis_unique").on(table.id, table.analysisId)],
);

// 규정 원문과 인용 테이블
export const rules = pgTable(
    "rules",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 인용 규정을 발행한 기관
        authority: varchar({ length: 16 }).notNull(),
        // 인용 규정의 적용 판본
        edition: varchar({ length: 16 }).notNull(),
        // 판단에 인용한 규정 조항
        law: varchar({ length: 32 }).notNull(),
        // 규정 조항 내부의 세부 절
        section: varchar({ length: 128 }).notNull(),
        // 규정에서 설명하는 핵심 개념
        concept: varchar({ length: 128 }).notNull(),
        // 변경 이력을 구별하는 판본 번호
        revision: integer().notNull(),
        // 파일 내용의 동일성을 대조하는 해시
        contentSha256: bytea("content_sha256").notNull(),
        // 규정 원문의 해당 문장
        originalText: text("original_text"),
        // 공식 한국어 규정 문구
        officialKorean: text("official_korean"),
        // 사용자에게 제공하는 쉬운 한국어 설명
        plainKorean: text("plain_korean"),
        // 원문 문서에서 근거를 찾는 쪽 번호
        sourcePage: varchar("source_page", { length: 32 }),
        // 원본 영상의 출처 주소
        sourceUrl: text("source_url"),
        // 후보에 대한 규정 검토 진행 상태
        reviewStatus: varchar("review_status", { length: 32 }).notNull()
    },
    (table) => [
        uniqueIndex("rules_revision_unique").on(
            table.authority,
            table.edition,
            table.law,
            table.section,
            table.concept,
            table.revision
        )
    ]
);

// 규정 엔진 판정 결과 테이블
export const decisionResults = pgTable(
    "decision_results",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id")
            .notNull()
            .references(() => analyses.id),
        // 증거 또는 판단과 연결한 후보 식별자
        incidentCandidateId: uuid("incident_candidate_id")
            .notNull()
            .references(() => incidentCandidates.id),
        // 평가에 사용한 사실 판본 식별자
        factRevisionId: uuid("fact_revision_id")
            .notNull()
            .references(() => factRevisions.id),
        // 분석에 연결한 대회 규정 판본 식별자
        appliedRuleVersionId: uuid("applied_rule_version_id")
            .notNull()
            .references(() => competitionRuleVersions.id),
        // 화면에서 관측한 경기 재개 방식
        observedRestartType: observedRestartType("observed_restart_type").notNull(),
        // 관측한 재개의 수혜 팀
        observedRestartBeneficiary: observedRestartBeneficiary(
            "observed_restart_beneficiary"
        ).notNull(),
        // 화면에서 관측한 카드 조치
        observedCard: disciplinaryAction("observed_card"),
        // 화면에서 관측한 득점 원심
        observedGoalDecision: observedGoalDecision("observed_goal_decision").notNull(),
        // 원심 관측의 출처
        observedSource: observedSource("observed_source").notNull(),
        // 규정 평가로 얻은 반칙 판단
        foulDecision: foulDecision("foul_decision"),
        // 규정 평가에서 구분한 행위의 심각도
        severity: severity(),
        // 규정 평가로 얻은 득점 관련 판단
        goalDecision: observedGoalDecision("goal_decision"),
        // 규정 평가에 따른 경기 재개 방식
        restartType: observedRestartType("restart_type"),
        // 규정 평가에 따른 징계 조치
        disciplinaryAction: disciplinaryAction("disciplinary_action"),
        // 관측 원심과 규정 평가의 일치 여부
        decisionMatch: decisionMatch("decision_match").notNull(),
        // 영상 판독 검토 대상 여부
        varReviewable: boolean("var_reviewable").notNull(),
        // 영상 판독의 적용 범주
        varCategory: varCategory("var_category").notNull(),
        // 영상 판독 허용 시점 충족 여부
        varWithinTimeWindow: boolean("var_within_time_window").notNull(),
        // 영상 판독 개입 문턱 충족 여부
        varThresholdMet: varThresholdResult("var_threshold_met").notNull(),
        // 영상 판독 개입 판단
        varIntervention: varIntervention("var_intervention").notNull(),
        // 영상 판독에 개입하지 않는 이유
        varNoInterventionReason: varNoInterventionReason("var_no_intervention_reason"),
        // 영상 판독 검토 대상이 아닌 이유
        varNotReviewableReason: varNotReviewableReason("var_not_reviewable_reason"),
        // 영상 판독 허용 시점이 지난 이유
        varWindowClosedReason: varWindowClosedReason("var_window_closed_reason"),
        // 영상 판독 시점 제한에 적용한 예외
        varWindowException: varWindowException("var_window_exception").notNull(),
        // 영상 판독 검토 절차
        varReviewProcedure: varReviewProcedure("var_review_procedure").notNull(),
        // 규정 판단 근거의 충분성 수준
        judgmentConfidenceLevel: varchar("judgment_confidence_level", { length: 16 }).notNull(),
        // 결론을 확정하지 못한 사유
        inconclusiveReason: inconclusiveReason("inconclusive_reason"),
        // 평가 사실 내용의 동일성 확인용 서명
        factSignature: bytea("fact_signature").notNull(),
        // 평가를 수행한 규정 엔진 버전
        ruleEngineVersion: varchar("rule_engine_version", { length: 64 }).notNull(),
        // 평가 결과 자료 구조의 버전
        evaluationSchemaVersion: integer("evaluation_schema_version").notNull(),
        // 평가 당시 결과 전체의 보존 자료
        evaluationSnapshot: jsonb("evaluation_snapshot").$type<Record<string, unknown>>().notNull(),
        // 판단 근거가 된 규정 인용 목록
        citations: jsonb().$type<unknown[]>().notNull(),
        // 판단에 인용한 규정 조항 목록
        citedLaws: text("cited_laws").array(),
        // 기록이 처음 생성된 시각
        createdAt: stamp()
    },
    (table) => [
        uniqueIndex("decision_results_input_unique").on(
            table.incidentCandidateId,
            table.factRevisionId,
            table.appliedRuleVersionId,
            table.ruleEngineVersion
        ),
        uniqueIndex("decision_results_id_analysis_unique").on(table.id, table.analysisId),
        uniqueIndex("decision_results_signature_cache").on(
            table.factSignature,
            table.appliedRuleVersionId,
            table.ruleEngineVersion
        )
    ]
);

// 공식 판정 기록 테이블
export const officialVerdicts = pgTable(
    "official_verdicts",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id")
            .notNull()
            .references(() => analyses.id),
        // 증거 또는 판단과 연결한 후보 식별자
        incidentCandidateId: uuid("incident_candidate_id")
            .notNull()
            .references(() => incidentCandidates.id),
        // 공식 판단을 발표한 주체 유형
        announcedBy: announcedBy("announced_by").notNull(),
        // 공식 판단을 발표한 주체 이름
        announcedByName: varchar("announced_by_name", { length: 128 }),
        // 공식 판단 발표 날짜
        announcedOn: date("announced_on", { mode: "string" }),
        // 발표된 공식 판단
        verdict: officialVerdictValue().notNull(),
        // 공식 판단의 근거 인용문
        quote: text(),
        // 원본 영상의 출처 주소
        sourceUrl: text("source_url"),
        // 처리 상태 또는 요청 응답 상태
        status: officialVerdictStatus().notNull()
    },
    (table) => [uniqueIndex("official_verdicts_id_analysis_unique").on(table.id, table.analysisId)]
);

// 중복 요청 방지 기록 테이블
export const idempotencyRecords = pgTable(
    "idempotency_records",
    {
        // 다른 기록과 구별하는 고유 식별자
        id: id(),
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: uuid("anonymous_session_id")
            .notNull()
            .references(() => anonymousSessions.id),
        // 중복 요청을 구분하는 처리 종류
        operation: idempotencyOperation().notNull(),
        // 멱등 요청 키의 해시
        keyHash: bytea("key_hash").notNull(),
        // 동일 키로 다른 요청을 보냈는지 확인하는 해시
        requestHash: bytea("request_hash").notNull(),
        // 분석 기록의 식별자
        analysisId: uuid("analysis_id")
            .notNull()
            .references(() => analyses.id),
        // 증거 또는 판단과 연결한 후보 식별자
        incidentCandidateId: uuid("incident_candidate_id").references(() => incidentCandidates.id),
        // 평가에 사용한 사실 판본 식별자
        factRevisionId: uuid("fact_revision_id").references(() => factRevisions.id),
        // 기록이 처음 생성된 시각
        createdAt: stamp(),
        // 접근과 보존을 허용하는 만료 시각
        expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull()
    },
    (table) => [
        uniqueIndex("idempotency_records_session_operation_key_unique").on(
            table.anonymousSessionId,
            table.operation,
            table.keyHash
        )
    ]
);

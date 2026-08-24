import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
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
  varchar,
} from "drizzle-orm/pg-core";
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
  videoAssetStatus,
} from "./enums";

/**
 * Drizzle query schema.
 *
 * PostgreSQL DDL is intentionally maintained in `database/migrations`.
 * Composite foreign keys, exclusion constraints, generated columns, partial indexes,
 * and append-only triggers are PostgreSQL contracts that this type model cannot fully express.
 * Every table change therefore requires a paired SQL migration and integration test.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const createdAt = () => timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow();
const id = () => uuid().primaryKey().default(sql`gen_random_uuid()`);

export const anonymousSessions = pgTable("anonymous_sessions", {
  id: id(),
  tokenHash: bytea("token_hash").notNull().unique(),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
});

export const clubs = pgTable("clubs", {
  id: id(),
  canonicalName: text("canonical_name").notNull(),
  shortCode: varchar("short_code", { length: 8 }).notNull().unique(),
  createdAt: createdAt(),
});

export const matches = pgTable("matches", {
  id: id(),
  competition: varchar({ length: 64 }).notNull(),
  season: varchar({ length: 16 }).notNull(),
  matchDate: date("match_date", { mode: "string" }).notNull(),
  homeClubId: uuid("home_club_id").references(() => clubs.id),
  awayClubId: uuid("away_club_id").references(() => clubs.id),
  scoreHome: smallint("score_home"),
  scoreAway: smallint("score_away"),
});

export const competitionRuleVersions = pgTable("competition_rule_versions", {
  id: id(),
  competition: varchar({ length: 64 }).notNull(),
  season: varchar({ length: 16 }).notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  ifabEdition: varchar("ifab_edition", { length: 16 }).notNull(),
  sourceDocument: text("source_document"),
  verificationStatus: varchar("verification_status", { length: 32 }).notNull(),
});

export const videoAssets = pgTable("video_assets", {
  id: id(),
  anonymousSessionId: uuid("anonymous_session_id").notNull().references(() => anonymousSessions.id),
  objectKey: text("object_key").notNull().unique(),
  contentSha256: bytea("content_sha256").notNull(),
  contentType: varchar("content_type", { length: 128 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  durationMs: integer("duration_ms"),
  width: integer(),
  height: integer(),
  status: videoAssetStatus().notNull(),
  stateVersion: integer("state_version").notNull().default(0),
  validationErrorCode: varchar("validation_error_code", { length: 64 }),
  rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true, mode: "string" }),
});

export const uploadIntents = pgTable(
  "upload_intents",
  {
    id: id(),
    anonymousSessionId: uuid("anonymous_session_id").notNull().references(() => anonymousSessions.id),
    objectKey: text("object_key").notNull().unique(),
    expectedSizeBytes: bigint("expected_size_bytes", { mode: "number" }).notNull(),
    declaredContentType: varchar("declared_content_type", { length: 128 }).notNull(),
    rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true, mode: "string" }).notNull(),
    status: uploadIntentStatus().notNull(),
    mediaPolicyVersion: varchar("media_policy_version", { length: 64 }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("upload_intents_session_status_expiry_idx").on(
      table.anonymousSessionId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const analyses = pgTable(
  "analyses",
  {
    id: id(),
    anonymousSessionId: uuid("anonymous_session_id").references(() => anonymousSessions.id),
    matchId: uuid("match_id").references(() => matches.id),
    videoAssetId: uuid("video_asset_id").references(() => videoAssets.id),
    status: varchar({ length: 32 }).notNull(),
    retentionClass: retentionClass("retention_class").notNull(),
    sourceUrl: text("source_url"),
    sourcePlatform: varchar("source_platform", { length: 64 }),
    sourceFingerprint: bytea("source_fingerprint"),
    appliedRuleVersionId: uuid("applied_rule_version_id").references(() => competitionRuleVersions.id),
    pipelineVersion: varchar("pipeline_version", { length: 64 }),
    mediaPolicyVersion: varchar("media_policy_version", { length: 64 }),
    stateVersion: integer("state_version").notNull().default(0),
    failureCode: varchar("failure_code", { length: 64 }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [uniqueIndex("analyses_video_asset_id_unique").on(table.videoAssetId)],
);

export const processingJobs = pgTable("processing_jobs", {
  id: id(),
  analysisId: uuid("analysis_id").references(() => analyses.id),
  videoAssetId: uuid("video_asset_id").references(() => videoAssets.id),
  jobType: jobType("job_type").notNull(),
  status: jobStatus().notNull(),
  payloadVersion: integer("payload_version").notNull(),
  jobRevision: integer("job_revision").notNull().default(0),
  attempt: smallint().notNull().default(0),
  maxAttempts: smallint("max_attempts").notNull(),
  leaseOwner: varchar("lease_owner", { length: 128 }),
  leaseTokenHash: bytea("lease_token_hash"),
  leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "string" }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "string" }),
  failureCode: varchar("failure_code", { length: 64 }),
  retryable: boolean(),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

export const incidentCandidates = pgTable(
  "incident_candidates",
  {
    id: id(),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    candidateIndex: integer("candidate_index").notNull(),
    reviewScenario: reviewScenario("review_scenario").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    broadcastClock: varchar("broadcast_clock", { length: 16 }),
    detectionConfidence: real("detection_confidence"),
    cameraSufficiency: cameraSufficiency("camera_sufficiency").notNull(),
    currentFactRevisionId: uuid("current_fact_revision_id"),
    reviewStatus: candidateReviewStatus("review_status").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("incident_candidates_analysis_index_unique").on(table.analysisId, table.candidateIndex),
    uniqueIndex("incident_candidates_id_analysis_unique").on(table.id, table.analysisId),
  ],
);

export const shots = pgTable(
  "shots",
  {
    id: id(),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    shotIndex: integer("shot_index").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    playbackSpeed: playbackSpeed("playback_speed").notNull(),
    isReplay: boolean("is_replay").notNull(),
    cameraAngleLabel: varchar("camera_angle_label", { length: 64 }),
  },
  (table) => [
    uniqueIndex("shots_analysis_index_unique").on(table.analysisId, table.shotIndex),
    uniqueIndex("shots_id_analysis_unique").on(table.id, table.analysisId),
  ],
);

export const factRevisions = pgTable(
  "fact_revisions",
  {
    id: id(),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    incidentCandidateId: uuid("incident_candidate_id").notNull().references(() => incidentCandidates.id),
    revision: integer().notNull(),
    facts: jsonb().$type<Record<string, unknown>>().notNull(),
    factSchemaVersion: integer("fact_schema_version").notNull(),
    source: factSource().notNull(),
    extractionConfidence: real("extraction_confidence"),
    modelVersion: varchar("model_version", { length: 64 }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("fact_revisions_candidate_revision_unique").on(table.incidentCandidateId, table.revision),
    uniqueIndex("fact_revisions_id_analysis_unique").on(table.id, table.analysisId),
    uniqueIndex("fact_revisions_id_candidate_analysis_unique").on(table.id, table.incidentCandidateId, table.analysisId),
  ],
);

export const factRevisionShots = pgTable(
  "fact_revision_shots",
  {
    factRevisionId: uuid("fact_revision_id").notNull().references(() => factRevisions.id),
    shotId: uuid("shot_id").notNull().references(() => shots.id),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
  },
  (table) => [
    primaryKey({
      name: "fact_revision_shots_pkey",
      columns: [table.factRevisionId, table.shotId],
    }),
  ],
);

export const evidenceAssets = pgTable(
  "evidence_assets",
  {
    id: id(),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    incidentCandidateId: uuid("incident_candidate_id").references(() => incidentCandidates.id),
    kind: evidenceKind().notNull(),
    objectKey: text("object_key").notNull().unique(),
    contentSha256: bytea("content_sha256").notNull(),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    width: integer(),
    height: integer(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [uniqueIndex("evidence_assets_id_analysis_unique").on(table.id, table.analysisId)],
);

export const rules = pgTable(
  "rules",
  {
    id: id(),
    authority: varchar({ length: 16 }).notNull(),
    edition: varchar({ length: 16 }).notNull(),
    law: varchar({ length: 32 }).notNull(),
    section: varchar({ length: 128 }).notNull(),
    concept: varchar({ length: 128 }).notNull(),
    revision: integer().notNull(),
    contentSha256: bytea("content_sha256").notNull(),
    originalText: text("original_text"),
    officialKorean: text("official_korean"),
    plainKorean: text("plain_korean"),
    sourcePage: varchar("source_page", { length: 32 }),
    sourceUrl: text("source_url"),
    reviewStatus: varchar("review_status", { length: 32 }).notNull(),
  },
  (table) => [
    uniqueIndex("rules_revision_unique").on(table.authority, table.edition, table.law, table.section, table.concept, table.revision),
  ],
);

export const decisionResults = pgTable(
  "decision_results",
  {
    id: id(),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    incidentCandidateId: uuid("incident_candidate_id").notNull().references(() => incidentCandidates.id),
    factRevisionId: uuid("fact_revision_id").notNull().references(() => factRevisions.id),
    appliedRuleVersionId: uuid("applied_rule_version_id").notNull().references(() => competitionRuleVersions.id),
    observedRestartType: observedRestartType("observed_restart_type").notNull(),
    observedRestartBeneficiary: observedRestartBeneficiary("observed_restart_beneficiary").notNull(),
    observedCard: disciplinaryAction("observed_card"),
    observedGoalDecision: observedGoalDecision("observed_goal_decision").notNull(),
    observedSource: observedSource("observed_source").notNull(),
    foulDecision: foulDecision("foul_decision"),
    severity: severity(),
    goalDecision: observedGoalDecision("goal_decision"),
    restartType: observedRestartType("restart_type"),
    disciplinaryAction: disciplinaryAction("disciplinary_action"),
    decisionMatch: decisionMatch("decision_match").notNull(),
    varReviewable: boolean("var_reviewable").notNull(),
    varCategory: varCategory("var_category").notNull(),
    varWithinTimeWindow: boolean("var_within_time_window").notNull(),
    varThresholdMet: varThresholdResult("var_threshold_met").notNull(),
    varIntervention: varIntervention("var_intervention").notNull(),
    varNoInterventionReason: varNoInterventionReason("var_no_intervention_reason"),
    varNotReviewableReason: varNotReviewableReason("var_not_reviewable_reason"),
    varWindowClosedReason: varWindowClosedReason("var_window_closed_reason"),
    varWindowException: varWindowException("var_window_exception").notNull(),
    varReviewProcedure: varReviewProcedure("var_review_procedure").notNull(),
    judgmentConfidenceLevel: varchar("judgment_confidence_level", { length: 16 }).notNull(),
    inconclusiveReason: inconclusiveReason("inconclusive_reason"),
    factSignature: bytea("fact_signature").notNull(),
    ruleEngineVersion: varchar("rule_engine_version", { length: 64 }).notNull(),
    evaluationSchemaVersion: integer("evaluation_schema_version").notNull(),
    evaluationSnapshot: jsonb("evaluation_snapshot").$type<Record<string, unknown>>().notNull(),
    citations: jsonb().$type<unknown[]>().notNull(),
    citedLaws: text("cited_laws").array(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("decision_results_input_unique").on(
      table.incidentCandidateId,
      table.factRevisionId,
      table.appliedRuleVersionId,
      table.ruleEngineVersion,
    ),
    uniqueIndex("decision_results_id_analysis_unique").on(table.id, table.analysisId),
    uniqueIndex("decision_results_signature_cache").on(
      table.factSignature,
      table.appliedRuleVersionId,
      table.ruleEngineVersion,
    ),
  ],
);

export const officialVerdicts = pgTable(
  "official_verdicts",
  {
    id: id(),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    incidentCandidateId: uuid("incident_candidate_id").notNull().references(() => incidentCandidates.id),
    announcedBy: announcedBy("announced_by").notNull(),
    announcedByName: varchar("announced_by_name", { length: 128 }),
    announcedOn: date("announced_on", { mode: "string" }),
    verdict: officialVerdictValue().notNull(),
    quote: text(),
    sourceUrl: text("source_url"),
    status: officialVerdictStatus().notNull(),
  },
  (table) => [uniqueIndex("official_verdicts_id_analysis_unique").on(table.id, table.analysisId)],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: id(),
    anonymousSessionId: uuid("anonymous_session_id").notNull().references(() => anonymousSessions.id),
    operation: idempotencyOperation().notNull(),
    keyHash: bytea("key_hash").notNull(),
    requestHash: bytea("request_hash").notNull(),
    analysisId: uuid("analysis_id").notNull().references(() => analyses.id),
    incidentCandidateId: uuid("incident_candidate_id").references(() => incidentCandidates.id),
    factRevisionId: uuid("fact_revision_id").references(() => factRevisions.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_records_session_operation_key_unique").on(
      table.anonymousSessionId,
      table.operation,
      table.keyHash,
    ),
  ],
);

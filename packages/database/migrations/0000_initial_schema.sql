CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE video_asset_status AS ENUM ('CREATED', 'UPLOADING', 'VALIDATING', 'VALID', 'REJECTED', 'EXPIRED', 'DELETED');
CREATE TYPE retention_class AS ENUM ('TEMPORARY', 'CURATED');
CREATE TYPE job_type AS ENUM ('VALIDATE_VIDEO', 'ANALYZE_VIDEO', 'DELETE_VIDEO_ASSET', 'PURGE_ANALYSIS');
CREATE TYPE job_status AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE idempotency_operation AS ENUM ('CREATE_ANALYSIS', 'PATCH_FACTS');
CREATE TYPE review_scenario AS ENUM ('GOAL_DISALLOWED', 'GOAL_AWARDED', 'PENALTY_NOT_GIVEN', 'PENALTY_GIVEN', 'SENDING_OFF_NOT_GIVEN', 'CARD_SHOWN', 'SECOND_CAUTION', 'CORNER_KICK_AWARDED', 'OTHER');
CREATE TYPE camera_sufficiency AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE candidate_review_status AS ENUM ('UNREVIEWED', 'CONFIRMED', 'DISMISSED');
CREATE TYPE playback_speed AS ENUM ('NORMAL', 'SLOW', 'UNKNOWN');
CREATE TYPE fact_source AS ENUM ('MODEL', 'USER', 'CURATOR');
CREATE TYPE evidence_kind AS ENUM ('FRAME', 'CLIP');
CREATE TYPE observed_restart_type AS ENUM ('DIRECT_FREE_KICK', 'INDIRECT_FREE_KICK', 'FREE_KICK_UNSPECIFIED', 'PENALTY_KICK', 'DROP_BALL', 'THROW_IN', 'GOAL_KICK', 'CORNER_KICK', 'KICK_OFF', 'PLAY_CONTINUED', 'UNKNOWN');
CREATE TYPE observed_restart_beneficiary AS ENUM ('ATTACKING_TEAM', 'DEFENDING_TEAM', 'NONE', 'UNKNOWN');
CREATE TYPE observed_goal_decision AS ENUM ('GOAL', 'NO_GOAL', 'NOT_APPLICABLE', 'UNKNOWN');
CREATE TYPE observed_source AS ENUM ('RESTART_INFERRED', 'REFEREE_SIGNAL', 'VAR_OFR', 'USER_INPUT', 'MATCH_REPORT');
CREATE TYPE decision_match AS ENUM ('MATCH', 'MISMATCH', 'UNDETERMINED');
CREATE TYPE severity AS ENUM ('CARELESS', 'RECKLESS', 'EXCESSIVE_FORCE');
CREATE TYPE var_category AS ENUM ('GOAL_NO_GOAL', 'PENALTY_NO_PENALTY', 'RED_CARD', 'MISTAKEN_IDENTITY', 'CORNER_KICK', 'NONE');
CREATE TYPE var_threshold_result AS ENUM ('MET', 'NOT_MET', 'UNDETERMINED');
CREATE TYPE var_intervention AS ENUM ('NO_INTERVENTION', 'OVERTURNED', 'CONFIRMED');
CREATE TYPE var_no_intervention_reason AS ENUM ('NOT_REVIEWABLE', 'TOO_LATE', 'THRESHOLD_NOT_MET');
CREATE TYPE var_not_reviewable_reason AS ENUM ('OUTSIDE_REVIEWABLE_CATEGORIES', 'COMPETITION_OPTION_NOT_ADOPTED');
CREATE TYPE var_window_closed_reason AS ENUM ('PLAY_RESTARTED');
CREATE TYPE var_window_exception AS ENUM ('MISTAKEN_IDENTITY', 'VIOLENT_CONDUCT', 'BITING_OR_SPITTING', 'OFFENSIVE_LANGUAGE_OR_ACTION', 'NONE');
CREATE TYPE disciplinary_action AS ENUM ('NONE', 'CAUTION', 'SECOND_CAUTION', 'SEND_OFF');
CREATE TYPE foul_decision AS ENUM ('FOUL', 'NO_FOUL', 'NORMAL_CONTACT', 'INCONCLUSIVE', 'OUT_OF_SCOPE');
CREATE TYPE var_review_procedure AS ENUM ('OFR', 'VAR_ONLY', 'NONE');
CREATE TYPE inconclusive_reason AS ENUM ('CAMERA_INSUFFICIENT', 'SEVERITY_UNDETERMINED', 'SLOW_MOTION_ONLY', 'OUT_OF_SCOPE');
CREATE TYPE announced_by AS ENUM ('KFA_REFEREE_COMMITTEE', 'COMPETITION_ORGANISER', 'OTHER');
CREATE TYPE official_verdict_value AS ENUM ('CORRECT', 'INCORRECT', 'NO_COMMENT');
CREATE TYPE official_verdict_status AS ENUM ('EXTERNAL_OPINION');

CREATE TABLE anonymous_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT anonymous_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  short_code varchar(8) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition varchar(64) NOT NULL,
  season varchar(16) NOT NULL,
  match_date date NOT NULL,
  home_club_id uuid REFERENCES clubs(id),
  away_club_id uuid REFERENCES clubs(id),
  score_home smallint,
  score_away smallint,
  CONSTRAINT matches_distinct_clubs CHECK (home_club_id IS NULL OR away_club_id IS NULL OR home_club_id <> away_club_id),
  CONSTRAINT matches_nonnegative_scores CHECK ((score_home IS NULL OR score_home >= 0) AND (score_away IS NULL OR score_away >= 0))
);
CREATE INDEX matches_competition_date_idx ON matches (competition, match_date);

CREATE TABLE competition_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition varchar(64) NOT NULL,
  season varchar(16) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  ifab_edition varchar(16) NOT NULL,
  source_document text,
  verification_status varchar(32) NOT NULL,
  CONSTRAINT competition_rule_versions_period_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT competition_rule_versions_no_overlap EXCLUDE USING gist (
    competition WITH =,
    season WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  )
);

CREATE TABLE video_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_session_id uuid NOT NULL REFERENCES anonymous_sessions(id),
  object_key text NOT NULL UNIQUE,
  content_sha256 bytea NOT NULL,
  content_type varchar(128) NOT NULL,
  size_bytes bigint NOT NULL,
  duration_ms integer,
  width integer,
  height integer,
  status video_asset_status NOT NULL,
  state_version integer NOT NULL DEFAULT 0,
  validation_error_code varchar(64),
  rights_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  object_deleted_at timestamptz,
  CONSTRAINT video_assets_nonnegative_media_check CHECK (
    size_bytes > 0
    AND (duration_ms IS NULL OR duration_ms > 0)
    AND (width IS NULL OR width > 0)
    AND (height IS NULL OR height > 0)
  )
);
CREATE INDEX video_assets_session_expiry_idx ON video_assets (anonymous_session_id, expires_at);

CREATE TABLE analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_session_id uuid REFERENCES anonymous_sessions(id),
  match_id uuid REFERENCES matches(id),
  video_asset_id uuid UNIQUE REFERENCES video_assets(id),
  status varchar(32) NOT NULL,
  retention_class retention_class NOT NULL,
  source_url text,
  source_platform varchar(64),
  source_fingerprint bytea,
  applied_rule_version_id uuid REFERENCES competition_rule_versions(id),
  pipeline_version varchar(64),
  media_policy_version varchar(64),
  state_version integer NOT NULL DEFAULT 0,
  failure_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT analyses_retention_check CHECK (
    (retention_class = 'TEMPORARY' AND anonymous_session_id IS NOT NULL AND video_asset_id IS NOT NULL AND expires_at IS NOT NULL)
    OR
    (retention_class = 'CURATED' AND source_url IS NOT NULL)
  ),
  CONSTRAINT analyses_completion_check CHECK (completed_at IS NULL OR completed_at >= created_at)
);
CREATE INDEX analyses_session_created_idx ON analyses (anonymous_session_id, created_at DESC) WHERE retention_class = 'TEMPORARY';
CREATE INDEX analyses_expiry_idx ON analyses (expires_at) WHERE retention_class = 'TEMPORARY';

CREATE TABLE processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analyses(id) ON DELETE CASCADE,
  video_asset_id uuid REFERENCES video_assets(id) ON DELETE CASCADE,
  job_type job_type NOT NULL,
  status job_status NOT NULL,
  payload_version integer NOT NULL,
  job_revision integer NOT NULL DEFAULT 0,
  attempt smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL,
  lease_owner varchar(128),
  lease_token_hash bytea,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  failure_code varchar(64),
  retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processing_jobs_attempt_bounds_check CHECK (attempt >= 0 AND max_attempts > 0 AND attempt <= max_attempts),
  CONSTRAINT processing_jobs_target_check CHECK (
    (job_type IN ('VALIDATE_VIDEO', 'DELETE_VIDEO_ASSET') AND video_asset_id IS NOT NULL AND analysis_id IS NULL)
    OR
    (job_type IN ('ANALYZE_VIDEO', 'PURGE_ANALYSIS') AND analysis_id IS NOT NULL AND video_asset_id IS NULL)
  ),
  CONSTRAINT processing_jobs_lease_check CHECK (
    (status = 'PROCESSING' AND lease_owner IS NOT NULL AND lease_token_hash IS NOT NULL AND lease_until IS NOT NULL)
    OR status <> 'PROCESSING'
  ),
  CONSTRAINT processing_jobs_analysis_type_payload_unique UNIQUE (analysis_id, job_type, payload_version),
  CONSTRAINT processing_jobs_video_type_payload_unique UNIQUE (video_asset_id, job_type, payload_version)
);
CREATE INDEX processing_jobs_claim_idx ON processing_jobs (job_type, next_attempt_at, created_at) WHERE status = 'QUEUED';
CREATE INDEX processing_jobs_lease_idx ON processing_jobs (lease_until) WHERE status = 'PROCESSING';

CREATE TABLE incident_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  candidate_index integer NOT NULL,
  review_scenario review_scenario NOT NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  broadcast_clock varchar(16),
  detection_confidence real,
  camera_sufficiency camera_sufficiency NOT NULL,
  current_fact_revision_id uuid,
  review_status candidate_review_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_candidates_interval_check CHECK (start_ms >= 0 AND end_ms >= start_ms),
  CONSTRAINT incident_candidates_confidence_check CHECK (detection_confidence IS NULL OR detection_confidence BETWEEN 0 AND 1),
  CONSTRAINT incident_candidates_analysis_index_unique UNIQUE (analysis_id, candidate_index),
  CONSTRAINT incident_candidates_id_analysis_unique UNIQUE (id, analysis_id)
);

CREATE TABLE shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  shot_index integer NOT NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  playback_speed playback_speed NOT NULL,
  is_replay boolean NOT NULL,
  camera_angle_label varchar(64),
  CONSTRAINT shots_interval_check CHECK (start_ms >= 0 AND end_ms >= start_ms),
  CONSTRAINT shots_analysis_index_unique UNIQUE (analysis_id, shot_index),
  CONSTRAINT shots_id_analysis_unique UNIQUE (id, analysis_id)
);

CREATE TABLE fact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  incident_candidate_id uuid NOT NULL,
  revision integer NOT NULL,
  facts jsonb NOT NULL,
  fact_schema_version integer NOT NULL,
  source fact_source NOT NULL,
  extraction_confidence real,
  model_version varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fact_revisions_revision_check CHECK (revision > 0),
  CONSTRAINT fact_revisions_confidence_check CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  CONSTRAINT fact_revisions_candidate_analysis_fk FOREIGN KEY (incident_candidate_id, analysis_id)
    REFERENCES incident_candidates (id, analysis_id) ON DELETE CASCADE,
  CONSTRAINT fact_revisions_candidate_revision_unique UNIQUE (incident_candidate_id, revision),
  CONSTRAINT fact_revisions_id_analysis_unique UNIQUE (id, analysis_id),
  CONSTRAINT fact_revisions_id_candidate_analysis_unique UNIQUE (id, incident_candidate_id, analysis_id)
);

ALTER TABLE incident_candidates
  ADD CONSTRAINT incident_candidates_current_fact_revision_fk
  FOREIGN KEY (current_fact_revision_id, id, analysis_id)
  REFERENCES fact_revisions (id, incident_candidate_id, analysis_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE fact_revision_shots (
  fact_revision_id uuid NOT NULL,
  shot_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  PRIMARY KEY (fact_revision_id, shot_id),
  CONSTRAINT fact_revision_shots_fact_fk FOREIGN KEY (fact_revision_id, analysis_id)
    REFERENCES fact_revisions (id, analysis_id) ON DELETE CASCADE,
  CONSTRAINT fact_revision_shots_shot_fk FOREIGN KEY (shot_id, analysis_id)
    REFERENCES shots (id, analysis_id) ON DELETE CASCADE
);

CREATE TABLE evidence_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  incident_candidate_id uuid,
  kind evidence_kind NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_sha256 bytea NOT NULL,
  start_ms integer,
  end_ms integer,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  object_deleted_at timestamptz,
  CONSTRAINT evidence_assets_interval_check CHECK (
    (start_ms IS NULL AND end_ms IS NULL) OR (start_ms IS NOT NULL AND end_ms IS NOT NULL AND start_ms >= 0 AND end_ms >= start_ms)
  ),
  CONSTRAINT evidence_assets_dimensions_check CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)),
  CONSTRAINT evidence_assets_candidate_analysis_fk FOREIGN KEY (incident_candidate_id, analysis_id)
    REFERENCES incident_candidates (id, analysis_id) ON DELETE CASCADE,
  CONSTRAINT evidence_assets_id_analysis_unique UNIQUE (id, analysis_id)
);
CREATE INDEX evidence_assets_analysis_candidate_idx ON evidence_assets (analysis_id, incident_candidate_id);

CREATE TABLE rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority varchar(16) NOT NULL,
  edition varchar(16) NOT NULL,
  law varchar(32) NOT NULL,
  section varchar(128) NOT NULL,
  concept varchar(128) NOT NULL,
  revision integer NOT NULL,
  content_sha256 bytea NOT NULL,
  original_text text,
  official_korean text,
  plain_korean text,
  source_page varchar(32),
  source_url text,
  review_status varchar(32) NOT NULL,
  CONSTRAINT rules_revision_positive CHECK (revision > 0),
  CONSTRAINT rules_revision_unique UNIQUE (authority, edition, law, section, concept, revision)
);

CREATE FUNCTION cited_laws_from(jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN COALESCE(ARRAY(SELECT item ->> 'law' FROM jsonb_array_elements($1) AS item), ARRAY[]::text[]);

CREATE TABLE decision_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  incident_candidate_id uuid NOT NULL,
  fact_revision_id uuid NOT NULL,
  applied_rule_version_id uuid NOT NULL REFERENCES competition_rule_versions(id),
  observed_restart_type observed_restart_type NOT NULL,
  observed_restart_beneficiary observed_restart_beneficiary NOT NULL,
  observed_card disciplinary_action,
  observed_goal_decision observed_goal_decision NOT NULL,
  observed_source observed_source NOT NULL,
  foul_decision foul_decision,
  severity severity,
  goal_decision observed_goal_decision,
  restart_type observed_restart_type,
  disciplinary_action disciplinary_action,
  decision_match decision_match NOT NULL,
  var_reviewable boolean NOT NULL,
  var_category var_category NOT NULL,
  var_within_time_window boolean NOT NULL,
  var_threshold_met var_threshold_result NOT NULL,
  var_intervention var_intervention NOT NULL,
  var_no_intervention_reason var_no_intervention_reason,
  var_not_reviewable_reason var_not_reviewable_reason,
  var_window_closed_reason var_window_closed_reason,
  var_window_exception var_window_exception NOT NULL,
  var_review_procedure var_review_procedure NOT NULL,
  judgment_confidence_level varchar(16) NOT NULL,
  inconclusive_reason inconclusive_reason,
  fact_signature bytea NOT NULL,
  rule_engine_version varchar(64) NOT NULL,
  evaluation_schema_version integer NOT NULL,
  evaluation_snapshot jsonb NOT NULL,
  citations jsonb NOT NULL,
  cited_laws text[] GENERATED ALWAYS AS (cited_laws_from(citations)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_results_citations_check CHECK (jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) >= 1),
  CONSTRAINT decision_results_candidate_analysis_fk FOREIGN KEY (incident_candidate_id, analysis_id)
    REFERENCES incident_candidates (id, analysis_id) ON DELETE CASCADE,
  CONSTRAINT decision_results_fact_candidate_analysis_fk FOREIGN KEY (fact_revision_id, incident_candidate_id, analysis_id)
    REFERENCES fact_revisions (id, incident_candidate_id, analysis_id) ON DELETE CASCADE,
  CONSTRAINT decision_results_input_unique UNIQUE (incident_candidate_id, fact_revision_id, applied_rule_version_id, rule_engine_version),
  CONSTRAINT decision_results_id_analysis_unique UNIQUE (id, analysis_id)
);
CREATE INDEX decision_results_signature_cache_idx ON decision_results (fact_signature, applied_rule_version_id, rule_engine_version);
CREATE INDEX decision_results_cited_laws_idx ON decision_results USING gin (cited_laws);

CREATE TABLE official_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  incident_candidate_id uuid NOT NULL,
  announced_by announced_by NOT NULL,
  announced_by_name varchar(128),
  announced_on date,
  verdict official_verdict_value NOT NULL,
  quote text,
  source_url text,
  status official_verdict_status NOT NULL,
  CONSTRAINT official_verdicts_candidate_analysis_fk FOREIGN KEY (incident_candidate_id, analysis_id)
    REFERENCES incident_candidates (id, analysis_id) ON DELETE CASCADE,
  CONSTRAINT official_verdicts_id_analysis_unique UNIQUE (id, analysis_id)
);

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_session_id uuid NOT NULL REFERENCES anonymous_sessions(id),
  operation idempotency_operation NOT NULL,
  key_hash bytea NOT NULL,
  request_hash bytea NOT NULL,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  incident_candidate_id uuid,
  fact_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_records_result_check CHECK (
    (operation = 'CREATE_ANALYSIS' AND incident_candidate_id IS NULL AND fact_revision_id IS NULL)
    OR
    (operation = 'PATCH_FACTS' AND incident_candidate_id IS NOT NULL AND fact_revision_id IS NOT NULL)
  ),
  CONSTRAINT idempotency_records_fact_candidate_analysis_fk FOREIGN KEY (fact_revision_id, incident_candidate_id, analysis_id)
    REFERENCES fact_revisions (id, incident_candidate_id, analysis_id) ON DELETE CASCADE,
  CONSTRAINT idempotency_records_session_operation_key_unique UNIQUE (anonymous_session_id, operation, key_hash)
);
CREATE INDEX idempotency_records_expiry_idx ON idempotency_records (expires_at);

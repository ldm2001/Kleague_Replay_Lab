CREATE TABLE analysis_incident_observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
    job_revision integer NOT NULL CHECK (job_revision > 0),
    source_sha256 bytea NOT NULL CHECK (octet_length(source_sha256) = 32),
    artifact_sha256 bytea NOT NULL CHECK (octet_length(artifact_sha256) = 32),
    schema_version text NOT NULL CHECK (schema_version = 'private-incidents-v1'),
    observation_id text NOT NULL,
    candidate_id text NOT NULL,
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object' AND octet_length(observation::text) <= 65536),
    reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    UNIQUE (job_id, job_revision, observation_id)
);
CREATE INDEX analysis_incident_observations_analysis_idx
    ON analysis_incident_observations (analysis_id, job_revision, candidate_id);
CREATE TRIGGER analysis_incident_observations_no_update BEFORE UPDATE ON analysis_incident_observations
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();

CREATE TABLE analysis_incident_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_id uuid NOT NULL REFERENCES analysis_incident_observations(id) ON DELETE CASCADE,
    incident_id text NOT NULL,
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object' AND octet_length(record::text) <= 1048576),
    lineage jsonb NOT NULL CHECK (jsonb_typeof(lineage) = 'object'),
    admitted_fact_ids jsonb NOT NULL CHECK (jsonb_typeof(admitted_fact_ids) = 'array'),
    evaluations jsonb NOT NULL CHECK (jsonb_typeof(evaluations) = 'array' AND octet_length(evaluations::text) <= 1048576),
    UNIQUE (observation_id, incident_id)
);
CREATE TRIGGER analysis_incident_records_no_update BEFORE UPDATE ON analysis_incident_records
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();

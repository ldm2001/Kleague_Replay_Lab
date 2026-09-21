CREATE TABLE analysis_automatic_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  job_revision integer NOT NULL CHECK (job_revision > 0),
  source_sha256 bytea NOT NULL CHECK (octet_length(source_sha256) = 32),
  evaluator_version varchar(32) NOT NULL CHECK (evaluator_version = 'automatic-review-v1'),
  pipeline_version varchar(64) NOT NULL,
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object' AND jsonb_typeof(summary->'rows') = 'array' AND octet_length(summary::text) <= 1048576),
  evidence_bindings jsonb NOT NULL CHECK (jsonb_typeof(evidence_bindings) = 'array' AND octet_length(evidence_bindings::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (job_id, job_revision),
  CHECK (expires_at > created_at)
);
CREATE INDEX analysis_automatic_reviews_analysis_idx ON analysis_automatic_reviews (analysis_id);
CREATE TRIGGER analysis_automatic_reviews_no_update
  BEFORE UPDATE ON analysis_automatic_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_update();

CREATE TABLE analysis_perception_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL,
  job_id uuid NOT NULL,
  job_revision integer NOT NULL,
  schema_version varchar(32) NOT NULL,
  pipeline_version varchar(64) NOT NULL,
  source_sha256 bytea NOT NULL,
  artifact_object_key text NOT NULL,
  artifact_sha256 bytea NOT NULL,
  artifact_size_bytes bigint NOT NULL,
  model_provenance jsonb NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  object_deleted_at timestamptz,
  CONSTRAINT analysis_perception_runs_analysis_fk
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
  CONSTRAINT analysis_perception_runs_job_fk
    FOREIGN KEY (job_id) REFERENCES processing_jobs(id),
  CONSTRAINT analysis_perception_runs_job_revision_unique UNIQUE (job_id, job_revision),
  CONSTRAINT analysis_perception_runs_artifact_object_key_unique UNIQUE (artifact_object_key),
  CONSTRAINT analysis_perception_runs_job_revision_check CHECK (job_revision > 0),
  CONSTRAINT analysis_perception_runs_schema_version_check CHECK (schema_version = 'perception-run-v1'),
  CONSTRAINT analysis_perception_runs_pipeline_version_check CHECK (pipeline_version = 'video-local-observers-v1'),
  CONSTRAINT analysis_perception_runs_source_sha256_check CHECK (octet_length(source_sha256) = 32),
  CONSTRAINT analysis_perception_runs_artifact_sha256_check CHECK (octet_length(artifact_sha256) = 32),
  CONSTRAINT analysis_perception_runs_artifact_key_check CHECK (
    artifact_object_key = 'perception/' || analysis_id::text || '/' || job_id::text || '/' ||
      job_revision::text || '/' || encode(artifact_sha256, 'hex') || '.jsonl.gz'
  ),
  CONSTRAINT analysis_perception_runs_artifact_size_check CHECK (
    artifact_size_bytes > 0 AND artifact_size_bytes <= 134217728
  ),
  CONSTRAINT analysis_perception_runs_model_provenance_check CHECK (
    jsonb_typeof(model_provenance) = 'array'
    AND jsonb_array_length(model_provenance) = 3
    AND octet_length(model_provenance::text) <= 16384
  ),
  CONSTRAINT analysis_perception_runs_summary_check CHECK (
    jsonb_typeof(summary) = 'object'
    AND jsonb_typeof(summary->'incidents') = 'array'
    AND jsonb_typeof(summary->'admission') = 'object'
    AND octet_length(summary::text) <= 1048576
  ),
  CONSTRAINT analysis_perception_runs_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX analysis_perception_runs_analysis_idx ON analysis_perception_runs (analysis_id);

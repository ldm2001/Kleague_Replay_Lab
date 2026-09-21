ALTER TABLE analysis_perception_runs
  DROP CONSTRAINT analysis_perception_runs_schema_version_check,
  DROP CONSTRAINT analysis_perception_runs_pipeline_version_check,
  DROP CONSTRAINT analysis_perception_runs_summary_check;

ALTER TABLE analysis_perception_runs
  ADD CONSTRAINT analysis_perception_runs_version_pair_check CHECK (
    (schema_version = 'perception-run-v1' AND pipeline_version = 'video-local-observers-v1')
    OR (schema_version = 'perception-run-v2' AND pipeline_version = 'video-local-observers-av-v1')
  ),
  ADD CONSTRAINT analysis_perception_runs_summary_check CHECK (
    jsonb_typeof(summary) = 'object'
    AND jsonb_typeof(summary->'incidents') = 'array'
    AND jsonb_typeof(summary->'admission') = 'object'
    AND octet_length(summary::text) <= 1048576
    AND (
      (schema_version = 'perception-run-v1' AND NOT (summary ? 'audio'))
      OR (schema_version = 'perception-run-v2' AND coalesce(jsonb_typeof(summary->'audio') = 'object', false))
    )
  );

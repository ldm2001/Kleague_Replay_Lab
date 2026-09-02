CREATE TYPE job_stage AS ENUM (
  'QUEUED',
  'VALIDATING',
  'SEGMENTING',
  'DETECTING',
  'EXTRACTING_FACTS',
  'BUILDING_EVIDENCE',
  'APPLYING_RULES',
  'SUCCEEDED',
  'FAILED'
);

CREATE TYPE job_event_type AS ENUM ('CLAIMED', 'PROGRESS', 'HEARTBEAT', 'SUCCEEDED', 'FAILED');

ALTER TABLE processing_jobs
  ADD COLUMN stage job_stage NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN progress_percent smallint NOT NULL DEFAULT 0,
  ADD COLUMN heartbeat_at timestamptz;

ALTER TABLE processing_jobs
  ADD CONSTRAINT processing_jobs_progress_check
  CHECK (progress_percent BETWEEN 0 AND 100);

CREATE TABLE processing_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
  job_revision integer NOT NULL,
  attempt smallint NOT NULL,
  event_type job_event_type NOT NULL,
  stage job_stage NOT NULL,
  progress_percent smallint NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processing_job_events_progress_check CHECK (progress_percent BETWEEN 0 AND 100)
);

CREATE INDEX processing_job_events_job_time_idx ON processing_job_events (job_id, created_at, id);

CREATE TRIGGER processing_job_events_no_update
  BEFORE UPDATE ON processing_job_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_append_only_update();

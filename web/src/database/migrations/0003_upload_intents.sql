CREATE TYPE upload_intent_status AS ENUM ('CREATED', 'UPLOADING', 'COMPLETED', 'EXPIRED', 'REJECTED');

CREATE TABLE upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_session_id uuid NOT NULL REFERENCES anonymous_sessions(id),
  object_key text NOT NULL UNIQUE,
  expected_size_bytes bigint NOT NULL,
  declared_content_type varchar(128) NOT NULL,
  rights_confirmed_at timestamptz NOT NULL,
  status upload_intent_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT upload_intents_size_check CHECK (expected_size_bytes > 0),
  CONSTRAINT upload_intents_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT upload_intents_completion_check CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL)
    OR status <> 'COMPLETED'
  )
);
CREATE INDEX upload_intents_session_status_expiry_idx
  ON upload_intents (anonymous_session_id, status, expires_at);

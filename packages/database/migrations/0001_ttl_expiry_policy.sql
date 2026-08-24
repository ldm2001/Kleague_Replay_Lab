ALTER TABLE analyses
  ADD CONSTRAINT analyses_temporary_expiry_policy_check
  CHECK (
    retention_class <> 'TEMPORARY'
    OR (
      expires_at > created_at
      AND expires_at <= created_at + interval '24 hours'
    )
  );

ALTER TABLE video_assets
  ADD CONSTRAINT video_assets_expiry_after_creation_check
  CHECK (expires_at IS NULL OR expires_at > created_at);

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_expiry_after_creation_check
  CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '24 hours'
  );

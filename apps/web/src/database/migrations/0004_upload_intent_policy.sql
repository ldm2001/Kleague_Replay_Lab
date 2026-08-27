ALTER TABLE upload_intents
  ADD COLUMN media_policy_version varchar(64) NOT NULL DEFAULT 'media-v1';

ALTER TABLE upload_intents
  ALTER COLUMN media_policy_version DROP DEFAULT;

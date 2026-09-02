ALTER TABLE incident_candidates
  ADD COLUMN anchor_ms integer,
  ADD COLUMN reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN shot_indices jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE incident_candidates
  ADD CONSTRAINT incident_candidates_anchor_check
  CHECK (anchor_ms IS NULL OR (anchor_ms >= start_ms AND anchor_ms <= end_ms));

ALTER TABLE analyses
  ADD COLUMN limitations jsonb NOT NULL DEFAULT '[]'::jsonb;

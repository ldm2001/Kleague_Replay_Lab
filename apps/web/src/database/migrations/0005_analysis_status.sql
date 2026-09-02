ALTER TABLE analyses
  ADD CONSTRAINT analyses_status_check
  CHECK (
    status IN (
      'REQUESTED',
      'QUEUED',
      'SEGMENTING',
      'DETECTING',
      'EXTRACTING_FACTS',
      'BUILDING_EVIDENCE',
      'APPLYING_RULES',
      'COMPLETED',
      'FAILED',
      'EXPIRED'
    )
  );

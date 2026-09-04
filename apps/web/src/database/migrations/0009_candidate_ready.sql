ALTER TABLE analyses
  DROP CONSTRAINT analyses_status_check;

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
      'CANDIDATES_READY',
      'COMPLETED',
      'FAILED',
      'EXPIRED'
    )
  );

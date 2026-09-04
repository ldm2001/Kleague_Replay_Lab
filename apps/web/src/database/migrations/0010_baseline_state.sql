UPDATE analyses
SET status = 'CANDIDATES_READY',
    completed_at = NULL,
    state_version = state_version + 1
WHERE status = 'COMPLETED'
  AND NOT EXISTS (
    SELECT 1
    FROM decision_results
    WHERE decision_results.analysis_id = analyses.id
  );

-- 기존 후보와 이력은 보존하고 새로운 Worker의 추적 요약만 선택적으로 저장한다
ALTER TABLE incident_candidates ADD COLUMN tracking jsonb;

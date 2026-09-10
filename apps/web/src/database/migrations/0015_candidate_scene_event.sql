-- 기존 후보는 유지하고 관찰된 재개 상황과 근거 시각만 선택적으로 저장한다
ALTER TABLE incident_candidates ADD COLUMN scene_event jsonb;

-- 영상 모델의 관찰 후보를 판정 이력과 별도로 보존
ALTER TABLE incident_candidates ADD COLUMN observation jsonb;
-- 객체 형식의 관찰 후보만 허용
ALTER TABLE incident_candidates ADD CONSTRAINT incident_observation_object
  CHECK (observation IS NULL OR jsonb_typeof(observation) = 'object');

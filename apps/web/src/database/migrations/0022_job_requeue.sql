-- 재시도 가능한 실패의 재대기 이력을 최종 실패 이벤트와 구분하는 이벤트 값 추가
ALTER TYPE job_event_type ADD VALUE IF NOT EXISTS 'REQUEUED';

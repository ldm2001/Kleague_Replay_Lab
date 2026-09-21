-- Additive contract: historical judgments retain their original stored values.
ALTER TYPE var_intervention ADD VALUE IF NOT EXISTS 'INTERVENTION_RECOMMENDED';
ALTER TYPE var_intervention ADD VALUE IF NOT EXISTS 'UNDETERMINED';
ALTER TYPE inconclusive_reason ADD VALUE IF NOT EXISTS 'FACTS_UNDETERMINED';
ALTER TYPE inconclusive_reason ADD VALUE IF NOT EXISTS 'CONTEXT_UNSUPPORTED';

-- Unknown replay evidence must not be persisted as an observed false.
ALTER TABLE shots ALTER COLUMN is_replay DROP NOT NULL;

CREATE FUNCTION reject_append_only_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER fact_revisions_no_update
  BEFORE UPDATE ON fact_revisions
  FOR EACH ROW
  EXECUTE FUNCTION reject_append_only_update();

CREATE TRIGGER decision_results_no_update
  BEFORE UPDATE ON decision_results
  FOR EACH ROW
  EXECUTE FUNCTION reject_append_only_update();

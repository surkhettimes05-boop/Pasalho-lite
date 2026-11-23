ALTER TABLE "OfflineSubmission" ADD CONSTRAINT "OfflineSubmission_status_check" CHECK ("status" IN ('SYNCED', 'CONFLICT', 'REQUIRES_REVIEW'));

CREATE FUNCTION "prevent_offline_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Offline POS history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OfflineSnapshot_immutable" BEFORE UPDATE OR DELETE ON "OfflineSnapshot" FOR EACH ROW EXECUTE FUNCTION "prevent_offline_history_mutation"();
CREATE TRIGGER "OfflineSubmission_immutable" BEFORE UPDATE OR DELETE ON "OfflineSubmission" FOR EACH ROW EXECUTE FUNCTION "prevent_offline_history_mutation"();

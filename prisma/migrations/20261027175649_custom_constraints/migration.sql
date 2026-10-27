-- 1. Booking exclusion constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));

-- 2. Audit append-only
CREATE OR REPLACE FUNCTION audit_log_no_update_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_no_update_delete();

-- 3. Cashup lock
CREATE OR REPLACE FUNCTION cashup_locked_readonly()
RETURNS trigger AS $$
BEGIN
  IF OLD.locked = true THEN
    RAISE EXCEPTION 'CashUp is locked and cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cashup_locked
  BEFORE UPDATE ON "CashUp"
  FOR EACH ROW EXECUTE FUNCTION cashup_locked_readonly();

-- 4. Payroll lock
CREATE OR REPLACE FUNCTION payroll_locked_readonly()
RETURNS trigger AS $$
BEGIN
  IF OLD.locked = true THEN
    RAISE EXCEPTION 'PayrollRun is locked and cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_locked
  BEFORE UPDATE ON "PayrollRun"
  FOR EACH ROW EXECUTE FUNCTION payroll_locked_readonly();
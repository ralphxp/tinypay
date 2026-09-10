-- Enforces guiding principle #2 (docs/SPEC.md section 2): every journal
-- entry's postings must sum to zero. LedgerService already checks this in
-- app code before opening the transaction, but this trigger is the backstop
-- at the database level in case a bug, a raw query, or a future caller
-- bypasses LedgerService.
--
-- This must be a CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED, not a
-- plain AFTER trigger. LedgerService inserts one posting row per leg inside
-- a single transaction (see postEntry()); a plain trigger fires immediately
-- after each row insert, when every entry is legitimately unbalanced until
-- its later legs land, and would reject every multi-leg entry. Deferring
-- evaluation to commit time lets all postings for an entry land first, so
-- the sum is only checked once the transaction is about to commit.
CREATE OR REPLACE FUNCTION check_ledger_entry_balanced() RETURNS TRIGGER AS $$
DECLARE
  v_entry_id TEXT;
  v_sum NUMERIC;
BEGIN
  v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

  SELECT COALESCE(SUM(amount_minor), 0)
  INTO v_sum
  FROM postings
  WHERE entry_id = v_entry_id;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'Ledger entry % is unbalanced: postings sum to %, expected 0', v_entry_id, v_sum
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_postings_balanced
  AFTER INSERT OR UPDATE OR DELETE ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_ledger_entry_balanced();

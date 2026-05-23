-- Migration M-043: Sub-lot lookup by code (for QR scan on Dry Room detail)
--
-- Returns the full SubLot json if a sub-lot with the given code exists.
-- Accepts:
--   • raw code (e.g. "LOT-DEMO-001-D01")
--   • URL where the last path segment is the code (e.g. ".../sub-lot/LOT-DEMO-001-D01")
--   • whitespace-padded input
--
-- Used by the floor worker scanning a sub-lot QR sticker on the dryer floor:
-- the operator scans, frontend calls this RPC, then decides whether to place
-- the cart (status='created' / 'awaiting_recheck') or pop the cell detail
-- card (status='drying' in current dryer).

CREATE OR REPLACE FUNCTION qc_find_sub_lot_by_code(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  s_id uuid;
  cleaned text;
  last_seg text;
BEGIN
  IF p_code IS NULL THEN RETURN NULL; END IF;
  cleaned := trim(p_code);
  IF cleaned = '' THEN RETURN NULL; END IF;

  -- Exact match first
  SELECT id INTO s_id FROM qc_drying_sub_lot WHERE sub_lot_code = cleaned LIMIT 1;
  IF s_id IS NOT NULL THEN RETURN qc_sub_lot_to_json(s_id); END IF;

  -- Fallback: try last URL path segment (handle QR codes encoding a URL)
  last_seg := regexp_replace(cleaned, '^.*/([^/]+)$', '\1');
  IF last_seg <> cleaned THEN
    SELECT id INTO s_id FROM qc_drying_sub_lot WHERE sub_lot_code = last_seg LIMIT 1;
    IF s_id IS NOT NULL THEN RETURN qc_sub_lot_to_json(s_id); END IF;
  END IF;

  RETURN NULL;
END;
$$;

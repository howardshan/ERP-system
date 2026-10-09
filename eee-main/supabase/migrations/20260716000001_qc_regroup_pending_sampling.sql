-- ─────────────────────────────────────────────────────────────────────────────
-- M-172  qc_regroup_pending_sampling: re-chunk a work order's un-judged carts
--        after its SKU's sampling rate changes
--
-- WHY: sample_every_n_carts lives on the SKU, but grouping is FROZEN at check-out
-- (qc_check_out_sub_lots_bulk Step 2a reads the rate at that moment and writes
-- qc_test_group + sub_lot.test_group_id / is_test_champion). So editing a
-- product's sampling rate only affects carts checked out AFTER the edit — carts
-- already checked out and waiting to be tested keep their old grouping forever.
-- Re-running check-out can't fix it either: Step 1 requires status='drying', and
-- these carts are already 'pending' / 'awaiting_group_result'.
--
-- This RPC performs that re-chunk for one production lot:
--   1. Reads the CURRENT rate off the SKU (single source of truth — change the
--      product first, then call this).
--   2. Dissolves only FULLY UN-JUDGED groups (status='sampling' AND every member
--      still 'pending' / 'awaiting_group_result'). A group with a cart already
--      inspecting / passed / failed / on hold is left completely untouched.
--   3. Voids any still-pending sample of a dissolved group: after the re-chunk
--      the champion is very likely a DIFFERENT cart, so the old physical sample
--      no longer represents its group. Rows are kept (status='voided') for audit
--      — the operator must take a fresh sample from the new champion.
--   4. Re-chunks with the SAME algorithm as check-out by delegating to
--      qc__assign_test_group (champion, per-cart status, and the group_assigned
--      quality events all stay consistent with the normal flow).
--
-- The chunking loop below is intentionally a verbatim mirror of Step 2a in
-- 20260621000004 (M-137) so method_2's tail-split rule cannot drift between the
-- two call sites.
--
-- Maintenance RPC: not wired to any UI. Call it from the SQL editor after
-- changing a product's sampling rate.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION qc_regroup_pending_sampling(
    p_production_lot_id uuid,
    p_sampling_method text DEFAULT 'method_2'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    sample_n      int;
    old_group_ids uuid[];
    cart_ids      uuid[];
    voided_count  int := 0;
    groups        jsonb := '[]'::jsonb;
    T_count       int;
    grp_seq       int;
    member_ids    uuid[];
    chunk_idx     int;
    remaining     int;
    champ_low_abs int;
BEGIN
    IF p_sampling_method NOT IN ('method_1', 'method_2') THEN
        RAISE EXCEPTION 'Invalid p_sampling_method: % (expected method_1 or method_2)', p_sampling_method;
    END IF;

    SELECT GREATEST(1, COALESCE(sku.sample_every_n_carts, 1))
      INTO sample_n
      FROM qc_production_lot lot
      LEFT JOIN qc_product_sku sku ON sku.id = lot.sku_id
     WHERE lot.id = p_production_lot_id;

    IF sample_n IS NULL THEN
        RAISE EXCEPTION 'Production lot not found: %', p_production_lot_id;
    END IF;

    -- Only dissolve groups where EVERY member is still awaiting its verdict.
    -- (Deleting a group SET NULLs test_group_id on all its members, so a group
    -- holding an inspecting/passed/failed/hold cart must be skipped wholesale or
    -- that cart would be orphaned from its result.)
    SELECT array_agg(g.id)
      INTO old_group_ids
      FROM qc_test_group g
     WHERE g.production_lot_id = p_production_lot_id
       AND g.status = 'sampling'
       AND EXISTS (
             SELECT 1 FROM qc_drying_sub_lot sl WHERE sl.test_group_id = g.id
           )
       AND NOT EXISTS (
             SELECT 1 FROM qc_drying_sub_lot sl
              WHERE sl.test_group_id = g.id
                AND sl.status NOT IN ('pending', 'awaiting_group_result')
           );

    IF old_group_ids IS NULL THEN
        RETURN jsonb_build_object(
            'production_lot_id', p_production_lot_id, 'sample_n', sample_n,
            'carts', 0, 'dissolved_groups', 0, 'voided_samples', 0,
            'groups', '[]'::jsonb);
    END IF;

    -- Highest sub_lot_code first — the order both sampling methods assume.
    SELECT array_agg(sl.id ORDER BY sl.sub_lot_code DESC)
      INTO cart_ids
      FROM qc_drying_sub_lot sl
     WHERE sl.test_group_id = ANY(old_group_ids);

    -- Void still-pending samples of the groups being dissolved.
    WITH v AS (
        UPDATE qc_sample sa
           SET status            = 'voided',
               voided_at         = now(),
               voided_by_auth_id = auth.uid(),
               void_reason       = 'Sampling regrouped to 1 per ' || sample_n || ' carts'
         WHERE sa.status = 'pending'
           AND (sa.drying_sub_lot_id = ANY(cart_ids) OR sa.test_group_id = ANY(old_group_ids))
        RETURNING sa.id, sa.drying_sub_lot_id, sa.sample_id
    ), ev AS (
        INSERT INTO qc_quality_event (drying_sub_lot_id, event_type, payload, actor_auth_id)
        SELECT v.drying_sub_lot_id, 'sample_voided',
               jsonb_build_object(
                   'sample_id', v.sample_id,
                   'reason',    'sampling_regrouped',
                   'sample_n',  sample_n),
               auth.uid()
          FROM v
        RETURNING 1
    )
    SELECT count(*) INTO voided_count FROM v;

    -- Detach carts, then drop the dissolved groups. Both
    -- qc_drying_sub_lot.test_group_id and qc_sample.test_group_id are
    -- ON DELETE SET NULL, so the DELETE clears the links for us.
    UPDATE qc_drying_sub_lot
       SET is_test_champion = false, updated_at = now()
     WHERE id = ANY(cart_ids);

    DELETE FROM qc_test_group WHERE id = ANY(old_group_ids);

    -- Number new groups after whatever resolved groups remain on this lot.
    SELECT COALESCE(MAX(group_sequence), 0) INTO grp_seq
      FROM qc_test_group WHERE production_lot_id = p_production_lot_id;

    -- ── Re-chunk (verbatim mirror of check-out Step 2a, M-137) ───────────────
    T_count   := array_length(cart_ids, 1);
    chunk_idx := 0;
    WHILE chunk_idx < T_count LOOP
        remaining := T_count - chunk_idx;

        IF p_sampling_method = 'method_2'
           AND remaining > sample_n AND remaining < 2 * sample_n THEN
            champ_low_abs := chunk_idx + 2 + ((remaining - 1) / 2);

            member_ids := cart_ids[chunk_idx + 1 : champ_low_abs - 1];
            grp_seq := grp_seq + 1;
            groups := groups || jsonb_build_array(qc__assign_test_group(
                p_production_lot_id, grp_seq, member_ids,
                member_ids[1], false, NULL, p_sampling_method));

            member_ids := cart_ids[champ_low_abs : T_count];
            grp_seq := grp_seq + 1;
            groups := groups || jsonb_build_array(qc__assign_test_group(
                p_production_lot_id, grp_seq, member_ids,
                member_ids[1], false, NULL, p_sampling_method));
            EXIT;
        ELSE
            member_ids := cart_ids[chunk_idx + 1 : LEAST(chunk_idx + sample_n, T_count)];
            grp_seq := grp_seq + 1;
            groups := groups || jsonb_build_array(qc__assign_test_group(
                p_production_lot_id, grp_seq, member_ids,
                member_ids[1], false, NULL, p_sampling_method));
            chunk_idx := chunk_idx + sample_n;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'production_lot_id', p_production_lot_id,
        'sample_n',          sample_n,
        'sampling_method',   p_sampling_method,
        'carts',             T_count,
        'dissolved_groups',  array_length(old_group_ids, 1),
        'voided_samples',    voided_count,
        'new_groups',        jsonb_array_length(groups),
        'groups',            groups
    );
END;
$$;

COMMENT ON FUNCTION qc_regroup_pending_sampling(uuid, text) IS
  'M-172: re-chunk a lot''s un-judged carts to the SKU''s CURRENT sample_every_n_carts. Dissolves only fully un-judged sampling groups, voids their pending samples, re-assigns via qc__assign_test_group. Change the product rate first, then call.';

-- ─────────────────────────────────────────────────────────────────────────────
-- M-133  Default sampling rate → 3 取 1 (sample 1 cart out of every 3)
--
-- Operations decided to sample 1 cart per 3 instead of every cart. This sets the
-- new default for products created from here on. Existing 379 products were also
-- backfilled to 3 in production via a one-off data update (kept here so a fresh
-- DB matches the same convention; harmless on an empty table).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.qc_product_sku
  alter column sample_every_n_carts set default 3;

update public.qc_product_sku
  set sample_every_n_carts = 3
  where sample_every_n_carts is distinct from 3;

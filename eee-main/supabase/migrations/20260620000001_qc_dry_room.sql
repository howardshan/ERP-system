-- ─────────────────────────────────────────────────────────────────────────────
-- M-124  Dry rooms with capacity
--
-- The drying model moves from per-cell to per-room: the smallest unit is now a
-- dry room, each with a cart capacity. This table backs the Location Management
-- screen (create room = number + capacity; edit = capacity). The legacy per-cell
-- table `qc_drying_location` and all existing cell operations are left untouched.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.qc_dry_room (
  id            uuid primary key default gen_random_uuid(),
  dryer_number  integer not null unique,
  capacity      integer not null default 0 check (capacity >= 0),
  created_at    timestamptz not null default now()
);

alter table public.qc_dry_room enable row level security;

drop policy if exists qc_dry_room_read on public.qc_dry_room;
create policy qc_dry_room_read   on public.qc_dry_room for select using (auth.role() = 'authenticated');

drop policy if exists qc_dry_room_write on public.qc_dry_room;
create policy qc_dry_room_write  on public.qc_dry_room for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

grant select, insert, update, delete on public.qc_dry_room to authenticated;

-- Seed one room per existing dryer (1–5) with a starting capacity of 100 carts.
insert into public.qc_dry_room (dryer_number, capacity)
values (1, 100), (2, 100), (3, 100), (4, 100), (5, 100)
on conflict (dryer_number) do nothing;

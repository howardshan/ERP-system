-- ─────────────────────────────────────────────────────────────────────────────
-- M-123  App module visibility (developer superuser panel)
--
-- A single-row global config of which frontend modules are HIDDEN. Read by every
-- client (public SELECT) so the whole site respects it. Written only through the
-- SECURITY DEFINER RPC `set_module_visibility`, which checks a developer secret —
-- the superuser panel is NOT a real account, so it calls this via the anon key.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.app_module_visibility (
  id             smallint primary key default 1,
  hidden_modules text[]   not null default '{}',
  updated_at     timestamptz not null default now(),
  constraint app_module_visibility_single_row check (id = 1)
);

insert into public.app_module_visibility (id, hidden_modules)
values (1, '{}')
on conflict (id) do nothing;

alter table public.app_module_visibility enable row level security;

-- Everyone (anon + authenticated) may read the config.
drop policy if exists app_module_visibility_read on public.app_module_visibility;
create policy app_module_visibility_read
  on public.app_module_visibility for select
  using (true);

grant select on public.app_module_visibility to anon, authenticated;

-- Writes go ONLY through this RPC, gated by the developer secret (the superuser
-- panel password). No direct INSERT/UPDATE policy exists, so the table cannot be
-- modified via the REST API without the secret.
create or replace function public.set_module_visibility(p_hidden text[], p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is distinct from 'Sa697296!' then
    raise exception 'unauthorized';
  end if;

  update public.app_module_visibility
     set hidden_modules = coalesce(p_hidden, '{}'),
         updated_at     = now()
   where id = 1;

  if not found then
    insert into public.app_module_visibility (id, hidden_modules)
    values (1, coalesce(p_hidden, '{}'));
  end if;
end;
$$;

grant execute on function public.set_module_visibility(text[], text) to anon, authenticated;

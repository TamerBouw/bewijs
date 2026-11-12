-- Basis voor de balie-agent van Wasserette Bubbel (FICTIEF oefenpakket).

create table if not exists public.app_settings (
  sleutel text primary key,
  waarde text not null
);

-- Kill-switch: 'false' zet de agent uit. Alles gaat dan naar de balie.
insert into public.app_settings (sleutel, waarde) values
  ('agents_actief', 'true'),
  ('instructies_versie', '2026-12-01')
on conflict (sleutel) do nothing;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  gestart_op timestamptz not null default now(),
  klaar_op timestamptz,
  status text not null check (status in ('ok', 'fout', 'afgebroken')),
  actie text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  model text,
  samenvatting text
);

create index if not exists agent_runs_gestart_op on public.agent_runs (gestart_op desc);

-- Alleen de server (secret key) leest en schrijft. Geen policies: met RLS aan en zonder policy
-- kan de publishable key niets.
alter table public.app_settings enable row level security;
alter table public.agent_runs enable row level security;

-- Nieuwe tabellen krijgen geen automatische grants meer (nieuwe projecten sinds 30 mei 2026, bestaande
-- sinds 30 oktober 2026). De agent leest de kill-switch en schrijft runs; de bewaking leest runs.
-- app_settings wijzigt alleen een mens (de klant, in de Table Editor of de SQL-editor).
grant select on public.app_settings to service_role;
grant select, insert on public.agent_runs to service_role;

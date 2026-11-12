-- Elk kwartier de bewaking aanroepen (FICTIEF oefenpakket).
-- De Vault-geheimen project_url en bewaking_key (de benoemde secret key "bewaking") maak je eenmalig
-- met de hand aan in de SQL-editor (zie RUNBOOK.md), nooit in een migratie.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'bubbel-bewaking',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/bewaking',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'bewaking_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

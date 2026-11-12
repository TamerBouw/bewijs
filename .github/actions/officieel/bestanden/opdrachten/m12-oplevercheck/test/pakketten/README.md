# Voorbeeldpakketten (FICTIEF)

Twee opleverpakketten van de balie-agent van Wasserette Bubbel, een verzonnen klant van het fictieve
Demo Bureau Vonk. Er staan geen echte gegevens en geen echte sleutels in.

- `goed/`: volledig. De oplevercheck vindt niets.
- `fout/`: hetzelfde pakket met 25 fouten en 1 waarschuwing, voor de tests.

De Edge Functions in `supabase/functions/` zijn Deno-code met `// @ts-nocheck` bovenaan, omdat deze
repo alleen Node-code type-checkt. Ze volgen het patroon van de cursus: `withSupabase` uit
`npm:@supabase/server@1`, `export default { fetch }` en `ctx.supabaseAdmin`. De balie-functie gebruikt
`auth: 'none'` met een eigen token (`BALIE_WEBHOOK_TOKEN`), de bewaking `auth: 'secret:bewaking'`.

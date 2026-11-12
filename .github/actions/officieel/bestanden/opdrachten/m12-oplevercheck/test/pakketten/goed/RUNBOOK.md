# Runbook balie-agent Wasserette Bubbel

> Fictief oefenpakket. Voor Hamid, Joyce en wie bij Vonk dienst heeft.

## Kill-switch: de agent stoppen

1. Open het Supabase-dashboard van project `bubbelbalie01`, ga naar Table Editor, tabel `app_settings`.
2. Zet bij `agents_actief` de waarde op `false` en sla op.
3. Controle: stuur een testbericht naar het zakelijke nummer. In `agent_runs` verschijnt een rij met
   status `afgebroken` en actie `naar_mens`. Het bericht staat bij de balie.

Of in de SQL-editor:

```sql
update public.app_settings set waarde = 'false' where sleutel = 'agents_actief';
```

Stop eerst, bel daarna Vonk. Stoppen kan nooit kwaad: alle berichten gaan dan naar de balie.

## Weer starten

1. Zet `agents_actief` terug op `true`.
2. Stuur een testbericht ("Hoe laat zijn jullie open?") en controleer de rij in `agent_runs` met status `ok`.

## Storingen

### De agent antwoordt niet meer

**Symptoom:** klanten krijgen geen antwoord; de alert "geen_run" komt binnen.
**Oorzaak:** `agents_actief` staat op `false`, de functie `bubbel-balie` geeft een fout, of de berichtenapp
stuurt geen berichten meer door (token gewijzigd).
**Oplossing:** controleer eerst `agents_actief`. Open dan Edge Functions, `bubbel-balie`, Logs. Zie je
`401 niet toegestaan`, zet dan `BALIE_WEBHOOK_TOKEN` opnieuw met `npx supabase secrets set`.

### Alles gaat naar de balie

**Symptoom:** elke run heeft actie `naar_mens` met reden "dagbudget op".
**Oorzaak:** het dagbudget (`API_DAGBUDGET_EUR`) is bereikt, bijvoorbeeld door een lus of een golf spam.
**Oplossing:** kijk in `agent_runs` welke runs veel tokens gebruikten. Is het spam, laat het budget staan
tot morgen. Is het echt drukte, verhoog het budget pas na overleg met Vonk.

### De kostenalert komt binnen

**Symptoom:** mail "[bubbel] kosten" met 80% van de maandlimiet.
**Oorzaak:** meer berichten dan verwacht, een duurder model of een lus.
**Oplossing:** vergelijk `kosten_eur` per dag in `agent_runs`. Staat `AGENT_MODEL` op iets anders dan
`claude-haiku-5-5`, zet het terug. De uitgavenlimiet van de workspace is een plafond: daarboven lukken
aanroepen niet meer, en de agent zet dan alles door naar de balie.

### Een storingsmelding mist gegevens

**Symptoom:** de monteur meldt dat een melding geen machinenummer of foutcode had.
**Oorzaak:** de QR-sticker op die machine ontbreekt of verwijst naar de verkeerde machine.
**Oplossing:** controleer de sticker. Voeg het geval toe aan `evals/gevallen.jsonl` en draai de evals.

## Herstellen uit een backup

Supabase Pro maakt elke dag een backup en bewaart die 7 dagen. Bestanden in Storage zitten daar niet in.

1. Zet eerst de agent uit (kill-switch).
2. Dashboard, Database, Backups: kies de backup van vóór het probleem en start het herstel. Het project is
   tijdens het herstel niet bereikbaar.
3. Zet de agent weer aan en controleer met een testbericht.

## Vaste controles

- Elke maandag om 06.17 uur UTC draaien de evals (GitHub Actions, `evals.yml`). Onder 90% geslaagd:
  geen wijzigingen uitrollen tot het weer groen is.
- Elk kwartier controleert de functie `bewaking` of de agent draait, wat hij kost en hoeveel fouten hij
  maakt. Eenmalig instellen in de SQL-editor (de waarden staan in de wachtwoordkluis van Vonk):

```sql
select vault.create_secret('https://bubbelbalie01.supabase.co', 'project_url');
select vault.create_secret('<secret key met de naam bewaking>', 'bewaking_key');
```

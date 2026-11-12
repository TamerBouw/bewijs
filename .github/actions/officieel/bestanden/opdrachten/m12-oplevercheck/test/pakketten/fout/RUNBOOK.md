# Runbook balie-agent Wasserette Bubbel

> Fictief oefenpakket MET FOUTEN, voor de tests van de oplevercheck. Voor Hamid, Joyce en wie bij Vonk dienst heeft.

## Storingen

### De agent antwoordt niet meer

**Symptoom:** klanten krijgen geen antwoord; de alert "geen_run" komt binnen.
**Oorzaak:** de agent staat uit, de functie `bubbel-balie` geeft een fout, of de berichtenapp
stuurt geen berichten meer door (token gewijzigd).
**Oplossing:** controleer eerst of de agent aan staat. Open dan Edge Functions, `bubbel-balie`, Logs. Zie je
`401 niet toegestaan`, zet dan `BALIE_WEBHOOK_TOKEN` opnieuw met `npx supabase secrets set`.

### Alles gaat naar de balie

**Symptoom:** elke run heeft actie `naar_mens` met reden "dagbudget op".
**Oplossing:** kijk in `agent_runs` welke runs veel tokens gebruikten. Is het spam, laat het budget staan
tot morgen. Is het echt drukte, verhoog het budget pas na overleg met Vonk.

## Stoppen

Zet de agent uit in het dashboard van Supabase en bel Vonk.

## Vaste controles

- Elke maandag om 06.17 uur UTC draaien de evals (GitHub Actions, `evals.yml`). Onder 90% geslaagd:
  geen wijzigingen uitrollen tot het weer groen is.
- Elk kwartier controleert de functie `bewaking` of de agent draait, wat hij kost en hoeveel fouten hij
  maakt. Eenmalig instellen in de SQL-editor (de waarden staan in de wachtwoordkluis van Vonk):

```sql
select vault.create_secret('https://bubbelbalie01.supabase.co', 'project_url');
select vault.create_secret('<secret key met de naam bewaking>', 'bewaking_key');
```

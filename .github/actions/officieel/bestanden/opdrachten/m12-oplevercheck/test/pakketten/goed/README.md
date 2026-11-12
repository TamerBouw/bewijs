# Balie-agent Wasserette Bubbel

> Fictief oefenpakket van Demo Bureau Vonk voor de module "Opleveren, beheren en verkopen".
> Wasserette Bubbel bestaat niet. Er staan geen echte gegevens of sleutels in.

## Wat de agent doet

- Beantwoordt in de berichtenapp de tien standaardvragen: openingstijden, prijs per kilo, dekbedden,
  doorlooptijd van de was- en vouwservice, vrije machines (alleen Centrum en Noord), pinnen, parkeren,
  gevonden voorwerpen, een machine die geld heeft "opgegeten" (doorzetten) en vragen over de bedrijfswas
  (doorzetten). In het Nederlands en het Engels.
- Maakt van een storingsmelding via het QR-formulier op de machine een volledige melding voor de
  onderhoudspartij: vestiging, machinenummer, foutcode en omschrijving. Ontbreekt er iets, dan vraagt
  hij het na.
- Schrijft elke run in `agent_runs`: status, actie, tokens en kosten. Nooit de tekst van het bericht.

## Wat de agent niet doet

- Geld terugbeloven of terugbetalen. Dat doen Joyce of Hamid (tot 25 euro mag Hamid zelf beslissen).
- Klachten over kwijtgeraakte of beschadigde was afhandelen: die gaan altijd naar een mens.
- Noodgevallen (brand, waterlekkage, inbraak): de agent antwoordt alleen "bel 112 en daarna Hamid" en
  zet het bericht direct door. Er volgt nooit een gewoon antwoord.
- Namen, telefoonnummers, adressen of sleutelcodes opslaan.
- Iets doen als `agents_actief` op `false` staat: dan gaat alles naar de balie.

## Installeren

```bash
npx supabase login
npx supabase link --project-ref bubbelbalie01
npx supabase db push --remote
cp .env.example supabase/functions/.env   # waarden invullen, nooit committen
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy bubbel-balie
npx supabase functions deploy bewaking
```

Maak onder API Keys een secret key met de naam `bewaking` en zet hem daarna met de project-URL in Vault
(zie `RUNBOOK.md`, "Vaste controles").

## Stoppen en starten

Stoppen: zet `agents_actief` op `false` (zie `RUNBOOK.md`, eerste sectie). Starten: terug op `true`.
Je hoeft niets opnieuw uit te rollen.

## Kosten

- Modelgebruik: verwacht ongeveer 1,30 euro per maand (claude-haiku-5-5). Dagbudget in code:
  `API_DAGBUDGET_EUR` (2 euro). Uitgavenlimiet van de workspace `bubbel-productie`: 25 euro per maand.
- Supabase Pro voor de organisatie "Wasserette Bubbel", op naam en rekening van de klant.
- Beheer volgens de offerte: 2 uur per maand.

## Contact

- Beheer en storingen: Milan, Demo Bureau Vonk, beheer@bureauvonk.example (werkdagen 09.00-17.00).
- Bij de klant: Hamid (bedrijfsleider) beslist over stoppen en starten.

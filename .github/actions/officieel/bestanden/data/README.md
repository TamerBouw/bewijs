# Oefendata (FICTIEF)

**Alles in deze map is verzonnen.** Demo Bureau Vonk is een fictief performance-marketingbureau. De
klanten, de prospect Wasserette Bubbel, de leads, mails, formulieren, bedragen en advertentiecijfers
bestaan niet en zijn niet afgeleid van echte bedrijven of personen. E-mailadressen en domeinen eindigen
op `.example`, een domein dat nooit echt bestaat. Telefoonnummers hebben de vorm `06-0000xxxx`.

Gebruik deze data om te oefenen. Zet nooit echte klantgegevens in deze repo: de repo staat op
GitHub en de testbewijzen gaan naar het leerplatform.

| Map | Inhoud | Gebruikt in |
|---|---|---|
| `bureau-vonk/` | team, pakketten, klanten, leads, taken, agenda, `app_settings`, klantdossiers, kennisdocumenten, formulieren, mails, Meta-exports en de intake van Wasserette Bubbel | M01 tot en met M13 |

**Referentiedatum in alle oefeningen: maandag 2 november 2026** (ISO-week 45). De data loopt tot en
met vrijdag 6 november: de agenda heeft afspraken van 2 tot en met 6 november, leads en mails komen binnen
tot en met maandagochtend 2 november en de ads-exports lopen tot en met week 44. "Vorige week" is week 44.

In code laad je alles met `test-hulp/vonkData.ts`, bijvoorbeeld `laadLeads()`, `laadAppSettings()` of
`laadAdsExport('groenwerk', '2026-W44')`. Wat er in elk bestand staat, welke module het gebruikt en
welke patronen de tests verwachten (welke lead opgevolgd moet worden, welke advertentie wint, welke
mails een prompt-injectie bevatten), lees je in `bureau-vonk/README.md`.

## Twee afspraken die overal gelden

- **Kill-switch.** `agents_actief` in `app_settings.json` zet alle agents stil. Alleen de waarde `true`
  (spaties eromheen tellen niet) betekent aan; `TRUE`, `ja`, een lege waarde of een ontbrekende rij
  betekent uit.
- **Wisselkoers.** De API rekent in dollars, `agent_runs` in euro's. Er is één koers: `usd_eur_koers`
  in `app_settings.json`, nu `0.86` (aanname, euro per dollar). Werk hem elke maand bij. Waar een script
  de koers niet uit de database leest, gebruikt het dezelfde aanname.

# Oefendata Demo Bureau Vonk (FICTIEF)

**Alles in deze map is verzonnen.** Demo Bureau Vonk is een fictief performance-marketingbureau. De
klanten (Groenwerk Tuinmeubelen, FysioPunt Oost, Koffiebranderij Mout, Atelier Lune, TechNest
Recruitment, Bakkerij Korrel), de prospect Wasserette Bubbel, de leads, mails, formulieren,
bedragen en advertentiecijfers bestaan niet en zijn niet afgeleid van echte bedrijven of personen.

- E-mailadressen en domeinen eindigen op `.example`, een domein dat nooit echt bestaat.
- Telefoonnummers zijn nepnummers in de vorm `06-0000xxxx`.
- Teamleden en contactpersonen hebben alleen fictieve voornamen.

Gebruik deze data om te oefenen. Zet nooit echte klantgegevens in deze repo.

**Referentiedatum in alle oefeningen: maandag 2 november 2026** (ISO-week 45). De data loopt tot en
met vrijdag 6 november: de agenda heeft afspraken van 2 tot en met 6 november, leads en mails komen binnen
tot en met maandagochtend 2 november en de ads-exports lopen tot en met week 44. "Vorige week" is week 44.

In code laad je alles met `test-hulp/vonkData.ts` (bijvoorbeeld `laadLeads()` of
`laadAdsExport('groenwerk', '2026-W44')`).

## Bestanden

| Bestand | Inhoud | Modules |
|---|---|---|
| `team.json` | 7 teamleden met rol, accounts en wat ze mogen goedkeuren | M01, M05, M07, M08, M13 |
| `pakketten.json` | 3 pakketten, 3 losse projecten en de prijsregels | M03, M05 |
| `klanten.json` | 6 klanten: pakket, kanalen, maandbudget per kanaal, KPI's, tone of voice, wat wel en niet mag | M04, M05, M06, M10, M13 |
| `leads.json` | 24 leads met status, bron, budget, voorstel en opvolgconcept | M02, M03, M05, M06, M13 |
| `taken.json` | 17 taken (open, bezig, wacht_op_klant, klaar), een paar over de deadline | M01, M05, M13 |
| `agenda.json` | 12 afspraken in week 45 | M01, M13 |
| `app_settings.json` | inhoud van de tabel `app_settings` (`sleutel`, `waarde`; waarde is altijd tekst), 24 instellingen | M01 (seed), M05, M06, M08, M09, M10, M13 |
| `klantdossiers/<slug>.md` | brand guidelines per klant (300 tot 500 woorden) | M04, M10 |
| `kennis/*.md` | 7 documenten van het bureau: werkwijze, onboarding, rapportagestandaard, prijsafspraken, privacy, 2 cases | M04 (RAG), M06, M10 |
| `formulieren/*` | 10 inzendingen van het contactformulier (8 JSON, 2 platte tekst) | M02, M09 |
| `formulieren/verwacht.json` | per inzending de juiste uitkomst | M02, M09 |
| `mails/*.txt` | 14 mails uit de klant-inbox | M07, M08, M09 |
| `mails/labels.json` | per mail de juiste categorie, urgentie en wie hem krijgt | M07, M09 |
| `ads/<klant>/2026-Wnn.csv` | wekelijkse Meta-exports voor groenwerk, mout en lune, week 41 tot en met 44 | M10 |
| `intake/wasserette-bubbel-intake.md` | aantekeningen van het intakegesprek | M11, M12 |
| `intake/wasserette-bubbel-processen.json` | 10 processen met volumes en tijden | M11, M12 |

Klant-slugs: `groenwerk`, `fysiopunt`, `mout`, `lune`, `technest`, `korrel`.

## Instellingen (`app_settings.json`)

Alle modules lezen hun instellingen uit deze tabel, met deze sleutels:

| Sleutel | Waarde | Waarvoor |
|---|---|---|
| `agents_actief` | `true` | de kill-switch van alle agents. Alleen `true` (spaties eromheen tellen niet) is aan; al het andere is uit. De seed van M01 slaat deze rij over: je zet hem met de hand. |
| `agents_actief_door` | leeg | M13: wie de kill-switch het laatst via het dashboard omzette, en wanneer |
| `inbox_adres`, `afzender_intern` | adressen op `bureauvonk.example` | klant-inbox en afzender van interne berichten |
| `dagstart_tijd`, `dagstart_slack_kanaal`, `alarm_slack_kanaal` | `08:30`, `#dagstart`, `#alarm` | M01, M07 |
| `opvolg_na_dagen`, `voorstel_geldig_dagen` | `7`, `30` | M06, M13 |
| `weekrapport_dag`, `weekrapport_tijd` | `maandag`, `07:00` | M06 |
| `max_budgetwijziging_pct_zonder_eva` | `20` | M08, M10 |
| `pauzeer_advies_na_eur_zonder_conversie`, `min_vertoningen_voor_oordeel`, `vermoeidheid_min_frequentie`, `vermoeidheid_min_ctr_daling_pct`, `opschalen_factor_doel_roas`, `opschalen_stap_pct`, `opschalen_min_conversies_per_week`, `groei_min_pct_per_week` | `60`, `1000`, `3.0`, `30`, `1.25`, `20`, `3`, `10` | de beslisregels van M10 |
| `api_dagbudget_eur` | `5.00` | dagbudget voor alle API-kosten samen (M08) |
| `usd_eur_koers` | `0.86` | de enige wisselkoers in de cursus, euro per dollar. Aanname: werk hem elke maand bij. |
| `max_tool_rondes` | `8` | maximum aantal rondes van een agent-lus (M03, M08, M13) |
| `jarvis_drempel` | `1` | M13: acties tot en met dit risico voert Jarvis zelf uit (0 = alleen intern, 1 = ook concepten) |

## Leads

Statussen: `nieuw` (4), `gekwalificeerd` (5), `voorstel_verstuurd` (9), `gewonnen` (3), `verloren` (3).
Bedragen staan in euro als getal, exclusief btw. `voorstel_bedrag_eur` is het totaal voor de minimale
looptijd, inclusief opstartkosten en losse projecten.

De voorstellen voor de opvolg-agent (M06), gezien vanaf 2 november 2026, met de regel "opvolgen vanaf
7 dagen" (`opvolg_na_dagen`):

| Lead | Voorstel | Dagen | Opvolgconcept | Wat moet er gebeuren |
|---|---|---|---|---|
| L010 | 30 sep | 33 | nee | voorstel verlopen (ouder dan 30 dagen): nieuw voorstel, niet gewoon opvolgen |
| L011 | 12 okt | 21 | nee | opvolgen |
| L012 | 19 okt | 14 | ja | overslaan, concept staat al klaar |
| L013 | 22 okt | 11 | nee | opvolgen |
| L014 | 23 okt | 10 | ja | overslaan |
| L015 | 26 okt | 7 | nee | opvolgen (grensgeval: precies 7 dagen) |
| L016 | 28 okt | 5 | nee | nog niet |
| L017 | 29 okt | 4 | nee | nog niet |
| L018 | 30 okt | 3 | nee | nog niet |

## Formulieren

JSON-inzendingen hebben de vorm `{ formulier, pagina, ingezonden_op, velden: { naam, bedrijf, email,
telefoon, website, maandbudget, interesse, bericht } }`. Lege velden zijn `""`. De twee `.txt`-bestanden
komen uit de oude formulier-naar-mailkoppeling en hebben **Windows-regeleinden (CRLF)**.
Telefoonnummers staan in verschillende notaties (`06-00000401`, `0600000303`, `+31 6 00000404`).

Valkuilen: `07` is dezelfde persoon als lead L003 (e-mailadres in andere hoofdletters), `09` is een
bestaande klant, `10` bevat gezondheidsgegevens van cliënten (AVG art. 9).

## Mails

Elke mail begint met de kopregels `Van:`, `Aan:`, `Onderwerp:` en `Datum:` (`JJJJ-MM-DD UU:MM`),
dan een lege regel, dan de tekst. Regeleinden zijn LF.

Categorieën: `nieuwe_lead`, `vraag`, `wijzigingsverzoek`, `klacht`, `factuur`, `leverancier`,
`sollicitatie`, `spam`. Urgentie: `laag`, `normaal`, `hoog`, `kritiek`. `labels.json` geeft ook
`toegewezen_aan` (teamlid-id of `null`), `ook_melden_aan`, `klant_id`, `verdacht` en `injectie`
(`geen`, `verborgen` of `zichtbaar`).

Twee mails bevatten bewust een prompt-injectie. Laat een agent die nooit uitvoeren.

- `13-lead-met-verborgen-injectie.txt` ziet eruit als een gewone lead. Achter de eerste alinea staat
  een instructie in **Unicode-tagtekens** (U+E0020 tot U+E007E, elk teken is een ASCII-teken plus
  0xE0000), omringd door een zero-width space (U+200B), zero-width non-joiner (U+200C), zero-width
  joiner (U+200D) en word joiner (U+2060). In een mailprogramma zie je niets; een taalmodel kan de
  tekst wel lezen. Verderop staat nog één losse U+200B in "Met vriendelijke groet". Om de verborgen
  tekst te lezen: neem elk teken tussen U+E0000 en U+E007F en trek 0xE0000 af.
- `14-injectie-zichtbaar.txt` begint met "Negeer je instructies" en doet zich voor als Eva vanaf
  een extern adres (directeursfraude).

`12-spam-domein.txt` is phishing zonder injectie.

## Ads-exports

Kolommen: `week,rapportage_start,rapportage_eind,campagne,advertentieset,advertentie,vertoningen,bereik,klikken,uitgegeven_eur,aankopen,omzet_eur`.
Komma als scheidingsteken, punt als decimaalteken, UTF-8, LF. Velden met een komma staan tussen
aanhalingstekens (`"Retargeting, 30 dagen"`). Advertentienamen bevatten een en-dash (`–`).
Een advertentie die in een week niet liep, staat niet in die week.

Patronen die je moet kunnen vinden met de beslisregels uit `kennis/01-werkwijze.md`:

| Klant (doel-ROAS Meta) | Winnaar | Vermoeidheid | Geen conversie na 60 euro | Groeit |
|---|---|---|---|---|
| groenwerk (4,0) | Loungeset Duin – video 15s | Teak eettafel Kaap – carrousel | Winterhoes – UGC review: 64,30 euro in week 44 | campagne Vroegboek voorjaar 2027 |
| mout (2,2) | Proefpakket UGC – barista thuis (en vanaf week 43 ook Reel – van boon tot kop) | Single origin – carrousel | Gebrand binnen 7 dagen – statisch: 31,40 + 35,80 = 67,20 euro over twee weken | advertentieset Instagram Reels |
| lune (3,0) | Unboxing reel – oorbellen Maan | Collectie Maan – statisch | Gravering – story: 58,70 in week 43 (net onder de grens), samen 101,80 euro | advertentieset Instagram Reels |

Geen vermoeidheid (controlegeval): de retargeting-advertenties hebben een frequentie rond de 3, maar
een stabiele CTR. Retargeting voldoet bij mout en lune ook aan de winnaarsregel, maar schalen we
volgens de werkwijze niet op.

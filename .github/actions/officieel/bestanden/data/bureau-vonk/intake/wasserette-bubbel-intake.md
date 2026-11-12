# Intakegesprek Wasserette Bubbel

> Fictieve gespreksaantekeningen van Demo Bureau Vonk. Wasserette Bubbel bestaat niet.

- **Datum:** vrijdag 30 oktober 2026, 14.00 tot 15.15 uur
- **Plaats:** vestiging Centrum, in het kantoortje achter de balie
- **Aanwezig:** Joyce (eigenaar), Hamid (bedrijfsleider), Eva en Milan (Vonk)
- **Aantekeningen:** Milan, aangevuld door Eva
- **Lead in het CRM:** L002

## Over het bedrijf
Wasserette Bubbel heeft vier vestigingen in dezelfde stad: Centrum, Noord, Zuid en Stationsbuurt. Joyce begon in 2014 met Centrum en nam de andere drie over tussen 2019 en 2024. Er werken 11 mensen (samen ongeveer 6 fte), vooral parttimers en studenten. Alle vestigingen zijn 7 dagen per week open van 07.00 tot 22.00 uur, maar er staat alleen tussen 09.00 en 18.00 uur iemand achter de balie.

Drie soorten omzet (schatting van Joyce, per maand ongeveer 58.000 euro):
1. **Selfservice** (ongeveer 55%): wasmachines en drogers, betalen bij een betaalzuil. Centrum en Noord hebben nieuwe machines die hun status online doorgeven (vrij, bezet, storing). Zuid en Stationsbuurt hebben oudere machines zonder online status.
2. **Was- en vouwservice** (ongeveer 25%): je brengt je was, de volgende dag haal je hem gevouwen op. 2,95 euro per kilo, minimaal 5 kilo. Groeit hard, vooral bij studenten en expats.
3. **Bedrijfswas** (ongeveer 20%): 23 vaste zakelijke klanten, zoals kappers, sportscholen, twee schoonheidssalons en een paar verhuurders van vakantiewoningen. Handdoeken, beddengoed en werkkleding. Ophalen en bezorgen op dinsdag en vrijdag met één bus.

## Wat Joyce wil
Joyce opende met: "Ik wil een AI die alles doet, zodat Hamid en ik weer gewoon ons werk kunnen doen." Na doorvragen kwamen er drie prioriteiten uit, in deze volgorde:

1. **Klantvragen.** Er komen per week zo'n 180 vragen binnen via telefoon, de berichtenapp op het zakelijke nummer, Instagram en mail. Volgens Hamid gaat 60% over steeds dezelfde tien dingen: openingstijden, prijs per kilo, of je een dekbed kunt wassen, hoe lang de was- en vouwservice duurt, of er een machine vrij is, of je kunt pinnen, waar je kunt parkeren, gevonden voorwerpen, een machine die geld heeft "opgegeten" en vragen over de bedrijfswas. Hamid beantwoordt de berichten 's avonds vanaf de bank. Gemiddelde reactietijd nu: 5 uur, in het weekend vaak de volgende dag. Veel klanten schrijven in het Engels, een paar in het Pools.
2. **Storingen.** Per week gaan er gemiddeld 14 machines of drogers stuk. Klanten melden het aan de balie, bellen of plakken een briefje. Hamid mailt dan de monteur van de onderhoudspartij, maar mist vaak gegevens (machinenummer, foutcode, vestiging). Bij ongeveer 30% van de storingen moet de monteur daardoor twee keer komen. Een machine staat gemiddeld 2,5 dag stil. Joyce schat dat een stilstaande machine 38 euro omzet per dag kost.
3. **Bedrijfswas.** Orders komen binnen via mail, telefoon en de berichtenapp, vaak vaag: "zelfde als vorige keer, maar dan meer handdoeken". Hamid typt alles over in een planningsspreadsheet. Joyce maakt aan het eind van de maand de facturen in het boekhoudprogramma, wat haar een hele middag kost. Er gaan ongeveer drie facturen per maand fout.

Verder genoemd, maar minder belangrijk: Google-reviews beantwoorden (nu wordt 40% beantwoord), social media ("we posten bijna nooit"), het rooster en het ruilen van diensten via een groepsapp, en de route van de bus.

## Systemen
- Mail en agenda in Google Workspace
- Website gemaakt met een websitebouwer, met een contactformulier dat naar de algemene mail gaat
- Berichtenapp voor bedrijven op één zakelijk nummer, gedeeld door Hamid en de balie
- Betaalzuilen en machines: de leverancier heeft een portaal met een CSV-export per dag. Of er een koppeling (API) is, weet Joyce niet. Alleen Centrum en Noord geven een online status door.
- Spreadsheet "Planning bedrijfswas 2026" in de gedeelde map
- Boekhoudprogramma, waar Joyce zelf factureert
- Geen CRM

## Zorgen en randvoorwaarden
- **Hamid is sceptisch.** "Klanten willen een mens, vooral als hun was kwijt is." Afgesproken: een klant kan altijd om een mens vragen, en klachten over kwijtgeraakte of beschadigde was gaan altijd naar een mens.
- **Veiligheid.** Een brandende droger of waterlekkage is een noodgeval: bellen, nooit een bericht van een agent. Joyce wil dat expliciet vastgelegd.
- **Privacy.** In berichten staan namen, telefoonnummers en adressen voor ophalen. Verhuurders van vakantiewoningen sturen soms sleutelcodes mee. Die mogen nergens worden opgeslagen.
- **Personeel.** De meeste medewerkers werken niet graag met nieuwe systemen. Alles moet werken via wat ze al gebruiken: de telefoon en de berichtenapp.
- **Geld terug.** Een agent mag nooit geld terugbeloven. Dat doen Joyce of Hamid, tot 25 euro mag Hamid zelf beslissen.

## Budget en planning
- Eenmalig maximaal 9.000 euro (excl. btw), per maand maximaal 350 euro voor beheer en de kosten van het taalmodel.
- Live vóór 1 februari 2027. In januari begint het nieuwe semester en is het druk met studenten.
- Joyce beslist samen met haar compagnon Stijn, die bij het vervolggesprek aanwezig is.

## Advertenties
Joyce wil de was- en vouwservice in Noord bekender maken bij studenten en expats. Ze denkt aan 800 euro per maand op Meta. Dat past bij het pakket Start (1.250 euro per maand, minimaal 3 maanden). Eva heeft gezegd dat we dat apart bekijken, los van het automatiseringsproject.

## Eerste indruk van Vonk
- Klantvragen en storingen zijn goed te automatiseren: veel volume, steeds dezelfde vragen, en de informatie is te structureren.
- Bedrijfswasorders zijn een tweede stap: eerst moeten de orders gestructureerd binnenkomen, bijvoorbeeld met een vast bestelformulier.
- Rooster en route: niet in de eerste fase.
- Grootste risico: verwachtingen. "Een AI die alles doet" bestaat niet. Eerste fase klein houden en meten.

## Afspraken
- Joyce stuurt vóór woensdag 4 november: een export van twee weken berichten (**zonder namen, nummers en adressen**, Hamid haalt die eruit), het storingslog van oktober en de lijst met bedrijfswasklanten (alleen bedrijfsnamen en ophaaldagen).
- Milan werkt een automatiseringsscan en een projectvoorstel met fasering, uren en maandkosten uit.
- Terugkoppeling op vrijdag 6 november om 10.00 uur in vestiging Centrum, met Joyce, Hamid en Stijn.

## Open vragen
- Heeft de leverancier van de machines een API, of alleen de CSV-export?
- Mag de agent in het Engels en Pools antwoorden, of alleen in het Nederlands en Engels?
- Wie is 's avonds en in het weekend aanspreekpunt als de agent iets doorzet naar een mens?
- Wil de onderhoudspartij storingen in een vast formaat ontvangen (formulier of mail)?

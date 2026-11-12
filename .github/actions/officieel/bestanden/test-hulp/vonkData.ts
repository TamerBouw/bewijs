/**
 * Leest de FICTIEVE oefendata van "Demo Bureau Vonk" in data/bureau-vonk/.
 * Alles is verzonnen; zie data/bureau-vonk/README.md. Referentiedatum: maandag 2 november 2026.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { REPO_MAP } from './bron';

export const VONK_MAP = `${REPO_MAP}/data/bureau-vonk`;

/** "Nu" in alle oefeningen: maandag 2 november 2026 (ISO-week 45). */
export const REFERENTIEDATUM = '2026-11-02';

// ---------- Team ----------

export type Rol =
  | 'eigenaar'
  | 'accountmanager'
  | 'performance_marketeer'
  | 'creative'
  | 'copywriter'
  | 'automatisering'
  | 'projectcoordinator';

export type ActieType =
  | 'budget_wijzigen'
  | 'campagne_starten'
  | 'campagne_pauzeren'
  | 'advertentie_publiceren'
  | 'bericht_naar_klant'
  | 'voorstel_versturen'
  | 'korting_geven'
  | 'factuur_wijzigen'
  | 'contract_wijzigen'
  | 'data_exporteren'
  | 'data_verwijderen';

export interface VonkTeamlid {
  id: string;
  naam: string;
  rol: Rol;
  functie: string;
  email: string;
  telefoon: string;
  slack: string;
  uren_per_week: number;
  /** Klant-id's waarvan dit teamlid accountmanager is. */
  accounts: string[];
  taken: string[];
  mag_goedkeuren: ActieType[];
}

// ---------- Pakketten ----------

export type Pakketcode = 'start' | 'groei' | 'schaal';
export type Rapportage = 'week' | 'maand';
export type LosProjectCode = 'landingspagina' | 'creative_sprint' | 'advertentie_audit';

export interface VonkPakket {
  code: Pakketcode;
  naam: string;
  prijs_per_maand_eur: number;
  opstartkosten_eur: number;
  /** Advertentiekanalen; e-mail telt niet mee. */
  max_kanalen: number;
  creatives_per_maand: number;
  rapportage: Rapportage;
  email_marketing: boolean;
  strategiesessie: boolean;
  inbegrepen: string[];
  niet_inbegrepen: string[];
}

export interface VonkLosProject {
  code: LosProjectCode;
  naam: string;
  prijs_eur: number;
  omschrijving: string;
}

export interface VonkPrijsregels {
  minimale_looptijd_maanden: number;
  opzegtermijn_maanden: number;
  facturatie: string;
  betaaltermijn_dagen: number;
  voorstel_geldig_dagen: number;
  jaarcontract_korting_pct: number;
  max_uitzondering_korting_pct: number;
  uitzondering_korting_goedkeurder: string;
  meerwerk_uurtarief_eur: number;
  min_advertentiebudget_per_kanaal_eur: number;
  audit_verrekenen_binnen_dagen: number;
  advertentiebudget_betaalt: string;
  niet_mogelijk: string[];
  maatwerk_automatisering: string;
}

export interface VonkPakketten {
  valuta: 'EUR';
  btw_pct: number;
  prijzen_excl_btw: boolean;
  pakketten: VonkPakket[];
  losse_projecten: VonkLosProject[];
  regels: VonkPrijsregels;
}

// ---------- Klanten ----------

export type Kanaal = 'meta' | 'google' | 'linkedin';
export type KlantType = 'webshop' | 'lokaal' | 'b2b';
export type KlantStatus = 'actief' | 'opzegrisico' | 'opgezegd' | 'gepauzeerd';
export type KlantSlug = 'groenwerk' | 'fysiopunt' | 'mout' | 'lune' | 'technest' | 'korrel';
export type KpiNaam =
  | 'roas'
  | 'cpa_eur'
  | 'cpl_eur'
  | 'leads_per_maand'
  | 'aankopen_per_maand'
  | 'abonnementen_per_maand'
  | 'gemiddelde_orderwaarde_eur'
  | 'email_omzet_aandeel_pct'
  | 'kandidaatleads_pct';

export const KLANT_SLUGS: readonly KlantSlug[] = ['groenwerk', 'fysiopunt', 'mout', 'lune', 'technest', 'korrel'];

export interface VonkKpi {
  kpi: KpiNaam;
  /** null = over alle kanalen samen. */
  kanaal: Kanaal | 'email' | null;
  doel: number;
  type: 'minimaal' | 'maximaal';
}

export interface VonkContactpersoon {
  naam: string;
  rol: string;
  email: string;
  telefoon: string;
}

export interface VonkKlant {
  id: string;
  slug: KlantSlug;
  naam: string;
  domein: string;
  sector: string;
  type: KlantType;
  pakket: Pakketcode;
  kanalen: Kanaal[];
  email_marketing: boolean;
  maandbudget_ads_eur: Partial<Record<Kanaal, number>>;
  maandbudget_ads_totaal_eur: number;
  start_datum: string;
  minimale_einddatum: string;
  status: KlantStatus;
  /** Teamlid-id. */
  accountmanager: string;
  contactpersoon: VonkContactpersoon;
  slack_kanaal: string;
  rapportage: Rapportage;
  doelen: string[];
  kpis: VonkKpi[];
  tone_of_voice: string;
  mag: string[];
  mag_niet: string[];
  gevoelige_gegevens: boolean;
  notitie: string;
}

// ---------- Leads ----------

export type LeadStatus = 'nieuw' | 'gekwalificeerd' | 'voorstel_verstuurd' | 'gewonnen' | 'verloren';
export type LeadBron = 'formulier' | 'mail' | 'linkedin' | 'doorverwijzing';

export interface VonkOpvolgconcept {
  aangemaakt_op: string;
  onderwerp: string;
  tekst: string;
}

export interface VonkLead {
  id: string;
  naam: string;
  bedrijf: string;
  email: string;
  telefoon: string | null;
  branche: string;
  website: string | null;
  bron: LeadBron;
  status: LeadStatus;
  aangemaakt_op: string;
  /** Advertentiebudget per maand in euro, of null als het onbekend is. */
  budget_indicatie_eur: number | null;
  kanalen_interesse: Kanaal[];
  /** Teamlid-id. */
  eigenaar: string;
  laatste_contact_op: string | null;
  voorstel_datum: string | null;
  /** null bij een voorstel voor alleen een los project. */
  voorstel_pakket: Pakketcode | null;
  /** Totaal voor de minimale looptijd, excl. btw, incl. opstartkosten en losse projecten. */
  voorstel_bedrag_eur: number | null;
  opvolgconcept: VonkOpvolgconcept | null;
  klant_id: string | null;
  verloren_reden: string | null;
  notitie: string | null;
}

// ---------- Taken, agenda, instellingen ----------

export type TaakStatus = 'open' | 'bezig' | 'wacht_op_klant' | 'klaar';
export type Prioriteit = 'laag' | 'normaal' | 'hoog';
export type TaakBron = 'handmatig' | 'agent';

export interface VonkTaak {
  id: string;
  titel: string;
  omschrijving: string;
  toegewezen_aan: string;
  klant_id: string | null;
  lead_id: string | null;
  deadline: string;
  status: TaakStatus;
  prioriteit: Prioriteit;
  bron: TaakBron;
  aangemaakt_op: string;
}

export interface VonkAfspraak {
  id: string;
  datum: string;
  start: string;
  eind: string;
  titel: string;
  deelnemers: string[];
  klant_id: string | null;
  lead_id: string | null;
  locatie: string;
}

/** Een rij uit de tabel app_settings. De waarde is altijd tekst. */
export interface VonkAppSetting {
  sleutel: string;
  waarde: string;
}

// ---------- Formulieren ----------

export interface VonkFormulierVelden {
  naam: string;
  bedrijf: string;
  email: string;
  telefoon: string;
  website: string;
  maandbudget: string;
  interesse: string[];
  bericht: string;
}

export interface VonkFormulierJson {
  formulier: string;
  pagina: string;
  ingezonden_op: string;
  velden: VonkFormulierVelden;
}

export type VonkFormulier =
  | { bestand: string; formaat: 'json'; ruw: string; data: VonkFormulierJson }
  | { bestand: string; formaat: 'txt'; ruw: string; data: null };

export type FormulierSoort = 'lead' | 'dubbele_lead' | 'bestaande_klant' | 'sollicitatie' | 'spam';

export interface VonkFormulierVerwachting {
  bestand: string;
  soort: FormulierSoort;
  taal: 'nl' | 'en';
  dubbel_van: string | null;
  klant_id: string | null;
  ontbreekt: string[];
  budget_eur: number | null;
  pakket_indicatie: Pakketcode | null;
  gevoelige_gegevens: boolean;
  /** De volgende stap zoals de intake van M02 hem bepaalt (kwalificeer). */
  volgende_stap: 'bellen' | 'mail_met_vragen' | 'afwijzen' | 'lead_bijwerken' | 'naar_accountmanager' | 'naar_eva' | 'negeren';
  toelichting: string;
}

// ---------- Mails ----------

export type MailCategorie =
  | 'nieuwe_lead'
  | 'vraag'
  | 'wijzigingsverzoek'
  | 'klacht'
  | 'factuur'
  | 'leverancier'
  | 'sollicitatie'
  | 'spam';
export type Urgentie = 'laag' | 'normaal' | 'hoog' | 'kritiek';
export type Injectie = 'geen' | 'verborgen' | 'zichtbaar';

export const MAIL_CATEGORIEEN: readonly MailCategorie[] = [
  'nieuwe_lead',
  'vraag',
  'wijzigingsverzoek',
  'klacht',
  'factuur',
  'leverancier',
  'sollicitatie',
  'spam',
];
export const URGENTIES: readonly Urgentie[] = ['laag', 'normaal', 'hoog', 'kritiek'];

export interface VonkMail {
  bestand: string;
  van: string;
  aan: string;
  onderwerp: string;
  /** Zoals in de kopregel: "JJJJ-MM-DD UU:MM". */
  datum: string;
  /** De tekst na de kopregels, ongewijzigd (onzichtbare tekens blijven staan). */
  tekst: string;
}

export interface VonkMailLabel {
  bestand: string;
  categorie: MailCategorie;
  urgentie: Urgentie;
  toegewezen_aan: string | null;
  ook_melden_aan: string[];
  klant_id: string | null;
  verdacht: boolean;
  injectie: Injectie;
  toelichting: string;
}

export interface VonkMailMetLabel extends VonkMail {
  label: VonkMailLabel;
}

// ---------- Ads ----------

export type AdsKlant = 'groenwerk' | 'mout' | 'lune';
export const ADS_KLANTEN: readonly AdsKlant[] = ['groenwerk', 'mout', 'lune'];

export interface VonkAdsRij {
  /** ISO-week, bijvoorbeeld "2026-W44". */
  week: string;
  rapportage_start: string;
  rapportage_eind: string;
  campagne: string;
  advertentieset: string;
  advertentie: string;
  vertoningen: number;
  bereik: number;
  klikken: number;
  uitgegeven_eur: number;
  aankopen: number;
  omzet_eur: number;
}

// ---------- Documenten en intake ----------

export interface VonkDocument {
  bestand: string;
  /** De eerste kop (# ...) van het document. */
  titel: string;
  tekst: string;
}

export interface BubbelVestiging {
  naam: string;
  wasmachines: number;
  drogers: number;
  online_status: boolean;
  balie: string;
}

export interface BubbelProces {
  id: string;
  naam: string;
  wie: string;
  kanalen: string[];
  frequentie: 'week' | 'maand';
  /** Aantal keer per week of per maand (zie frequentie). */
  volume: number;
  minuten_per_keer: number;
  gevoelige_gegevens: string[];
  pijnpunt: string;
  risico_bij_fout: 'laag' | 'middel' | 'hoog' | 'kritiek';
  nooit_automatiseren?: boolean;
  /** Overige meetwaarden per proces, zoals aandeel_herhaalvragen_pct of gemiddelde_stilstand_dagen. */
  [extra: string]: unknown;
}

export interface BubbelProcesoverzicht {
  bedrijf: string;
  fictief: true;
  bron: string;
  uurkosten_eur: number;
  omzet_per_maand_eur: number;
  stilstand_omzetverlies_per_machine_per_dag_eur: number;
  vestigingen: BubbelVestiging[];
  processen: BubbelProces[];
}

export interface VonkIntake {
  aantekeningen: string;
  processen: BubbelProcesoverzicht;
}

// ---------- Hulpjes ----------

function lees(pad: string): string {
  return readFileSync(`${VONK_MAP}/${pad}`, 'utf8');
}

function leesJson<T>(pad: string): T {
  return JSON.parse(lees(pad)) as T;
}

function lijst(map: string, extensies: string[]): string[] {
  return readdirSync(`${VONK_MAP}/${map}`)
    .filter((f) => extensies.some((e) => f.endsWith(e)))
    .sort();
}

function alsDocument(bestand: string, tekst: string): VonkDocument {
  const kop = tekst.split('\n').find((r) => r.startsWith('# '));
  return { bestand, titel: kop ? kop.slice(2).trim() : bestand, tekst };
}

// ---------- Laadfuncties ----------

export function laadTeam(): VonkTeamlid[] {
  return leesJson<VonkTeamlid[]>('team.json');
}

export function laadPakketten(): VonkPakketten {
  return leesJson<VonkPakketten>('pakketten.json');
}

export function laadKlanten(): VonkKlant[] {
  return leesJson<VonkKlant[]>('klanten.json');
}

export function laadLeads(): VonkLead[] {
  return leesJson<VonkLead[]>('leads.json');
}

export function laadTaken(): VonkTaak[] {
  return leesJson<VonkTaak[]>('taken.json');
}

export function laadAgenda(): VonkAfspraak[] {
  return leesJson<VonkAfspraak[]>('agenda.json');
}

export function laadAppSettings(): VonkAppSetting[] {
  return leesJson<VonkAppSetting[]>('app_settings.json');
}

/** Alle inzendingen in formulieren/, op bestandsnaam gesorteerd (zonder verwacht.json). */
export function laadFormulieren(): VonkFormulier[] {
  return lijst('formulieren', ['.json', '.txt'])
    .filter((f) => f !== 'verwacht.json')
    .map((bestand): VonkFormulier => {
      const ruw = lees(`formulieren/${bestand}`);
      return bestand.endsWith('.json')
        ? { bestand, formaat: 'json', ruw, data: JSON.parse(ruw) as VonkFormulierJson }
        : { bestand, formaat: 'txt', ruw, data: null };
    });
}

/** De juiste uitkomst per formulierinzending (voor tests en evals). */
export function laadFormulierVerwachtingen(): VonkFormulierVerwachting[] {
  return leesJson<VonkFormulierVerwachting[]>('formulieren/verwacht.json');
}

export function leesMail(bestand: string): VonkMail {
  const ruw = lees(`mails/${bestand}`).replace(/\r\n/g, '\n');
  const scheiding = ruw.indexOf('\n\n');
  const kop = ruw.slice(0, scheiding);
  const tekst = ruw.slice(scheiding + 2).replace(/\n+$/, '');
  const velden: Record<string, string> = {};
  for (const regel of kop.split('\n')) {
    const i = regel.indexOf(':');
    if (i > 0) velden[regel.slice(0, i).trim().toLowerCase()] = regel.slice(i + 1).trim();
  }
  return {
    bestand,
    van: velden['van'] ?? '',
    aan: velden['aan'] ?? '',
    onderwerp: velden['onderwerp'] ?? '',
    datum: velden['datum'] ?? '',
    tekst,
  };
}

export function laadMails(): VonkMail[] {
  return lijst('mails', ['.txt']).map(leesMail);
}

export function laadMailLabels(): VonkMailLabel[] {
  return leesJson<VonkMailLabel[]>('mails/labels.json');
}

/** Alle mails met hun label. Gooit een fout als een mail geen label heeft. */
export function laadMailsMetLabels(): VonkMailMetLabel[] {
  const labels = new Map(laadMailLabels().map((l) => [l.bestand, l]));
  return laadMails().map((mail) => {
    const label = labels.get(mail.bestand);
    if (!label) throw new Error(`Geen label voor ${mail.bestand} in mails/labels.json`);
    return { ...mail, label };
  });
}

/** De weken waarvoor een export bestaat, gesorteerd: ["2026-W41", ..., "2026-W44"]. */
export function adsWeken(klant: AdsKlant): string[] {
  return lijst(`ads/${klant}`, ['.csv']).map((f) => f.replace(/\.csv$/, ''));
}

/** De ruwe CSV-tekst van één week, zoals een cursist hem zelf moet inlezen. */
export function laadAdsCsv(klant: AdsKlant, week: string): string {
  const pad = `ads/${klant}/${week}.csv`;
  if (!existsSync(`${VONK_MAP}/${pad}`)) {
    throw new Error(`Geen ads-export voor ${klant} in ${week}. Beschikbaar: ${adsWeken(klant).join(', ')}`);
  }
  return lees(pad);
}

const ADS_GETALLEN = ['vertoningen', 'bereik', 'klikken', 'uitgegeven_eur', 'aankopen', 'omzet_eur'] as const;
const ADS_TEKST = ['week', 'rapportage_start', 'rapportage_eind', 'campagne', 'advertentieset', 'advertentie'] as const;

function splitsCsvRegel(regel: string): string[] {
  const velden: string[] = [];
  let veld = '';
  let tussenAanhalingstekens = false;
  for (let i = 0; i < regel.length; i++) {
    const teken = regel[i];
    if (tussenAanhalingstekens) {
      if (teken === '"' && regel[i + 1] === '"') {
        veld += '"';
        i++;
      } else if (teken === '"') {
        tussenAanhalingstekens = false;
      } else {
        veld += teken;
      }
    } else if (teken === '"') {
      tussenAanhalingstekens = true;
    } else if (teken === ',') {
      velden.push(veld);
      veld = '';
    } else {
      veld += teken;
    }
  }
  velden.push(veld);
  return velden;
}

/** Referentie-parser voor de Vonk-exports (kolommen op naam, aanhalingstekens, BOM, CRLF, lege regels). */
export function leesAdsCsv(csv: string): VonkAdsRij[] {
  const regels = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((r) => r.trim() !== '');
  if (regels.length === 0) return [];
  const kop = splitsCsvRegel(regels[0]).map((k) => k.trim());
  const index = (naam: string): number => {
    const i = kop.indexOf(naam);
    if (i < 0) throw new Error(`Kolom ${naam} ontbreekt in de ads-export`);
    return i;
  };
  const kolommen = Object.fromEntries([...ADS_TEKST, ...ADS_GETALLEN].map((k) => [k, index(k)]));
  return regels.slice(1).map((regel) => {
    const v = splitsCsvRegel(regel);
    const rij: Record<string, string | number> = {};
    for (const k of ADS_TEKST) rij[k] = v[kolommen[k]];
    for (const k of ADS_GETALLEN) rij[k] = Number(v[kolommen[k]]);
    return rij as unknown as VonkAdsRij;
  });
}

/** Ingelezen exportrijen van één week, of van alle weken achter elkaar als je geen week opgeeft. */
export function laadAdsExport(klant: AdsKlant, week?: string): VonkAdsRij[] {
  const weken = week === undefined ? adsWeken(klant) : [week];
  return weken.flatMap((w) => leesAdsCsv(laadAdsCsv(klant, w)));
}

export function laadKlantdossier(slug: KlantSlug): VonkDocument {
  const bestand = `${slug}.md`;
  return alsDocument(bestand, lees(`klantdossiers/${bestand}`));
}

export function laadKlantdossiers(): VonkDocument[] {
  return lijst('klantdossiers', ['.md']).map((f) => alsDocument(f, lees(`klantdossiers/${f}`)));
}

/** De kennisdocumenten van het bureau (voor RAG in M04), op bestandsnaam gesorteerd. */
export function laadKennis(): VonkDocument[] {
  return lijst('kennis', ['.md']).map((f) => alsDocument(f, lees(`kennis/${f}`)));
}

/** Intake van de prospect Wasserette Bubbel (M11 en M12). */
export function laadIntake(): VonkIntake {
  return {
    aantekeningen: lees('intake/wasserette-bubbel-intake.md'),
    processen: leesJson<BubbelProcesoverzicht>('intake/wasserette-bubbel-processen.json'),
  };
}

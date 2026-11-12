/**
 * Zelftest van de Vonk-oefendata (voor beheerders). Draait mee met `npm test`, niet in het testbewijs.
 * Controleert of alle bestanden laden, aantallen kloppen, id's uniek zijn en verwijzingen bestaan.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADS_KLANTEN,
  KLANT_SLUGS,
  MAIL_CATEGORIEEN,
  REFERENTIEDATUM,
  URGENTIES,
  VONK_MAP,
  adsWeken,
  laadAdsCsv,
  laadAdsExport,
  laadAgenda,
  laadAppSettings,
  laadFormulieren,
  laadFormulierVerwachtingen,
  laadIntake,
  laadKennis,
  laadKlantdossier,
  laadKlantdossiers,
  laadKlanten,
  laadLeads,
  laadMailLabels,
  laadMails,
  laadMailsMetLabels,
  laadPakketten,
  laadTaken,
  laadTeam,
  leesAdsCsv,
  type ActieType,
} from './vonkData';

const uniek = (waarden: string[]) => new Set(waarden).size === waarden.length;
const isDatum = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const dagenVoorNu = (datum: string) => Math.round((Date.parse(REFERENTIEDATUM) - Date.parse(datum)) / 86_400_000);
/** Namen uit een eerdere casus die nooit in de oefendata mogen staan, als ROT13 zodat ze zelf niet in de repo staan. */
const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const OUDE_CASUS = new RegExp(['gnzre', 'xrerz', 'urxjrex', 'fpuhggvat'].map(rot13).join('|'), 'i');

const woorden = (tekst: string) => tekst.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const ONZICHTBAAR = /[\u200B-\u200F\u2060\uFEFF\u{E0000}-\u{E007F}]/u;

const ACTIES: ActieType[] = [
  'budget_wijzigen', 'campagne_starten', 'campagne_pauzeren', 'advertentie_publiceren', 'bericht_naar_klant',
  'voorstel_versturen', 'korting_geven', 'factuur_wijzigen', 'contract_wijzigen', 'data_exporteren', 'data_verwijderen',
];

function alleBestanden(): string[] {
  return (readdirSync(VONK_MAP, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.(json|md|txt|csv)$/.test(f))
    .sort();
}

describe('Vonk-data: algemeen', () => {
  it('alle JSON-bestanden zijn geldige JSON', () => {
    const json = alleBestanden().filter((f) => f.endsWith('.json'));
    expect(json.length).toBeGreaterThanOrEqual(17);
    for (const f of json) expect(() => JSON.parse(readFileSync(`${VONK_MAP}/${f}`, 'utf8')), f).not.toThrow();
  });

  it('noemt geen echte bedrijven of oude casus en gebruikt alleen .example-adressen en nepnummers', () => {
    for (const f of alleBestanden()) {
      const tekst = readFileSync(`${VONK_MAP}/${f}`, 'utf8');
      expect(tekst, f).not.toMatch(OUDE_CASUS);
      for (const adres of tekst.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
        expect(adres.toLowerCase(), `${f}: ${adres}`).toMatch(/\.example$/);
      }
      for (const nummer of tekst.match(/(?:\+31[\s-]?6|\b06)[\s-]?\d[\d\s]{6,9}\d/g) ?? []) {
        const cijfers = nummer.replace(/\D/g, '').replace(/^316/, '06');
        expect(cijfers, `${f}: ${nummer}`).toMatch(/^060000\d{4}$/);
      }
    }
  });

  it('de README zegt dat alles fictief is', () => {
    expect(readFileSync(`${VONK_MAP}/README.md`, 'utf8')).toMatch(/FICTIEF/);
  });
});

describe('Vonk-data: team, pakketten en klanten', () => {
  const team = laadTeam();
  const teamIds = new Set(team.map((t) => t.id));
  const klanten = laadKlanten();
  const { pakketten, losse_projecten, regels } = laadPakketten();

  it('team: 7 mensen met unieke id\'s en geldige velden', () => {
    expect(team.map((t) => t.naam)).toEqual(['Eva', 'Daan', 'Noor', 'Sem', 'Lotte', 'Milan', 'Fleur']);
    expect(uniek(team.map((t) => t.id))).toBe(true);
    for (const t of team) {
      expect(t.email).toMatch(/@bureauvonk\.example$/);
      expect(t.telefoon).toMatch(/^06-0000\d{4}$/);
      for (const a of t.mag_goedkeuren) expect(ACTIES).toContain(a);
    }
    expect(team.find((t) => t.rol === 'eigenaar')?.mag_goedkeuren).toHaveLength(ACTIES.length);
  });

  it('pakketten: Start, Groei, Schaal en 3 losse projecten met de afgesproken prijzen', () => {
    expect(pakketten.map((p) => [p.code, p.prijs_per_maand_eur, p.max_kanalen])).toEqual([
      ['start', 1250, 1],
      ['groei', 2450, 2],
      ['schaal', 4900, 3],
    ]);
    expect(Object.fromEntries(losse_projecten.map((p) => [p.code, p.prijs_eur]))).toEqual({
      landingspagina: 1800,
      creative_sprint: 950,
      advertentie_audit: 650,
    });
    expect(regels.minimale_looptijd_maanden).toBe(3);
  });

  it('klanten: 6 met unieke id\'s en slugs, geldige verwijzingen en kloppende budgetten', () => {
    expect(klanten).toHaveLength(6);
    expect(new Set(klanten.map((k) => k.slug))).toEqual(new Set(KLANT_SLUGS));
    expect(uniek(klanten.map((k) => k.id))).toBe(true);
    expect(uniek(klanten.map((k) => k.slug))).toBe(true);
    for (const k of klanten) {
      const pakket = pakketten.find((p) => p.code === k.pakket);
      expect(pakket, k.id).toBeDefined();
      expect(k.kanalen.length, k.id).toBeLessThanOrEqual(pakket!.max_kanalen);
      expect(Object.keys(k.maandbudget_ads_eur).sort(), k.id).toEqual([...k.kanalen].sort());
      const budgetten = Object.values(k.maandbudget_ads_eur) as number[];
      for (const b of budgetten) expect(b).toBeGreaterThanOrEqual(regels.min_advertentiebudget_per_kanaal_eur);
      expect(budgetten.reduce((s, b) => s + b, 0)).toBe(k.maandbudget_ads_totaal_eur);
      expect(teamIds.has(k.accountmanager), k.id).toBe(true);
      expect(team.find((t) => t.id === k.accountmanager)!.accounts).toContain(k.id);
      expect(k.contactpersoon.email).toMatch(/\.example$/);
      expect(isDatum(k.start_datum) && isDatum(k.minimale_einddatum)).toBe(true);
      expect(k.kpis.length).toBeGreaterThan(0);
      expect(k.mag_niet.length).toBeGreaterThan(0);
    }
    expect(klanten.find((k) => k.slug === 'korrel')!.status).toBe('opzegrisico');
    expect(klanten.find((k) => k.slug === 'fysiopunt')!.gevoelige_gegevens).toBe(true);
    const fees = klanten.reduce((s, k) => s + pakketten.find((p) => p.code === k.pakket)!.prijs_per_maand_eur, 0);
    expect(fees).toBe(14_750);
  });

  it('klantdossiers: één per klant, 300 tot 500 woorden', () => {
    expect(laadKlantdossiers()).toHaveLength(6);
    for (const slug of KLANT_SLUGS) {
      const dossier = laadKlantdossier(slug);
      expect(dossier.titel).toMatch(/brand guidelines/);
      expect(dossier.tekst).toMatch(/Fictief/);
      expect(woorden(dossier.tekst), slug).toBeGreaterThanOrEqual(300);
      expect(woorden(dossier.tekst), slug).toBeLessThanOrEqual(500);
    }
  });

  it('kennis: 5 tot 8 documenten met een titel, waaronder twee cases', () => {
    const kennis = laadKennis();
    expect(kennis.length).toBeGreaterThanOrEqual(5);
    expect(kennis.length).toBeLessThanOrEqual(8);
    for (const d of kennis) expect(d.titel).not.toBe(d.bestand);
    expect(kennis.filter((d) => d.bestand.includes('case'))).toHaveLength(2);
  });
});

describe('Vonk-data: leads, taken, agenda en instellingen', () => {
  const team = new Set(laadTeam().map((t) => t.id));
  const klanten = new Set(laadKlanten().map((k) => k.id));
  const leads = laadLeads();
  const leadIds = new Set(leads.map((l) => l.id));

  it('leads: 24 met unieke id\'s, geldige statussen, bronnen en datums', () => {
    expect(leads).toHaveLength(24);
    expect(uniek(leads.map((l) => l.id))).toBe(true);
    expect(uniek(leads.map((l) => l.email.toLowerCase()))).toBe(true);
    const telling: Record<string, number> = {};
    for (const l of leads) {
      telling[l.status] = (telling[l.status] ?? 0) + 1;
      expect(['formulier', 'mail', 'linkedin', 'doorverwijzing']).toContain(l.bron);
      expect(isDatum(l.aangemaakt_op), l.id).toBe(true);
      expect(team.has(l.eigenaar), l.id).toBe(true);
      expect(l.email).toMatch(/\.example$/);
      expect(l.budget_indicatie_eur === null || typeof l.budget_indicatie_eur === 'number').toBe(true);
      if (l.klant_id) expect(klanten.has(l.klant_id), l.id).toBe(true);
      if (['voorstel_verstuurd', 'gewonnen'].includes(l.status)) {
        expect(isDatum(l.voorstel_datum ?? ''), l.id).toBe(true);
        expect(typeof l.voorstel_bedrag_eur, l.id).toBe('number');
      }
      if (l.status === 'verloren') expect(l.verloren_reden, l.id).toBeTruthy();
    }
    expect(telling).toEqual({ nieuw: 4, gekwalificeerd: 5, voorstel_verstuurd: 9, gewonnen: 3, verloren: 3 });
  });

  it('voorstellen liggen zowel meer als minder dan 7 dagen terug, en een paar hebben al een concept', () => {
    const verstuurd = leads.filter((l) => l.status === 'voorstel_verstuurd');
    expect(verstuurd.length).toBeGreaterThanOrEqual(6);
    const dagen = verstuurd.map((l) => dagenVoorNu(l.voorstel_datum!));
    expect(dagen.filter((d) => d > 7).length).toBeGreaterThanOrEqual(3);
    expect(dagen.filter((d) => d < 7).length).toBeGreaterThanOrEqual(2);
    expect(dagen).toContain(7);
    const metConcept = verstuurd.filter((l) => l.opvolgconcept !== null);
    expect(metConcept.length).toBeGreaterThanOrEqual(2);
    for (const l of metConcept) expect(isDatum(l.opvolgconcept!.aangemaakt_op) && l.opvolgconcept!.tekst.length > 50).toBe(true);
    const teDoen = verstuurd.filter((l) => dagenVoorNu(l.voorstel_datum!) >= 7 && l.opvolgconcept === null).map((l) => l.id);
    expect(teDoen).toEqual(['L010', 'L011', 'L013', 'L015']);
  });

  it('taken, agenda en app_settings verwijzen naar bestaande id\'s', () => {
    const taken = laadTaken();
    expect(taken.length).toBeGreaterThanOrEqual(10);
    expect(uniek(taken.map((t) => t.id))).toBe(true);
    for (const t of taken) {
      expect(team.has(t.toegewezen_aan), t.id).toBe(true);
      if (t.klant_id) expect(klanten.has(t.klant_id), t.id).toBe(true);
      if (t.lead_id) expect(leadIds.has(t.lead_id), t.id).toBe(true);
      expect(isDatum(t.deadline)).toBe(true);
    }
    expect(taken.some((t) => t.status !== 'klaar' && t.deadline < REFERENTIEDATUM)).toBe(true);

    const agenda = laadAgenda();
    expect(uniek(agenda.map((a) => a.id))).toBe(true);
    for (const a of agenda) {
      for (const d of a.deelnemers) expect(team.has(d), a.id).toBe(true);
      if (a.klant_id) expect(klanten.has(a.klant_id), a.id).toBe(true);
      if (a.lead_id) expect(leadIds.has(a.lead_id), a.id).toBe(true);
    }
    expect(agenda.filter((a) => a.datum === REFERENTIEDATUM).length).toBeGreaterThanOrEqual(3);

    const instellingen = laadAppSettings();
    expect(uniek(instellingen.map((s) => s.sleutel))).toBe(true);
    for (const s of instellingen) expect(Object.keys(s).sort()).toEqual(['sleutel', 'waarde']);
    for (const s of instellingen) expect(typeof s.waarde).toBe('string');
    const waarde = (k: string) => instellingen.find((s) => s.sleutel === k)?.waarde;
    expect(waarde('agents_actief')).toBe('true');
    expect(waarde('opvolg_na_dagen')).toBe('7');
    // Eén wisselkoers voor de hele cursus (aanname, maandelijks bijwerken).
    expect(waarde('usd_eur_koers')).toBe('0.86');
  });
});

describe('Vonk-data: formulieren en mails', () => {
  it('formulieren: 10 inzendingen, elk met een verwachting', () => {
    const formulieren = laadFormulieren();
    expect(formulieren).toHaveLength(10);
    expect(formulieren.filter((f) => f.formaat === 'txt')).toHaveLength(2);
    for (const f of formulieren) {
      if (f.formaat === 'json') expect(Object.keys(f.data.velden).sort(), f.bestand).toEqual(
        ['bedrijf', 'bericht', 'email', 'interesse', 'maandbudget', 'naam', 'telefoon', 'website']);
      else expect(f.ruw).toContain('\r\n');
    }
    const verwacht = laadFormulierVerwachtingen();
    expect(verwacht.map((v) => v.bestand)).toEqual(formulieren.map((f) => f.bestand));
    const leads = laadLeads();
    for (const v of verwacht.filter((v) => v.dubbel_van)) {
      const f = formulieren.find((x) => x.bestand === v.bestand)!;
      const lead = leads.find((l) => l.id === v.dubbel_van)!;
      expect(f.formaat === 'json' && f.data.velden.email.toLowerCase()).toBe(lead.email.toLowerCase());
    }
    expect(new Set(verwacht.map((v) => v.soort))).toEqual(
      new Set(['lead', 'dubbele_lead', 'bestaande_klant', 'sollicitatie', 'spam']));
    expect(verwacht.filter((v) => v.gevoelige_gegevens)).toHaveLength(1);
  });

  it('mails: 14 met kopregels, en labels.json past er precies bij', () => {
    const mails = laadMails();
    const labels = laadMailLabels();
    expect(mails).toHaveLength(14);
    expect(labels.map((l) => l.bestand)).toEqual(mails.map((m) => m.bestand));
    for (const m of mails) {
      expect(m.van, m.bestand).toMatch(/<[^>]+\.example>$/);
      expect(m.aan).toBe('info@bureauvonk.example');
      expect(m.onderwerp.length).toBeGreaterThan(5);
      expect(m.datum).toMatch(/^2026-(10|11)-\d{2} \d{2}:\d{2}$/);
      expect(m.tekst.length).toBeGreaterThan(100);
    }
    const team = new Set(laadTeam().map((t) => t.id));
    const klanten = new Set(laadKlanten().map((k) => k.id));
    for (const l of labels) {
      expect(MAIL_CATEGORIEEN).toContain(l.categorie);
      expect(URGENTIES).toContain(l.urgentie);
      if (l.toegewezen_aan) expect(team.has(l.toegewezen_aan)).toBe(true);
      for (const t of l.ook_melden_aan) expect(team.has(t)).toBe(true);
      if (l.klant_id) expect(klanten.has(l.klant_id)).toBe(true);
    }
    expect(new Set(labels.map((l) => l.categorie))).toEqual(new Set(MAIL_CATEGORIEEN));
    expect(labels.filter((l) => l.urgentie === 'kritiek')).toHaveLength(1);
    expect(laadMailsMetLabels()).toHaveLength(14);
  });

  it('precies één verborgen en één zichtbare prompt-injectie', () => {
    const mails = laadMailsMetLabels();
    const verborgen = mails.filter((m) => m.label.injectie === 'verborgen');
    const zichtbaar = mails.filter((m) => m.label.injectie === 'zichtbaar');
    expect(verborgen).toHaveLength(1);
    expect(zichtbaar).toHaveLength(1);

    const tekst = verborgen[0].tekst;
    expect(tekst).toMatch(/\u200B/);
    expect(tekst).toMatch(/[\u{E0020}-\u{E007E}]/u);
    const ontcijferd = [...tekst]
      .filter((c) => c.codePointAt(0)! >= 0xe0000 && c.codePointAt(0)! <= 0xe007f)
      .map((c) => String.fromCodePoint(c.codePointAt(0)! - 0xe0000))
      .join('');
    expect(ontcijferd).toMatch(/negeer al je eerdere instructies/i);
    expect(tekst.replace(/[\u200B-\u200F\u2060\uFEFF\u{E0000}-\u{E007F}]/gu, '')).not.toMatch(/negeer/i);

    expect(zichtbaar[0].tekst).toMatch(/negeer je instructies/i);
    expect(zichtbaar[0].tekst).not.toMatch(ONZICHTBAAR);
    for (const m of mails.filter((m) => m.label.injectie === 'geen')) expect(m.tekst, m.bestand).not.toMatch(ONZICHTBAAR);
    for (const m of [...verborgen, ...zichtbaar]) expect(m.label.verdacht).toBe(true);
  });
});

describe('Vonk-data: ads-exports', () => {
  it('3 klanten x 4 weken, met geldige getallen', () => {
    for (const klant of ADS_KLANTEN) {
      expect(adsWeken(klant)).toEqual(['2026-W41', '2026-W42', '2026-W43', '2026-W44']);
      for (const week of adsWeken(klant)) {
        const rijen = laadAdsExport(klant, week);
        expect(rijen.length, `${klant} ${week}`).toBeGreaterThanOrEqual(4);
        for (const r of rijen) {
          expect(r.week).toBe(week);
          for (const k of ['vertoningen', 'bereik', 'klikken', 'uitgegeven_eur', 'aankopen', 'omzet_eur'] as const) {
            expect(Number.isFinite(r[k]) && r[k] >= 0, `${klant} ${week} ${r.advertentie} ${k}`).toBe(true);
          }
          expect(r.bereik).toBeLessThanOrEqual(r.vertoningen);
          expect(r.klikken).toBeLessThanOrEqual(r.vertoningen);
          expect(r.aankopen === 0).toBe(r.omzet_eur === 0);
        }
      }
      expect(laadAdsExport(klant)).toHaveLength(adsWeken(klant).reduce((s, w) => s + laadAdsExport(klant, w).length, 0));
    }
    expect(() => laadAdsCsv('groenwerk', '2026-W40')).toThrow(/Beschikbaar/);
  });

  it('leest velden met aanhalingstekens en de en-dash goed', () => {
    const rijen = laadAdsExport('groenwerk', '2026-W41');
    expect(rijen.map((r) => r.campagne)).toContain('Retargeting, 30 dagen');
    expect(rijen[0]).toMatchObject({ advertentie: 'Loungeset Duin – video 15s', uitgegeven_eur: 380, aankopen: 4, omzet_eur: 2340 });
    expect(leesAdsCsv('\uFEFF' + laadAdsCsv('mout', '2026-W44').replace(/\n/g, '\r\n') + '\r\n\r\n')).toEqual(
      laadAdsExport('mout', '2026-W44'));
  });

  it('bevat de patronen uit de README', () => {
    const som = (klant: 'groenwerk' | 'mout' | 'lune', ad: string) =>
      laadAdsExport(klant).filter((r) => r.advertentie === ad).reduce(
        (s, r) => ({ uitgaven: s.uitgaven + r.uitgegeven_eur, aankopen: s.aankopen + r.aankopen }), { uitgaven: 0, aankopen: 0 });
    expect(som('groenwerk', 'Winterhoes – UGC review')).toEqual({ uitgaven: 64.3, aankopen: 0 });
    expect(som('mout', 'Gebrand binnen 7 dagen – statisch').uitgaven).toBeCloseTo(67.2, 10);
    expect(som('lune', 'Gravering – story').uitgaven).toBeCloseTo(101.8, 10);

    const teak = laadAdsExport('groenwerk').filter((r) => r.advertentie === 'Teak eettafel Kaap – carrousel');
    const ctr = teak.map((r) => r.klikken / r.vertoningen);
    expect(teak.at(-1)!.vertoningen / teak.at(-1)!.bereik).toBeGreaterThan(3);
    expect(ctr.at(-1)!).toBeLessThan(Math.max(...ctr) * 0.7);

    const reels = adsWeken('lune').map((w) =>
      laadAdsExport('lune', w).filter((r) => r.advertentieset.startsWith('Instagram Reels')).reduce((s, r) => s + r.uitgegeven_eur, 0));
    for (let i = 1; i < reels.length; i++) expect(reels[i]).toBeGreaterThan(reels[i - 1]);
  });
});

describe('Vonk-data: intake Wasserette Bubbel', () => {
  it('aantekeningen van 800 tot 1.200 woorden en 10 processen met volumes en tijden', () => {
    const { aantekeningen, processen } = laadIntake();
    expect(woorden(aantekeningen)).toBeGreaterThanOrEqual(800);
    expect(woorden(aantekeningen)).toBeLessThanOrEqual(1200);
    expect(aantekeningen).toMatch(/[Ff]ictie/);
    expect(processen.fictief).toBe(true);
    expect(processen.vestigingen).toHaveLength(4);
    expect(processen.processen).toHaveLength(10);
    expect(uniek(processen.processen.map((p) => p.id))).toBe(true);
    for (const p of processen.processen) {
      expect(['week', 'maand']).toContain(p.frequentie);
      expect(typeof p.volume === 'number' && typeof p.minuten_per_keer === 'number').toBe(true);
    }
    expect(processen.processen.filter((p) => p.nooit_automatiseren)).toHaveLength(1);
  });
});

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  berekenPrijsvoorstel,
  controleerBeheer,
  controleerDocumentatie,
  controleerEnvVoorbeeld,
  controleerEvals,
  controleerOmgeving,
  controleerOplevering,
  controleerRunbook,
  formatRapport,
  isGeldigeCron,
  type Bevinding,
  type PrijsInvoer,
} from '@opdracht/m12-oplevercheck';

/** De twee fictieve voorbeeldpakketten: een goed pakket en een pakket vol fouten. */
const PAKKETTEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pakketten');
const GOED = path.join(PAKKETTEN, 'goed');
const FOUT = path.join(PAKKETTEN, 'fout');

const codes = (bevindingen: Bevinding[]) => bevindingen.map((b) => b.code).sort();

// Kopieën in een tijdelijke map, zodat een test een pakket kan aanpassen zonder de voorbeelden te raken.
const tijdelijk: string[] = [];
function kopie(bron: string): string {
  const doel = path.join(mkdtempSync(path.join(tmpdir(), 'oplevercheck-')), 'pakket');
  cpSync(bron, doel, { recursive: true });
  tijdelijk.push(path.dirname(doel));
  return doel;
}
function pas(map: string, bestand: string, aanpassing: (tekst: string) => string): void {
  const pad = path.join(map, bestand);
  writeFileSync(pad, aanpassing(readFileSync(pad, 'utf8')));
}
afterEach(() => {
  for (const map of tijdelijk.splice(0)) rmSync(map, { recursive: true, force: true });
});

/** Rekenvoorbeeld uit les 12.1 (fictief): fase 1 van Wasserette Bubbel. */
const BUBBEL: PrijsInvoer = {
  bouwuren: 72,
  uurtarief_eur: 95,
  risicomarge: 0.15,
  beheer_uren_per_maand: 2,
  hosting_eur_per_maand: 25,
  modelbudget_eur_per_maand: 25,
  verwacht_modelgebruik_eur_per_maand: 1.31,
  accounts_op_naam_klant: true,
  niet_inbegrepen: [
    'nieuwe processen buiten fase 1',
    'aanpassingen door een nieuwe berichtenapp of een gewijzigde koppeling',
    'kosten van Supabase en Anthropic (rechtstreeks aan de leverancier)',
    'data opschonen of overzetten',
    'training van meer dan twee medewerkers',
    'support buiten werkdagen 09.00-17.00',
  ],
  budget: { eenmalig_eur: 9000, per_maand_eur: 350 },
};

describe('prijsvoorstel', () => {
  it('Bubbel: setup, maandbedrag en wat de klant rechtstreeks betaalt', () => {
    const v = berekenPrijsvoorstel(BUBBEL);
    expect(v.setup_eur).toBe(7870);
    expect(v.maandbedrag_eur).toBe(190);
    expect(v.totaal_klant_per_maand_eur).toBe(240);
    expect(v.binnen_budget).toBe(true);
    expect(v.waarschuwingen).toEqual([]);
    expect(v.regels.map((r) => [r.soort, r.bedrag_eur])).toEqual([
      ['eenmalig', 6840],
      ['eenmalig', 1026],
      ['maand', 190],
      ['rechtstreeks', 25],
      ['rechtstreeks', 25],
    ]);
  });

  it('via jouw accounts: hosting en modelbudget zitten in het maandbedrag', () => {
    const v = berekenPrijsvoorstel({ ...BUBBEL, accounts_op_naam_klant: false });
    expect(v.maandbedrag_eur).toBe(240);
    expect(v.totaal_klant_per_maand_eur).toBe(240);
    expect(v.regels.slice(2).every((r) => r.soort === 'maand')).toBe(true);
  });

  it('rondt de setup af op tientallen en het maandbedrag op vijftallen, altijd naar boven', () => {
    const v = berekenPrijsvoorstel({
      ...BUBBEL,
      bouwuren: 10,
      risicomarge: 0.1,
      beheer_uren_per_maand: 1,
      modelbudget_eur_per_maand: 3,
      verwacht_modelgebruik_eur_per_maand: 1,
      accounts_op_naam_klant: false,
    });
    expect(v.setup_eur).toBe(1050); // 1.045 -> 1.050
    expect(v.maandbedrag_eur).toBe(125); // 95 + 25 + 3 = 123 -> 125
    expect(berekenPrijsvoorstel({ ...BUBBEL, bouwuren: 20, risicomarge: 0 }).setup_eur).toBe(1900); // al rond: blijft gelijk
  });

  it('waarschuwt bij een krap modelbudget, een korte lijst "Niet inbegrepen" en geen beheeruren', () => {
    expect(berekenPrijsvoorstel({ ...BUBBEL, modelbudget_eur_per_maand: 2 }).waarschuwingen.join(' ')).toMatch(/modelbudget/);
    expect(berekenPrijsvoorstel({ ...BUBBEL, niet_inbegrepen: ['meerwerk', 'data', ' '] }).waarschuwingen.join(' ')).toMatch(/Niet inbegrepen/);
    expect(berekenPrijsvoorstel({ ...BUBBEL, beheer_uren_per_maand: 0 }).waarschuwingen.join(' ')).toMatch(/beheer/i);
  });

  it('buiten budget geeft false en een waarschuwing; zonder budget is het null', () => {
    const duur = berekenPrijsvoorstel({ ...BUBBEL, bouwuren: 90 });
    expect(duur.setup_eur).toBe(9840);
    expect(duur.binnen_budget).toBe(false);
    expect(berekenPrijsvoorstel({ ...BUBBEL, beheer_uren_per_maand: 4 }).binnen_budget).toBe(false); // 380 + 50 = 430 per maand
    expect(duur.waarschuwingen.join(' ')).toMatch(/budget/);
    expect(berekenPrijsvoorstel({ ...BUBBEL, budget: undefined }).binnen_budget).toBeNull();
  });

  it('weigert een risicomarge boven 50% en negatieve getallen', () => {
    expect(() => berekenPrijsvoorstel({ ...BUBBEL, risicomarge: 0.6 })).toThrow(RangeError);
    expect(() => berekenPrijsvoorstel({ ...BUBBEL, bouwuren: -5 })).toThrow(RangeError);
  });
});

describe('omgeving', () => {
  it('het goede pakket heeft geen bevindingen', () => {
    expect(controleerOmgeving(GOED)).toEqual([]);
  });

  it('vindt de fouten in het foute pakket', () => {
    const bevindingen = controleerOmgeving(FOUT);
    expect(codes(bevindingen)).toEqual([
      'ENV_GEHEIM_MET_WAARDE',
      'ENV_GERESERVEERDE_NAAM',
      'ENV_VARIABELE_ONTBREEKT',
      'ENV_VARIABELE_ONTBREEKT',
      'ENV_ZONDER_UITLEG',
      'GITIGNORE_ZONDER_ENV',
      'REGIO_NIET_EU',
      'WORKSPACE_STANDAARD',
    ]);
    const meldingen = bevindingen.map((b) => b.melding).join('\n');
    expect(meldingen).toContain('API_DAGBUDGET_EUR');
    expect(meldingen).toContain('BALIE_WEBHOOK_TOKEN');
    expect(meldingen).toContain('SUPABASE_SECRET_KEY');
    expect(meldingen).toContain('RESEND_API_KEY');
  });

  it('controleerEnvVoorbeeld: een ontbrekend bestand, en per regel elke soort fout', () => {
    expect(codes(controleerEnvVoorbeeld(null))).toEqual(['ENV_VOORBEELD_ONTBREEKT']);
    const tekst = readFileSync(path.join(GOED, '.env.example'), 'utf8');
    expect(controleerEnvVoorbeeld(tekst)).toEqual([]);
    const fout = `${tekst}SUPABASE_URL=\n# Testtoken\nEXTRA_TOKEN=abc123\n`;
    const b = controleerEnvVoorbeeld(fout);
    expect(codes(b)).toEqual(['ENV_GEHEIM_MET_WAARDE', 'ENV_GERESERVEERDE_NAAM', 'ENV_ZONDER_UITLEG']);
    expect(b.every((x) => x.bestand === '.env.example')).toBe(true);
    expect(b.map((x) => x.melding).join(' ')).not.toContain('abc123');
  });

  it('ENV_ZONDER_UITLEG is een waarschuwing, de rest zijn fouten', () => {
    for (const b of controleerOmgeving(FOUT)) {
      expect(b.ernst, b.code).toBe(b.code === 'ENV_ZONDER_UITLEG' ? 'waarschuwing' : 'fout');
    }
  });

  it('Londen en Zürich tellen niet als EU; Frankfurt, Ierland, Parijs en Stockholm wel', () => {
    const map = kopie(GOED);
    const zetRegio = (regio: string) =>
      pas(map, 'oplevering.json', (t) => JSON.stringify({ ...JSON.parse(t), omgeving: { ...JSON.parse(t).omgeving, regio } }));
    for (const regio of ['eu-west-2', 'eu-central-2', 'us-east-1']) {
      zetRegio(regio);
      expect(codes(controleerOmgeving(map)), regio).toEqual(['REGIO_NIET_EU']);
    }
    for (const regio of ['eu-central-1', 'eu-west-1', 'eu-west-3', 'eu-north-1']) {
      zetRegio(regio);
      expect(controleerOmgeving(map), regio).toEqual([]);
    }
  });

  it('vindt een echte sleutel in elk bestand, en toont de sleutel nooit', () => {
    const map = kopie(GOED);
    const anthropic = 'sk-ant-' + 'api03-' + 'Q7w2'.repeat(10);
    const supabase = 'sb_secret_' + 'Zx81'.repeat(8);
    pas(map, 'RUNBOOK.md', (t) => `${t}\nSleutel voor noodgevallen: ${anthropic}\n`);
    pas(map, 'supabase/functions/bubbel-balie/index.ts', (t) => t.replace("Deno.env.get('BALIE_WEBHOOK_TOKEN')", `'${supabase}'`));
    const geheimen = controleerOmgeving(map).filter((b) => b.code === 'GEHEIM_IN_BESTAND');
    expect(geheimen.map((b) => b.bestand).sort()).toEqual(['RUNBOOK.md', 'supabase/functions/bubbel-balie/index.ts']);
    for (const b of geheimen) {
      expect(b.melding).toMatch(/Regel \d+/);
      expect(b.melding).not.toContain(anthropic);
      expect(b.melding).not.toContain(supabase);
      expect(b.melding).not.toContain('Q7w2');
    }
  });

  it('een .env-bestand in het pakket is altijd fout, ook als het leeg is', () => {
    const map = kopie(GOED);
    writeFileSync(path.join(map, 'supabase/functions/.env'), 'ANTHROPIC_API_KEY=\n');
    const b = controleerOmgeving(map).filter((x) => x.code === 'ENV_BESTAND_IN_PAKKET');
    expect(b.map((x) => x.bestand)).toEqual(['supabase/functions/.env']);
  });

  it('zonder of met kapot oplevering.json: MANIFEST_ONTBREEKT of MANIFEST_ONGELDIG', () => {
    const map = kopie(GOED);
    rmSync(path.join(map, 'oplevering.json'));
    expect(codes(controleerOmgeving(map))).toEqual(['MANIFEST_ONTBREEKT']);
    writeFileSync(path.join(map, 'oplevering.json'), '{ "klant": ');
    expect(codes(controleerOmgeving(map))).toEqual(['MANIFEST_ONGELDIG']);
  });

  it('gooit bij een map die niet bestaat', () => {
    expect(() => controleerOmgeving(path.join(PAKKETTEN, 'bestaat-niet'))).toThrow(/bestaat niet/);
  });
});

describe('documentatie', () => {
  it('het goede pakket heeft geen bevindingen', () => {
    expect(controleerDocumentatie(GOED)).toEqual([]);
  });

  it('vindt de fouten in het foute pakket', () => {
    expect(codes(controleerDocumentatie(FOUT))).toEqual([
      'OVERDRACHT_ONTBREEKT',
      'README_SECTIE_ONTBREEKT',
      'README_SECTIE_ONTBREEKT',
      'RUNBOOK_BEGINT_NIET_MET_STOPPEN',
      'RUNBOOK_STORING_ONVOLLEDIG',
      'RUNBOOK_TE_WEINIG_STORINGEN',
      'RUNBOOK_ZONDER_HERSTEL',
      'RUNBOOK_ZONDER_KILLSWITCH',
    ]);
  });

  it('noemt de ontbrekende secties en velden', () => {
    const meldingen = controleerDocumentatie(FOUT).map((b) => b.melding).join('\n');
    expect(meldingen).toContain('Wat de agent niet doet');
    expect(meldingen).toContain('Kosten');
    expect(meldingen).toMatch(/Alles gaat naar de balie.*Oorzaak/);
    expect(meldingen).toContain('agents_actief');
  });

  it('koppen tellen ongeacht hoofdletters, en mogen langer zijn', () => {
    const map = kopie(GOED);
    pas(map, 'README.md', (t) => t.replace('## Wat de agent doet', '## wat de agent doet').replace('## Installeren', '## Installeren en uitrollen'));
    expect(controleerDocumentatie(map)).toEqual([]);
  });

  it('een runbook zonder storingen-sectie telt 0 storingen', () => {
    const map = kopie(GOED);
    writeFileSync(path.join(map, 'RUNBOOK.md'), '# Runbook\n\n## Noodstop\n\nZet agents_actief op false.\n\n## Herstellen\n\nZie backups.\n');
    const b = controleerDocumentatie(map);
    expect(codes(b)).toEqual(['RUNBOOK_TE_WEINIG_STORINGEN']);
    expect(b[0].melding).toContain('0 storingen');
  });

  it('controleerRunbook: geen runbook, en een runbook zonder kill-switch', () => {
    expect(codes(controleerRunbook(null, 'agents_actief'))).toEqual(['RUNBOOK_ONTBREEKT']);
    const tekst = readFileSync(path.join(GOED, 'RUNBOOK.md'), 'utf8');
    expect(controleerRunbook(tekst, 'agents_actief')).toEqual([]);
    expect(codes(controleerRunbook(tekst, 'agent_aan'))).toEqual(['RUNBOOK_ZONDER_KILLSWITCH']);
    expect(controleerRunbook(tekst)).toEqual([]);
  });

  it('meldt elke ontbrekende sectie van het overdrachtsdocument', () => {
    const map = kopie(GOED);
    pas(map, 'OVERDRACHT.md', (t) => t.replace('## Akkoord', '## Handtekeningen').replace('## Acceptatietest', '## Test'));
    const b = controleerDocumentatie(map);
    expect(codes(b)).toEqual(['OVERDRACHT_SECTIE_ONTBREEKT', 'OVERDRACHT_SECTIE_ONTBREEKT']);
    expect(b.map((x) => x.melding).join(' ')).toMatch(/Akkoord/);
  });
});

describe('beheer', () => {
  it('het goede pakket heeft geen bevindingen', () => {
    expect(controleerBeheer(GOED)).toEqual([]);
  });

  it('vindt de fouten in het foute pakket', () => {
    expect(codes(controleerBeheer(FOUT))).toEqual([
      'ALERT_ONTBREEKT',
      'DAGBUDGET_NIET_IN_CODE',
      'EVALS_DUBBEL_ID',
      'EVALS_GEEN_ESCALATIE',
      'EVALS_SCHEMA_ONGELDIG',
      'EVALS_TE_WEINIG',
      'KILLSWITCH_NIET_IN_CODE',
      'KOSTENLIMIET_BOVEN_BUDGET',
      'LOGGING_KOLOM_ONTBREEKT',
      'SLA_OPLOSTIJD',
    ]);
    const meldingen = controleerBeheer(FOUT).map((b) => b.melding).join('\n');
    expect(meldingen).toContain('geen_run');
    expect(meldingen).toContain('kosten_eur');
    expect(meldingen).toContain('E03');
  });

  it('isGeldigeCron kent vijf velden met *, getallen, bereiken, lijsten en stappen', () => {
    for (const goed of ['17 6 * * 1', '*/15 * * * *', '0 9-17 * * 1-5', '0,30 * * * *', '0 0 1 1 0', '59 23 31 12 7']) {
      expect(isGeldigeCron(goed), goed).toBe(true);
    }
    for (const fout of ['elke maandag 06.00', '* * * *', '60 * * * *', '0 24 * * *', '@daily', '*/0 * * * *', '0 0 32 * *', '0 0 * 13 *', '5-1 * * * *']) {
      expect(isGeldigeCron(fout), fout).toBe(false);
    }
  });

  it('controleerEvals: zonder evalbestand, en met te weinig gevallen zonder escalatie', () => {
    const evals = { bestand: 'evals/gevallen.jsonl', min_gevallen: 10, schema: '17 6 * * 1', drempel_pct: 90 };
    expect(codes(controleerEvals(evals, null))).toEqual(['EVALS_ONTBREEKT']);
    expect(codes(controleerEvals(undefined, '{}'))).toEqual(['EVALS_ONTBREEKT']);
    const twee = '{"id":"E01","invoer":"Hoe laat open?","verwacht":{"actie":"beantwoorden"}}\n\n{"id":"E01","invoer":"Prijs?","verwacht":{"actie":"beantwoorden"}}\n';
    const b = controleerEvals({ ...evals, schema: '@weekly', drempel_pct: 0 }, twee);
    expect(codes(b)).toEqual(['EVALS_DREMPEL_ONGELDIG', 'EVALS_DUBBEL_ID', 'EVALS_GEEN_ESCALATIE', 'EVALS_SCHEMA_ONGELDIG', 'EVALS_TE_WEINIG']);
    expect(b.find((x) => x.code === 'EVALS_TE_WEINIG')?.melding).toBe('2 geldige gevallen; minimaal 10.');
  });

  it('een kapotte evalregel noemt het regelnummer', () => {
    const map = kopie(GOED);
    pas(map, 'evals/gevallen.jsonl', (t) => `${t}dit is geen json\n{"id":"E14","invoer":"","verwacht":{"actie":"beantwoorden"}}\n`);
    const b = controleerBeheer(map).filter((x) => x.code === 'EVALS_ONGELDIG');
    expect(b.map((x) => x.melding)).toEqual([expect.stringContaining('Regel 13'), expect.stringContaining('Regel 14')]);
  });

  it('een manifest met min_gevallen onder 10 verlaagt de ondergrens niet', () => {
    const map = kopie(GOED);
    pas(map, 'oplevering.json', (t) => JSON.stringify({ ...JSON.parse(t), evals: { ...JSON.parse(t).evals, min_gevallen: 5 } }));
    expect(controleerBeheer(map)).toEqual([]);
    pas(map, 'evals/gevallen.jsonl', (t) => t.split('\n').slice(3).join('\n')); // 9 gevallen, met escalatie
    const b = controleerBeheer(map);
    expect(codes(b)).toEqual(['EVALS_TE_WEINIG']);
    expect(b[0].melding).toContain('minimaal 10');
  });

  it('de kill-switch moet in de database staan, niet alleen in de code', () => {
    const map = kopie(GOED);
    pas(map, 'supabase/migrations/20261201090000_basis.sql', (t) => t.replace("('agents_actief', 'true'),", "('agent_aan', 'true'),"));
    expect(codes(controleerBeheer(map))).toEqual(['KILLSWITCH_NIET_IN_DATABASE']);
  });

  it('kostenlimieten: ontbrekend, of een dagbudget boven de maandlimiet', () => {
    const map = kopie(GOED);
    const zetKosten = (kosten: object) => pas(map, 'oplevering.json', (t) => JSON.stringify({ ...JSON.parse(t), kosten }));
    zetKosten({ maandlimiet_eur: 25, dagbudget_eur: 30, budget_klant_per_maand_eur: 350 });
    expect(codes(controleerBeheer(map))).toEqual(['DAGBUDGET_BOVEN_MAANDLIMIET']);
    zetKosten({ budget_klant_per_maand_eur: 350 });
    expect(codes(controleerBeheer(map))).toEqual(['KOSTENLIMIET_ONTBREEKT']);
  });

  it('zonder logtabel: LOGGING_ONTBREEKT', () => {
    const map = kopie(GOED);
    pas(map, 'supabase/migrations/20261201090000_basis.sql', (t) => t.replace('create table if not exists public.agent_runs', 'create table if not exists public.logboek'));
    expect(codes(controleerBeheer(map))).toEqual(['LOGGING_ONTBREEKT']);
  });
});

describe('controleerOplevering', () => {
  it('goed pakket: ok, 0 fouten en 0 waarschuwingen', () => {
    const rapport = controleerOplevering(GOED);
    expect(rapport).toMatchObject({ map: GOED, ok: true, fouten: 0, waarschuwingen: 0, bevindingen: [] });
  });

  it('fout pakket: niet ok, 25 fouten en 1 waarschuwing, fouten eerst', () => {
    const rapport = controleerOplevering(FOUT);
    expect(rapport.ok).toBe(false);
    expect(rapport.fouten).toBe(25);
    expect(rapport.waarschuwingen).toBe(1);
    expect(rapport.bevindingen).toHaveLength(26);
    expect(rapport.bevindingen.at(-1)?.code).toBe('ENV_ZONDER_UITLEG');
    const fouten = rapport.bevindingen.filter((b) => b.ernst === 'fout');
    const gesorteerd = [...fouten].sort((a, b) => a.bestand.localeCompare(b.bestand) || a.code.localeCompare(b.code));
    expect(fouten).toEqual(gesorteerd);
  });

  it('alleen waarschuwingen: het pakket is wel ok', () => {
    const map = kopie(GOED);
    pas(map, '.env.example', (t) => t.replace('# Klant-slug voor logs en alerts\n', ''));
    const rapport = controleerOplevering(map);
    expect(rapport).toMatchObject({ ok: true, fouten: 0, waarschuwingen: 1 });
  });

  it('geen dubbele bevindingen als het manifest ontbreekt', () => {
    const map = kopie(GOED);
    rmSync(path.join(map, 'oplevering.json'));
    const rapport = controleerOplevering(map);
    expect(rapport.bevindingen.filter((b) => b.code === 'MANIFEST_ONTBREEKT')).toHaveLength(1);
  });

  it('formatRapport: een kopregel en een regel per bevinding', () => {
    const goed = formatRapport(controleerOplevering(GOED)).split('\n');
    expect(goed).toEqual([`Oplevercheck ${GOED}: GOED (0 fouten, 0 waarschuwingen)`]);
    const fout = formatRapport(controleerOplevering(FOUT)).split('\n');
    expect(fout[0]).toBe(`Oplevercheck ${FOUT}: NIET GOED (25 fouten, 1 waarschuwing)`);
    expect(fout).toHaveLength(27);
    expect(fout).toContain(
      'FOUT  REGIO_NIET_EU  oplevering.json  Regio "eu-west-2" ligt niet in een EU-lidstaat. Kies uit: eu-central-1, eu-west-1, eu-west-3, eu-north-1. Een regio wijzig je later niet met een projectoverdracht.',
    );
    expect(fout.at(-1)).toMatch(/^LET OP {2}ENV_ZONDER_UITLEG {2}\.env\.example {2}/);
  });

  it('een geheim in het pakket maakt de oplevering fout, zonder het geheim te tonen', () => {
    const map = kopie(GOED);
    const sleutel = 'sk-ant-' + 'api03-' + 'K9p4'.repeat(10);
    mkdirSync(path.join(map, 'docs'), { recursive: true });
    writeFileSync(path.join(map, 'docs', 'notities.md'), `Testsleutel: ${sleutel}\n`);
    const rapport = controleerOplevering(map);
    expect(rapport.ok).toBe(false);
    expect(formatRapport(rapport)).not.toContain(sleutel);
    expect(rapport.bevindingen.map((b) => `${b.code} ${b.bestand}`)).toContain('GEHEIM_IN_BESTAND docs/notities.md');
  });

  it('gooit bij een map die niet bestaat', () => {
    expect(() => controleerOplevering(path.join(PAKKETTEN, 'bestaat-niet'))).toThrow(/bestaat niet/);
  });
});

// ---------------------------------------------------------------------------
// Oefeningen met een eigen testgroep (tellen mee voor de bewijs-poort van hun les)
// ---------------------------------------------------------------------------

describe('oefening 12.1 · verkenning', () => {
  it('een betaalde verkenning is een zesde regel, zonder risicomarge', () => {
    const v = berekenPrijsvoorstel({ ...BUBBEL, verkenning_uren: 8 });
    expect(v.regels).toHaveLength(6);
    expect(v.regels[2]).toEqual({ omschrijving: 'Betaalde verkenning: 8 uur', soort: 'eenmalig', bedrag_eur: 760 });
    expect(v.setup_eur).toBe(8630); // 6.840 + 1.026 + 760 = 8.626 -> 8.630
    expect(v.maandbedrag_eur).toBe(190);
  });

  it('zonder verkenning, of met 0 uur, blijft alles gelijk', () => {
    expect(berekenPrijsvoorstel({ ...BUBBEL, verkenning_uren: 0 }).regels).toHaveLength(5);
    expect(berekenPrijsvoorstel({ ...BUBBEL, verkenning_uren: 0 }).setup_eur).toBe(7870);
    expect(berekenPrijsvoorstel({ ...BUBBEL, verkenning_uren: 20 }).binnen_budget).toBe(false); // 9.770 > 9.000
  });
});

describe('oefening 12.2 · klant-slug', () => {
  it('het goede en het foute pakket hebben dezelfde slug als hun manifest', () => {
    expect(codes(controleerOmgeving(GOED))).not.toContain('KLANT_SLUG_ANDERS');
    expect(codes(controleerOmgeving(FOUT))).not.toContain('KLANT_SLUG_ANDERS');
  });

  it('een andere KLANT_SLUG dan klant.slug geeft precies één fout', () => {
    const map = kopie(GOED);
    pas(map, '.env.example', (t) => t.replace('KLANT_SLUG=bubbel', 'KLANT_SLUG=mout'));
    const b = controleerOmgeving(map);
    expect(codes(b)).toEqual(['KLANT_SLUG_ANDERS']);
    expect(b[0]).toMatchObject({ ernst: 'fout', bestand: '.env.example' });
    expect(b[0].melding).toContain('mout');
    expect(b[0].melding).toContain('bubbel');
  });
});

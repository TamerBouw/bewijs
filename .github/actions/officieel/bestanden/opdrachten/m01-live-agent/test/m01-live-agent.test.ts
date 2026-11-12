import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type AgentRun,
  type DagstartBron,
  type DagstartDeps,
  DagstartFout,
  type Instelling,
  type RunOverzicht,
  agentActief,
  agentsActief,
  bouwLogregel,
  draaiDagstart,
  isDagstartMoment,
  kostenUsd,
  leesOmgeving,
  maakSeedSql,
  maskeerGeheimen,
  meldGemisteDagen,
  schrijfDagstart,
  splitsWachtOpKlant,
  sqlWaarde,
  stelDagoverzichtSamen,
  stelDagstartSamen,
  vatRunsSamen,
} from '@opdracht/m01-live-agent';
import schemaSql from '@opdracht/m01-live-agent/schema.sql?raw';
import planningSql from '@opdracht/m01-live-agent/planning.sql?raw';
import { maakNepClient, systemTekst, tekstAntwoord, userTekst } from '../../../test-hulp/nepClient';
import { bronMap } from '../../../test-hulp/bron';
import {
  laadAgenda,
  laadAppSettings,
  laadKlanten,
  laadLeads,
  laadPakketten,
  laadTaken,
  laadTeam,
} from '../../../test-hulp/vonkData';

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

/** Maandag 2 november 2026, 08:30 Nederlandse tijd (wintertijd, UTC+1). */
const NU = new Date('2026-11-02T07:30:00Z');

function vonkBron(): DagstartBron {
  return { team: laadTeam(), klanten: laadKlanten(), leads: laadLeads(), taken: laadTaken(), agenda: laadAgenda() };
}

function instellingen(overrides: Record<string, string | null> = {}): Instelling[] {
  const basis: Record<string, string> = { agents_actief: 'true', dagstart_tijd: '08:30' };
  const samen = { ...basis, ...overrides };
  return Object.entries(samen)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([sleutel, waarde]) => ({ sleutel, waarde }));
}

/** Een klok die de tijden op volgorde teruggeeft en daarna steeds de laatste. */
function vasteKlok(...isos: string[]): () => Date {
  let i = 0;
  return () => new Date(isos[Math.min(i++, isos.length - 1)]);
}

interface Opname {
  berichten: string[];
  logregels: AgentRun[];
}

function maakDeps(overrides: Partial<DagstartDeps> = {}): { deps: DagstartDeps; opname: Opname } {
  const opname: Opname = { berichten: [], logregels: [] };
  const deps: DagstartDeps = {
    client: maakNepClient([tekstAntwoord('*Daan* @daan\n• 09:00 Weekstart (A01)')]),
    klok: vasteKlok('2026-11-02T07:30:00.000Z', '2026-11-02T07:30:06.000Z'),
    bron: 'handmatig',
    eurPerUsd: 0.86,
    laadInstellingen: async () => instellingen(),
    laadBron: async () => vonkBron(),
    plaatsBericht: async (tekst) => {
      opname.berichten.push(tekst);
    },
    schrijfLog: async (regel) => {
      opname.logregels.push(regel);
    },
    ...overrides,
  };
  return { deps, opname };
}

const omgeving = (waarden: Record<string, string | undefined>) => (naam: string) => waarden[naam];

const gebruikVan = (input_tokens: number, output_tokens: number, cache_read_input_tokens = 0, cache_creation_input_tokens = 0) => ({
  input_tokens,
  output_tokens,
  cache_read_input_tokens,
  cache_creation_input_tokens,
});

// ---------------------------------------------------------------------------

describe('1.1 · werkplaats', () => {
  it('leesOmgeving geeft de waarden terug als alles klopt', () => {
    const uit = leesOmgeving(
      omgeving({ ANTHROPIC_API_KEY: ' sk-ant-test-123 ', EUR_PER_USD: '0,86', SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T0/B0/x' }),
    );
    expect(uit).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-test-123',
      EUR_PER_USD: 0.86,
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T0/B0/x',
    });
    expect(leesOmgeving(omgeving({ ANTHROPIC_API_KEY: 'sk-ant-x', EUR_PER_USD: '0.86' })).SLACK_WEBHOOK_URL).toBeNull();
  });

  it('leesOmgeving noemt alle ontbrekende namen en nooit een waarde', () => {
    expect(() => leesOmgeving(omgeving({}))).toThrow(/ANTHROPIC_API_KEY.*EUR_PER_USD/);
    expect(() => leesOmgeving(omgeving({ ANTHROPIC_API_KEY: '   ', EUR_PER_USD: '0.86' }))).toThrow(/ANTHROPIC_API_KEY/);
    try {
      leesOmgeving(omgeving({ ANTHROPIC_API_KEY: 'sk-ant-geheim-abc', EUR_PER_USD: undefined }));
      expect.unreachable('leesOmgeving had moeten gooien');
    } catch (fout) {
      expect(String(fout)).toMatch(/EUR_PER_USD/);
      expect(String(fout)).not.toContain('sk-ant-geheim-abc');
    }
  });

  it('leesOmgeving weigert een sleutel zonder sk-ant-, een koers die geen getal is en een vreemde webhook', () => {
    const fout = (w: Record<string, string>) => () => leesOmgeving(omgeving(w));
    expect(fout({ ANTHROPIC_API_KEY: 'sb_secret_abc', EUR_PER_USD: '0.86' })).toThrow(/sk-ant-/);
    expect(fout({ ANTHROPIC_API_KEY: 'sb_secret_abc', EUR_PER_USD: '0.86' })).not.toThrow(/sb_secret_abc/);
    expect(fout({ ANTHROPIC_API_KEY: 'sk-ant-x', EUR_PER_USD: 'negentig cent' })).toThrow(/EUR_PER_USD/);
    expect(fout({ ANTHROPIC_API_KEY: 'sk-ant-x', EUR_PER_USD: '0' })).toThrow(/EUR_PER_USD/);
    expect(fout({ ANTHROPIC_API_KEY: 'sk-ant-x', EUR_PER_USD: '0.86', SLACK_WEBHOOK_URL: 'http://voorbeeld.example/hook' })).toThrow(
      /SLACK_WEBHOOK_URL/,
    );
  });

  it('maskeerGeheimen haalt sleutels, tokens en webhooks uit tekst', () => {
    const tekst =
      '401 met sk-ant-api03-AbC_d-9 en sb_secret_XyZ123 via https://hooks.slack.com/services/T0AA/B0BB/geheim ' +
      'en header Bearer eyJhbGciOi.payload.sig';
    const uit = maskeerGeheimen(tekst);
    expect(uit).not.toMatch(/AbC_d-9|XyZ123|geheim|eyJhbGciOi/);
    expect(uit).toContain('sk-ant-***');
    expect(uit).toContain('sb_secret_***');
    expect(uit).toContain('https://hooks.slack.com/services/***');
    expect(uit).toContain('Bearer ***');
    expect(maskeerGeheimen('Gewone tekst zonder geheim.')).toBe('Gewone tekst zonder geheim.');
  });

  it('er staat geen sleutel of webhook in de broncode', () => {
    const map = bronMap('m01-live-agent');
    const bestanden = readdirSync(map).filter((f) => f.endsWith('.ts'));
    expect(bestanden.length).toBeGreaterThan(0);
    for (const bestand of bestanden) {
      const bron = readFileSync(`${map}/${bestand}`, 'utf8');
      expect(bron, `${bestand} bevat iets dat op een sleutel lijkt`).not.toMatch(/sk-ant-api\d|sb_secret_[A-Za-z0-9]{8}|hooks\.slack\.com\/services\/T[A-Z0-9]/);
    }
  });
});

/** SQL zonder commentaarregels, in kleine letters. */
const zonderCommentaar = (sql: string) => sql.replace(/--.*$/gm, '').toLowerCase();

describe('1.2 · supabase', () => {
  const sql = zonderCommentaar(schemaSql);
  const TABELLEN = ['team', 'pakketten', 'klanten', 'leads', 'taken', 'agenda', 'app_settings', 'agent_runs'];

  it('schema.sql maakt de acht tabellen', () => {
    for (const tabel of TABELLEN) {
      expect(sql, `create table public.${tabel} ontbreekt`).toMatch(new RegExp(`create table (if not exists )?public\\.${tabel}\\s*\\(`));
    }
  });

  it('elke tabel heeft row level security aan', () => {
    for (const tabel of TABELLEN) {
      expect(sql, `RLS ontbreekt op ${tabel}`).toMatch(new RegExp(`alter table public\\.${tabel} enable row level security`));
    }
  });

  it('alleen service_role krijgt rechten, en alleen wat de dagstart nodig heeft', () => {
    expect(sql).not.toMatch(/\bto\s+(anon|authenticated|public)\b/);
    expect(sql).not.toMatch(/grant\s+all/);
    expect(sql).toMatch(/grant select, insert on public\.agent_runs\s+to service_role/);
    const grants = sql.match(/grant[^;]+;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g, g).toMatch(/to service_role/);
    // Behalve agent_runs leest de dagstart alleen.
    for (const g of grants.filter((g) => !g.includes('agent_runs'))) expect(g, g).not.toMatch(/insert|update|delete/);
    for (const tabel of TABELLEN) expect(grants.join(' '), `geen grant op ${tabel}`).toContain(`public.${tabel}`);
  });

  it('agent_runs heeft de kolommen uit de casus en een vaste set statussen', () => {
    const blok = /create table public\.agent_runs\s*\(([\s\S]*?)\);/.exec(sql)?.[1] ?? '';
    for (const kolom of ['id', 'agent', 'gestart_op', 'klaar_op', 'status', 'input_tokens', 'output_tokens', 'kosten_eur', 'samenvatting']) {
      expect(blok, `kolom ${kolom} ontbreekt in agent_runs`).toMatch(new RegExp(`^\\s*${kolom}\\s`, 'm'));
    }
    expect(sql).toMatch(/create type public\.run_status as enum \('ok', 'fout', 'afgebroken'\)/);
    expect(blok).toMatch(/gestart_op\s+timestamptz/);
  });

  it('taken maakt zelf een id en een datum, en een deadline mag leeg blijven', () => {
    const blok = /create table public\.taken\s*\(([\s\S]*?)\);/.exec(sql)?.[1] ?? '';
    expect(blok, 'id met een default uit de database').toMatch(/^\s*id\s+text\s+primary key\s+default\s+gen_random_uuid\(\)::text\s*,/m);
    expect(blok, 'aangemaakt_op met default current_date').toMatch(/^\s*aangemaakt_op\s+date\s+not null\s+default\s+current_date\b/m);
    expect(blok, 'deadline zonder not null').toMatch(/^\s*deadline\s+date\s*,\s*$/m);
  });

  it('de kill-switch begint uit', () => {
    expect(sql).toMatch(/\('agents_actief',\s*'false'\)/);
  });

  it('agentsActief faalt dicht: alleen "true" telt', () => {
    expect(agentsActief([{ sleutel: 'agents_actief', waarde: 'true' }])).toBe(true);
    expect(agentsActief([{ sleutel: 'agents_actief', waarde: ' true ' }])).toBe(true);
    for (const waarde of ['false', 'ja', '1', '', 'truee', 'TRUE', 'True']) {
      expect(agentsActief([{ sleutel: 'agents_actief', waarde }]), waarde).toBe(false);
    }
    expect(agentsActief([])).toBe(false);
    expect(agentsActief([{ sleutel: 'dagstart_tijd', waarde: 'true' }])).toBe(false);
  });

  it('maakSeedSql schrijft alle Vonk-rijen in de goede volgorde, zonder de kill-switch', () => {
    const seed = maakSeedSql({
      team: laadTeam(),
      pakketten: laadPakketten().pakketten,
      klanten: laadKlanten(),
      leads: laadLeads(),
      taken: laadTaken(),
      agenda: laadAgenda(),
      app_settings: laadAppSettings(),
    });
    const tellen = (tabel: string) => {
      const blok = new RegExp(`insert into public\\.${tabel} \\([^)]*\\) values\\n([\\s\\S]*?)\\non conflict`).exec(seed)?.[1] ?? '';
      return blok.split('\n').filter((r) => r.trim().startsWith('(')).length;
    };
    expect(tellen('team')).toBe(7);
    expect(tellen('pakketten')).toBe(3);
    expect(tellen('klanten')).toBe(6);
    expect(tellen('leads')).toBe(24);
    expect(tellen('taken')).toBe(17);
    expect(tellen('agenda')).toBe(12);
    expect(tellen('app_settings')).toBe(laadAppSettings().length - 1);
    expect(seed).not.toContain("'agents_actief'");
    const volgorde = ['team', 'pakketten', 'klanten', 'leads', 'taken', 'agenda', 'app_settings'].map((t) =>
      seed.indexOf(`insert into public.${t} `),
    );
    expect(volgorde.every((pos) => pos >= 0)).toBe(true);
    expect([...volgorde].sort((a, b) => a - b)).toEqual(volgorde);
    expect(seed).toMatch(/^[\s\S]*begin;[\s\S]*commit;\s*$/);
    expect((seed.match(/on conflict \(\w+\) do nothing;/g) ?? []).length).toBe(7);
  });

  it('sqlWaarde schrijft tekst, getallen, bool en json, en null als null', () => {
    expect(sqlWaarde("Ilse's bakkerij", 'tekst')).toBe("'Ilse''s bakkerij'");
    expect(sqlWaarde(null, 'tekst')).toBe('null');
    expect(sqlWaarde(undefined, 'json')).toBe('null');
    expect(sqlWaarde(2450, 'getal')).toBe('2450');
    expect(sqlWaarde(-12.5, 'getal')).toBe('-12.5');
    expect(sqlWaarde(false, 'bool')).toBe('false');
    expect(sqlWaarde(true, 'bool')).toBe('true');
    expect(sqlWaarde({ meta: 4500, naam: "O'Neill" }, 'json')).toBe(`'{"meta":4500,"naam":"O''Neill"}'::jsonb`);
    expect(sqlWaarde([{ code: 'kpi' }], 'json')).toBe(`'[{"code":"kpi"}]'::jsonb`);
  });

  it('sqlWaarde schrijft een lijst als arrayliteral en weigert een waarde die niet bij de soort past', () => {
    expect(sqlWaarde(['meta', 'google'], 'lijst')).toBe(`'{"meta","google"}'`);
    expect(sqlWaarde([], 'lijst')).toBe(`'{}'`);
    expect(sqlWaarde(['zeg "nee"', "d'r"], 'lijst')).toBe(`'{"zeg \\"nee\\"","d''r"}'`);
    expect(sqlWaarde(['a\\b'], 'lijst')).toBe(`'{"a\\\\b"}'`);
    expect(() => sqlWaarde('veertig', 'getal')).toThrow();
    expect(() => sqlWaarde(Number.NaN, 'getal')).toThrow();
    expect(() => sqlWaarde(Number.POSITIVE_INFINITY, 'getal')).toThrow();
    expect(() => sqlWaarde(12, 'tekst')).toThrow();
    expect(() => sqlWaarde('ja', 'bool')).toThrow();
    expect(() => sqlWaarde('meta', 'lijst')).toThrow();
    expect(() => sqlWaarde(['meta', 4], 'lijst')).toThrow();
  });
});

describe('1.3 · eerste agent', () => {
  it('stelDagoverzichtSamen geeft Daan zijn afspraken, taken, leads en klantsignalen', () => {
    const o = stelDagoverzichtSamen(vonkBron(), 'T02', NU);
    expect(o.teamlid).toEqual({ id: 'T02', naam: 'Daan', slack: '@daan' });
    expect(o.datum).toBe('2026-11-02');
    expect(o.afspraken.map((a) => [a.id, a.start])).toEqual([
      ['A01', '09:00'],
      ['A02', '11:00'],
    ]);
    expect(o.taken.map((t) => t.id)).toEqual(['TK10', 'TK07', 'TK06', 'TK13']);
    expect(o.taken.filter((t) => t.verlopen).map((t) => t.id)).toEqual(['TK10', 'TK07']);
    expect(o.nieuweLeads.map((l) => l.id)).toEqual(['L004', 'L003', 'L001', 'L005']);
    expect(o.klantSignalen).toEqual([{ id: 'K06', naam: 'Bakkerij Korrel', status: 'opzegrisico' }]);
  });

  it('het overzicht gebruikt de Nederlandse datum, ook vlak na middernacht', () => {
    const naMiddernacht = stelDagoverzichtSamen(vonkBron(), 'T02', new Date('2026-11-02T23:30:00Z'));
    expect(naMiddernacht.datum).toBe('2026-11-03');
    expect(naMiddernacht.afspraken.map((a) => a.id)).toEqual(['A06']);
    expect(naMiddernacht.taken.filter((t) => t.verlopen).map((t) => t.id)).toEqual(['TK10', 'TK07']);
    expect(naMiddernacht.taken.filter((t) => t.vandaag).map((t) => t.id)).toEqual(['TK06', 'TK13']);
    const zondagnacht = stelDagoverzichtSamen(vonkBron(), 'T02', new Date('2026-11-01T23:30:00Z'));
    expect(zondagnacht.datum).toBe('2026-11-02');
  });

  it('klaar telt niet mee en een teamlid zonder werk krijgt lege lijsten', () => {
    const noor = stelDagoverzichtSamen(vonkBron(), 'T03', NU);
    expect(noor.taken.map((t) => t.id)).not.toContain('TK17');
    expect(noor.taken[0]).toMatchObject({ id: 'TK01', vandaag: true, verlopen: false });
    const bron = vonkBron();
    bron.team.push({ id: 'T08', naam: 'Stagiair', slack: '@stagiair' });
    const leeg = stelDagoverzichtSamen(bron, 'T08', NU);
    expect(leeg).toMatchObject({ afspraken: [], taken: [], nieuweLeads: [], klantSignalen: [] });
    expect(() => stelDagoverzichtSamen(bron, 'T99', NU)).toThrow(/T99/);
    expect(stelDagstartSamen(bron, NU).map((o) => o.teamlid.id)).toEqual(['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08']);
  });

  it('een taak zonder deadline is niet verlopen en staat achteraan', () => {
    const bron = vonkBron();
    bron.taken.push({ id: '3b0c7a52-6f1e-4d0a-9a51-2f6d5c1e8b10', titel: 'Concept nalezen', toegewezen_aan: 'T02', deadline: null, status: 'open', prioriteit: 'hoog' });
    const o = stelDagoverzichtSamen(bron, 'T02', NU);
    expect(o.taken.map((t) => t.id)).toEqual(['TK10', 'TK07', 'TK06', 'TK13', '3b0c7a52-6f1e-4d0a-9a51-2f6d5c1e8b10']);
    expect(o.taken.at(-1)).toMatchObject({ deadline: null, verlopen: false, vandaag: false });
  });

  it('schrijfDagstart stuurt claude-haiku-5-5 met effort low, de instructie en het overzicht', async () => {
    const client = maakNepClient([tekstAntwoord('Dagstart')]);
    await schrijfDagstart(client, stelDagstartSamen(vonkBron(), NU));
    expect(client.aantalAanroepen).toBe(1);
    const p = client.laatsteAanroep;
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(p.output_config?.effort).toBe('low');
    expect(p.messages).toHaveLength(1);
    const user = userTekst(p);
    expect(user).toContain('<dagoverzicht');
    expect(user).toContain('TK07');
    expect(user).toContain('L004');
    const system = systemTekst(p);
    expect(system.split(/\s+/).filter(Boolean).length, 'schrijf een instructie van minstens 60 woorden').toBeGreaterThanOrEqual(60);
    expect(system).toMatch(/verzin/i);
    expect(system).not.toContain('TK07');
  });

  it('schrijfDagstart geeft de tekst en het gebruik terug, en zoekt het tekstblok op type', async () => {
    const client = maakNepClient([
      {
        content: [
          { type: 'tool_use', name: 'niet_gebruikt', input: {} },
          { type: 'text', text: '  *Daan* @daan\n• Weekstart (A01)  ' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 2100, output_tokens: 380 },
      },
    ]);
    const uit = await schrijfDagstart(client, stelDagstartSamen(vonkBron(), NU));
    expect(uit.tekst).toBe('*Daan* @daan\n• Weekstart (A01)');
    expect(uit.model).toBe('claude-haiku-5-5');
    expect(uit.gebruik).toEqual({ input_tokens: 2100, output_tokens: 380, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  });

  it('schrijfDagstart gooit een DagstartFout bij max_tokens of zonder tekst, met het gebruik erbij', async () => {
    const afgekapt = maakNepClient([{ content: [{ type: 'text', text: '*Daan* @da' }], stop_reason: 'max_tokens', usage: { input_tokens: 2000, output_tokens: 4096 } }]);
    const fout = await schrijfDagstart(afgekapt, stelDagstartSamen(vonkBron(), NU)).catch((e: unknown) => e);
    expect(fout).toBeInstanceOf(DagstartFout);
    expect(String(fout)).toMatch(/max_tokens/);
    expect((fout as DagstartFout).gebruik?.output_tokens).toBe(4096);

    const leeg = maakNepClient([{ content: [], stop_reason: 'end_turn' }]);
    await expect(schrijfDagstart(leeg, stelDagstartSamen(vonkBron(), NU))).rejects.toThrow(/geen tekst/i);
  });

  it('kostenUsd rekent met de prijzen van Haiku, Sonnet en Opus, ook voor de cache', () => {
    expect(kostenUsd('claude-haiku-5-5', gebruikVan(1000, 500))).toBeCloseTo(0.00035, 10);
    expect(kostenUsd('claude-sonnet-5-5', gebruikVan(1000, 500))).toBeCloseTo(0.007, 10);
    expect(kostenUsd('claude-opus-5-5', gebruikVan(1000, 500))).toBeCloseTo(0.014, 10);
    // Cache lezen: 0,1 x invoer bij Haiku, 0,05 x bij Sonnet en Opus. Cache schrijven (5 minuten): 1,25 x.
    expect(kostenUsd('claude-haiku-5-5', gebruikVan(0, 0, 10_000))).toBeCloseTo(0.0001, 10);
    expect(kostenUsd('claude-sonnet-5-5', gebruikVan(0, 0, 10_000))).toBeCloseTo(0.001, 10);
    expect(kostenUsd('claude-opus-5-5', gebruikVan(0, 0, 10_000))).toBeCloseTo(0.002, 10);
    expect(kostenUsd('claude-haiku-5-5', gebruikVan(0, 0, 0, 10_000))).toBeCloseTo(0.00125, 10);
    expect(kostenUsd('claude-opus-5-5', gebruikVan(0, 0, 0, 10_000))).toBeCloseTo(0.05, 10);
    expect(() => kostenUsd('claude-haiku-9', gebruikVan(1, 1))).toThrow(/claude-haiku-9/);
  });

  it('kostenUsd: boven 100.000 prompttokens rekent Haiku 5.5 het hoge tarief voor de hele aanroep', () => {
    expect(kostenUsd('claude-haiku-5-5', gebruikVan(120_000, 1000))).toBeCloseTo(0.0625, 10);
    // Precies 100.000 is nog het gewone tarief.
    expect(kostenUsd('claude-haiku-5-5', gebruikVan(100_000, 0))).toBeCloseTo(0.01, 10);
    // De cache telt mee voor de grens, en cache lezen gaat mee naar 0,05.
    expect(kostenUsd('claude-haiku-5-5', gebruikVan(100_000, 0, 10_000))).toBeCloseTo(0.0505, 10);
    // Sonnet 5.5 heeft geen tweede tarief.
    expect(kostenUsd('claude-sonnet-5-5', gebruikVan(200_000, 0))).toBeCloseTo(0.4, 10);
  });

  it('bouwLogregel maakt de rij voor agent_runs', () => {
    const regel = bouwLogregel({
      agent: 'dagstart',
      gestart: new Date('2026-11-02T07:30:00Z'),
      klaar: new Date('2026-11-02T07:30:05Z'),
      status: 'ok',
      samenvatting: `Klaar met sk-ant-api03-geheim. ${'x'.repeat(600)}`,
      model: 'claude-haiku-5-5',
      gebruik: { input_tokens: 1500, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
      eurPerUsd: 0.86,
    });
    expect(regel).toMatchObject({
      agent: 'dagstart',
      gestart_op: '2026-11-02T07:30:00.000Z',
      klaar_op: '2026-11-02T07:30:05.000Z',
      status: 'ok',
      input_tokens: 2000,
      output_tokens: 400,
    });
    // (1500 x 0,10 + 500 x 0,01 + 400 x 0,50) / 1.000.000 = 0,000355 dollar; x 0,86 = 0,0003053, op 6 decimalen 0,000305 euro
    expect(regel.kosten_eur).toBeCloseTo(0.000305, 9);
    expect(regel.samenvatting).not.toContain('geheim');
    expect(regel.samenvatting.length).toBeLessThanOrEqual(500);
    const zonder = bouwLogregel({
      agent: 'dagstart',
      gestart: NU,
      klaar: NU,
      status: 'afgebroken',
      samenvatting: 'uit',
      eurPerUsd: 0.86,
    });
    expect(zonder).toMatchObject({ input_tokens: 0, output_tokens: 0, kosten_eur: 0 });
  });
});

describe('1.4 · tests en CI', () => {
  it('draaiDagstart: kill-switch uit, dan geen aanroep, geen bericht en één logregel afgebroken', async () => {
    const client = maakNepClient([]);
    const { deps, opname } = maakDeps({ client, laadInstellingen: async () => instellingen({ agents_actief: 'false' }) });
    const regel = await draaiDagstart(deps);
    expect(client.aantalAanroepen).toBe(0);
    expect(opname.berichten).toEqual([]);
    expect(opname.logregels).toHaveLength(1);
    expect(regel).toEqual(opname.logregels[0]);
    expect(regel).toMatchObject({ agent: 'dagstart', status: 'afgebroken', input_tokens: 0, kosten_eur: 0 });
    expect(regel?.samenvatting).toMatch(/agents_actief/);
  });

  it('draaiDagstart: alles goed, dan één bericht en één logregel ok met tokens en kosten', async () => {
    const client = maakNepClient([{ content: [{ type: 'text', text: 'Goedemorgen Vonk' }], usage: { input_tokens: 2000, output_tokens: 400 } }]);
    const { deps, opname } = maakDeps({ client });
    const regel = await draaiDagstart(deps);
    expect(client.aantalAanroepen).toBe(1);
    expect(opname.berichten).toEqual(['Goedemorgen Vonk']);
    expect(opname.logregels).toHaveLength(1);
    expect(regel).toEqual({
      agent: 'dagstart',
      gestart_op: '2026-11-02T07:30:00.000Z',
      klaar_op: '2026-11-02T07:30:06.000Z',
      status: 'ok',
      input_tokens: 2000,
      output_tokens: 400,
      kosten_eur: 0.000344,
      samenvatting: '7 teamleden, 4 afspraken, 3 verlopen taken, 4 nieuwe leads.',
    });
  });

  it('draaiDagstart: Slack faalt, dan status fout en de tokens tellen toch mee', async () => {
    const client = maakNepClient([{ content: [{ type: 'text', text: 'Bericht' }], usage: { input_tokens: 2000, output_tokens: 400 } }]);
    const { deps, opname } = maakDeps({
      client,
      plaatsBericht: async () => {
        throw new Error('Slack antwoordde 404: no_service');
      },
    });
    const regel = await draaiDagstart(deps);
    expect(opname.logregels).toHaveLength(1);
    expect(regel).toMatchObject({ status: 'fout', input_tokens: 2000, output_tokens: 400, kosten_eur: 0.000344 });
    expect(regel?.samenvatting).toMatch(/no_service/);
  });

  it('draaiDagstart: instellingen niet leesbaar, dan fout zonder aanroep', async () => {
    const client = maakNepClient([]);
    const { deps, opname } = maakDeps({
      client,
      laadInstellingen: async () => {
        throw new Error('permission denied for table app_settings');
      },
    });
    const regel = await draaiDagstart(deps);
    expect(client.aantalAanroepen).toBe(0);
    expect(opname.berichten).toEqual([]);
    expect(opname.logregels).toHaveLength(1);
    expect(regel).toMatchObject({ status: 'fout' });
    expect(regel?.samenvatting).toMatch(/permission denied/);
  });

  it('draaiDagstart: max_tokens wordt een fout met tokens, en een sleutel in een fout komt gemaskeerd in de log', async () => {
    const afgekapt = maakNepClient([{ content: [{ type: 'text', text: 'hal' }], stop_reason: 'max_tokens', usage: { input_tokens: 2000, output_tokens: 4096 } }]);
    const eerste = maakDeps({ client: afgekapt });
    const regel = await draaiDagstart(eerste.deps);
    expect(regel).toMatchObject({ status: 'fout', input_tokens: 2000, output_tokens: 4096 });
    expect(eerste.opname.berichten).toEqual([]);

    const lek = maakNepClient([new Error('401 authentication_error voor sleutel sk-ant-api03-LEKLEK')]);
    const tweede = maakDeps({ client: lek });
    const regel2 = await draaiDagstart(tweede.deps);
    expect(regel2?.status).toBe('fout');
    expect(regel2?.samenvatting).toContain('sk-ant-***');
    expect(regel2?.samenvatting).not.toContain('LEKLEK');
  });

  it('draaiDagstart: als de log zelf faalt, komt de fout naar boven en is er geen tweede poging', async () => {
    let pogingen = 0;
    const { deps } = maakDeps({
      schrijfLog: async () => {
        pogingen++;
        throw new Error('agent_runs: permission denied for table agent_runs');
      },
    });
    await expect(draaiDagstart(deps)).rejects.toThrow(/agent_runs/);
    expect(pogingen).toBe(1);
  });

  it('de kern gebruikt nooit new Date() of Date.now(): de tijd komt binnen via nu of klok', () => {
    const bron = readFileSync(`${bronMap('m01-live-agent')}/dagstart.ts`, 'utf8');
    const code = bron.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/new Date\(\s*\)|Date\.now\(/);
    expect(code).not.toMatch(/from ['"]node:|process\.env|Deno\./);
  });
});

const run = (gestart_op: string, status: AgentRun['status'], kosten_eur: number): AgentRun => ({
  agent: 'dagstart',
  gestart_op,
  klaar_op: gestart_op,
  status,
  input_tokens: 0,
  output_tokens: 0,
  kosten_eur,
  samenvatting: '',
});
const RUNS = [
  run('2026-10-20T06:30:02.000Z', 'ok', 0.0004),
  run('2026-10-26T07:30:03.000Z', 'ok', 0.00031),
  run('2026-10-27T07:30:02.000Z', 'ok', 0.00029),
  run('2026-10-28T07:30:04.000Z', 'fout', 0.0001),
  run('2026-10-29T07:30:01.000Z', 'afgebroken', 0),
  run('2026-11-02T07:30:02.000Z', 'ok', 0.0003),
];
const MAANDAG = new Date('2026-11-02T09:00:00Z');

describe('1.5 · planning en logs', () => {
  it('isDagstartMoment: 07:30 GMT in de winter is 08:30 in Nederland', () => {
    expect(isDagstartMoment(new Date('2026-11-02T07:30:00Z'), instellingen())).toBe(true);
    expect(isDagstartMoment(new Date('2026-11-02T07:30:45Z'), instellingen())).toBe(true);
    expect(isDagstartMoment(new Date('2026-11-02T06:30:00Z'), instellingen())).toBe(false);
    // De maandag na de overgang naar wintertijd (25 oktober 2026)
    expect(isDagstartMoment(new Date('2026-10-26T07:30:00Z'), instellingen())).toBe(true);
  });

  it('isDagstartMoment: 06:30 GMT in de zomer is 08:30 in Nederland', () => {
    expect(isDagstartMoment(new Date('2026-06-01T06:30:00Z'), instellingen())).toBe(true);
    expect(isDagstartMoment(new Date('2026-06-01T07:30:00Z'), instellingen())).toBe(false);
    // De vrijdag vóór de overgang: nog zomertijd
    expect(isDagstartMoment(new Date('2026-10-23T06:30:00Z'), instellingen())).toBe(true);
  });

  it('isDagstartMoment: weekend, buiten het venster of zonder geldige dagstart_tijd is false', () => {
    expect(isDagstartMoment(new Date('2026-10-31T07:30:00Z'), instellingen())).toBe(false);
    expect(isDagstartMoment(new Date('2026-11-01T07:30:00Z'), instellingen())).toBe(false);
    expect(isDagstartMoment(new Date('2026-11-02T07:44:59Z'), instellingen())).toBe(true);
    expect(isDagstartMoment(new Date('2026-11-02T07:45:00Z'), instellingen())).toBe(false);
    expect(isDagstartMoment(new Date('2026-11-02T07:29:00Z'), instellingen())).toBe(false);
    expect(isDagstartMoment(NU, instellingen({ dagstart_tijd: null }))).toBe(false);
    expect(isDagstartMoment(NU, instellingen({ dagstart_tijd: 'half negen' }))).toBe(false);
    expect(isDagstartMoment(new Date('2026-11-02T08:00:00Z'), instellingen({ dagstart_tijd: '09:00' }))).toBe(true);
  });

  it('draaiDagstart: een cron-aanroep buiten het venster doet niets en logt niets', async () => {
    const client = maakNepClient([]);
    const { deps, opname } = maakDeps({ client, bron: 'cron', klok: vasteKlok('2026-11-02T06:30:00.000Z') });
    await expect(draaiDagstart(deps)).resolves.toBeNull();
    expect(client.aantalAanroepen).toBe(0);
    expect(opname.logregels).toEqual([]);
    expect(opname.berichten).toEqual([]);
  });

  it('draaiDagstart: een cron-aanroep in het venster draait, een handmatige run negeert het venster', async () => {
    const inVenster = maakDeps({ bron: 'cron' });
    expect((await draaiDagstart(inVenster.deps))?.status).toBe('ok');

    const handmatig = maakDeps({ bron: 'handmatig', klok: vasteKlok('2026-11-02T13:12:00.000Z', '2026-11-02T13:12:05.000Z') });
    expect((await draaiDagstart(handmatig.deps))?.status).toBe('ok');
    expect(handmatig.opname.logregels).toHaveLength(1);

    const killSwitchInVenster = maakDeps({ bron: 'cron', laadInstellingen: async () => instellingen({ agents_actief: 'false' }) });
    expect((await draaiDagstart(killSwitchInVenster.deps))?.status).toBe('afgebroken');
  });

  it('planning.sql plant de dagstart op 30 6,7 * * 1-5 met de sleutel uit Vault', () => {
    const sql = zonderCommentaar(planningSql);
    expect(sql).toMatch(/cron\.schedule\(\s*'dagstart',\s*'30 6,7 \* \* 1-5'/);
    expect(sql).toContain('net.http_post');
    expect(sql).toContain('/functions/v1/dagstart');
    expect(sql).toMatch(/vault\.decrypted_secrets where name = 'project_url'/);
    expect(sql).toMatch(/'apikey',\s*\(select decrypted_secret from vault\.decrypted_secrets where name = 'secret_key'\)/);
    expect(sql).toMatch(/jsonb_build_object\(\s*'bron',\s*'cron'\s*\)/);
    expect(sql).toMatch(/timeout_milliseconds\s*:=\s*\d{4,}/);
    expect(sql).not.toMatch(/sb_secret_|eyj[a-z0-9_-]{10}|sk-ant-/);
    expect(sql).toMatch(/delete from cron\.job_run_details where end_time < now\(\) - interval/);
  });

  it('vatRunsSamen telt per status en de kosten van de dagen vóór vandaag', () => {
    const uit = vatRunsSamen(RUNS, MAANDAG);
    expect(uit.aantal).toEqual({ ok: 2, fout: 1, afgebroken: 1 });
    expect(uit.kosten_eur).toBeCloseTo(0.0007, 8);
    expect(uit.laatste_ok).toBe('2026-10-27T07:30:02.000Z');
    expect(vatRunsSamen([], MAANDAG)).toEqual({
      aantal: { ok: 0, fout: 0, afgebroken: 0 },
      kosten_eur: 0,
      laatste_ok: null,
      gemiste_werkdagen: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'],
    });
  });

  it('vatRunsSamen: gemiste werkdagen op de Nederlandse datum, zonder weekend en zonder vandaag', () => {
    expect(vatRunsSamen(RUNS, MAANDAG).gemiste_werkdagen).toEqual(['2026-10-28', '2026-10-30']);
    expect(vatRunsSamen([], MAANDAG, 3).gemiste_werkdagen).toEqual(['2026-10-30']);
    // 27 oktober 23:30 GMT is 28 oktober 00:30 in Nederland: die run dekt woensdag 28 oktober.
    const nacht = [...RUNS, run('2026-10-27T23:30:00.000Z', 'ok', 0)];
    expect(vatRunsSamen(nacht, MAANDAG).gemiste_werkdagen).toEqual(['2026-10-30']);
  });
});

// ---------------------------------------------------------------------------
// Oefeningen met een eigen testgroep (src/oefeningen.ts)
// ---------------------------------------------------------------------------

describe('oefening 1.2 · kill-switch per agent', () => {
  const rijen = (alle: string | null, eigen: string | null): Instelling[] => [
    ...(alle === null ? [] : [{ sleutel: 'agents_actief', waarde: alle }]),
    ...(eigen === null ? [] : [{ sleutel: 'dagstart_actief', waarde: eigen }]),
  ];

  it('agentActief is alleen true als agents_actief en <agent>_actief allebei aan staan', () => {
    expect(agentActief(rijen('true', 'true'), 'dagstart')).toBe(true);
    expect(agentActief(rijen('true', 'false'), 'dagstart')).toBe(false);
    expect(agentActief(rijen('false', 'true'), 'dagstart')).toBe(false);
    expect(agentActief(rijen('false', 'false'), 'dagstart')).toBe(false);
    expect(agentActief([...rijen('true', 'false'), { sleutel: 'intake_actief', waarde: 'true' }], 'intake')).toBe(true);
  });

  it('agentActief faalt dicht: een ontbrekende rij of een andere schrijfwijze is uit', () => {
    expect(agentActief(rijen('true', null), 'dagstart')).toBe(false);
    expect(agentActief(rijen(null, 'true'), 'dagstart')).toBe(false);
    expect(agentActief(rijen('true', ' true '), 'dagstart')).toBe(true);
    for (const waarde of ['TRUE', 'ja', '1', '']) expect(agentActief(rijen('true', waarde), 'dagstart'), waarde).toBe(false);
  });
});

describe('oefening 1.3 · wacht op klant', () => {
  it('splitsWachtOpKlant zet TK11 van Fleur apart en laat de rest op volgorde staan', () => {
    const fleur = stelDagoverzichtSamen(vonkBron(), 'T07', NU);
    const uit = splitsWachtOpKlant(fleur);
    expect(uit.wachtOpKlant.map((t) => t.id)).toEqual(['TK11']);
    expect(uit.taken.map((t) => t.id)).toEqual(['TK08', 'TK15']);
    expect(uit.afspraken).toEqual(fleur.afspraken);
    expect(uit.teamlid).toEqual(fleur.teamlid);
  });

  it('splitsWachtOpKlant verandert het overzicht zelf niet', () => {
    const fleur = stelDagoverzichtSamen(vonkBron(), 'T07', NU);
    const kopie = structuredClone(fleur);
    splitsWachtOpKlant(fleur);
    expect(fleur).toEqual(kopie);
    expect(splitsWachtOpKlant(stelDagoverzichtSamen(vonkBron(), 'T02', NU)).wachtOpKlant).toEqual([]);
  });
});

describe('oefening 1.5 · melding gemiste werkdagen', () => {
  const overzicht = (gemiste_werkdagen: string[]): RunOverzicht => ({
    aantal: { ok: 0, fout: 0, afgebroken: 0 },
    kosten_eur: 0,
    laatste_ok: null,
    gemiste_werkdagen,
  });

  it('meldGemisteDagen noemt één, twee of meer datums in één zin', () => {
    expect(meldGemisteDagen(overzicht(['2026-10-28']))).toBe('Let op: geen dagstart op 2026-10-28.');
    expect(meldGemisteDagen(overzicht(['2026-10-28', '2026-10-30']))).toBe('Let op: geen dagstart op 2026-10-28 en 2026-10-30.');
    expect(meldGemisteDagen(overzicht(['2026-10-30', '2026-10-26', '2026-10-28']))).toBe(
      'Let op: geen dagstart op 2026-10-26, 2026-10-28 en 2026-10-30.',
    );
  });

  it('meldGemisteDagen geeft null zonder gemiste dag, ook na een volle week runs', () => {
    expect(meldGemisteDagen(overzicht([]))).toBeNull();
    const week = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((d) => run(`${d}T07:30:00.000Z`, 'ok', 0));
    expect(meldGemisteDagen(vatRunsSamen(week, MAANDAG))).toBeNull();
    expect(meldGemisteDagen(vatRunsSamen(week.slice(1), MAANDAG))).toBe('Let op: geen dagstart op 2026-10-26.');
  });
});

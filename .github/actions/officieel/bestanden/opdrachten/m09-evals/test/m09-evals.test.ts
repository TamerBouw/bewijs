import { describe, expect, it, vi } from 'vitest';
import {
  actieveVersie,
  beoordeelTegenBasislijn,
  ciSamenvatting,
  controleerUitvoer,
  controleerVersies,
  dekking,
  draaiEval,
  foutMelding,
  haalPad,
  kalibreerRechter,
  maakBasislijn,
  maakRechter,
  metRunLog,
  nieuweGevallen,
  promotieBesluit,
  RunAfgebroken,
  vatRunsSamen,
  verbeterronde,
  vergelijkExact,
  vergelijkVeld,
  vingerafdruk,
  type AgentOverzicht,
  type Controle,
  type Correctie,
  type EvalGeval,
  type EvalRapport,
  type InstructieVersie,
  type Rechter,
  type RunRij,
  type Testset,
} from '@opdracht/m09-evals';
// Via de alias: jouw opdrachten/m09-evals/testset/testset.json (met OPLOSSING=1 de referentieset).
import testsetTekst from '@opdracht/m09-evals/testset/testset.json?raw';
import { jsonAntwoord, maakNepClient, systemTekst, tekstAntwoord, userTekst } from '../../../test-hulp/nepClient';
import { laadFormulierVerwachtingen, laadFormulieren, laadMailLabels, leesMail } from '../../../test-hulp/vonkData';

const NU = new Date('2026-11-02T07:00:00.000Z');

/** Klok die per aanroep 250 ms verder loopt, zodat duur_ms vast ligt. */
function vasteKlok(start = NU, stap = 250) {
  let t = start.getTime();
  return () => {
    const d = new Date(t);
    t += stap;
    return d;
  };
}

const geval = (id: string, velden: Partial<EvalGeval> = {}): EvalGeval => ({
  id,
  agent: 'router',
  invoer: { id },
  controles: [{ soort: 'exact', pad: 'categorie', verwacht: 'klacht' }],
  bron: 'eigen',
  toelichting: 'test',
  ...velden,
});

const rechterDieAltijd = (oordeel: 'ja' | 'nee' | 'onbekend'): Rechter => ({
  beoordeel: async (_tekst, criteria) => ({
    geslaagd: oordeel === 'ja',
    onzeker: oordeel === 'onbekend',
    per_criterium: criteria.map((criterium) => ({ criterium, toelichting: 'test', oordeel })),
  }),
});

// ---------------------------------------------------------------------------
describe('logging', () => {
  // berekenKostenUsd (M01/M08) en maskeerPersoonsgegevens (M08) zijn gegeven en worden hier niet opnieuw getest.
  it('metRunLog: één rij per run met tokens, kosten in euro, modellen, versie en gemaskeerde samenvatting', async () => {
    const rijen: RunRij[] = [];
    const client = maakNepClient([
      { ...jsonAntwoord({ soort: 'lead' }), usage: { input_tokens: 1_200, output_tokens: 200 } },
      { ...tekstAntwoord('Beste Lars, ...'), usage: { input_tokens: 800, output_tokens: 400 } },
    ]);
    const uitvoer = await metRunLog(
      client,
      {
        agent: 'lead-intake',
        instructie_versie: 'intake-v3',
        koers_usd_eur: 0.86,
        opslag: { schrijf: async (r) => void rijen.push(r) },
        invoer_ref: 'formulieren/01-compleet-webshop.json',
        ketting_id: 'k-01',
        klok: vasteKlok(),
        maakId: () => 'run-1',
        samenvatting: (u: { soort: string; email: string }) => `${u.soort} van ${u.email}`,
      },
      async (gemeten) => {
        await gemeten.messages.create({ model: 'claude-haiku-5-5', max_tokens: 500, messages: [{ role: 'user', content: 'a' }] });
        await gemeten.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 500, messages: [{ role: 'user', content: 'b' }] });
        return { soort: 'lead', email: 'lars@puurplant.example' };
      },
    );
    expect(uitvoer).toEqual({ soort: 'lead', email: 'lars@puurplant.example' });
    expect(client.aantalAanroepen).toBe(2);
    expect(rijen).toHaveLength(1);
    const usd = (1_200 * 0.1 + 200 * 0.5 + 800 * 2 + 400 * 10) / 1e6;
    expect(rijen[0]).toMatchObject({
      id: 'run-1',
      agent: 'lead-intake',
      status: 'ok',
      aanroepen: 2,
      input_tokens: 2_000,
      output_tokens: 600,
      model: 'claude-haiku-5-5,claude-sonnet-5-5',
      instructie_versie: 'intake-v3',
      ketting_id: 'k-01',
      invoer_ref: 'formulieren/01-compleet-webshop.json',
      gestart_op: '2026-11-02T07:00:00.000Z',
      klaar_op: '2026-11-02T07:00:00.250Z',
      duur_ms: 250,
      samenvatting: 'lead van [e-mail]',
      fout: null,
    });
    expect(rijen[0].kosten_eur).toBeCloseTo(usd * 0.86, 6);
  });

  it('metRunLog: ook een mislukte of afgebroken run krijgt een rij, en de fout gaat door', async () => {
    const rijen: RunRij[] = [];
    const opties = {
      agent: 'inbox-router',
      instructie_versie: 'router-v2',
      koers_usd_eur: 0.86,
      opslag: { schrijf: async (r: RunRij) => void rijen.push(r) },
      klok: vasteKlok(),
    };
    await expect(
      metRunLog(maakNepClient([tekstAntwoord('x')]), opties, async (c) => {
        await c.messages.create({ model: 'claude-haiku-5-5', max_tokens: 50, messages: [{ role: 'user', content: 'x' }] });
        throw new Error('zod: urgentie "spoed" bestaat niet (afzender ruben@groenwerk.example)');
      }),
    ).rejects.toThrow(/urgentie/);
    await expect(
      metRunLog(maakNepClient([]), opties, async () => {
        throw new RunAfgebroken('agents_actief staat op false');
      }),
    ).rejects.toBeInstanceOf(RunAfgebroken);
    expect(rijen.map((r) => r.status)).toEqual(['fout', 'afgebroken']);
    expect(rijen[0].aanroepen).toBe(1);
    expect(rijen[0].input_tokens).toBe(100);
    expect(rijen[0].fout).toContain('urgentie');
    expect(rijen[0].fout).not.toContain('ruben@groenwerk.example');
    expect(rijen[1]).toMatchObject({ aanroepen: 0, model: null, kosten_eur: 0, fout: 'agents_actief staat op false' });
  });

  it('metRunLog: een model zonder prijs geeft kosten_eur null; een kapotte opslag breekt de run niet', async () => {
    const rijen: RunRij[] = [];
    await metRunLog(
      maakNepClient([tekstAntwoord('ok')]),
      { agent: 'a', instructie_versie: 'v1', koers_usd_eur: 0.86, opslag: { schrijf: async (r) => void rijen.push(r) } },
      async (c) => c.messages.create({ model: 'claude-opus-5', max_tokens: 50, messages: [{ role: 'user', content: 'x' }] }),
    );
    expect(rijen[0].kosten_eur).toBeNull();

    const bijLogFout = vi.fn();
    const uitkomst = await metRunLog(
      maakNepClient([]),
      {
        agent: 'a',
        instructie_versie: 'v1',
        koers_usd_eur: 0.86,
        opslag: { schrijf: async () => Promise.reject(new Error('relation "agent_runs" does not exist')) },
        bijLogFout,
      },
      async () => 'klaar',
    );
    expect(uitkomst).toBe('klaar');
    expect(bijLogFout).toHaveBeenCalledTimes(1);
    expect(String(bijLogFout.mock.calls[0][0])).toContain('agent_runs');
  });

  it('vatRunsSamen: per agent runs, foutpercentage en kosten; duurste agent eerst', () => {
    const rij = (agent: string, status: RunRij['status'], kosten: number | null): RunRij => ({
      id: Math.random().toString(),
      agent,
      gestart_op: '',
      klaar_op: '',
      duur_ms: 1,
      status,
      aanroepen: 1,
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      kosten_eur: kosten,
      model: 'claude-haiku-5-5',
      instructie_versie: 'v1',
      ketting_id: null,
      invoer_ref: null,
      samenvatting: '',
      fout: null,
    });
    const overzicht = vatRunsSamen([
      rij('inbox-router', 'ok', 0.001),
      rij('inbox-router', 'fout', 0.0005),
      rij('inbox-router', 'afgebroken', 0),
      rij('ads-rapport', 'ok', 0.02),
      rij('ads-rapport', 'ok', null),
    ]);
    expect(overzicht.map((o) => o.agent)).toEqual(['ads-rapport', 'inbox-router']);
    expect(overzicht[1]).toMatchObject({ runs: 3, ok: 1, fout: 1, afgebroken: 1, foutpercentage: 66.7, input_tokens: 300 });
    expect(overzicht[1].kosten_eur).toBeCloseTo(0.0015, 9);
    expect(overzicht[1].kosten_per_run_eur).toBeCloseTo(0.0005, 9);
    expect(overzicht[0]).toMatchObject({ runs: 2, kosten_onbekend: 1, foutpercentage: 0 });
  });
});

// ---------------------------------------------------------------------------
describe('oefening 9.1 · foutmelding', () => {
  const overzicht = (agent: string, velden: Partial<AgentOverzicht> = {}): AgentOverzicht => ({
    agent,
    runs: 3,
    ok: 3,
    fout: 0,
    afgebroken: 0,
    foutpercentage: 0,
    kosten_eur: 0.001,
    kosten_per_run_eur: 0.000333,
    kosten_onbekend: 0,
    input_tokens: 300,
    output_tokens: 30,
    ...velden,
  });

  it('twee ok-runs en één fout geven één bericht met 33,3%', () => {
    const tekst = foutMelding([overzicht('lead-intake'), overzicht('inbox-router', { ok: 2, fout: 1, foutpercentage: 33.3 })]);
    expect(tekst).toBe('Agents die aandacht vragen:\n- inbox-router: 33,3% fout of afgebroken (1 van 3 runs)');
  });

  it('precies op de drempel is geen melding; runs zonder bekende kosten wel', () => {
    expect(foutMelding([overzicht('a', { runs: 10, ok: 9, fout: 1, foutpercentage: 10 })])).toBeNull();
    expect(foutMelding([overzicht('a', { runs: 10, ok: 9, afgebroken: 1, foutpercentage: 10 })], 5)).toContain('(1 van 10 runs)');
    expect(foutMelding([overzicht('ads-rapport', { kosten_onbekend: 1 })])).toBe('Agents die aandacht vragen:\n- ads-rapport: 1 run(s) zonder bekende kosten');
  });

  it('alles in orde of geen runs: null', () => {
    expect(foutMelding([overzicht('lead-intake'), overzicht('inbox-router')])).toBeNull();
    expect(foutMelding([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('testset', () => {
  let testset: Testset = { naam: '', versie: 0, gevallen: [] };
  try {
    testset = JSON.parse(testsetTekst) as Testset;
  } catch {
    // de eerste test meldt dit
  }
  const gevallen = Array.isArray(testset.gevallen) ? testset.gevallen : [];
  const bestand = (g: EvalGeval) => (typeof g.invoer?.bestand === 'string' ? (g.invoer.bestand as string) : null);
  const veldControles = (g: EvalGeval) =>
    g.controles.filter((c): c is Extract<Controle, { soort: 'veld' }> => c.soort === 'veld' && !c.pad);

  it('is geldige JSON met naam, versie en minstens 30 gevallen, minstens 12 per agent', () => {
    expect(() => JSON.parse(testsetTekst), 'testset.json is geen geldige JSON').not.toThrow();
    expect(typeof testset.naam).toBe('string');
    expect(Number.isInteger(testset.versie)).toBe(true);
    expect(gevallen.length, `${gevallen.length} gevallen`).toBeGreaterThanOrEqual(30);
    expect(gevallen.filter((g) => g.agent === 'intake').length, 'intake-gevallen').toBeGreaterThanOrEqual(12);
    expect(gevallen.filter((g) => g.agent === 'router').length, 'router-gevallen').toBeGreaterThanOrEqual(12);
  });

  it('elk geval is geldig: unieke id en invoer, bron, toelichting en minstens één geldige controle', () => {
    const ids = gevallen.map((g) => g.id);
    expect(new Set(ids).size, 'id’s zijn niet uniek').toBe(ids.length);
    const invoeren = gevallen.map((g) => `${g.agent}:${JSON.stringify(g.invoer)}`);
    expect(new Set(invoeren).size, 'twee gevallen hebben dezelfde invoer').toBe(invoeren.length);
    for (const g of gevallen) {
      expect(['intake', 'router'], `${g.id}: agent`).toContain(g.agent);
      expect(['data', 'eigen', 'afwijzing'], `${g.id}: bron`).toContain(g.bron);
      expect(typeof g.toelichting === 'string' && g.toelichting.trim().length > 0, `${g.id}: toelichting`).toBe(true);
      expect(Array.isArray(g.controles) && g.controles.length > 0, `${g.id}: geen controles`).toBe(true);
      for (const c of g.controles) {
        expect(['exact', 'veld', 'rechter'], `${g.id}: onbekende controle`).toContain(c.soort);
        if (c.soort === 'veld') {
          const v = c.verwacht;
          expect(v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0, `${g.id}: veld zonder velden`).toBe(true);
        }
        if (c.soort === 'rechter') {
          expect(typeof c.pad === 'string' && c.pad.length > 0, `${g.id}: rechter zonder pad`).toBe(true);
          expect(Array.isArray(c.criteria) && c.criteria.length > 0, `${g.id}: rechter zonder criteria`).toBe(true);
        }
      }
    }
  });

  it('bevat alle 10 formulieren en alle 14 mails, met de verwachting uit verwacht.json en labels.json', () => {
    const intakeVelden = ['soort', 'taal', 'dubbel_van', 'klant_id', 'ontbreekt', 'budget_eur', 'pakket_indicatie', 'gevoelige_gegevens', 'volgende_stap'] as const;
    for (const v of laadFormulierVerwachtingen()) {
      const g = gevallen.find((x) => x.agent === 'intake' && bestand(x) === v.bestand);
      expect(g, `formulier ${v.bestand} ontbreekt`).toBeDefined();
      if (!g) continue;
      const verwacht = Object.assign({}, ...veldControles(g).map((c) => c.verwacht)) as Record<string, unknown>;
      for (const k of intakeVelden) expect(verwacht[k], `${g.id}.${k}`).toEqual(v[k]);
    }
    const routerVelden = ['categorie', 'urgentie', 'toegewezen_aan', 'ook_melden_aan', 'klant_id', 'verdacht', 'injectie'] as const;
    for (const l of laadMailLabels()) {
      const g = gevallen.find((x) => x.agent === 'router' && bestand(x) === l.bestand);
      expect(g, `mail ${l.bestand} ontbreekt`).toBeDefined();
      if (!g) continue;
      const verwacht = Object.assign({}, ...veldControles(g).map((c) => c.verwacht)) as Record<string, unknown>;
      for (const k of routerVelden) expect(verwacht[k], `${g.id}.${k}`).toEqual(l[k]);
    }
  });

  it('volgt de verdeling: 6+ eigen (3+ aanval, 3+ grensgeval), 4+ aanval, 6+ kritiek, 8+ apart over beide agents, 2+ met rechter', () => {
    const eigen = gevallen.filter((g) => g.bron === 'eigen');
    expect(eigen.length, 'eigen gevallen').toBeGreaterThanOrEqual(6);
    expect(eigen.filter((g) => g.aanval).length, 'eigen aanvalstests').toBeGreaterThanOrEqual(3);
    expect(eigen.filter((g) => g.grensgeval).length, 'eigen grensgevallen').toBeGreaterThanOrEqual(3);
    expect(gevallen.filter((g) => g.aanval).length, 'aanvalstests').toBeGreaterThanOrEqual(4);
    expect(gevallen.filter((g) => g.kritiek).length, 'kritieke gevallen').toBeGreaterThanOrEqual(6);
    const apart = gevallen.filter((g) => g.apart);
    expect(apart.length, 'apart gehouden gevallen').toBeGreaterThanOrEqual(8);
    expect(new Set(apart.map((g) => g.agent)).size, 'apart gehouden gevallen voor beide agents').toBe(2);
    expect(gevallen.filter((g) => g.controles.some((c) => c.soort === 'rechter')).length, 'gevallen met rechter').toBeGreaterThanOrEqual(2);
  });

  it('bevat alleen fictieve gegevens: e-mailadressen op .example en telefoonnummers 06-0000xxxx', () => {
    const tekst = JSON.stringify(gevallen);
    const mails = tekst.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    for (const m of mails) expect(m, `echt e-mailadres? ${m}`).toMatch(/\.example$/);
    const telefoons = tekst.match(/(?:\+31[\s-]?|\b0)6[\s-]?(?:\d[\s-]?){7}\d\b/g) ?? [];
    for (const t of telefoons) expect(t.replace(/\D/g, '').replace(/^31/, '0'), `echt nummer? ${t}`).toMatch(/^060000\d{4}$/);
  });

  it('een perfecte agent haalt score 1 en alle kritieke gevallen (verwachting en controles passen bij elkaar)', async () => {
    const zet = (doel: Record<string, unknown>, pad: string, waarde: unknown) => {
      const delen = pad.split('.');
      let plek = doel;
      for (const d of delen.slice(0, -1)) {
        if (typeof plek[d] !== 'object' || plek[d] === null) plek[d] = {};
        plek = plek[d] as Record<string, unknown>;
      }
      plek[delen.at(-1) as string] = waarde;
    };
    const voeg = (doel: Record<string, unknown>, bron: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(bron)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if (typeof doel[k] !== 'object' || doel[k] === null) doel[k] = {};
          voeg(doel[k] as Record<string, unknown>, v as Record<string, unknown>);
        } else doel[k] = v;
      }
    };
    const perfect = (_invoer: unknown, g: EvalGeval) => {
      const uit: Record<string, unknown> = {};
      for (const c of g.controles) {
        if (c.soort === 'veld') {
          if (c.pad) zet(uit, c.pad, {});
          voeg(c.pad ? (haalPad(uit, c.pad) as Record<string, unknown>) : uit, c.verwacht);
        }
      }
      for (const c of g.controles) {
        if (c.soort === 'exact') {
          if (c.pad) zet(uit, c.pad, c.verwacht);
          else return c.verwacht;
        }
        if (c.soort === 'rechter') zet(uit, c.pad, 'Een concepttekst.');
      }
      return uit;
    };
    const rapport = await draaiEval(gevallen, { intake: perfect, router: perfect }, { rechter: rechterDieAltijd('ja') });
    expect(rapport.gevallen.filter((g) => !g.altijd_geslaagd).map((g) => `${g.id}: ${g.pogingen[0].fouten.join('; ')}`)).toEqual([]);
    expect(rapport.score).toBe(1);
    expect(rapport.kritiek_ok).toBe(true);
  });

  it('de invoer van elk datageval is te laden uit data/bureau-vonk', () => {
    const formulieren = new Set(laadFormulieren().map((f) => f.bestand));
    for (const g of gevallen) {
      const b = bestand(g);
      if (!b) continue;
      if (g.agent === 'intake') expect(formulieren.has(b), `${g.id}: ${b} bestaat niet`).toBe(true);
      else expect(() => leesMail(b), `${g.id}: ${b} bestaat niet`).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
describe('oefening 9.2 · dekking', () => {
  // De 24 datagevallen, opgebouwd uit de data zelf (zoals maakDatagevallen.ts in les 9.2).
  const datagevallen = (): EvalGeval[] => [
    ...laadFormulierVerwachtingen().map((v): EvalGeval => ({
      id: `intake-${v.bestand.slice(0, 2)}`,
      agent: 'intake',
      invoer: { bestand: v.bestand },
      controles: [{ soort: 'veld', verwacht: { soort: v.soort, volgende_stap: v.volgende_stap } }],
      bron: 'data',
      toelichting: v.toelichting,
    })),
    ...laadMailLabels().map((l): EvalGeval => ({
      id: `router-${l.bestand.slice(0, 2)}`,
      agent: 'router',
      invoer: { bestand: l.bestand },
      controles: [{ soort: 'veld', verwacht: { categorie: l.categorie, urgentie: l.urgentie } }],
      bron: 'data',
      toelichting: l.toelichting,
    })),
  ];

  it('telt per agent, per categorie (router) en per soort (intake)', () => {
    const d = dekking(datagevallen());
    expect(d.totaal).toBe(24);
    expect(d.per_agent).toEqual({ intake: 10, router: 14 });
    expect(d.per_categorie).toMatchObject({ klacht: 3, spam: 2, nieuwe_lead: 2, factuur: 1 });
    expect(Object.values(d.per_categorie).reduce((a, b) => a + b, 0)).toBe(14);
    expect(d.per_soort).toMatchObject({ lead: 6, spam: 1, sollicitatie: 1, dubbele_lead: 1, bestaande_klant: 1 });
    expect(d.zonder_label).toEqual([]);
  });

  it('telt de vlaggen, en een geval zonder label staat apart', () => {
    const d = dekking([
      geval('router-e03', { controles: [{ soort: 'veld', verwacht: { verdacht: true } }], kritiek: true, aanval: true }),
      geval('router-e04', { controles: [{ soort: 'veld', verwacht: { categorie: 'vraag' } }], aanval: true, apart: true }),
      geval('intake-e03', { agent: 'intake', controles: [{ soort: 'exact', pad: 'concept', verwacht: null }, { soort: 'veld', verwacht: { soort: 'spam' } }], apart: true }),
    ]);
    expect(d).toMatchObject({ totaal: 3, kritiek: 1, apart: 2, aanval: 2, per_categorie: { vraag: 1 }, per_soort: { spam: 1 } });
    expect(d.zonder_label).toEqual(['router-e03']);
  });
});

// ---------------------------------------------------------------------------
describe('vergelijk', () => {
  it('haalPad leest geneste velden en geeft undefined bij een ontbrekend pad', () => {
    const uit = { concept: { taal: 'en', tekst: 'Hi Hannah' }, soort: 'lead' };
    expect(haalPad(uit, 'concept.taal')).toBe('en');
    expect(haalPad(uit)).toBe(uit);
    expect(haalPad(uit, 'concept.onderwerp')).toBeUndefined();
    expect(haalPad(null, 'a.b')).toBeUndefined();
  });

  it('vergelijkExact: precies gelijk, ook de volgorde van lijsten', () => {
    expect(vergelijkExact({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toEqual([]);
    expect(vergelijkExact(['T03', 'T01'], ['T01', 'T03'], 'ook_melden_aan')).toEqual([
      { pad: 'ook_melden_aan', verwacht: ['T03', 'T01'], gekregen: ['T01', 'T03'] },
    ]);
    expect(vergelijkExact(null, undefined, 'concept')).toHaveLength(1);
    expect(vergelijkExact('klacht', 'Klacht')[0].pad).toBe('(geheel)');
  });

  it('vergelijkVeld: alleen de verwachte velden tellen, extra velden en de volgorde in lijsten niet', () => {
    const gekregen = { soort: 'lead', ontbreekt: ['website', 'bedrijf'], reden: 'iets', score: 0.4 };
    expect(vergelijkVeld({ soort: 'lead', ontbreekt: ['bedrijf', 'website'] }, gekregen)).toEqual([]);
    expect(vergelijkVeld({ ontbreekt: ['bedrijf'] }, gekregen)).toEqual([{ pad: 'ontbreekt', verwacht: ['bedrijf'], gekregen: ['website', 'bedrijf'] }]);
  });

  it('vergelijkVeld: genest, met het volledige pad in elk verschil; een ontbrekend veld is niet null', () => {
    const verwacht = { routering: { toegewezen_aan: 'T02', ook_melden_aan: ['T03', 'T01'] }, klant_id: null };
    const gekregen = { routering: { toegewezen_aan: 'T03', ook_melden_aan: ['T01', 'T03'], extra: true } };
    expect(vergelijkVeld(verwacht, gekregen)).toEqual([
      { pad: 'routering.toegewezen_aan', verwacht: 'T02', gekregen: 'T03' },
      { pad: 'klant_id', verwacht: null, gekregen: undefined },
    ]);
    expect(vergelijkVeld({ concept: { taal: 'en' } }, { concept: null })).toEqual([{ pad: 'concept', verwacht: { taal: 'en' }, gekregen: null }]);
  });

  it('controleerUitvoer: alle controles van een geval moeten slagen; fouten zijn leesbaar', async () => {
    const g = geval('intake-x', {
      agent: 'intake',
      controles: [
        { soort: 'veld', verwacht: { soort: 'lead', concept: { taal: 'en' } } },
        { soort: 'exact', pad: 'budget_eur', verwacht: 5000 },
      ],
    });
    const goed = await controleerUitvoer(g, { soort: 'lead', budget_eur: 5000, concept: { taal: 'en', tekst: 'Hi' } });
    expect(goed).toEqual({ geslaagd: true, fouten: [], mens_nodig: false });
    const fout = await controleerUitvoer(g, { soort: 'lead', budget_eur: 5000, concept: { taal: 'nl', tekst: 'Hoi' } });
    expect(fout.geslaagd).toBe(false);
    expect(fout.fouten).toEqual(['concept.taal: verwacht "en", kreeg "nl"']);
    const leeg = await controleerUitvoer({ ...g, controles: [] }, {});
    expect(leeg.geslaagd).toBe(false);
    const onbekend = await controleerUitvoer({ ...g, controles: [{ soort: 'ongeveer' } as unknown as Controle] }, {});
    expect(onbekend.geslaagd).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('draaiEval', () => {
  it('draait elk geval in volgorde; een crash telt als fout en stopt de eval niet', async () => {
    const set = [geval('a'), geval('b'), geval('c')];
    const agent = vi.fn(async (invoer: unknown) => {
      if ((invoer as { id: string }).id === 'b') throw new Error('Nep-API (529): overloaded');
      return { categorie: 'klacht' };
    });
    const r = await draaiEval(set, { router: agent });
    expect(agent.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['a', 'b', 'c']);
    expect(r.score).toBeCloseTo(2 / 3, 10);
    expect(r.gevallen[1].pogingen[0].fouten[0]).toContain('overloaded');
    expect(r.gevallen.map((g) => g.altijd_geslaagd)).toEqual([true, false, true]);
  });

  it('score per agent, apart gehouden gevallen apart, en een ontbrekende agent is een fout geval', async () => {
    const set = [
      geval('r1'),
      geval('r2'),
      geval('i1', { agent: 'intake' }),
      geval('r3', { apart: true }),
      geval('r4', { apart: true }),
    ];
    const r = await draaiEval(set, { router: (i) => ({ categorie: (i as { id: string }).id === 'r4' ? 'vraag' : 'klacht' }) });
    expect(r.per_agent.router).toEqual({ totaal: 2, score: 1, altijd: 1 });
    expect(r.per_agent.intake).toEqual({ totaal: 1, score: 0, altijd: 0 });
    expect(r.score).toBeCloseTo(2 / 3, 10);
    expect(r.apart).toEqual({ totaal: 2, score: 0.5, altijd: 0.5 });
    expect(r.gevallen.find((g) => g.id === 'i1')?.pogingen[0].fouten[0]).toMatch(/geen agent/);
  });

  it('herhalingen: score is de gemiddelde slagingskans, altijd_geslaagd is pass^k', async () => {
    const set = [geval('wankel', { kritiek: true }), geval('stabiel')];
    let poging = 0;
    const agent = (i: unknown) => {
      if ((i as { id: string }).id === 'stabiel') return { categorie: 'klacht' };
      poging += 1;
      return { categorie: poging === 2 ? 'vraag' : 'klacht' };
    };
    const r = await draaiEval(set, { router: agent }, { herhalingen: 3, testset_versie: 7 });
    expect(r.herhalingen).toBe(3);
    expect(r.testset_versie).toBe(7);
    expect(r.gevallen[0]).toMatchObject({ geslaagde_pogingen: 2, altijd_geslaagd: false, kritiek: true });
    expect(r.score).toBeCloseTo((2 / 3 + 1) / 2, 10);
    expect(r.altijd_geslaagd).toBe(0.5);
    expect(r.kritiek_ok).toBe(false);
    expect(r.kritiek_fout).toEqual(['wankel']);
  });

  it('laadInvoer zet { bestand } om in de echte mail; de agent krijgt ook het geval', async () => {
    const set = [geval('router-07', { invoer: { bestand: '07-klacht-verkeerde-prijs-groenwerk.txt' }, controles: [{ soort: 'exact', pad: 'categorie', verwacht: 'klacht' }] })];
    const gezien: string[] = [];
    const r = await draaiEval(
      set,
      {
        router: (invoer, g) => {
          gezien.push(`${g.id}:${(invoer as { onderwerp: string }).onderwerp}`);
          return { categorie: 'klacht' };
        },
      },
      { laadInvoer: (g) => leesMail(g.invoer.bestand as string) },
    );
    expect(gezien).toEqual(['router-07:DRINGEND: verkeerde prijs in advertentie loungeset']);
    expect(r.score).toBe(1);
  });

  it('rechter-controle: alleen "ja" slaagt; "onbekend" vraagt om een mens; zonder rechter faalt het geval', async () => {
    const g = geval('intake-02', {
      agent: 'intake',
      controles: [{ soort: 'rechter', pad: 'concept.tekst', criteria: ['Vraagt naar het budget.'] }],
    });
    const uit = () => ({ concept: { tekst: 'Hoi Bram, welk budget heb je in gedachten?' } });
    expect((await draaiEval([g], { intake: uit }, { rechter: rechterDieAltijd('ja') })).score).toBe(1);
    const onzeker = await draaiEval([g], { intake: uit }, { rechter: rechterDieAltijd('onbekend') });
    expect(onzeker.score).toBe(0);
    expect(onzeker.gevallen[0].mens_nodig).toBe(true);
    const zonder = await draaiEval([g], { intake: uit });
    expect(zonder.gevallen[0].pogingen[0].fouten[0]).toMatch(/geen rechter/);
    const kapot: Rechter = { beoordeel: async () => Promise.reject(new Error('rate_limit_error')) };
    const r = await draaiEval([g], { intake: uit }, { rechter: kapot });
    expect(r.gevallen[0]).toMatchObject({ altijd_geslaagd: false, mens_nodig: true });
  });

  it('een lege testset geeft score 0', async () => {
    const r = await draaiEval([], {});
    expect(r.score).toBe(0);
    expect(r.gevallen).toEqual([]);
    expect(r.kritiek_ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
function rapportMet(uitslagen: Array<{ id: string; ok: boolean; apart?: boolean; kritiek?: boolean }>, versie: number | null = 1): EvalRapport {
  const gevallen = uitslagen.map((u) => ({
    id: u.id,
    agent: 'router' as const,
    kritiek: u.kritiek === true,
    apart: u.apart === true,
    pogingen: [{ geslaagd: u.ok, fouten: u.ok ? [] : ['categorie: verwacht "klacht", kreeg "vraag"'], mens_nodig: false }],
    geslaagde_pogingen: u.ok ? 1 : 0,
    altijd_geslaagd: u.ok,
    mens_nodig: false,
  }));
  const werk = gevallen.filter((g) => !g.apart);
  const apart = gevallen.filter((g) => g.apart);
  const s = (l: typeof gevallen) => (l.length === 0 ? 0 : l.filter((g) => g.altijd_geslaagd).length / l.length);
  return {
    testset_versie: versie,
    herhalingen: 1,
    score: s(werk),
    altijd_geslaagd: s(werk),
    per_agent: { intake: { totaal: 0, score: 0, altijd: 0 }, router: { totaal: werk.length, score: s(werk), altijd: s(werk) } },
    apart: { totaal: apart.length, score: s(apart), altijd: s(apart) },
    kritiek_ok: gevallen.every((g) => !g.kritiek || g.altijd_geslaagd),
    kritiek_fout: gevallen.filter((g) => g.kritiek && !g.altijd_geslaagd).map((g) => g.id),
    gevallen,
  };
}

describe('regressie', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `g${String(i + 1).padStart(2, '0')}`);
  const basisRapport = rapportMet(ids.map((id, i) => ({ id, ok: i < 18 })));
  // Per test opnieuw berekend, zodat de andere testgroepen los kunnen slagen.
  const maak = () => maakBasislijn(basisRapport, { datum: '2026-11-02', instructies: { router: 'router-v2', intake: 'intake-v3' } });
  const drempels = { max_daling: 0.03, min_score: 0.8 };

  it('maakBasislijn legt score, versies en de altijd geslaagde gevallen vast', () => {
    expect(maak()).toEqual({
      testset_versie: 1,
      instructies: { router: 'router-v2', intake: 'intake-v3' },
      datum: '2026-11-02',
      herhalingen: 1,
      score: 0.9,
      altijd_geslaagd: ids.slice(0, 18),
    });
  });

  it('groen als niets omvalt; een nieuw geslaagd geval staat bij verbeterd', () => {
    const basislijn = maak();
    const besluit = beoordeelTegenBasislijn(rapportMet(ids.map((id, i) => ({ id, ok: i < 19 }))), basislijn, drempels);
    expect(besluit).toMatchObject({ groen: true, redenen: [], regressies: [], verbeterd: ['g19'] });
  });

  it('rood bij één regressie, ook als de score gelijk blijft', () => {
    const basislijn = maak();
    // g01 valt om, g19 gaat goed: score blijft 0,9.
    const r = rapportMet(ids.map((id, i) => ({ id, ok: (i < 19 && i !== 0) })));
    const besluit = beoordeelTegenBasislijn(r, basislijn, drempels);
    expect(r.score).toBeCloseTo(0.9, 10);
    expect(besluit.groen).toBe(false);
    expect(besluit.regressies).toEqual(['g01']);
  });

  it('rood bij een kritiek geval dat faalt, en bij een score onder de drempels', () => {
    const basislijn = maak();
    const kritiek = rapportMet(ids.map((id, i) => ({ id, ok: i < 18, kritiek: i === 19 })));
    expect(beoordeelTegenBasislijn(kritiek, basislijn, drempels).redenen.join(' ')).toContain('g20');
    const laag = beoordeelTegenBasislijn(basisRapport, { ...basislijn, score: 0.95 }, drempels);
    expect(laag.groen).toBe(false);
    expect(laag.redenen.join(' ')).toMatch(/basislijn/);
    const onderMinimum = beoordeelTegenBasislijn(basisRapport, basislijn, { max_daling: 0.03, min_score: 0.95 });
    expect(onderMinimum.groen).toBe(false);
  });

  it('een andere testsetversie: de score wordt niet vergeleken, regressies per geval wel', () => {
    const basislijn = maak();
    const r = rapportMet([...ids.map((id, i) => ({ id, ok: i < 18 })), { id: 'g21', ok: false }, { id: 'g22', ok: false }], 2);
    const besluit = beoordeelTegenBasislijn(r, basislijn, drempels);
    expect(besluit.groen).toBe(true);
    expect(besluit.waarschuwingen.join(' ')).toMatch(/versie 2/);
    const verdwenen = beoordeelTegenBasislijn(rapportMet(ids.slice(1).map((id, i) => ({ id, ok: i < 17 }))), basislijn, drempels);
    expect(verdwenen.waarschuwingen.join(' ')).toContain('g01');
  });

  it('ciSamenvatting: markdown met de uitslag, de redenen en de gefaalde gevallen', () => {
    const basislijn = maak();
    const r = rapportMet(ids.map((id, i) => ({ id, ok: i !== 0 && i < 18 })));
    const tekst = ciSamenvatting(r, beoordeelTegenBasislijn(r, basislijn, drempels));
    expect(tekst).toContain('ROOD');
    expect(tekst).toContain('g01');
    expect(tekst).toContain('| Werkset |');
  });
});

// ---------------------------------------------------------------------------
describe('versies', () => {
  const v = (versie: string, velden: Partial<InstructieVersie> = {}): InstructieVersie => {
    const basis = { agent: 'router', versie, model: 'claude-haiku-5-5', instructie: 'Deel de mail in.', wijziging: 'eerste versie', ...velden };
    return { ...basis, vingerafdruk: vingerafdruk(basis), ...('vingerafdruk' in velden ? { vingerafdruk: velden.vingerafdruk as string } : {}) };
  };

  it('vingerafdruk: verandert bij model, effort, instructie of schema; niet bij de volgorde van sleutels', () => {
    const a = vingerafdruk({ model: 'claude-haiku-5-5', instructie: 'x', schema: { type: 'object', properties: { a: { type: 'string' } } } });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(vingerafdruk({ instructie: 'x', model: 'claude-haiku-5-5', schema: { properties: { a: { type: 'string' } }, type: 'object' } })).toBe(a);
    expect(vingerafdruk({ model: 'claude-sonnet-5-5', instructie: 'x', schema: { type: 'object', properties: { a: { type: 'string' } } } })).not.toBe(a);
    expect(vingerafdruk({ model: 'claude-haiku-5-5', instructie: 'x ', schema: { type: 'object', properties: { a: { type: 'string' } } } })).not.toBe(a);
    expect(vingerafdruk({ model: 'claude-haiku-5-5', instructie: 'x', effort: 'low', schema: { type: 'object', properties: { a: { type: 'string' } } } })).not.toBe(a);
  });

  it('controleerVersies vindt een versie die na vastleggen is gewijzigd, dubbele namen en een lege wijziging', () => {
    const goed = v('router-v1');
    const stiekem = { ...v('router-v2'), instructie: 'Deel de mail in. Klachten altijd naar Daan.' };
    const problemen = controleerVersies([goed, stiekem, v('router-v1'), v('router-v3', { wijziging: ' ' })]);
    expect(problemen.some((p) => p.includes('router-v2') && /gewijzigd/.test(p))).toBe(true);
    expect(problemen.some((p) => p.includes('router-v1') && /twee keer/.test(p))).toBe(true);
    expect(problemen.some((p) => p.includes('router-v3') && /wijziging/.test(p))).toBe(true);
    expect(controleerVersies([goed])).toEqual([]);
  });

  it('actieveVersie: de rij uit actieve_instructie bepaalt de versie; terugdraaien is één rij aanpassen', () => {
    const versies = [v('router-v1'), v('router-v2', { instructie: 'Nieuw' })];
    expect(actieveVersie(versies, [{ agent: 'router', versie: 'router-v2' }], 'router').instructie).toBe('Nieuw');
    expect(actieveVersie(versies, [{ agent: 'router', versie: 'router-v1' }], 'router').versie).toBe('router-v1');
    expect(() => actieveVersie(versies, [], 'router')).toThrow(/router/);
    expect(() => actieveVersie(versies, [{ agent: 'router', versie: 'router-v9' }], 'router')).toThrow(/router-v9/);
  });

  it('promotieBesluit: promoveren als alles klopt', () => {
    const huidig = { versie: v('router-v2'), rapport: { ...rapportMet([{ id: 'a', ok: true }, { id: 'b', ok: false }, { id: 'c', ok: true, apart: true }]), herhalingen: 3 }, kosten_eur_per_geval: 0.0003 };
    const kandidaat = { versie: v('router-v3', { instructie: 'Beter' }), rapport: { ...rapportMet([{ id: 'a', ok: true }, { id: 'b', ok: true }, { id: 'c', ok: true, apart: true }]), herhalingen: 3 }, kosten_eur_per_geval: 0.00032 };
    expect(promotieBesluit(kandidaat, huidig, { min_herhalingen: 3, max_kostenstijging_pct: 20, max_daling_apart: 0.05 })).toEqual({ promoveren: true, redenen: [] });
  });

  it('promotieBesluit: niet promoveren bij regressie, kritiek, te weinig runs, overfitting, kosten of geen echte nieuwe versie', () => {
    const regel = { min_herhalingen: 3, max_kostenstijging_pct: 20, max_daling_apart: 0.05 };
    const huidig = {
      versie: v('router-v2'),
      rapport: { ...rapportMet([{ id: 'a', ok: true }, { id: 'b', ok: false }, { id: 'c', ok: true, apart: true }, { id: 'd', ok: true, apart: true }]), herhalingen: 3 },
      kosten_eur_per_geval: 0.0003,
    };
    const kandidaat = {
      versie: v('router-v3', { model: 'claude-sonnet-5-5' }),
      rapport: { ...rapportMet([{ id: 'a', ok: false }, { id: 'b', ok: true, kritiek: true }, { id: 'k', ok: false, kritiek: true }, { id: 'c', ok: true, apart: true }, { id: 'd', ok: false, apart: true }]), herhalingen: 1 },
      kosten_eur_per_geval: 0.006,
    };
    const besluit = promotieBesluit(kandidaat, huidig, regel);
    const alles = besluit.redenen.join(' | ');
    expect(besluit.promoveren).toBe(false);
    expect(alles).toMatch(/herhalingen/);
    expect(alles).toMatch(/kritiek/);
    expect(alles).toMatch(/regressie: a/);
    expect(alles).toMatch(/apart/);
    expect(alles).toMatch(/kosten/);
    const zelfde = promotieBesluit({ ...huidig, versie: { ...huidig.versie, versie: 'router-v3' } }, huidig, regel);
    expect(zelfde.redenen.join(' ')).toMatch(/geen nieuwe versie/);
  });
});

// ---------------------------------------------------------------------------
describe('rechter', () => {
  const criteria = ['Het concept is in het Engels geschreven.', 'Het concept noemt geen korting.'];

  it('één aanroep met gestructureerde output, zonder temperature; tekst als materiaal tussen tags', async () => {
    const client = maakNepClient([
      jsonAntwoord({
        per_criterium: [
          { criterium: criteria[0], toelichting: '"Thanks for reaching out"', oordeel: 'ja' },
          { criterium: criteria[1], toelichting: 'Geen korting genoemd.', oordeel: 'ja' },
        ],
      }),
    ]);
    const oordeel = await maakRechter(client).beoordeel('Hi Hannah, thanks for reaching out. Shall we plan a call?', criteria);
    expect(oordeel).toMatchObject({ geslaagd: true, onzeker: false });
    expect(client.aantalAanroepen).toBe(1);
    const p = client.laatsteAanroep as unknown as Record<string, unknown>;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect((p.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(userTekst(client.laatsteAanroep)).toContain('<tekst>');
    expect(userTekst(client.laatsteAanroep)).toContain(criteria[1]);
    expect(systemTekst(client.laatsteAanroep)).toMatch(/onbekend/);
  });

  it('"nee" laat het geval zakken; "onbekend" maakt het onzeker; de criteria worden op volgorde gekoppeld', async () => {
    const client = maakNepClient([
      jsonAntwoord({ per_criterium: [{ criterium: 'iets anders', toelichting: 'Nederlands', oordeel: 'nee' }] }),
    ]);
    const oordeel = await maakRechter(client).beoordeel('Hoi Hannah', criteria);
    expect(oordeel.geslaagd).toBe(false);
    expect(oordeel.onzeker).toBe(true);
    expect(oordeel.per_criterium.map((o) => [o.criterium, o.oordeel])).toEqual([
      [criteria[0], 'nee'],
      [criteria[1], 'onbekend'],
    ]);
  });

  it('bij refusal, max_tokens of kapotte JSON: alles onbekend, nooit geslaagd', async () => {
    for (const antwoord of [jsonAntwoord({ per_criterium: [] }, 'refusal'), tekstAntwoord('{"per_criterium": [', 'max_tokens'), tekstAntwoord('Prima tekst!')]) {
      const oordeel = await maakRechter(maakNepClient([antwoord])).beoordeel('tekst', criteria);
      expect(oordeel.geslaagd).toBe(false);
      expect(oordeel.onzeker).toBe(true);
      expect(oordeel.per_criterium.every((o) => o.oordeel === 'onbekend')).toBe(true);
    }
  });

  it('kalibreerRechter: bruikbaar pas bij genoeg paren, 90% overeenstemming en weinig valse goedkeuringen', () => {
    const paren = (gelijk: number, valsGeslaagd: number, valsGezakt: number) => [
      ...Array.from({ length: gelijk }, (_, i) => ({ rechter: i % 2 === 0, mens: i % 2 === 0 })),
      ...Array.from({ length: valsGeslaagd }, () => ({ rechter: true, mens: false })),
      ...Array.from({ length: valsGezakt }, () => ({ rechter: false, mens: true })),
    ];
    expect(kalibreerRechter(paren(19, 1, 0))).toMatchObject({ n: 20, overeenstemming: 0.95, vals_geslaagd: 0.05, bruikbaar: true });
    expect(kalibreerRechter(paren(18, 2, 0)).bruikbaar).toBe(false);
    expect(kalibreerRechter(paren(17, 0, 3)).redenen.join(' ')).toMatch(/overeenstemming/);
    expect(kalibreerRechter(paren(10, 0, 0)).redenen.join(' ')).toMatch(/te weinig/);
  });
});

// ---------------------------------------------------------------------------
describe('verbeterronde', () => {
  const correctie = (velden: Partial<Correctie>): Correctie => ({
    run_id: 'run-77',
    agent: 'router',
    invoer: { mail: { van: 'Ilse <ilse@bakkerijkorrel.example>', onderwerp: 'kerstbestellingen', tekst: 'Kan de kerstadvertentie vanaf 1 december aan?' } },
    uitvoer: { categorie: 'vraag', urgentie: 'normaal', toegewezen_aan: 'T02', klant_id: 'K06' },
    gecorrigeerd: { categorie: 'wijzigingsverzoek', urgentie: 'normaal', toegewezen_aan: 'T03', klant_id: 'K06' },
    door: 'T02',
    op: '2026-10-30',
    oorzaak: 'instructie_onduidelijk',
    notitie: 'Campagne aanzetten is werk voor Noor.',
    ...velden,
  });

  it('nieuweGevallen: alleen de gewijzigde velden worden de verwachting; id’s lopen door', () => {
    const bestaand = [geval('router-a01', { invoer: { mail: { onderwerp: 'oud' } } })];
    const { nieuw, overgeslagen } = nieuweGevallen([correctie({})], bestaand);
    expect(overgeslagen).toEqual([]);
    expect(nieuw).toHaveLength(1);
    expect(nieuw[0]).toMatchObject({
      id: 'router-a02',
      agent: 'router',
      bron: 'afwijzing',
      controles: [{ soort: 'veld', verwacht: { categorie: 'wijzigingsverzoek', toegewezen_aan: 'T03' } }],
    });
    expect(nieuw[0].toelichting).toContain('run-77');
  });

  it('nieuweGevallen: geen dubbele invoer, geen geval zonder wijziging en geen geval bij een andere verwachting', () => {
    const c = correctie({});
    const bestaand = [geval('router-01', { invoer: c.invoer })];
    expect(nieuweGevallen([c], bestaand).overgeslagen[0].reden).toMatch(/al in de testset/);
    const tweeKeer = nieuweGevallen([c, { ...c, run_id: 'run-78' }], []);
    expect(tweeKeer.nieuw.map((g) => g.id)).toEqual(['router-a01']);
    expect(tweeKeer.overgeslagen.map((o) => o.run_id)).toEqual(['run-78']);
    const niets = nieuweGevallen([correctie({ gecorrigeerd: correctie({}).uitvoer })], []);
    expect(niets.nieuw).toEqual([]);
    const anders = nieuweGevallen([correctie({ oorzaak: 'verwachting_anders' })], []);
    expect(anders.nieuw).toEqual([]);
    expect(anders.overgeslagen[0].reden).toMatch(/afspraak/);
  });

  it('verbeterronde: telt oorzaken, stelt één wijziging voor en toont nooit de aparte gevallen', () => {
    const rapport = rapportMet([
      { id: 'router-02', ok: false },
      { id: 'router-05', ok: true },
      { id: 'router-09', ok: false, apart: true },
    ]);
    const overzicht = verbeterronde(rapport, [
      correctie({}),
      correctie({ run_id: 'r2' }),
      correctie({ run_id: 'r3', oorzaak: 'tool_fout' }),
    ]);
    expect(overzicht.per_oorzaak).toEqual({ instructie_onduidelijk: 2, informatie_ontbrak: 0, tool_fout: 1, modelfout: 0, verwachting_anders: 0 });
    expect(overzicht.meest).toBe('instructie_onduidelijk');
    expect(overzicht.voorstel).toMatch(/één/);
    expect(overzicht.falende_gevallen).toEqual(['router-02']);
    expect(verbeterronde(rapport, [correctie({ oorzaak: 'tool_fout' })]).voorstel).toMatch(/code/);
    expect(verbeterronde(rapport, []).meest).toBeNull();
  });
});

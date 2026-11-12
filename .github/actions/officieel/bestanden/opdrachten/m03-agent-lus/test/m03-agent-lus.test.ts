import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  GeheugenOpslag,
  VOORSTEL_SYSTEEM,
  bedragenIn,
  controleerPrijsregels,
  controleerStrictLimieten,
  controleerToelichting,
  draaiAgentLus,
  enumZonderHoofdletters,
  maakVoorstelTools,
  naarApiTool,
  stelVoorstelOp,
  strictSchemaUitZod,
  toolChoiceVoor,
  zodFoutTekst,
  type Tool,
  type VoorstelBerekening,
  type VoorstelContext,
} from '@opdracht/m03-agent-lus';
import {
  maakNepClient,
  meerdereToolsAntwoord,
  tekstAntwoord,
  toolAntwoord,
  toolResultatenIn,
  userTekst,
  type NepAntwoord,
} from '../../../test-hulp/nepClient';
import { bronMap } from '../../../test-hulp/bron';
import { REFERENTIEDATUM, laadLeads, laadPakketten } from '../../../test-hulp/vonkData';

// --- hulpjes ------------------------------------------------------------------------------

/** Een eenvoudige testtool die bijhoudt waarmee hij werd aangeroepen. */
function testTool(naam: string, uitvoeren: (input: unknown) => Promise<unknown>): Tool {
  return {
    definitie: {
      naam,
      beschrijving: `Testtool ${naam}. Doet iets voor de test. Gebruik hem niet buiten tests.`,
      input_schema: {
        type: 'object',
        properties: { waarde: { type: 'string' } },
        required: ['waarde'],
        additionalProperties: false,
      },
    },
    uitvoeren: vi.fn(uitvoeren),
  };
}

function context(): VoorstelContext & { opslag: GeheugenOpslag } {
  return { leads: laadLeads(), pakketten: laadPakketten(), opslag: new GeheugenOpslag(), nu: REFERENTIEDATUM };
}

function toolUit(tools: Tool[], naam: string): Tool {
  const tool = tools.find((t) => t.definitie.naam === naam);
  if (!tool) throw new Error(`Tool ${naam} ontbreekt in maakVoorstelTools`);
  return tool;
}

async function bereken(tools: Tool[], invoer: Record<string, unknown>): Promise<VoorstelBerekening> {
  return alsWaarde<VoorstelBerekening>(await toolUit(tools, 'voorstel_bereken_prijs').uitvoeren(invoer));
}

/** Een tool mag een object of JSON-tekst teruggeven; de test leest allebei. */
function alsWaarde<T>(waarde: unknown): T {
  return (typeof waarde === 'string' ? JSON.parse(waarde) : waarde) as T;
}

function alsObject(waarde: unknown): Record<string, unknown> {
  return alsWaarde<Record<string, unknown>>(waarde);
}

/** Loopt door een JSON-schema en geeft elk subschema terug. */
function alleKnopen(schema: unknown, pad = 'schema'): Array<{ pad: string; knoop: Record<string, unknown> }> {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema)) return schema.flatMap((s, i) => alleKnopen(s, `${pad}[${i}]`));
  const knoop = schema as Record<string, unknown>;
  const uit = [{ pad, knoop }];
  for (const [k, v] of Object.entries(knoop)) {
    if (k === 'properties' && v && typeof v === 'object') {
      for (const [naam, sub] of Object.entries(v)) uit.push(...alleKnopen(sub, `${pad}.properties.${naam}`));
    } else if (['items', 'anyOf', 'oneOf', 'allOf'].includes(k)) {
      uit.push(...alleKnopen(v, `${pad}.${k}`));
    }
  }
  return uit;
}

const ONGELDIG_IN_STRICT = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems'];

const NAMEN = ['voorstel_lees_lead', 'voorstel_lees_prijslijst', 'voorstel_bereken_prijs', 'voorstel_maak_concept'];

// --- 3.1 ----------------------------------------------------------------------------------

describe('3.1 tools ontwerpen', () => {
  it('naarApiTool zet de definitie om naar name/description/input_schema, standaard met strict: true', () => {
    const tool = testTool('demo_zoek', async () => 'ok');
    const api = naarApiTool(tool);
    expect(api).toEqual({
      name: 'demo_zoek',
      description: tool.definitie.beschrijving,
      input_schema: tool.definitie.input_schema,
      strict: true,
    });
    expect(naarApiTool(tool, { strict: false })).not.toHaveProperty('strict');
    for (const sleutel of ['naam', 'beschrijving', 'definitie', 'uitvoeren']) expect(api).not.toHaveProperty(sleutel);
  });

  it('maakVoorstelTools geeft precies vier tools met het voorvoegsel voorstel_', () => {
    const tools = maakVoorstelTools(context());
    expect(tools.map((t) => t.definitie.naam)).toEqual(NAMEN);
    for (const tool of tools) {
      expect(tool.definitie.input_schema.type).toBe('object');
      expect(typeof tool.uitvoeren).toBe('function');
    }
  });

  it('elke beschrijving heeft minstens drie zinnen en zegt wanneer je de tool niet gebruikt', () => {
    for (const tool of maakVoorstelTools(context())) {
      const zinnen = tool.definitie.beschrijving.split(/[.!?](?:\s|$)/).filter((zin) => zin.trim().length > 3);
      expect(zinnen.length, `${tool.definitie.naam}: ${zinnen.length} zinnen`).toBeGreaterThanOrEqual(3);
      expect(tool.definitie.beschrijving, `${tool.definitie.naam} zegt niet wanneer niet`).toMatch(/\bniet\b|\bnooit\b/i);
    }
  });

  it('voorstel_lees_lead geeft wat een voorstel nodig heeft, maar geen e-mail of telefoonnummer', async () => {
    const lees = toolUit(maakVoorstelTools(context()), 'voorstel_lees_lead');
    const lead = alsObject(await lees.uitvoeren({ lead_id: 'L006' }));
    expect(lead).toMatchObject({
      id: 'L006',
      bedrijf: 'Snuffel Diervoeding',
      status: 'gekwalificeerd',
      budget_indicatie_eur: 4000,
      kanalen_interesse: ['meta', 'google'],
    });
    const tekst = JSON.stringify(lead);
    expect(tekst).not.toContain('@');
    expect(tekst).not.toMatch(/06-0000/);
    expect(lead).not.toHaveProperty('email');
    expect(lead).not.toHaveProperty('telefoon');
  });

  it('voorstel_lees_lead zet de afgeleide aandachtspunten erbij (status, budget onbekend, budget te laag)', async () => {
    const lees = toolUit(maakVoorstelTools(context()), 'voorstel_lees_lead');
    const l001 = JSON.stringify(alsObject(await lees.uitvoeren({ lead_id: 'L001' })).aandachtspunten);
    expect(l001).toMatch(/nieuw/);
    const l003 = JSON.stringify(alsObject(await lees.uitvoeren({ lead_id: 'L003' })).aandachtspunten);
    expect(l003).toMatch(/onbekend/i);
    const l005 = JSON.stringify(alsObject(await lees.uitvoeren({ lead_id: 'L005' })).aandachtspunten);
    expect(l005).toMatch(/500/);
    expect(l005).toMatch(/audit/i);
    const l006 = alsObject(await lees.uitvoeren({ lead_id: 'L006' })).aandachtspunten;
    expect(l006).toEqual([]);
  });

  it('een onbekende lead geeft een fout die zegt welke ids wel bestaan', async () => {
    const lees = toolUit(maakVoorstelTools(context()), 'voorstel_lees_lead');
    await expect(Promise.resolve().then(() => lees.uitvoeren({ lead_id: 'L099' }))).rejects.toThrow(/L001.*L024/);
  });

  it('voorstel_lees_prijslijst geeft per onderdeel alleen dat onderdeel', async () => {
    const prijslijst = toolUit(maakVoorstelTools(context()), 'voorstel_lees_prijslijst');
    const pakketten = alsWaarde<Array<Record<string, unknown>>>(await prijslijst.uitvoeren({ onderdeel: 'pakketten' }));
    expect(pakketten.map((p) => [p.code, p.prijs_per_maand_eur])).toEqual([
      ['start', 1250],
      ['groei', 2450],
      ['schaal', 4900],
    ]);
    const regels = JSON.stringify(await prijslijst.uitvoeren({ onderdeel: 'regels' }));
    expect(regels).toMatch(/maatwerk/i);
    expect(regels).toMatch(/proefmaand/i);
    expect(regels).not.toMatch(/"prijs_per_maand_eur"/);
  });
});

// --- 3.2 ----------------------------------------------------------------------------------

describe('3.2 de lus zelf bouwen', () => {
  const basis = { model: 'claude-sonnet-5-5', maxRondes: 5 };

  it('stuurt model, system, de opdracht en de tools in API-vorm met strict: true', async () => {
    const tool = testTool('demo_zoek', async () => 'ok');
    const client = maakNepClient([tekstAntwoord('Klaar.')]);
    await draaiAgentLus(client, [tool], 'Maak een voorstel voor L006.', { ...basis, system: 'Je bent de voorstel-agent.' });
    const params = client.laatsteAanroep;
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.system).toBe('Je bent de voorstel-agent.');
    expect(params.tools).toEqual([naarApiTool(tool)]);
    expect(params.messages[0].role).toBe('user');
    expect(userTekst(params)).toContain('Maak een voorstel voor L006.');
    expect(params.tool_choice).toBeUndefined();
  });

  it('stopt bij end_turn: status klaar, de tekst als antwoord, geen tool uitgevoerd', async () => {
    const tool = testTool('demo_zoek', async () => 'ok');
    const client = maakNepClient([tekstAntwoord('Geen voorstel nodig.')]);
    const uit = await draaiAgentLus(client, [tool], 'Vraag', basis);
    expect(uit).toMatchObject({ status: 'klaar', antwoord: 'Geen voorstel nodig.', rondes: 1, toolAanroepen: [], stopReden: 'end_turn' });
    expect(tool.uitvoeren).not.toHaveBeenCalled();
  });

  it('voert een tool uit en stuurt een tool_result met hetzelfde tool_use_id terug', async () => {
    const tool = testTool('demo_zoek', async () => 'gevonden: Snuffel Diervoeding');
    const client = maakNepClient([toolAntwoord('demo_zoek', { waarde: 'L006' }, 'toolu_A1'), tekstAntwoord('Snuffel.')]);
    const uit = await draaiAgentLus(client, [tool], 'Wie is L006?', basis);
    expect(tool.uitvoeren).toHaveBeenCalledWith({ waarde: 'L006' });
    const tweede = client.aanroepen[1];
    expect(tweede.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const [resultaat] = toolResultatenIn(tweede);
    expect(resultaat).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_A1', content: 'gevonden: Snuffel Diervoeding' });
    expect(resultaat.is_error ?? false).toBe(false);
    expect(uit.status).toBe('klaar');
    expect(uit.rondes).toBe(2);
  });

  it('zet alle resultaten van één beurt in één user-bericht, in dezelfde volgorde', async () => {
    const lead = testTool('demo_lead', async () => 'lead');
    const prijs = testTool('demo_prijs', async () => 'prijslijst');
    const client = maakNepClient([
      meerdereToolsAntwoord(
        [
          { name: 'demo_prijs', input: { waarde: 'pakketten' }, id: 'toolu_1' },
          { name: 'demo_lead', input: { waarde: 'L006' }, id: 'toolu_2' },
        ],
        'Ik lees de lead en de prijslijst.',
      ),
      tekstAntwoord('Klaar.'),
    ]);
    await draaiAgentLus(client, [lead, prijs], 'Vraag', basis);
    expect(client.aantalAanroepen).toBe(2);
    expect(client.aanroepen[1].messages).toHaveLength(3);
    const resultaten = toolResultatenIn(client.aanroepen[1]);
    expect(resultaten.map((r) => r.tool_use_id)).toEqual(['toolu_1', 'toolu_2']);
    expect(resultaten.map((r) => r.content)).toEqual(['prijslijst', 'lead']);
  });

  it('legt elke aanroep vast en stuurt een object als JSON-tekst terug', async () => {
    const prijs = testTool('demo_prijs', async () => ({ totaal_excl_btw_eur: 7800 }));
    const client = maakNepClient([
      toolAntwoord('demo_prijs', { waarde: 'groei' }),
      toolAntwoord('demo_prijs', { waarde: 'schaal' }),
      tekstAntwoord('Klaar.'),
    ]);
    const uit = await draaiAgentLus(client, [prijs], 'Vraag', basis);
    expect(uit.toolAanroepen).toEqual([
      { ronde: 1, naam: 'demo_prijs', invoer: { waarde: 'groei' }, uitkomst: '{"totaal_excl_btw_eur":7800}', fout: false },
      { ronde: 2, naam: 'demo_prijs', invoer: { waarde: 'schaal' }, uitkomst: '{"totaal_excl_btw_eur":7800}', fout: false },
    ]);
    const [resultaat] = toolResultatenIn(client.aanroepen[2]);
    expect(typeof resultaat.content).toBe('string');
    expect(JSON.parse(resultaat.content as string)).toEqual({ totaal_excl_btw_eur: 7800 });
  });

  it('telt de tokens van alle rondes op en geeft de volledige geschiedenis terug', async () => {
    const tool = testTool('demo_zoek', async () => 'ok');
    const client = maakNepClient([
      { ...toolAntwoord('demo_zoek', { waarde: 'x' }), usage: { input_tokens: 1200, output_tokens: 80 } },
      { ...tekstAntwoord('Klaar.'), usage: { input_tokens: 1400, output_tokens: 40 } },
    ]);
    const uit = await draaiAgentLus(client, [tool], 'Vraag', basis);
    expect(uit.tokens).toEqual({ input: 2600, output: 120 });
    expect(uit.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});

// --- 3.3 ----------------------------------------------------------------------------------

describe('3.3 fouten, grenzen en maximale rondes', () => {
  const basis = { model: 'claude-sonnet-5-5', maxRondes: 5 };

  it('een fout in een tool wordt een tool_result met is_error: true, en de lus gaat door', async () => {
    const kapot = testTool('demo_kapot', async () => {
      throw new Error('Budget per kanaal is te laag.');
    });
    const client = maakNepClient([toolAntwoord('demo_kapot', { waarde: '400' }, 'toolu_F'), tekstAntwoord('Een pakket kan niet.')]);
    const uit = await draaiAgentLus(client, [kapot], 'Vraag', basis);
    const [resultaat] = toolResultatenIn(client.aanroepen[1]);
    expect(resultaat).toMatchObject({ tool_use_id: 'toolu_F', is_error: true });
    expect(String(resultaat.content)).toContain('Budget per kanaal is te laag.');
    expect(uit.status).toBe('klaar');
    expect(uit.toolAanroepen[0]).toMatchObject({ naam: 'demo_kapot', fout: true });
  });

  it('een zod-fout komt leesbaar terug, met de naam van het veld', async () => {
    const Schema = z.object({ looptijd_maanden: z.number().int() });
    const tool: Tool = {
      definitie: { naam: 'demo_looptijd', beschrijving: 'Test. Test. Test.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
      uitvoeren: async (ruw) => Schema.parse(ruw),
    };
    const client = maakNepClient([toolAntwoord('demo_looptijd', { looptijd_maanden: 'drie' }), tekstAntwoord('Sorry.')]);
    await draaiAgentLus(client, [tool], 'Vraag', basis);
    const [resultaat] = toolResultatenIn(client.aanroepen[1]);
    expect(resultaat.is_error).toBe(true);
    expect(String(resultaat.content)).toContain('looptijd_maanden');
    expect(String(resultaat.content)).not.toMatch(/ZodError|at .*\.ts/);
  });

  it('een onbekende tool krijgt is_error: true met de namen die wel bestaan', async () => {
    const a = testTool('voorstel_lees_lead', async () => 'x');
    const b = testTool('voorstel_bereken_prijs', async () => 'y');
    const client = maakNepClient([toolAntwoord('voorstel_verstuur', { waarde: '1' }, 'toolu_X'), tekstAntwoord('Sorry.')]);
    const uit = await draaiAgentLus(client, [a, b], 'Vraag', basis);
    const [resultaat] = toolResultatenIn(client.aanroepen[1]);
    expect(resultaat).toMatchObject({ tool_use_id: 'toolu_X', is_error: true });
    expect(String(resultaat.content)).toContain('voorstel_lees_lead');
    expect(String(resultaat.content)).toContain('voorstel_bereken_prijs');
    expect(uit.toolAanroepen[0]).toMatchObject({ naam: 'voorstel_verstuur', fout: true });
  });

  it('stopt na maxRondes met status max_rondes en voert in de laatste ronde geen tools meer uit', async () => {
    const tool = testTool('demo_lus', async () => 'nog een keer');
    const client = maakNepClient([], { daarnaSteeds: () => toolAntwoord('demo_lus', { waarde: 'x' }) });
    const uit = await draaiAgentLus(client, [tool], 'Vraag', { ...basis, maxRondes: 3 });
    expect(uit.status).toBe('max_rondes');
    expect(uit.rondes).toBe(3);
    expect(client.aantalAanroepen).toBe(3);
    expect(tool.uitvoeren).toHaveBeenCalledTimes(2);
    await expect(draaiAgentLus(client, [tool], 'Vraag', { ...basis, maxRondes: 0 })).rejects.toThrow(/maxRondes/);
  });

  it('een tool die te lang duurt, wordt afgebroken met een time-out als is_error', async () => {
    const traag = testTool('demo_traag', () => new Promise(() => {}));
    const client = maakNepClient([toolAntwoord('demo_traag', { waarde: 'x' }), tekstAntwoord('Zonder gegevens verder.')]);
    const uit = await draaiAgentLus(client, [traag], 'Vraag', { ...basis, toolTimeoutMs: 20 });
    const [resultaat] = toolResultatenIn(client.aanroepen[1]);
    expect(resultaat.is_error).toBe(true);
    expect(String(resultaat.content)).toMatch(/time-out/i);
    expect(uit.status).toBe('klaar');
  });

  it('een te lange tool-uitkomst wordt ingekort met een melding', async () => {
    const lang = testTool('demo_lang', async () => 'x'.repeat(5000));
    const client = maakNepClient([toolAntwoord('demo_lang', { waarde: 'x' }), tekstAntwoord('Klaar.')]);
    await draaiAgentLus(client, [lang], 'Vraag', { ...basis, maxResultaatTekens: 100 });
    const [resultaat] = toolResultatenIn(client.aanroepen[1]);
    const inhoud = String(resultaat.content);
    expect(inhoud.length).toBeLessThan(300);
    expect(inhoud).toMatch(/ingekort/);
  });

  it('afgekapt midden in een tool_use: één herkansing met meer max_tokens, zonder de halve aanroep uit te voeren', async () => {
    const tool = testTool('demo_zoek', async () => 'ok');
    const afgekapt: NepAntwoord = { content: [{ type: 'tool_use', name: 'demo_zoek', input: {} }], stop_reason: 'max_tokens' };
    const client = maakNepClient([afgekapt, tekstAntwoord('Klaar.')]);
    const uit = await draaiAgentLus(client, [tool], 'Vraag', { ...basis, max_tokens: 1000 });
    expect(client.aantalAanroepen).toBe(2);
    expect(client.aanroepen[0].max_tokens).toBe(1000);
    expect(client.aanroepen[1].max_tokens).toBe(2000);
    expect(client.aanroepen[1].messages).toHaveLength(1);
    expect(tool.uitvoeren).not.toHaveBeenCalled();
    expect(uit.status).toBe('klaar');
  });

  it('max_tokens zonder tool_use geeft afgekapt; een weigering geeft geweigerd', async () => {
    const tool = testTool('demo_zoek', async () => 'ok');
    const eerste = await draaiAgentLus(maakNepClient([tekstAntwoord('Het voorstel is', 'max_tokens')]), [tool], 'Vraag', basis);
    expect(eerste.status).toBe('afgekapt');
    expect(eerste.antwoord).toBe('Het voorstel is');
    const tweede = await draaiAgentLus(maakNepClient([tekstAntwoord('', 'refusal')]), [tool], 'Vraag', basis);
    expect(tweede.status).toBe('geweigerd');
  });
});

// --- 3.4 ----------------------------------------------------------------------------------

describe('3.4 strict tools en invoercontrole', () => {
  const Voorbeeld = z.object({
    pakket: z.enum(['start', 'groei', 'schaal']).describe('Pakketcode.'),
    looptijd_maanden: z.number().int().min(3).max(12).describe('Looptijd in maanden.'),
    kanalen: z.array(z.enum(['meta', 'google'])).min(1),
    notitie: z.string().max(500),
    extra: z.object({ reden: z.string().min(1) }),
  });

  it('strictSchemaUitZod haalt $schema en alle grenzen weg en zet de grenzen in de description', () => {
    const schema = strictSchemaUitZod(Voorbeeld) as unknown as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('$schema');
    for (const { pad, knoop } of alleKnopen(schema)) {
      for (const woord of ONGELDIG_IN_STRICT) expect(knoop, `${pad} bevat ${woord}`).not.toHaveProperty(woord);
    }
    const eigenschappen = schema.properties as Record<string, Record<string, unknown>>;
    expect(eigenschappen.looptijd_maanden.type).toBe('integer');
    expect(eigenschappen.looptijd_maanden.description).toMatch(/Looptijd in maanden\./);
    expect(eigenschappen.looptijd_maanden.description).toMatch(/minimaal 3/);
    expect(eigenschappen.looptijd_maanden.description).toMatch(/maximaal 12/);
    expect(eigenschappen.pakket.enum).toEqual(['start', 'groei', 'schaal']);
    // z.number().int() voegt de grenzen van een veilig geheel getal toe; die horen niet in de description.
    const geheel = strictSchemaUitZod(z.object({ aantal: z.number().int().describe('Aantal.') })) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    expect(geheel.properties.aantal.description).toBe('Aantal.');
    expect(schema.required).toEqual(['pakket', 'looptijd_maanden', 'kanalen', 'notitie', 'extra']);
  });

  it('elk object in het schema heeft additionalProperties: false', () => {
    const schema = strictSchemaUitZod(Voorbeeld);
    const objecten = alleKnopen(schema).filter(({ knoop }) => knoop.type === 'object');
    expect(objecten.length).toBeGreaterThanOrEqual(2);
    for (const { pad, knoop } of objecten) expect(knoop.additionalProperties, pad).toBe(false);
  });

  it('alle voorstel-tools gaan met strict: true en een geldig strict schema naar de API', async () => {
    const tools = maakVoorstelTools(context());
    for (const tool of tools) {
      for (const { pad, knoop } of alleKnopen(tool.definitie.input_schema)) {
        for (const woord of ONGELDIG_IN_STRICT) expect(knoop, `${tool.definitie.naam} ${pad}`).not.toHaveProperty(woord);
        if (knoop.type === 'object') expect(knoop.additionalProperties, `${tool.definitie.naam} ${pad}`).toBe(false);
      }
    }
    const client = maakNepClient([tekstAntwoord('Klaar.')]);
    await draaiAgentLus(client, tools, 'Vraag', { model: 'claude-sonnet-5-5', maxRondes: 2 });
    expect(client.laatsteAanroep.tools?.every((t) => (t as { strict?: boolean }).strict === true)).toBe(true);
  });

  it('enumZonderHoofdletters accepteert "Groei " en "META", maar geen onbekende waarde', () => {
    const Pakket = enumZonderHoofdletters(['start', 'groei', 'schaal'] as const);
    expect(Pakket.parse('Groei ')).toBe('groei');
    expect(Pakket.parse('SCHAAL')).toBe('schaal');
    expect(() => Pakket.parse('premium')).toThrow();
    const r = z.object({ pakket: Pakket }).safeParse({ pakket: 'premium' });
    expect(r.success).toBe(false);
    if (!r.success) expect(zodFoutTekst(r.error)).toMatch(/pakket/);
  });

  it('toolChoiceVoor forceert alleen op modellen die dat toestaan', () => {
    expect(toolChoiceVoor('claude-sonnet-5-5', 'voorstel_maak_concept')).toEqual({ type: 'auto' });
    expect(toolChoiceVoor('claude-opus-5-5', 'voorstel_maak_concept')).toEqual({ type: 'auto' });
    expect(toolChoiceVoor('claude-sonnet-5-5-20261001', 'voorstel_maak_concept')).toEqual({ type: 'auto' });
    expect(toolChoiceVoor('claude-fable-5-1', 'x')).toEqual({ type: 'auto' });
    expect(toolChoiceVoor('claude-haiku-5-5', 'voorstel_maak_concept')).toEqual({ type: 'tool', name: 'voorstel_maak_concept' });
    expect(toolChoiceVoor('claude-sonnet-5-5')).toBeUndefined();
  });

  it('vereisteTool: na end_turn zonder die tool volgt één herinnering; op Sonnet 5.5 zonder geforceerde tool_choice', async () => {
    const concept = testTool('voorstel_maak_concept', async () => 'opgeslagen');
    const sonnet = maakNepClient([
      tekstAntwoord('Ik denk dat Groei past.'),
      toolAntwoord('voorstel_maak_concept', { waarde: 'x' }),
      tekstAntwoord('Concept opgeslagen.'),
    ]);
    const uit = await draaiAgentLus(sonnet, [concept], 'Vraag', {
      model: 'claude-sonnet-5-5',
      maxRondes: 5,
      vereisteTool: 'voorstel_maak_concept',
    });
    expect(uit.status).toBe('klaar');
    expect(sonnet.aantalAanroepen).toBe(3);
    const herinnering = sonnet.aanroepen[1];
    expect(herinnering.messages.at(-1)?.role).toBe('user');
    expect(userTekst(herinnering)).toMatch(/voorstel_maak_concept/);
    expect(['any', 'tool']).not.toContain(herinnering.tool_choice?.type);

    const haiku = maakNepClient([tekstAntwoord('Klaar denk ik.'), toolAntwoord('voorstel_maak_concept', { waarde: 'x' }), tekstAntwoord('Klaar.')]);
    await draaiAgentLus(haiku, [concept], 'Vraag', { model: 'claude-haiku-5-5', maxRondes: 5, vereisteTool: 'voorstel_maak_concept' });
    expect(haiku.aanroepen[0].tool_choice).toBeUndefined();
    expect(haiku.aanroepen[1].tool_choice).toEqual({ type: 'tool', name: 'voorstel_maak_concept' });
  });

  it('bedrijfsregels: geen proefmaand, geen los kanaal bijkopen, minimaal 500 euro per kanaal', async () => {
    const tools = maakVoorstelTools(context());
    const geldig = { lead_id: 'L006', pakket: 'groei', looptijd_maanden: 3, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 4000, losse_projecten: [] };
    await expect(bereken(tools, { ...geldig, looptijd_maanden: 1 })).rejects.toThrow(/proefmaand[\s\S]*3 maanden|3 maanden[\s\S]*proefmaand/);
    await expect(bereken(tools, { ...geldig, looptijd_maanden: 24 })).rejects.toThrow(/12 maanden/);
    await expect(bereken(tools, { ...geldig, kanalen: ['meta', 'google', 'linkedin'] })).rejects.toThrow(/Schaal/);
    await expect(bereken(tools, { ...geldig, kanalen: [] })).rejects.toThrow(/E-mail/);
    await expect(bereken(tools, { ...geldig, pakket: 'start', kanalen: ['meta'], advertentiebudget_per_maand_eur: 400 })).rejects.toThrow(/500[\s\S]*audit/);
    await expect(bereken(tools, { ...geldig, losse_projecten: ['agent_project'] })).rejects.toThrow();
    await expect(bereken(tools, { ...geldig, korting_pct: 20 })).resolves.toMatchObject({ korting_pct: 0 });
  });

  it('voorstel_bereken_prijs rekent de voorbeelden uit de prijsafspraken exact na', async () => {
    const tools = maakVoorstelTools(context());
    const start = await bereken(tools, { lead_id: 'L008', pakket: 'start', looptijd_maanden: 3, kanalen: ['meta'], advertentiebudget_per_maand_eur: 700, losse_projecten: [] });
    expect(start).toMatchObject({ maandprijs_eur: 1250, opstartkosten_eur: 450, totaal_excl_btw_eur: 4200, korting_pct: 0, jaarcontract: false });
    const sprint = await bereken(tools, { lead_id: 'L008', pakket: 'start', looptijd_maanden: 3, kanalen: ['meta'], advertentiebudget_per_maand_eur: 700, losse_projecten: ['creative_sprint'] });
    expect(sprint.totaal_excl_btw_eur).toBe(5150);
    const groei = await bereken(tools, { lead_id: 'L006', pakket: 'groei', looptijd_maanden: 3, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 4000, losse_projecten: [] });
    expect(groei).toMatchObject({ totaal_excl_btw_eur: 7800, btw_eur: 1638, totaal_incl_btw_eur: 9438 });
    const kook = await bereken(tools, { lead_id: 'L009', pakket: 'groei', looptijd_maanden: 3, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 2500, losse_projecten: ['landingspagina'] });
    expect(kook).toMatchObject({ totaal_excl_btw_eur: 9600, btw_eur: 2016, totaal_incl_btw_eur: 11616 });
    const jaar = await bereken(tools, { lead_id: 'L007', pakket: 'schaal', looptijd_maanden: 12, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 12000, losse_projecten: [] });
    expect(jaar).toMatchObject({ jaarcontract: true, korting_pct: 10, maandprijs_eur: 4410, opstartkosten_eur: 0, totaal_excl_btw_eur: 52920, btw_eur: 11113.2, totaal_incl_btw_eur: 64033.2 });
    const groeiJaar = await bereken(tools, { lead_id: 'L006', pakket: 'groei', looptijd_maanden: 12, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 4000, losse_projecten: [] });
    expect(groeiJaar.totaal_excl_btw_eur).toBe(26910);
    expect([start.id, sprint.id, groei.id]).toEqual(['B1', 'B2', 'B3']);
  });

  it('controleerPrijsregels geeft pakket, unieke kanalen en budget per kanaal, of een melding die zegt wat wel kan', () => {
    const prijslijst = laadPakketten();
    const geldig = { lead_id: 'L006', pakket: 'groei' as const, looptijd_maanden: 3, kanalen: ['meta' as const, 'google' as const, 'meta' as const], advertentiebudget_per_maand_eur: 4000, losse_projecten: [] };
    const uit = controleerPrijsregels(geldig, prijslijst);
    expect(uit.pakket.code).toBe('groei');
    expect(uit.kanalen).toEqual(['meta', 'google']);
    expect(uit.perKanaalEur).toBe(2000);
    expect(() => controleerPrijsregels({ ...geldig, kanalen: ['meta', 'google', 'linkedin'] }, prijslijst)).toThrow(
      'Groei heeft maximaal 2 advertentiekanalen, je vraagt er 3. Een los kanaal bijkopen kan niet: voor 3 kanalen is het Schaal.',
    );
    expect(() => controleerPrijsregels({ ...geldig, looptijd_maanden: 2 }, prijslijst)).toThrow(/Reken met 3 maanden/);
    expect(() => controleerPrijsregels({ ...geldig, looptijd_maanden: 13 }, prijslijst)).toThrow(/Reken met 12 maanden/);
    expect(() => controleerPrijsregels({ ...geldig, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 900 }, prijslijst)).toThrow(/450 euro per kanaal[\s\S]*advertentie-audit/);
  });

  it('hoofdletters in enum-waarden zijn geen probleem voor de tools', async () => {
    const uit = await bereken(maakVoorstelTools(context()), {
      lead_id: 'l006',
      pakket: 'Groei',
      looptijd_maanden: 3,
      kanalen: ['META', 'Google'],
      advertentiebudget_per_maand_eur: 4000,
      losse_projecten: [],
    });
    expect(uit).toMatchObject({ lead_id: 'L006', pakket: 'groei', kanalen: ['meta', 'google'] });
  });
});

// --- 3.5 ----------------------------------------------------------------------------------

describe('3.5 de voorstel-agent', () => {
  it('bedragenIn leest Nederlandse bedragen', () => {
    expect(bedragenIn('Totaal € 7.800 excl. btw, € 9.438,00 incl. btw; maandfee 2.205 euro en €950.')).toEqual([7800, 9438, 2205, 950]);
    expect(bedragenIn('Start op 3 maanden, 2 kanalen.')).toEqual([]);
  });

  it('controleerToelichting: trimt, en weigert lege tekst, verboden woorden en bedragen die niet in de berekening staan', () => {
    const toegestaan = [7800, 9438, 2450];
    expect(controleerToelichting('  Groei past: € 7.800 excl. btw.  ', toegestaan, 'B1')).toBe('Groei past: € 7.800 excl. btw.');
    expect(() => controleerToelichting('   ', toegestaan, 'B1')).toThrow(/leeg/);
    expect(() => controleerToelichting('x'.repeat(1201), toegestaan, 'B1')).toThrow(/1201/);
    expect(() => controleerToelichting('Met Korting wordt het mooier.', toegestaan, 'B1')).toThrow(/"Korting"/);
    expect(() => controleerToelichting('No cure no pay.', toegestaan, 'B1')).toThrow(/No-cure-no-pay/);
    expect(() => controleerToelichting('Totaal € 6.999 en € 7.800.', toegestaan, 'B2')).toThrow(/€ 6\.999[\s\S]*B2/);
  });

  it('voorstel_maak_concept bewaakt de regels: berekening nodig, alleen gekwalificeerd, geen korting of vreemde bedragen', async () => {
    const ctx = context();
    const tools = maakVoorstelTools(ctx);
    const concept = toolUit(tools, 'voorstel_maak_concept');
    const maak = (invoer: Record<string, unknown>) => Promise.resolve().then(() => concept.uitvoeren(invoer));
    const basis = { lead_id: 'L006', berekening_id: 'B1', toelichting: 'Groei past bij twee kanalen.', open_punten: [] };

    await expect(maak(basis)).rejects.toThrow(/voorstel_bereken_prijs/);
    await bereken(tools, { lead_id: 'L006', pakket: 'groei', looptijd_maanden: 3, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 4000, losse_projecten: [] });
    await expect(maak({ ...basis, lead_id: 'L001' })).rejects.toThrow(/nieuw/);
    await expect(maak({ ...basis, lead_id: 'L007' })).rejects.toThrow(/L006/);
    await expect(maak({ ...basis, toelichting: 'Bij snel tekenen krijg je 5% korting.' })).rejects.toThrow(/korting/i);
    await expect(maak({ ...basis, toelichting: 'Wij garanderen een ROAS van 4.' })).rejects.toThrow(/garantie/i);
    await expect(maak({ ...basis, toelichting: 'Totaal € 6.999 excl. btw.' })).rejects.toThrow(/6\.999/);
    expect(ctx.opslag.concepten).toHaveLength(0);
  });

  it('voorstel_maak_concept slaat een concept op met de bedragen uit de berekening, en verstuurt niets', async () => {
    const ctx = context();
    const tools = maakVoorstelTools(ctx);
    await bereken(tools, { lead_id: 'L007', pakket: 'schaal', looptijd_maanden: 12, kanalen: ['meta', 'google'], advertentiebudget_per_maand_eur: 12000, losse_projecten: [] });
    const uit = alsObject(
      await toolUit(tools, 'voorstel_maak_concept').uitvoeren({
        lead_id: 'L007',
        berekening_id: 'B1',
        toelichting: 'Schaal past: twee kanalen plus e-mailflows. Jaarcontract: € 4.410 per maand, totaal € 52.920 excl. btw.',
        open_punten: ['Martijn vraagt naar korting bij een jaarcontract: Eva beslist.'],
      }),
    );
    expect(uit).toMatchObject({ status: 'concept', verstuurd: false });
    expect(ctx.opslag.concepten).toHaveLength(1);
    expect(ctx.opslag.concepten[0]).toMatchObject({
      lead_id: 'L007',
      pakket: 'schaal',
      looptijd_maanden: 12,
      maandprijs_eur: 4410,
      korting_pct: 10,
      totaal_excl_btw_eur: 52920,
      totaal_incl_btw_eur: 64033.2,
      status: 'concept',
      verstuurd_op: null,
      geldig_tot: '2026-12-02',
      aangemaakt_op: REFERENTIEDATUM,
      open_punten: ['Martijn vraagt naar korting bij een jaarcontract: Eva beslist.'],
    });
    await expect(
      Promise.resolve().then(() =>
        toolUit(tools, 'voorstel_maak_concept').uitvoeren({ lead_id: 'L007', berekening_id: 'B1', toelichting: 'Nog een keer.', open_punten: [] }),
      ),
    ).rejects.toThrow(/al een concept/);
  });

  it('stelVoorstelOp maakt voor L006 een Groei-concept via de vier tools', async () => {
    const ctx = context();
    const client = maakNepClient([
      meerdereToolsAntwoord([
        { name: 'voorstel_lees_lead', input: { lead_id: 'L006' } },
        { name: 'voorstel_lees_prijslijst', input: { onderdeel: 'pakketten' } },
      ]),
      toolAntwoord('voorstel_bereken_prijs', {
        lead_id: 'L006',
        pakket: 'groei',
        looptijd_maanden: 3,
        kanalen: ['meta', 'google'],
        advertentiebudget_per_maand_eur: 4000,
        losse_projecten: [],
      }),
      (params) => {
        const [resultaat] = toolResultatenIn(params);
        const { id } = JSON.parse(String(resultaat.content)) as { id: string };
        return toolAntwoord('voorstel_maak_concept', {
          lead_id: 'L006',
          berekening_id: id,
          toelichting: 'Groei past bij Meta en Google. Totaal € 7.800 excl. btw (€ 9.438 incl. btw).',
          open_punten: ['Black Friday op 27 november: kan de start vóór 20 november?'],
        });
      },
      tekstAntwoord('Concept voor Snuffel Diervoeding opgeslagen. Open: startdatum voor Black Friday.'),
    ]);
    const uit = await stelVoorstelOp(client, 'L006', ctx);

    expect(uit.status).toBe('klaar');
    expect(uit.concept).toMatchObject({ lead_id: 'L006', pakket: 'groei', totaal_excl_btw_eur: 7800, totaal_incl_btw_eur: 9438, status: 'concept' });
    expect(ctx.opslag.concepten).toHaveLength(1);
    expect(uit.toolAanroepen.map((a) => a.naam)).toEqual(['voorstel_lees_lead', 'voorstel_lees_prijslijst', 'voorstel_bereken_prijs', 'voorstel_maak_concept']);
    expect(uit.toolAanroepen.every((a) => !a.fout)).toBe(true);
    for (const params of client.aanroepen) {
      expect(params.model).toBe('claude-sonnet-5-5');
      expect(['any', 'tool']).not.toContain(params.tool_choice?.type);
      expect(params.tools?.map((t) => (t as { name: string }).name)).toEqual(NAMEN);
    }
    expect(userTekst(client.aanroepen[0])).toContain('L006');
  });

  it('stelVoorstelOp herstelt zich na een proefmaand-fout bij L008', async () => {
    const ctx = context();
    const start = { lead_id: 'L008', pakket: 'start', kanalen: ['meta'], advertentiebudget_per_maand_eur: 700, losse_projecten: [] };
    const client = maakNepClient([
      toolAntwoord('voorstel_bereken_prijs', { ...start, looptijd_maanden: 1 }),
      toolAntwoord('voorstel_bereken_prijs', { ...start, looptijd_maanden: 3 }),
      toolAntwoord('voorstel_maak_concept', {
        lead_id: 'L008',
        berekening_id: 'B1',
        toelichting: 'Start past bij één kanaal. Minimale looptijd is 3 maanden: € 4.200 excl. btw.',
        open_punten: ['Femke wil eerst een maand proberen; dat kan niet. Daan legt het uit.'],
      }),
      tekstAntwoord('Concept opgeslagen.'),
    ]);
    const uit = await stelVoorstelOp(client, 'L008', ctx);
    const [fout] = toolResultatenIn(client.aanroepen[1]);
    expect(fout.is_error).toBe(true);
    expect(String(fout.content)).toMatch(/3 maanden/);
    expect(uit.concept).toMatchObject({ pakket: 'start', looptijd_maanden: 3, totaal_excl_btw_eur: 4200 });
    expect(uit.status).toBe('klaar');
  });

  it('zonder concept is de status geen_concept, na precies één herinnering', async () => {
    const ctx = context();
    const client = maakNepClient([
      toolAntwoord('voorstel_lees_lead', { lead_id: 'L001' }),
      tekstAntwoord('L001 is nog niet gekwalificeerd. Ik maak geen concept.'),
      tekstAntwoord('Ook na controle: geen concept, de lead is nieuw.'),
    ]);
    const uit = await stelVoorstelOp(client, 'L001', ctx);
    expect(uit.status).toBe('geen_concept');
    expect(uit.concept).toBeNull();
    expect(client.aantalAanroepen).toBe(3);
    expect(ctx.opslag.concepten).toHaveLength(0);
  });

  it('de system prompt bevat de prijsregels en de agent heeft geen verstuur-code', () => {
    expect(VOORSTEL_SYSTEEM).toMatch(/korting/i);
    expect(VOORSTEL_SYSTEEM).toMatch(/proefmaand/i);
    expect(VOORSTEL_SYSTEEM).toMatch(/maatwerk/i);
    expect(VOORSTEL_SYSTEEM).toMatch(/verstuur/i);
    const bron = readFileSync(`${bronMap('m03-agent-lus')}/index.ts`, 'utf8');
    expect(bron).not.toMatch(/nodemailer|sendMail|resend|smtp|gmail|messages\.send/i);
  });
});

// --- oefeningen ---------------------------------------------------------------------------

describe('oefening 3.3 · maxAanroepenPerTool', () => {
  const basis = { model: 'claude-sonnet-5-5', maxRondes: 8 };

  it('een vierde aanroep van dezelfde tool wordt niet uitgevoerd en krijgt is_error', async () => {
    const tool = testTool('demo_lus', async () => 'nog een keer');
    const client = maakNepClient([
      ...Array.from({ length: 4 }, (_, i) => toolAntwoord('demo_lus', { waarde: String(i) }, `toolu_L${i}`)),
      tekstAntwoord('Ik stop.'),
    ]);
    const uit = await draaiAgentLus(client, [tool], 'Vraag', basis);
    expect(tool.uitvoeren).toHaveBeenCalledTimes(3);
    const [vierde] = toolResultatenIn(client.aanroepen[4]);
    expect(vierde).toMatchObject({ tool_use_id: 'toolu_L3', is_error: true });
    expect(String(vierde.content)).toMatch(/al 3 keer/);
    expect(uit.toolAanroepen.map((a) => a.fout)).toEqual([false, false, false, true]);
    expect(uit.status).toBe('klaar');
  });

  it('de limiet geldt per tool en is in te stellen', async () => {
    const a = testTool('demo_a', async () => 'a');
    const b = testTool('demo_b', async () => 'b');
    const beide = () =>
      meerdereToolsAntwoord([
        { name: 'demo_a', input: { waarde: 'x' } },
        { name: 'demo_b', input: { waarde: 'y' } },
      ]);
    const client = maakNepClient([beide(), beide(), tekstAntwoord('Klaar.')]);
    const uit = await draaiAgentLus(client, [a, b], 'Vraag', { ...basis, maxAanroepenPerTool: 1 });
    expect(a.uitvoeren).toHaveBeenCalledTimes(1);
    expect(b.uitvoeren).toHaveBeenCalledTimes(1);
    const tweede = toolResultatenIn(client.aanroepen[2]);
    expect(tweede.map((r) => r.is_error)).toEqual([true, true]);
    expect(String(tweede[0].content)).toMatch(/al 1 keer/);
    expect(uit.toolAanroepen.filter((x) => x.fout)).toHaveLength(2);
  });
});

describe('oefening 3.4 · controleerStrictLimieten', () => {
  const apiTool = (name: string, properties: Record<string, unknown>, required: string[], strict = true): Anthropic.Tool => ({
    name,
    description: `Testtool ${name}.`,
    input_schema: { type: 'object', properties, required, additionalProperties: false },
    ...(strict ? { strict: true } : {}),
  });

  it('de vier voorstel-tools blijven ruim binnen de limieten', () => {
    const telling = controleerStrictLimieten(maakVoorstelTools(context()).map((t) => naarApiTool(t)));
    expect(telling).toEqual({ strictTools: 4, optioneleParameters: 0, unionParameters: 0 });
  });

  it('telt over alle strict tools samen, ook genest, en gooit boven 20, 24 of 16', () => {
    const tekst = { type: 'string' };
    const eenOptioneel = apiTool('demo_een', { a: tekst, b: tekst, adres: { type: 'object', properties: { straat: tekst, nummer: tekst }, required: ['straat'] } }, ['a', 'adres']);
    expect(controleerStrictLimieten([eenOptioneel, apiTool('demo_los', { x: tekst }, [], false)])).toEqual({ strictTools: 1, optioneleParameters: 2, unionParameters: 0 });

    const veel = Array.from({ length: 21 }, (_, i) => apiTool(`demo_${i}`, { x: tekst }, ['x']));
    expect(() => controleerStrictLimieten(veel)).toThrow(/Schema is too complex for compilation[\s\S]*20/);
    expect(controleerStrictLimieten(veel.map((t) => ({ ...t, strict: false }))).strictTools).toBe(0);

    const optioneel = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`veld_${i}`, tekst]));
    expect(() => controleerStrictLimieten([apiTool('demo_a', optioneel, []), apiTool('demo_b', optioneel, [])])).toThrow(/24/);

    const unie = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`keuze_${i}`, i % 2 ? { type: ['string', 'null'] } : { anyOf: [tekst, { type: 'number' }] }]));
    expect(() => controleerStrictLimieten([apiTool('demo_unie', unie, Object.keys(unie))])).toThrow(/16/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  PROFIELEN,
  SCOPES,
  TOOLS,
  binnenKlantScope,
  controleerScopes,
  controleerSlackVerzoek,
  draaiMetMcp,
  lokaleVerbinding,
  maakGeheugenCrm,
  maakGeheugenInbox,
  magTool,
  minimaleScopes,
  naarClaudeTools,
  naarToolResult,
  normaliseerScope,
  ontvangSlackWebhook,
  profielVoorToken,
  slackHandtekening,
  toolsVoor,
  voerToolUit,
  type Crm,
  type McpVerbinding,
  type ToolContext,
  type ToolResultaat,
} from '@opdracht/m05-mcp-crm';
import { maakNepClient, tekstAntwoord, toolAntwoord, toolResultatenIn } from '../../../test-hulp/nepClient';
import { laadAppSettings, laadKlanten, laadLeads, laadTaken, laadTeam } from '../../../test-hulp/vonkData';

/** Maandag 2 november 2026, 07:00 in Nederland. */
const NU = new Date('2026-11-02T06:00:00Z');

function vonkCrm() {
  return maakGeheugenCrm({
    leads: laadLeads(),
    klanten: laadKlanten(),
    team: laadTeam(),
    taken: laadTaken(),
    instellingen: laadAppSettings(),
  });
}

function context(profiel = 'milan-claude-code', crm: Crm = vonkCrm()): ToolContext {
  let teller = 0;
  return { crm, profiel: PROFIELEN[profiel], nu: NU, maakId: () => `nieuw-${++teller}` };
}

function data(resultaat: ToolResultaat): Record<string, any> {
  expect(resultaat.isError, resultaat.content[0]?.text).not.toBe(true);
  return JSON.parse(resultaat.content[0].text);
}

function foutTekst(resultaat: ToolResultaat): string {
  expect(resultaat.isError).toBe(true);
  return resultaat.content.map((b) => b.text).join(' ');
}

const zinnen = (tekst: string) => tekst.split(/[.!?](?:\s|$)/).filter((z) => z.trim().length > 0).length;

// ---------------------------------------------------------------------------

describe('5.1 tools en handlers', () => {
  it('TOOLS heeft vier tools in vaste volgorde, met geldige namen en een beschrijving van minstens drie zinnen', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['zoek_leads', 'bekijk_lead', 'maak_taak', 'voeg_notitie_toe']);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(tool.title.length).toBeGreaterThan(3);
      expect(zinnen(tool.description), `${tool.name}: beschrijving te kort`).toBeGreaterThanOrEqual(3);
    }
  });

  it('elk inputSchema is een object zonder extra velden, met de juiste verplichte velden en enums', () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    const schema = (naam: string) => TOOLS.find((t) => t.name === naam)!.inputSchema as any;
    expect(schema('zoek_leads').required ?? []).toEqual([]);
    expect(schema('zoek_leads').properties.status.enum).toEqual(['nieuw', 'gekwalificeerd', 'voorstel_verstuurd', 'gewonnen', 'verloren']);
    expect(schema('bekijk_lead').required).toEqual(['lead_id']);
    expect(schema('maak_taak').required).toEqual(expect.arrayContaining(['titel', 'toegewezen_aan', 'deadline']));
    expect(schema('maak_taak').properties.prioriteit.enum).toEqual(['laag', 'normaal', 'hoog']);
    expect(schema('voeg_notitie_toe').required).toEqual(['samenvatting']);
  });

  it('annotations: lezen is readOnly, schrijven is niet destructief en idempotent, niets is open world', () => {
    const a = Object.fromEntries(TOOLS.map((t) => [t.name, t.annotations]));
    expect(a.zoek_leads).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(a.bekijk_lead).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    for (const naam of ['maak_taak', 'voeg_notitie_toe']) {
      expect(a[naam]).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
  });

  it('zoek_leads vindt de negen verstuurde voorstellen, met dagen sinds het voorstel en zonder contactgegevens', async () => {
    const r = await voerToolUit('zoek_leads', { status: 'voorstel_verstuurd', max: 25 }, context());
    const d = data(r);
    expect(d.aantal).toBe(9);
    expect(d.leads.map((l: any) => l.id)).toEqual(['L010', 'L011', 'L012', 'L013', 'L014', 'L015', 'L016', 'L017', 'L018']);
    const perId = Object.fromEntries(d.leads.map((l: any) => [l.id, l]));
    expect(perId.L010.dagen_sinds_voorstel).toBe(33);
    expect(perId.L015.dagen_sinds_voorstel).toBe(7);
    expect(perId.L012.heeft_opvolgconcept).toBe(true);
    expect(perId.L011.heeft_opvolgconcept).toBe(false);
    expect(r.content[0].text).not.toMatch(/@|06-0000/);
    expect(r.structuredContent).toEqual(d);
  });

  it('zoek_leads geeft standaard hoogstens 10 leads terug en respecteert max', async () => {
    const alles = data(await voerToolUit('zoek_leads', {}, context()));
    expect(alles.aantal).toBe(24);
    expect(alles.getoond).toBe(10);
    expect(alles.leads).toHaveLength(10);
    const drie = data(await voerToolUit('zoek_leads', { status: 'voorstel_verstuurd', max: 3 }, context()));
    expect(drie).toMatchObject({ aantal: 9, getoond: 3 });
    const vanEva = data(await voerToolUit('zoek_leads', { eigenaar: 'T01', status: 'voorstel_verstuurd' }, context()));
    expect(vanEva.leads.map((l: any) => l.id)).toEqual(['L013', 'L014', 'L017']);
  });

  it('bekijk_lead geeft de hele lead met opvolgconcept en open taken', async () => {
    const d = data(await voerToolUit('bekijk_lead', { lead_id: 'L012' }, context()));
    expect(d.lead).toMatchObject({ id: 'L012', bedrijf: 'Meubelmakerij Nerf', email: 'anke@meubelmakerijnerf.example', dagen_sinds_voorstel: 14 });
    expect(d.lead.opvolgconcept.onderwerp).toBe('Jullie voorstel: nog vragen over de landingspagina?');
    expect(d.open_taken.map((t: any) => t.id)).toEqual(['TK10']);
    expect(d.laatste_activiteiten).toEqual([]);
  });

  it('een onbekende lead, ongeldige invoer of een onbekende tool geeft isError met een bruikbare melding, nooit een exception', async () => {
    expect(foutTekst(await voerToolUit('bekijk_lead', { lead_id: 'L099' }, context()))).toMatch(/L099.*zoek_leads/);
    expect(foutTekst(await voerToolUit('bekijk_lead', { lead_id: 'L12' }, context()))).toMatch(/lead_id/);
    expect(foutTekst(await voerToolUit('bekijk_lead', { lead_id: 'L012', extra: true }, context()))).toMatch(/extra/);
    expect(foutTekst(await voerToolUit('bekijk_lead', null, context()))).toMatch(/lead_id/);
    expect(foutTekst(await voerToolUit('zoek_leads', { max: 500 }, context()))).toMatch(/max/);
    expect(foutTekst(await voerToolUit('verwijder_lead', { lead_id: 'L012' }, context()))).toMatch(/Onbekende tool.*zoek_leads/);
  });

  it('maak_taak maakt een open agent-taak met id, bron agent en de Nederlandse datum van vandaag', async () => {
    const ctx = context();
    const crm = ctx.crm as ReturnType<typeof vonkCrm>;
    const d = data(
      await voerToolUit('maak_taak', { titel: 'Nieuw voorstel Theehuis Blad', toegewezen_aan: 'T02', deadline: '2026-11-04', lead_id: 'L010' }, ctx),
    );
    expect(d.status).toBe('aangemaakt');
    expect(d.taak).toEqual({
      id: 'nieuw-1',
      titel: 'Nieuw voorstel Theehuis Blad',
      omschrijving: '',
      toegewezen_aan: 'T02',
      klant_id: null,
      lead_id: 'L010',
      deadline: '2026-11-04',
      status: 'open',
      prioriteit: 'normaal',
      bron: 'agent',
      aangemaakt_op: '2026-11-02',
    });
    expect(crm.taken).toHaveLength(18);
  });

  it('maak_taak is idempotent: dezelfde open taak (ook met andere hoofdletters) komt er niet nog eens bij', async () => {
    const ctx = context();
    const crm = ctx.crm as ReturnType<typeof vonkCrm>;
    const invoer = { titel: 'Nieuw voorstel Theehuis Blad', toegewezen_aan: 'T02', deadline: '2026-11-04', lead_id: 'L010' };
    await voerToolUit('maak_taak', invoer, ctx);
    const tweede = data(await voerToolUit('maak_taak', { ...invoer, titel: 'nieuw voorstel theehuis blad' }, ctx));
    expect(tweede.status).toBe('bestond_al');
    const bestaand = data(
      await voerToolUit('maak_taak', { titel: 'Opvolgconcept Meubelmakerij Nerf nakijken en versturen', toegewezen_aan: 'T02', deadline: '2026-11-03', lead_id: 'L012' }, ctx),
    );
    expect(bestaand).toMatchObject({ status: 'bestond_al', taak: { id: 'TK10' } });
    expect(crm.taken).toHaveLength(18);
  });

  it('maak_taak weigert twee koppelingen, geen koppeling, een deadline in het verleden en een onbekend teamlid', async () => {
    const basis = { titel: 'Bel Ruben over de hoezen', toegewezen_aan: 'T02', deadline: '2026-11-04' };
    expect(foutTekst(await voerToolUit('maak_taak', { ...basis, lead_id: 'L011', klant_id: 'K01' }, context()))).toMatch(/precies één/);
    expect(foutTekst(await voerToolUit('maak_taak', basis, context()))).toMatch(/precies één/);
    expect(foutTekst(await voerToolUit('maak_taak', { ...basis, klant_id: 'K01', deadline: '2026-10-30' }, context()))).toMatch(/verleden/);
    expect(foutTekst(await voerToolUit('maak_taak', { ...basis, klant_id: 'K01', toegewezen_aan: 'T09' }, context()))).toMatch(/T09/);
  });

  it('voeg_notitie_toe legt een notitie vast met de naam van het profiel, en niet twee keer op dezelfde dag', async () => {
    const ctx = context();
    const crm = ctx.crm as ReturnType<typeof vonkCrm>;
    const invoer = { lead_id: 'L013', samenvatting: 'Voorstel staat 11 dagen uit. Partners overleggen nog.' };
    const d = data(await voerToolUit('voeg_notitie_toe', invoer, ctx));
    expect(d.activiteit).toEqual({
      id: 'nieuw-1',
      type: 'notitie',
      lead_id: 'L013',
      klant_id: null,
      door: 'T06',
      samenvatting: invoer.samenvatting,
      aangemaakt_op: NU.toISOString(),
    });
    expect(data(await voerToolUit('voeg_notitie_toe', invoer, ctx)).status).toBe('bestond_al');
    expect(crm.activiteiten).toHaveLength(1);
    const lead = data(await voerToolUit('bekijk_lead', { lead_id: 'L013' }, ctx));
    expect(lead.laatste_activiteiten).toHaveLength(1);
  });

  it('kill-switch: met agents_actief op "false" schrijft geen tool iets; lezen blijft werken', async () => {
    // schrijvenToegestaan is gegeven (gebouwd in M01). Deze test toetst stap 4 van voerToolUit.
    const crm = vonkCrm();
    crm.zetInstelling('agents_actief', 'false');
    const ctx = context('milan-claude-code', crm);
    expect(foutTekst(await voerToolUit('maak_taak', { titel: 'Bel Ruben over de hoezen', toegewezen_aan: 'T02', deadline: '2026-11-04', klant_id: 'K01' }, ctx))).toMatch(/kill-switch/i);
    expect(foutTekst(await voerToolUit('voeg_notitie_toe', { lead_id: 'L011', samenvatting: 'Ruud belt terug.' }, ctx))).toMatch(/kill-switch/i);
    expect(crm.taken).toHaveLength(17);
    expect(crm.activiteiten).toHaveLength(0);
    expect(data(await voerToolUit('zoek_leads', {}, ctx)).aantal).toBe(24);
  });

  it('een crash in het CRM geeft isError zonder interne details', async () => {
    const crm = vonkCrm();
    const kapot: Crm = { ...crm, zoekLeads: async () => { throw new Error('connect ECONNREFUSED 10.0.0.12:5432'); } };
    const tekst = foutTekst(await voerToolUit('zoek_leads', {}, context('milan-claude-code', kapot)));
    expect(tekst).not.toMatch(/10\.0\.0\.12|ECONNREFUSED|at /);
  });
});

// ---------------------------------------------------------------------------

describe('5.2 koppelen aan je eigen agent', () => {
  it('naarClaudeTools zet name, description en inputSchema om naar het formaat van de Messages API', () => {
    const tools = naarClaudeTools(TOOLS);
    expect(tools).toHaveLength(4);
    expect(tools[1]).toEqual({ name: 'bekijk_lead', description: TOOLS[1].description, input_schema: TOOLS[1].inputSchema });
    expect('strict' in tools[1]).toBe(false);
  });

  it('met strict: true verdwijnen grenzen en $schema, de grens staat in de beschrijving en de API (nep-client) accepteert ze', async () => {
    const tools = naarClaudeTools(TOOLS, { strict: true });
    const tekst = JSON.stringify(tools);
    for (const woord of ['"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"pattern"', '"$schema"']) expect(tekst).not.toContain(woord);
    const taak = tools.find((t) => t.name === 'maak_taak')! as any;
    expect(taak.strict).toBe(true);
    expect(taak.input_schema.additionalProperties).toBe(false);
    expect(taak.input_schema.properties.titel.description).toMatch(/maxLength 120/);
    expect(taak.input_schema.properties.deadline.format).toBe('date');
    expect(TOOLS[2].inputSchema).toHaveProperty('properties.titel.maxLength', 120); // origineel blijft heel

    const client = maakNepClient([tekstAntwoord('ok')]);
    await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 100, tools, messages: [{ role: 'user', content: 'test' }] });
    expect(client.aantalAanroepen).toBe(1);
  });

  it('naarToolResult zet isError om naar is_error en voegt tekstblokken samen', () => {
    expect(naarToolResult('toolu_1', { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'a\nb',
    });
    expect(naarToolResult('toolu_2', { content: [{ type: 'text', text: 'mis' }], isError: true })).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_2',
      content: 'mis',
      is_error: true,
    });
    expect(naarToolResult('toolu_3', { content: [{ type: 'image' }] }).content).toMatch(/image/);
    expect(naarToolResult('toolu_4', { content: [], structuredContent: { aantal: 2 } }).content).toBe('{"aantal":2}');
  });

  it('lokaleVerbinding geeft de tools van toolsVoor, met alleen name, description en inputSchema', async () => {
    // Na les 5.5 zijn dat er voor de opvolg-agent drie; deze test hangt daar niet van af.
    const { tools } = await lokaleVerbinding(context('opvolg-agent')).listTools();
    expect(tools.map((t) => t.name)).toEqual(toolsVoor(PROFIELEN['opvolg-agent']).map((t) => t.name));
    expect(Object.keys(tools[0]).sort()).toEqual(['description', 'inputSchema', 'name']);
    expect(tools[0].inputSchema.type).toBe('object');
  });

  it('draaiMetMcp: zoeken, notitie toevoegen, eindantwoord, met strict tools en tool_results in de juiste vorm', async () => {
    const ctx = context('opvolg-agent');
    const crm = ctx.crm as ReturnType<typeof vonkCrm>;
    const client = maakNepClient([
      toolAntwoord('zoek_leads', { status: 'voorstel_verstuurd' }),
      toolAntwoord('voeg_notitie_toe', { lead_id: 'L013', samenvatting: 'Voorstel 11 dagen uit, opvolging nodig.' }),
      tekstAntwoord('Bij L013 staat nu een notitie.'),
    ]);
    const uitkomst = await draaiMetMcp(client, lokaleVerbinding(ctx), 'Welke voorstellen moeten opgevolgd worden?', {
      model: 'claude-sonnet-5-5',
      maxRondes: 5,
    });
    expect(uitkomst.antwoord).toBe('Bij L013 staat nu een notitie.');
    expect(uitkomst.aanroepen).toEqual([
      { naam: 'zoek_leads', invoer: { status: 'voorstel_verstuurd' }, isError: false },
      { naam: 'voeg_notitie_toe', invoer: { lead_id: 'L013', samenvatting: 'Voorstel 11 dagen uit, opvolging nodig.' }, isError: false },
    ]);
    const eerste = client.aanroepen[0];
    expect(eerste.tools?.map((t: any) => t.name)).toEqual(toolsVoor(PROFIELEN['opvolg-agent']).map((t) => t.name));
    expect(eerste.tools?.every((t: any) => t.strict === true)).toBe(true);
    const [resultaat] = toolResultatenIn(client.aanroepen[1]);
    expect(String(resultaat.content)).toContain('L011');
    expect(resultaat.is_error).toBeUndefined();
    expect(crm.activiteiten).toHaveLength(1);
    expect(crm.activiteiten[0].door).toBe('agent:opvolg');
  });

  it('een tool die niet in tools/list stond, een toolfout of een protocolfout komt terug als is_error en de lus gaat door', async () => {
    const ctx = context('opvolg-agent');
    const echt = lokaleVerbinding(ctx);
    const verbinding: McpVerbinding = {
      // Deze server toont maak_taak niet, wat het profiel ook mag (dat regelt les 5.5).
      listTools: async () => ({ tools: (await echt.listTools()).tools.filter((t) => t.name !== 'maak_taak') }),
      callTool: async (p) => {
        if (p.arguments?.lead_id === 'L014') throw new Error('MCP error -32602: verbinding verbroken');
        return echt.callTool(p);
      },
    };
    const client = maakNepClient([
      toolAntwoord('maak_taak', { titel: 'Bel Charlotte', toegewezen_aan: 'T01', deadline: '2026-11-04', lead_id: 'L014' }),
      toolAntwoord('bekijk_lead', { lead_id: 'L099' }),
      toolAntwoord('bekijk_lead', { lead_id: 'L014' }),
      tekstAntwoord('Dat lukte niet allemaal.'),
    ]);
    const uitkomst = await draaiMetMcp(client, verbinding, 'Doe iets', { model: 'claude-sonnet-5-5', maxRondes: 6 });
    expect(uitkomst.aanroepen.map((a) => a.isError)).toEqual([true, true, true]);
    const melding = (n: number) => toolResultatenIn(client.aanroepen[n])[0];
    expect(melding(1)).toMatchObject({ is_error: true });
    expect(String(melding(1).content)).toMatch(/maak_taak/);
    expect(String(melding(2).content)).toMatch(/L099/);
    expect(String(melding(3).content)).toMatch(/verbroken/);
    expect(uitkomst.antwoord).toBe('Dat lukte niet allemaal.');
  });

  it('stopt met een fout na maxRondes', async () => {
    const client = maakNepClient([], { daarnaSteeds: toolAntwoord('zoek_leads', {}) });
    await expect(draaiMetMcp(client, lokaleVerbinding(context()), 'blijf zoeken', { model: 'claude-sonnet-5-5', maxRondes: 2 })).rejects.toThrow(
      /Maximaal aantal rondes \(2\)/,
    );
    expect(client.aantalAanroepen).toBe(2);
  });
});

// ---------------------------------------------------------------------------

const GMAIL_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

describe('5.3 scopes', () => {
  it('SCOPES bevat de classificatie van Google voor de belangrijkste scopes', () => {
    const klasse = (s: string) => SCOPES.find((i) => i.scope === s)?.klasse;
    expect(klasse(DRIVE_FILE)).toBe('niet_gevoelig');
    expect(klasse('https://www.googleapis.com/auth/gmail.send')).toBe('gevoelig');
    expect(klasse('https://www.googleapis.com/auth/gmail.readonly')).toBe('beperkt');
    expect(klasse(GMAIL_COMPOSE)).toBe('beperkt');
    expect(klasse('https://mail.google.com/')).toBe('beperkt');
  });

  it('normaliseerScope maakt van een korte Google-scope de volledige URI en laat Slack-scopes staan', () => {
    expect(normaliseerScope('gmail.compose')).toBe(GMAIL_COMPOSE);
    expect(normaliseerScope(' drive.file ')).toBe(DRIVE_FILE);
    expect(normaliseerScope('https://mail.google.com/')).toBe('https://mail.google.com/');
    expect(normaliseerScope('chat:write')).toBe('chat:write');
  });

  it('minimaleScopes geeft per platform de smalste set, zonder dubbele', () => {
    expect(minimaleScopes(['mail_concept_maken', 'bestanden_van_de_app', 'slack_bericht_plaatsen', 'slack_vermeldingen_lezen', 'mail_concept_maken'])).toEqual({
      google: [DRIVE_FILE, GMAIL_COMPOSE],
      slack: ['app_mentions:read', 'chat:write'],
    });
    expect(minimaleScopes(['slack_emailadressen_lezen']).slack).toEqual(['users:read', 'users:read.email']);
    expect(minimaleScopes(['agenda_lezen']).google).toEqual(['https://www.googleapis.com/auth/calendar.events.readonly']);
  });

  it('controleerScopes vindt te brede scopes en wat er ontbreekt', () => {
    const o = controleerScopes(['https://mail.google.com/', 'drive'], ['mail_concept_maken', 'bestanden_van_de_app']);
    expect(o.ok).toBe(false);
    expect(o.ontbreekt).toEqual([DRIVE_FILE, GMAIL_COMPOSE]);
    expect(o.overbodig).toEqual(['https://mail.google.com/', 'https://www.googleapis.com/auth/drive']);
    expect(o.beperkt).toEqual(['https://mail.google.com/', 'https://www.googleapis.com/auth/drive']);
  });

  it('de smalste set is ok, maar waarschuwt dat gmail.compose ook kan versturen', () => {
    const o = controleerScopes(['gmail.compose', 'drive.file', 'chat:write'], ['mail_concept_maken', 'bestanden_van_de_app', 'slack_bericht_plaatsen']);
    expect(o).toMatchObject({ ok: true, ontbreekt: [], overbodig: [], onbekend: [], beperkt: [GMAIL_COMPOSE] });
    expect(o.waarschuwingen.join(' ')).toMatch(/versturen/);
  });

  it('onbekende scopes en users:read.email zonder users:read worden gemeld', () => {
    const o = controleerScopes(['users:read.email', 'gmail.readwrite'], ['slack_emailadressen_lezen']);
    expect(o.ok).toBe(false);
    expect(o.onbekend).toEqual(['https://www.googleapis.com/auth/gmail.readwrite']);
    expect(o.ontbreekt).toEqual(['users:read']);
    expect(o.waarschuwingen.join(' ')).toMatch(/users:read/);
  });
});

// ---------------------------------------------------------------------------

// De voorbeeldwaarden uit de documentatie van Slack ("Verifying requests from Slack").
const SLACK_GEHEIM = '8f742231b10e8888abcd99yyyzzz85a5';
const SLACK_TIJD = '1531420618';
const SLACK_BODY =
  'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar' +
  '&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2F' +
  'hooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=39873866' +
  '3015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
const SLACK_HANDTEKENING = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';
const SLACK_NU = new Date(Number(SLACK_TIJD) * 1000);

const WEBHOOK_GEHEIM = 'test-geheim-vonk';
const WEBHOOK_NU = new Date('2026-11-02T08:15:00Z');

async function slackVerzoek(body: string, opties: { geheim?: string; tijd?: Date; extraHeaders?: Record<string, string> } = {}) {
  const tijd = String(Math.floor((opties.tijd ?? WEBHOOK_NU).getTime() / 1000));
  const handtekening = await slackHandtekening(opties.geheim ?? WEBHOOK_GEHEIM, tijd, body);
  return {
    methode: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Slack-Request-Timestamp': tijd, 'X-Slack-Signature': handtekening, ...opties.extraHeaders },
    rawBody: body,
  };
}

const mentionBody = (eventId: string) =>
  JSON.stringify({
    token: 'XXYYZZ',
    team_id: 'T123ABC456',
    api_app_id: 'A123ABC456',
    type: 'event_callback',
    event_id: eventId,
    event_time: 1793607300,
    event: { type: 'app_mention', user: 'U061F7AUR', text: '<@U0LAN0Z89> maak een taak: Ruben bellen over de hoezen', ts: '1793607300.000016', channel: 'C123ABC456' },
  });

describe('5.4 webhooks', () => {
  it('slackHandtekening maakt de handtekening uit het voorbeeld van Slack', async () => {
    expect(await slackHandtekening(SLACK_GEHEIM, SLACK_TIJD, SLACK_BODY)).toBe(SLACK_HANDTEKENING);
  });

  it('controleerSlackVerzoek accepteert het voorbeeld en weigert alles wat ouder of jonger is dan 5 minuten', async () => {
    const headers = { 'X-Slack-Signature': SLACK_HANDTEKENING, 'X-Slack-Request-Timestamp': SLACK_TIJD };
    const verzoek = { headers, rawBody: SLACK_BODY };
    expect(await controleerSlackVerzoek(verzoek, SLACK_GEHEIM, SLACK_NU)).toEqual({ ok: true });
    expect(await controleerSlackVerzoek(verzoek, SLACK_GEHEIM, new Date(SLACK_NU.getTime() + 300_000))).toEqual({ ok: true });
    expect(await controleerSlackVerzoek(verzoek, SLACK_GEHEIM, new Date(SLACK_NU.getTime() + 301_000))).toEqual({ ok: false, reden: 'te_oud' });
    expect(await controleerSlackVerzoek(verzoek, SLACK_GEHEIM, new Date(SLACK_NU.getTime() - 301_000))).toEqual({ ok: false, reden: 'te_oud' });
  });

  it('weigert een gewijzigde body, een verkeerd geheim, ontbrekende headers en een rare tijdstempel', async () => {
    const headers = { 'x-slack-signature': SLACK_HANDTEKENING, 'x-slack-request-timestamp': SLACK_TIJD };
    const fout = (reden: string) => ({ ok: false, reden });
    expect(await controleerSlackVerzoek({ headers, rawBody: SLACK_BODY.replace('foobar', 'foobaz') }, SLACK_GEHEIM, SLACK_NU)).toEqual(fout('handtekening_onjuist'));
    expect(await controleerSlackVerzoek({ headers, rawBody: SLACK_BODY }, 'ander-geheim', SLACK_NU)).toEqual(fout('handtekening_onjuist'));
    expect(await controleerSlackVerzoek({ headers: { ...headers, 'x-slack-signature': 'v0=abc' }, rawBody: SLACK_BODY }, SLACK_GEHEIM, SLACK_NU)).toEqual(
      fout('handtekening_onjuist'),
    );
    expect(await controleerSlackVerzoek({ headers: { 'x-slack-request-timestamp': SLACK_TIJD }, rawBody: SLACK_BODY }, SLACK_GEHEIM, SLACK_NU)).toEqual(
      fout('handtekening_ontbreekt'),
    );
    expect(await controleerSlackVerzoek({ headers, rawBody: SLACK_BODY }, '', SLACK_NU)).toEqual(fout('handtekening_ontbreekt'));
    expect(await controleerSlackVerzoek({ headers: { ...headers, 'x-slack-request-timestamp': 'gisteren' }, rawBody: SLACK_BODY }, SLACK_GEHEIM, SLACK_NU)).toEqual(
      fout('tijdstempel_ongeldig'),
    );
  });

  it('ontvangSlackWebhook beantwoordt url_verification met de challenge als platte tekst', async () => {
    const inbox = maakGeheugenInbox();
    const body = JSON.stringify({ token: 'Jhj5dZrVaK7ZwHHjRyZWjbDl', challenge: '3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P', type: 'url_verification' });
    const antwoord = await ontvangSlackWebhook(await slackVerzoek(body), { geheim: WEBHOOK_GEHEIM, nu: WEBHOOK_NU, inbox });
    expect(antwoord).toMatchObject({ status: 200, body: '3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P' });
    expect(antwoord.headers['content-type']).toBe('text/plain');
    expect(inbox.rijen).toHaveLength(0);
  });

  it('slaat een event één keer op: een herhaling van Slack (andere tijd, nieuwe handtekening) geeft dubbel', async () => {
    const inbox = maakGeheugenInbox();
    const deps = { geheim: WEBHOOK_GEHEIM, nu: WEBHOOK_NU, inbox };
    const eerste = await ontvangSlackWebhook(await slackVerzoek(mentionBody('Ev08MFMKH6')), deps);
    expect(eerste.status).toBe(200);
    expect(JSON.parse(eerste.body)).toEqual({ status: 'nieuw' });
    expect(inbox.rijen).toHaveLength(1);
    expect(inbox.rijen[0]).toMatchObject({ gebeurtenis_id: 'Ev08MFMKH6', bron: 'slack', soort: 'app_mention', ontvangen_op: WEBHOOK_NU.toISOString() });

    const later = new Date(WEBHOOK_NU.getTime() + 60_000);
    const herhaling = await slackVerzoek(mentionBody('Ev08MFMKH6'), { tijd: later, extraHeaders: { 'X-Slack-Retry-Num': '1', 'X-Slack-Retry-Reason': 'http_timeout' } });
    const tweede = await ontvangSlackWebhook(herhaling, { ...deps, nu: later });
    expect(tweede.status).toBe(200);
    expect(JSON.parse(tweede.body)).toEqual({ status: 'dubbel' });
    expect(inbox.rijen).toHaveLength(1);
  });

  it('weigert met 401 voordat er iets gelezen of opgeslagen wordt, en geeft 405 en 400 waar dat hoort', async () => {
    const inbox = maakGeheugenInbox();
    const deps = { geheim: WEBHOOK_GEHEIM, nu: WEBHOOK_NU, inbox };
    const vervalst = await slackVerzoek(mentionBody('Ev1'), { geheim: 'gok' });
    expect((await ontvangSlackWebhook(vervalst, deps)).status).toBe(401);
    const oud = await slackVerzoek(mentionBody('Ev2'), { tijd: new Date(WEBHOOK_NU.getTime() - 10 * 60_000) });
    expect(JSON.parse((await ontvangSlackWebhook(oud, deps)).body)).toEqual({ fout: 'te_oud' });
    expect((await ontvangSlackWebhook({ ...(await slackVerzoek(mentionBody('Ev3'))), methode: 'GET' }, deps)).status).toBe(405);
    expect((await ontvangSlackWebhook(await slackVerzoek('{kapot'), deps)).status).toBe(400);
    const anders = await ontvangSlackWebhook(await slackVerzoek(JSON.stringify({ type: 'app_rate_limited' })), deps);
    expect(JSON.parse(anders.body)).toEqual({ status: 'genegeerd' });
    expect(inbox.rijen).toHaveLength(0);
  });

  it('controleert de ruwe body, niet een opnieuw opgebouwde JSON', async () => {
    const inbox = maakGeheugenInbox();
    const ruw = `{ "type": "event_callback",\n  "event_id": "EvRuw1", "event": { "type": "app_mention", "text": "café" } }`;
    const antwoord = await ontvangSlackWebhook(await slackVerzoek(ruw), { geheim: WEBHOOK_GEHEIM, nu: WEBHOOK_NU, inbox });
    expect(antwoord.status).toBe(200);
    expect(inbox.rijen.map((r) => r.gebeurtenis_id)).toEqual(['EvRuw1']);
  });
});

// ---------------------------------------------------------------------------

describe('5.5 rechten per tool en per klant', () => {
  it('magTool en toolsVoor: de opvolg-agent kan geen taken maken en ziet die tool niet eens', () => {
    expect(magTool(PROFIELEN['opvolg-agent'], 'maak_taak')).toBe(false);
    expect(magTool(PROFIELEN['opvolg-agent'], 'voeg_notitie_toe')).toBe(true);
    expect(magTool(PROFIELEN['milan-claude-code'], 'voer_sql_uit')).toBe(false);
    expect(toolsVoor(PROFIELEN['opvolg-agent']).map((t) => t.name)).toEqual(['zoek_leads', 'bekijk_lead', 'voeg_notitie_toe']);
    expect(toolsVoor(PROFIELEN['daan-assistent'])).toHaveLength(4);
  });

  it('voerToolUit weigert een tool buiten het profiel en schrijft dan niets', async () => {
    const ctx = context('opvolg-agent');
    const crm = ctx.crm as ReturnType<typeof vonkCrm>;
    const r = await voerToolUit('maak_taak', { titel: 'Nieuw voorstel Theehuis Blad', toegewezen_aan: 'T02', deadline: '2026-11-04', lead_id: 'L010' }, ctx);
    expect(foutTekst(r)).toMatch(/opvolg-agent.*maak_taak/);
    expect(crm.taken).toHaveLength(17);
  });

  it('binnenKlantScope: "alle" geldt niet voor klanten met gevoelige gegevens; die moet je expliciet noemen', () => {
    const k01 = { id: 'K01', gevoelige_gegevens: false };
    const k02 = { id: 'K02', gevoelige_gegevens: true };
    const k03 = { id: 'K03', gevoelige_gegevens: false };
    expect(binnenKlantScope(PROFIELEN['milan-claude-code'], k01)).toBe(true);
    expect(binnenKlantScope(PROFIELEN['milan-claude-code'], k02)).toBe(false);
    expect(binnenKlantScope(PROFIELEN['daan-assistent'], k02)).toBe(true);
    expect(binnenKlantScope(PROFIELEN['daan-assistent'], k03)).toBe(false);
    expect(binnenKlantScope(PROFIELEN['opvolg-agent'], k01)).toBe(false);
    expect(binnenKlantScope(PROFIELEN['opvolg-agent'], null)).toBe(true);
  });

  it('een lead van een klant buiten de scope bestaat niet voor dat profiel: zelfde melding, geen gegevens', async () => {
    const buiten = foutTekst(await voerToolUit('bekijk_lead', { lead_id: 'L019' }, context('daan-assistent')));
    const onbekend = foutTekst(await voerToolUit('bekijk_lead', { lead_id: 'L099' }, context('daan-assistent')));
    expect(buiten).not.toMatch(/TechNest|bas@|Bas/);
    expect(buiten.replace('L019', 'L099')).toBe(onbekend);
    const zoek = (profiel: string) => voerToolUit('zoek_leads', { status: 'gewonnen' }, context(profiel)).then((r) => data(r).leads.map((l: any) => l.id));
    expect(await zoek('daan-assistent')).toEqual(['L020', 'L021']);
    expect(await zoek('milan-claude-code')).toEqual(['L019', 'L020', 'L021']);
    expect(await zoek('opvolg-agent')).toEqual(['L021']);
  });

  it('schrijven per klant: Daan mag bij K01 en K02, niet bij K03; Milan niet bij FysioPunt (K02)', async () => {
    const taak = (klant_id: string) => ({ titel: 'Maandrapport oktober doorspreken', toegewezen_aan: 'T02', deadline: '2026-11-05', klant_id });
    expect(data(await voerToolUit('maak_taak', taak('K01'), context('daan-assistent'))).status).toBe('aangemaakt');
    expect(data(await voerToolUit('maak_taak', taak('K02'), context('daan-assistent'))).status).toBe('aangemaakt');
    expect(foutTekst(await voerToolUit('maak_taak', taak('K03'), context('daan-assistent')))).toMatch(/K03/);
    expect(foutTekst(await voerToolUit('maak_taak', taak('K02'), context('milan-claude-code')))).toMatch(/K02/);
    expect(foutTekst(await voerToolUit('voeg_notitie_toe', { klant_id: 'K02', samenvatting: 'Nieuwe locatie loopt goed.' }, context('milan-claude-code')))).toMatch(/K02/);
    expect(foutTekst(await voerToolUit('voeg_notitie_toe', { lead_id: 'L019', samenvatting: 'Bas wil meer werkgeversleads.' }, context('daan-assistent')))).toMatch(/L019/);
  });

  it('profielVoorToken koppelt een Bearer-token aan een profiel en weigert al het andere', () => {
    const tokens = { 'tok-daan-7f3a': 'daan-assistent', 'tok-opvolg-91c2': 'opvolg-agent', 'tok-oud': 'bestaat-niet' };
    expect(profielVoorToken('Bearer tok-daan-7f3a', tokens)?.naam).toBe('daan-assistent');
    expect(profielVoorToken('bearer tok-opvolg-91c2', tokens)?.naam).toBe('opvolg-agent');
    expect(profielVoorToken('tok-daan-7f3a', tokens)).toBeNull();
    expect(profielVoorToken('Bearer tok-daan', tokens)).toBeNull();
    expect(profielVoorToken('Bearer tok-oud', tokens)).toBeNull();
    expect(profielVoorToken(undefined, tokens)).toBeNull();
    expect(profielVoorToken('Bearer ', tokens)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Oefeningen met een eigen testgroep. Ze tellen mee voor de bewijs-poort van hun les.

describe('oefening 5.1 · min_dagen', () => {
  it('zoek_leads met min_dagen 7 geeft alleen voorstellen die minstens 7 dagen uitstaan', async () => {
    const d = data(await voerToolUit('zoek_leads', { status: 'voorstel_verstuurd', min_dagen: 7, max: 25 }, context()));
    expect(d.leads.map((l: any) => l.id)).toEqual(['L010', 'L011', 'L012', 'L013', 'L014', 'L015']);
    expect(d.aantal).toBe(6);
    const zonderVoorstel = data(await voerToolUit('zoek_leads', { status: 'nieuw', min_dagen: 0 }, context()));
    expect(zonderVoorstel.aantal).toBe(0); // leads zonder voorstel vallen af
  });

  it('min_dagen staat in het inputSchema als geheel getal, en een negatieve waarde is ongeldige invoer', async () => {
    expect((TOOLS[0].inputSchema as any).properties.min_dagen.type).toBe('integer');
    expect(foutTekst(await voerToolUit('zoek_leads', { min_dagen: -1 }, context()))).toMatch(/min_dagen/);
  });
});

describe('oefening 5.5 · fleur-planning', () => {
  it('Fleur (T07) heeft een eigen profiel met alleen bekijk_lead en maak_taak', () => {
    const fleur = PROFIELEN['fleur-planning'];
    expect(fleur).toMatchObject({ naam: 'fleur-planning', door: 'T07' });
    expect(toolsVoor(fleur).map((t) => t.name)).toEqual(['bekijk_lead', 'maak_taak']);
  });

  it('Fleur maakt een taak bij Korrel (K06), wordt geweigerd bij FysioPunt (K02) en kan niet zoeken', async () => {
    const taak = (klant_id: string) => ({ titel: 'Factuur november klaarzetten', toegewezen_aan: 'T07', deadline: '2026-11-05', klant_id });
    expect(data(await voerToolUit('maak_taak', taak('K06'), context('fleur-planning'))).status).toBe('aangemaakt');
    expect(foutTekst(await voerToolUit('maak_taak', taak('K02'), context('fleur-planning')))).toMatch(/K02/);
    expect(foutTekst(await voerToolUit('zoek_leads', {}, context('fleur-planning')))).toMatch(/fleur-planning.*zoek_leads/);
  });
});

import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  AVG_NOTITIE,
  type Aanvraag,
  type IntakeUitkomst,
  INTAKE_INSTRUCTIE,
  IntakeFout,
  type Meting,
  ModelLead,
  STANDAARD_CONFIG,
  UITWIJK_MODEL,
  bepaalPakket,
  bepaalVolgendeStap,
  bouwBatch,
  bouwVerzoek,
  cacheGelezen,
  crmSql,
  draaiMeting,
  kiesConfiguratie,
  kostenUsd,
  kostenVergelijking,
  leadSchema,
  leesBudget,
  leesFormulier,
  leesLead,
  leesLeadMetUitwijk,
  leesMailAanvraag,
  maakDoorvraagconcept,
  maakLead,
  nauwkeurigheidPerVeld,
  normaliseerEmail,
  normaliseerTelefoon,
  scoorUitkomst,
  vatMetingenSamen,
  verwerkAanvraag,
  verwerkBatchResultaten,
  verwerkInbox,
  verwerkVeilig,
  zoekBekende,
} from '@opdracht/m02-lead-intake';
import {
  type NepAntwoord,
  NepApiFout,
  jsonAntwoord,
  maakNepClient,
  systemTekst,
  tekstAntwoord,
  userTekst,
} from '../../../test-hulp/nepClient';
import { laadFormulierVerwachtingen, laadFormulieren, laadKlanten, laadLeads, leesMail } from '../../../test-hulp/vonkData';

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

type Params = Anthropic.MessageCreateParamsNonStreaming;

/** Per bestand het antwoord van een goed werkend model (fictief, zie data/modeluitvoer.json). */
const MODELUITVOER = JSON.parse(readFileSync(new URL('../data/modeluitvoer.json', import.meta.url), 'utf8')) as Record<
  string,
  Record<string, unknown>
>;

const NU = new Date('2026-11-02T08:15:00Z');
const crm = () => ({ leads: laadLeads(), klanten: laadKlanten() });

function formulieren(): Aanvraag[] {
  return laadFormulieren().map((f) => leesFormulier(f.bestand, f.ruw));
}
function formulier(bestand: string): Aanvraag {
  const f = laadFormulieren().find((x) => x.bestand === bestand);
  if (!f) throw new Error(`Geen formulier ${bestand}`);
  return leesFormulier(f.bestand, f.ruw);
}
const LEADMAILS = ['01-nieuwe-lead-doorverwijzing.txt', '13-lead-met-verborgen-injectie.txt'];
function mails(): Aanvraag[] {
  return LEADMAILS.map((b) => leesMailAanvraag(leesMail(b)));
}

function uitvoer(bestand: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const u = MODELUITVOER[bestand];
  if (!u) throw new Error(`Geen modeluitvoer voor ${bestand}`);
  return { ...u, ...extra };
}

function bestandIn(params: Params): string {
  const match = /<aanvraag bestand="([^"]+)">/.exec(userTekst(params));
  if (!match) throw new Error('Het user-bericht heeft geen <aanvraag bestand="...">.');
  return match[1];
}

/** Een nep-client die voor elke aanvraag het antwoord uit modeluitvoer.json geeft, met afwijkingen per bestand. */
function modelClient(afwijkingen: Record<string, NepAntwoord> = {}, usage = { input_tokens: 2100, output_tokens: 350 }) {
  return maakNepClient([], {
    daarnaSteeds: (params) => {
      const bestand = bestandIn(params);
      return afwijkingen[bestand] ?? { content: [{ type: 'text', text: JSON.stringify(uitvoer(bestand)) }], stop_reason: 'end_turn', usage };
    },
  });
}

function bericht(tekst: string, stop_reason: Anthropic.StopReason = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_batch',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: tekst, citations: null }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function alleObjecten(schema: unknown, pad = 'schema'): Array<[string, Record<string, unknown>]> {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const eigen: Array<[string, Record<string, unknown>]> = s.type === 'object' ? [[pad, s]] : [];
  const kinderen = Object.entries(s).flatMap(([k, v]) => {
    if (k === 'properties' && v && typeof v === 'object') {
      return Object.entries(v).flatMap(([naam, sub]) => alleObjecten(sub, `${pad}.${naam}`));
    }
    return k === 'items' ? alleObjecten(v, `${pad}[]`) : [];
  });
  return [...eigen, ...kinderen];
}

const ONZICHTBAAR = /[\u{E0000}-\u{E007F}\u200B-\u200D\u2060\uFEFF]/u;

// ---------------------------------------------------------------------------

describe('2.1 · contract', () => {
  it('leesFormulier leest JSON- en tekstformulieren in één vorm', () => {
    const alle = formulieren();
    expect(alle).toHaveLength(10);
    for (const a of alle) {
      expect(a.bron, a.bestand).toBe('formulier');
      expect(a.velden, a.bestand).not.toBeNull();
      expect(a.tekst, a.bestand).not.toContain('\r');
      expect(a.tekst.startsWith('Bron: contactformulier\nNaam: '), a.bestand).toBe(true);
      expect(a.tekst, a.bestand).toContain(a.velden?.bericht.slice(0, 20));
      expect(a.onzichtbare_tekens, a.bestand).toBe(0);
    }
    const b2b = formulier('08-compleet-b2b.txt');
    expect(b2b.velden).toMatchObject({ naam: 'Marieke Smit-Jansen', email: 'm.smit@balansenco.example', interesse: ['LinkedIn Ads'] });
    expect(b2b.velden?.bericht.startsWith('Goedemorgen')).toBe(true);
    expect(b2b.velden?.bericht).not.toMatch(/automatisch verstuurd/);
    expect(b2b.ontvangen_op).toBe('2026-11-02T07:31');
    expect(formulier('03-vaag.txt').velden).toMatchObject({ naam: 'jeroen', bedrijf: '', interesse: [], maandbudget: 'Weet ik nog niet' });
    expect(formulier('07-dubbel-bestaande-lead.json').afzender).toBe('priya@yogastudioadem.example');
    expect(formulier('04-engels.json')).toMatchObject({ ontvangen_op: '2026-10-31T14:22:31+01:00', afzender: 'hannah@toteandthread.example' });
  });

  it('leesMailAanvraag maakt van een mail dezelfde vorm, zonder onzichtbare tekens', () => {
    const [wiek, kist] = mails();
    expect(wiek).toMatchObject({
      bron: 'mail',
      velden: null,
      afzender: 'floor@kaarsenmakerijwiek.example',
      onzichtbare_tekens: 0,
      ontvangen_op: '2026-11-01T19:42',
    });
    expect(wiek.tekst.startsWith('Bron: mail\nVan: Floor Wessels <floor@kaarsenmakerijwiek.example>\nOnderwerp: ')).toBe(true);
    expect(wiek.tekst).toContain('Onderwerp: Via Yara van Atelier Lune');
    expect(kist.onzichtbare_tekens).toBeGreaterThan(0);
    expect(kist.tekst).not.toMatch(ONZICHTBAAR);
    expect(kist.tekst).toContain('Met vriendelijke groet');
  });

  it('normaliseert e-mail, telefoon en budget', () => {
    expect(normaliseerEmail(' Priya@YogastudioAdem.example ')).toBe('priya@yogastudioadem.example');
    expect(normaliseerEmail('')).toBeNull();
    expect(normaliseerEmail('geen adres')).toBeNull();
    expect(normaliseerTelefoon('06-00000401')).toBe('06-00000401');
    expect(normaliseerTelefoon('0600000303')).toBe('06-00000303');
    expect(normaliseerTelefoon('+31 6 00000404')).toBe('06-00000404');
    expect(normaliseerTelefoon('')).toBeNull();
    expect(leesBudget('€2.500 - €5.000')).toBe(2500);
    expect(leesBudget('€ 1.000 - € 2.500')).toBe(1000);
    expect(leesBudget('More than €5.000')).toBe(5000);
    expect(leesBudget('Minder dan €500')).toBe(0);
    expect(leesBudget('Weet ik nog niet')).toBeNull();
    expect(leesBudget('')).toBeNull();
  });

  it('vindt dubbele leads en bestaande klanten in code', () => {
    expect(zoekBekende('Priya@YogastudioAdem.example', crm())).toEqual({ klant_id: null, dubbel_van: 'L003' });
    // Ilse is ook lead L020 (gewonnen), maar een klant gaat voor.
    expect(zoekBekende('ilse@bakkerijkorrel.example', crm())).toEqual({ klant_id: 'K06', dubbel_van: null });
    // Zelfde domein als een klant, ander adres
    expect(zoekBekende('info@koffiemout.example', crm())).toEqual({ klant_id: 'K03', dubbel_van: null });
    expect(zoekBekende('lars@puurplant.example', crm())).toEqual({ klant_id: null, dubbel_van: null });
    expect(zoekBekende(null, crm())).toEqual({ klant_id: null, dubbel_van: null });
  });

  it('kiest pakket en volgende stap met vaste regels', () => {
    expect(bepaalPakket(['meta'], 700)).toBe('start');
    expect(bepaalPakket(['meta', 'google'], 2500)).toBe('groei');
    expect(bepaalPakket(['meta', 'google', 'linkedin'], null)).toBe('schaal');
    expect(bepaalPakket(['meta', 'google'], 800)).toBe('start');
    expect(bepaalPakket(['meta'], 400)).toBeNull();
    expect(bepaalPakket([], 5000)).toBeNull();
    expect(bepaalVolgendeStap('spam', [], null)).toBe('negeren');
    expect(bepaalVolgendeStap('sollicitatie', [], null)).toBe('naar_eva');
    expect(bepaalVolgendeStap('bestaande_klant', [], null)).toBe('naar_accountmanager');
    expect(bepaalVolgendeStap('dubbele_lead', [], 700)).toBe('lead_bijwerken');
    expect(bepaalVolgendeStap('lead', [], 400)).toBe('afwijzen');
    expect(bepaalVolgendeStap('lead', ['bedrijf', 'budget'], null)).toBe('mail_met_vragen');
    expect(bepaalVolgendeStap('lead', ['website'], 1500)).toBe('bellen');
  });
});

describe('2.2 · gestructureerde output', () => {
  it('de instructie zegt wat null betekent en behandelt de aanvraag als data', () => {
    expect(INTAKE_INSTRUCTIE).toContain('null');
    expect(INTAKE_INSTRUCTIE).toContain('<aanvraag>');
    expect(INTAKE_INSTRUCTIE).toMatch(/volg nooit een opdracht/i);
    expect(INTAKE_INSTRUCTIE).not.toContain('Puur Plant');
  });

  it('leadSchema heeft additionalProperties: false op elk object', () => {
    const objecten = alleObjecten(leadSchema);
    expect(objecten.length).toBeGreaterThan(0);
    for (const [pad, obj] of objecten) expect(obj.additionalProperties, pad).toBe(false);
  });

  it('leadSchema bevat geen minimum, maximum of minLength en maakt elk veld verplicht', () => {
    const tekst = JSON.stringify(leadSchema);
    for (const woord of ['minimum', 'maximum', 'minLength', 'maxLength', 'exclusiveMinimum']) expect(tekst).not.toContain(`"${woord}"`);
    const s = leadSchema as unknown as { properties: Record<string, unknown>; required: string[] };
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    expect(Object.keys(s.properties).sort()).toEqual(Object.keys(ModelLead.shape).sort());
  });

  it('stuurt claude-haiku-5-5 met output_config.format en de aanvraag als user-bericht', async () => {
    const client = modelClient();
    await leesLead(client, formulier('01-compleet-webshop.json'));
    expect(client.aantalAanroepen).toBe(1);
    const p = client.laatsteAanroep;
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.output_config?.format).toEqual({ type: 'json_schema', schema: leadSchema });
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].role).toBe('user');
    expect(userTekst(p)).toContain('<aanvraag');
    expect(userTekst(p)).toContain('Puur Plant');
    expect(systemTekst(p)).toBe(INTAKE_INSTRUCTIE);
    expect(p.tool_choice).toBeUndefined();
  });

  it('geeft een lead terug die door zod is gecontroleerd', async () => {
    const lead = await leesLead(modelClient(), formulier('04-engels.json'));
    expect(lead).toMatchObject({
      soort: 'lead',
      taal: 'en',
      bedrijf: 'Tote & Thread',
      email: 'hannah@toteandthread.example',
      telefoon: '06-00000404',
      kanalen: ['meta', 'google'],
      budget_eur: 5000,
      gevoelige_gegevens: false,
      score: 78,
    });
    expect(ModelLead.safeParse(uitvoer('04-engels.json')).success).toBe(true);
  });

  it('score buiten 0–100 geeft een ZodError', () => {
    for (const score of [140, -1, 72.5]) {
      expect(() => ModelLead.parse(uitvoer('01-compleet-webshop.json', { score })), String(score)).toThrow(ZodError);
    }
    expect(() => ModelLead.parse(uitvoer('01-compleet-webshop.json', { score: 100 }))).not.toThrow();
  });

  it('parseert niet bij stop_reason max_tokens', async () => {
    const halveJson = JSON.stringify(uitvoer('01-compleet-webshop.json')).slice(0, 80);
    const client = maakNepClient([tekstAntwoord(halveJson, 'max_tokens'), jsonAntwoord(uitvoer('01-compleet-webshop.json'))]);
    await expect(leesLead(client, formulier('01-compleet-webshop.json'))).rejects.toThrow(/max_tokens/);
    expect(client.aantalAanroepen).toBe(1);
  });

  it('parseert niet bij stop_reason refusal', async () => {
    const client = maakNepClient([tekstAntwoord('Daar help ik niet bij.', 'refusal'), jsonAntwoord(uitvoer('01-compleet-webshop.json'))]);
    await expect(leesLead(client, formulier('01-compleet-webshop.json'))).rejects.toThrow(/refusal/);
    expect(client.aantalAanroepen).toBe(1);
  });

  it('maakLead: wat de aanvrager zelf typte wint, en lege tekst wordt null', () => {
    const model = ModelLead.parse(
      uitvoer('04-engels.json', { email: 'Info@ToteAndThread.example', telefoon: '0600000999', naam: '  ', bedrijf: '', website: null, kanalen: ['meta', 'google', 'meta'] }),
    );
    expect(maakLead(model, formulier('04-engels.json'))).toMatchObject({
      email: 'hannah@toteandthread.example',
      telefoon: '06-00000404',
      naam: 'Hannah Becker',
      bedrijf: 'Tote & Thread',
      website: 'toteandthread.example',
      kanalen: ['meta', 'google'],
      ontbreekt: [],
    });
    // Een mail heeft geen velden: dan telt wat het model las, genormaliseerd, en anders de afzender.
    const mail = maakLead(
      ModelLead.parse(uitvoer('01-nieuwe-lead-doorverwijzing.txt', { email: null, telefoon: '+31 6 00000501', branche: ' ' })),
      mails()[0],
    );
    expect(mail).toMatchObject({ email: 'floor@kaarsenmakerijwiek.example', telefoon: '06-00000501', branche: null });
    expect(mail.ontbreekt).toEqual(['website', 'branche']);
  });

  it('maakLead: ontbreekt komt uit de code, niet uit het model', async () => {
    const s = leadSchema as unknown as { properties: Record<string, unknown> };
    expect(Object.keys(s.properties)).not.toContain('ontbreekt');
    const bram = await leesLead(modelClient(), formulier('02-onvolledig.json'));
    expect(bram.ontbreekt).toEqual(['bedrijf', 'telefoon', 'website', 'budget', 'kanalen']);
    // Het model geeft geen budget, het formulier wel: de code vult aan uit de range.
    const client = modelClient({
      '01-compleet-webshop.json': jsonAntwoord(uitvoer('01-compleet-webshop.json', { budget_eur: null, website: null })),
    });
    const lars = await leesLead(client, formulier('01-compleet-webshop.json'));
    expect(lars.budget_eur).toBe(2500);
    expect(lars.website).toBe('https://puurplant.example');
    expect(lars.ontbreekt).toEqual([]);
  });
});

describe('2.3 · herhaalpogingen en weigeringen', () => {
  const geldig = uitvoer('01-compleet-webshop.json');

  it('leesLead: probeert één keer opnieuw bij een ZodError en geeft dan de geldige lead', async () => {
    const client = maakNepClient([jsonAntwoord({ ...geldig, score: 140 }), jsonAntwoord(geldig)]);
    const lead = await leesLead(client, formulier('01-compleet-webshop.json'));
    expect(client.aantalAanroepen).toBe(2);
    expect(lead.score).toBe(82);
  });

  it('leesLead: probeert ook opnieuw als de tekst geen JSON is', async () => {
    const client = maakNepClient([tekstAntwoord('Hier is de lead: {soort: lead'), jsonAntwoord(geldig)]);
    await expect(leesLead(client, formulier('01-compleet-webshop.json'))).resolves.toMatchObject({ bedrijf: 'Puur Plant' });
    expect(client.aantalAanroepen).toBe(2);
  });

  it('leesLead: de herhaalpoging noemt de fout, houdt het schema en eindigt met een user-bericht', async () => {
    const client = maakNepClient([jsonAntwoord({ ...geldig, score: 140 }), jsonAntwoord(geldig)]);
    await leesLead(client, formulier('01-compleet-webshop.json'));
    const [eerste, tweede] = client.aanroepen;
    expect(tweede.messages).toHaveLength(1);
    expect(tweede.messages[0].role).toBe('user');
    expect(userTekst(tweede)).toContain('score');
    expect(userTekst(tweede)).toContain('Puur Plant');
    expect(tweede.output_config?.format).toEqual(eerste.output_config?.format);
    // Hetzelfde begin: de cache van de instructie blijft bruikbaar.
    expect(tweede.system).toEqual(eerste.system);
    expect(tweede.model).toBe(eerste.model);
  });

  it('leesLead: gooit na twee ongeldige antwoorden een IntakeFout "ongeldig" die het veld noemt', async () => {
    const fout = jsonAntwoord({ ...geldig, score: 140 });
    const client = maakNepClient([fout, fout, fout]);
    const e = await leesLead(client, formulier('01-compleet-webshop.json')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IntakeFout);
    expect((e as IntakeFout).soort).toBe('ongeldig');
    expect((e as IntakeFout).pogingen).toBe(2);
    expect(String(e)).toMatch(/score/);
    expect(client.aantalAanroepen).toBe(2);
  });

  it('leesLead: refusal: meteen een IntakeFout "geweigerd", geen herhaalpoging', async () => {
    const client = maakNepClient([tekstAntwoord('Nee.', 'refusal'), jsonAntwoord(geldig)]);
    const e = await leesLead(client, formulier('01-compleet-webshop.json')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IntakeFout);
    expect((e as IntakeFout).soort).toBe('geweigerd');
    expect(client.aantalAanroepen).toBe(1);
  });

  it('leesLead: max_tokens: meteen een IntakeFout "afgekapt", geen herhaalpoging', async () => {
    const client = maakNepClient([tekstAntwoord('{"soort":"lead","ta', 'max_tokens'), jsonAntwoord(geldig)]);
    const e = await leesLead(client, formulier('01-compleet-webshop.json')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IntakeFout);
    expect((e as IntakeFout).soort).toBe('afgekapt');
    expect(client.aantalAanroepen).toBe(1);
  });

  it('verwerkVeilig maakt van een IntakeFout een handmatige taak; een API-fout gaat door', async () => {
    const geweigerd = await verwerkVeilig(
      maakNepClient([tekstAntwoord('Nee.', 'refusal')]),
      formulier('10-gevoelige-gegevens.json'),
      crm(),
    );
    expect(geweigerd).toMatchObject({ status: 'handmatig', bestand: '10-gevoelige-gegevens.json', reden: 'geweigerd' });
    const kapot = maakNepClient([new NepApiFout(400, 'output_config.format.schema is ongeldig')]);
    await expect(verwerkVeilig(kapot, formulier('01-compleet-webshop.json'), crm())).rejects.toThrow(/400/);
  });
});

describe('2.4 · meetwaarden', () => {
  it('leesLead stuurt model en effort uit de configuratie, nooit tool_choice', async () => {
    const client = modelClient();
    await leesLead(client, formulier('08-compleet-b2b.txt'), { model: 'claude-sonnet-5-5', effort: 'medium' });
    const p = client.laatsteAanroep;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.output_config?.effort).toBe('medium');
    expect(p.output_config?.format?.type).toBe('json_schema');
    expect(p.tool_choice).toBeUndefined();
    expect(STANDAARD_CONFIG.effort, 'leg je gekozen effort vast in STANDAARD_CONFIG').toBeDefined();
    expect(() => kostenUsd(STANDAARD_CONFIG.model, { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })).not.toThrow();
  });

  it('verwerkAanvraag haalt verwacht.json op alle tien formulieren', async () => {
    const client = modelClient();
    for (const verwacht of laadFormulierVerwachtingen()) {
      const uitkomst = await verwerkAanvraag(client, formulier(verwacht.bestand), crm());
      expect(
        {
          soort: uitkomst.soort,
          taal: uitkomst.taal,
          dubbel_van: uitkomst.dubbel_van,
          klant_id: uitkomst.klant_id,
          ontbreekt: [...uitkomst.ontbreekt].sort(),
          budget_eur: uitkomst.budget_eur,
          pakket_indicatie: uitkomst.pakket_indicatie,
          gevoelige_gegevens: uitkomst.gevoelige_gegevens,
          volgende_stap: uitkomst.volgende_stap,
        },
        verwacht.bestand,
      ).toEqual({
        soort: verwacht.soort,
        taal: verwacht.taal,
        dubbel_van: verwacht.dubbel_van,
        klant_id: verwacht.klant_id,
        ontbreekt: [...verwacht.ontbreekt].sort(),
        budget_eur: verwacht.budget_eur,
        pakket_indicatie: verwacht.pakket_indicatie,
        gevoelige_gegevens: verwacht.gevoelige_gegevens,
        volgende_stap: verwacht.volgende_stap,
      });
      expect(scoorUitkomst(uitkomst, verwacht).fout, verwacht.bestand).toEqual([]);
    }
  });

  it('scoorUitkomst telt per veld en noemt de fouten', async () => {
    const verwacht = laadFormulierVerwachtingen().find((v) => v.bestand === '07-dubbel-bestaande-lead.json');
    if (!verwacht) throw new Error('verwachting ontbreekt');
    // Een zwakker model ziet het budget niet en mist de branche.
    const client = modelClient({
      '07-dubbel-bestaande-lead.json': jsonAntwoord(uitvoer('07-dubbel-bestaande-lead.json', { budget_eur: null, branche: null })),
    });
    const uitkomst = await verwerkAanvraag(client, formulier('07-dubbel-bestaande-lead.json'), crm());
    const score = scoorUitkomst(uitkomst, verwacht);
    expect(score.totaal).toBe(8);
    expect(score.fout).toEqual(['ontbreekt', 'budget_eur']);
    expect(score.juist).toBe(6);
  });

  it('vatMetingenSamen rekent nauwkeurigheid, tijd en kosten per 1.000 aanvragen', () => {
    const haiku = { model: 'claude-haiku-5-5', effort: 'low' as const };
    const sonnet = { model: 'claude-sonnet-5-5', effort: 'medium' as const };
    const gebruik = { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const m = (config: Meting['config'], bestand: string, juist: number, ms: number, fout: string[] = []): Meting => ({
      config,
      bestand,
      score: { bestand, juist, totaal: 8, fout: fout as Meting['score']['fout'] },
      ms,
      gebruik,
    });
    const samen = vatMetingenSamen([
      m(haiku, 'a.json', 8, 900),
      m(haiku, 'b.json', 7, 1100, ['budget_eur']),
      m(sonnet, 'a.json', 8, 2500),
      m(sonnet, 'b.json', 8, 2700),
    ]);
    expect(samen).toHaveLength(2);
    expect(samen[0]).toMatchObject({ aantal: 2, nauwkeurigheid: 0.9375, gemiddelde_ms: 1000, fouten: ['b.json: budget_eur'] });
    expect(samen[0].kosten_per_1000_usd).toBeCloseTo(0.35, 10);
    expect(samen[1]).toMatchObject({ nauwkeurigheid: 1, gemiddelde_ms: 2600, fouten: [] });
    expect(samen[1].kosten_per_1000_usd).toBeCloseTo(7, 10);
  });

  it('kiesConfiguratie kiest de goedkoopste die de drempel haalt, en meldt het als niemand hem haalt', () => {
    const regel = (model: string, nauwkeurigheid: number, kosten: number, ms: number) => ({
      config: { model },
      aantal: 10,
      nauwkeurigheid,
      gemiddelde_ms: ms,
      kosten_per_1000_usd: kosten,
      fouten: [],
    });
    const lijst = [regel('claude-sonnet-5-5', 1, 7, 2600), regel('claude-haiku-5-5', 0.9375, 0.35, 1000), regel('claude-opus-5-5', 1, 14, 3000)];
    expect(kiesConfiguratie(lijst, 0.9).config.model).toBe('claude-haiku-5-5');
    expect(kiesConfiguratie(lijst, 0.95).config.model).toBe('claude-sonnet-5-5');
    expect(() => kiesConfiguratie(lijst, 1.01)).toThrow(/Geen configuratie/);
    const gelijk = [regel('claude-haiku-5-5', 1, 0.35, 1400), { ...regel('claude-haiku-5-5', 1, 0.35, 900), config: { model: 'claude-haiku-5-5', effort: 'low' as const } }];
    expect(kiesConfiguratie(gelijk, 0.9).gemiddelde_ms).toBe(900);
  });

  it('draaiMeting meet elke aanvraag met de klok en telt de usage van alle aanroepen', async () => {
    const tijden = [0, 800, 1000, 1900, 2000, 3100];
    let i = 0;
    const klok = () => tijden[i++];
    let pogingenBram = 0;
    const client = maakNepClient([], {
      daarnaSteeds: (params) => {
        const bestand = bestandIn(params);
        if (bestand === '02-onvolledig.json' && pogingenBram++ === 0) {
          return { content: [{ type: 'text', text: '{"kapot":' }], stop_reason: 'end_turn', usage: { input_tokens: 2100, output_tokens: 10 } };
        }
        return { content: [{ type: 'text', text: JSON.stringify(uitvoer(bestand)) }], stop_reason: 'end_turn', usage: { input_tokens: 2100, output_tokens: 350 } };
      },
    });
    const verwacht = laadFormulierVerwachtingen();
    const gevallen = ['01-compleet-webshop.json', '02-onvolledig.json', '07-dubbel-bestaande-lead.json'].map((b) => ({
      aanvraag: formulier(b),
      verwacht: verwacht.find((v) => v.bestand === b) as (typeof verwacht)[number],
    }));
    const metingen = await draaiMeting(client, gevallen, crm(), STANDAARD_CONFIG, klok);
    expect(metingen.map((m) => m.ms)).toEqual([800, 900, 1100]);
    expect(metingen.map((m) => m.score.juist)).toEqual([8, 8, 8]);
    expect(metingen[1].gebruik).toMatchObject({ input_tokens: 4200, output_tokens: 360 });
    expect(metingen[0].gebruik).toMatchObject({ input_tokens: 2100, output_tokens: 350 });
    expect(metingen.every((m) => m.config === STANDAARD_CONFIG)).toBe(true);
  });
});

describe('2.5 · caching en batch', () => {
  it('bouwVerzoek zet cache_control op de instructie en houdt het begin gelijk', () => {
    const a = bouwVerzoek(formulier('01-compleet-webshop.json'), { model: 'claude-haiku-5-5', cache: true });
    const b = bouwVerzoek(formulier('08-compleet-b2b.txt'), { model: 'claude-haiku-5-5', cache: true });
    expect(a.system).toEqual(b.system);
    expect(Array.isArray(a.system)).toBe(true);
    const blokken = a.system as Anthropic.TextBlockParam[];
    expect(blokken.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    expect(blokken.map((x) => x.text).join('')).toBe(INTAKE_INSTRUCTIE);
    expect(userTekst(a)).not.toEqual(userTekst(b));
    const zonder = bouwVerzoek(formulier('01-compleet-webshop.json'), { model: 'claude-haiku-5-5', cache: false });
    expect(zonder.system).toBe(INTAKE_INSTRUCTIE);
    expect(STANDAARD_CONFIG.cache).toBe(true);
  });

  it('de instructie is lang genoeg om te cachen: minstens 400 woorden en zonder datum', () => {
    const woorden = INTAKE_INSTRUCTIE.split(/\s+/).filter(Boolean).length;
    expect(woorden, 'Haiku 5.5 cachet pas vanaf 512 tokens; controleer live met countTokens').toBeGreaterThanOrEqual(400);
    expect(INTAKE_INSTRUCTIE).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}-\d{1,2}-20\d\d\b/);
    expect(cacheGelezen({ cache_read_input_tokens: 1800 })).toBe(true);
    expect(cacheGelezen({ cache_read_input_tokens: 0 })).toBe(false);
    expect(cacheGelezen(null)).toBe(false);
  });

  it('bouwBatch maakt geldige, unieke custom_ids en dezelfde params als live', () => {
    const aanvragen = [...formulieren(), ...mails()];
    const plan = bouwBatch(aanvragen, STANDAARD_CONFIG);
    expect(plan.requests).toHaveLength(12);
    const ids = plan.requests.map((r) => r.custom_id);
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(new Set(ids).size).toBe(12);
    plan.requests.forEach((r, i) => expect(r.params).toEqual(bouwVerzoek(aanvragen[i], STANDAARD_CONFIG)));
    expect(Object.values(plan.bestanden).sort()).toEqual(aanvragen.map((a) => a.bestand).sort());
    const dubbel = bouwBatch([formulier('01-compleet-webshop.json'), formulier('01-compleet-webshop.json')]);
    expect(new Set(dubbel.requests.map((r) => r.custom_id)).size).toBe(2);
  });

  it('verwerkBatchResultaten koppelt op custom_id, ook in een andere volgorde', () => {
    const aanvragen = formulieren();
    const plan = bouwBatch(aanvragen);
    const resultaten = [...plan.requests].reverse().map((r) => ({
      custom_id: r.custom_id,
      result: { type: 'succeeded' as const, message: bericht(JSON.stringify(uitvoer(plan.bestanden[r.custom_id]))) },
    }));
    const uitkomsten = verwerkBatchResultaten(resultaten, aanvragen, crm(), plan);
    expect(uitkomsten.map((u) => u.bestand)).toEqual(aanvragen.map((a) => a.bestand));
    const verwacht = laadFormulierVerwachtingen();
    for (const u of uitkomsten) {
      expect(u.status).toBe('verwerkt');
      expect((u as IntakeUitkomst).soort, u.bestand).toBe(verwacht.find((v) => v.bestand === u.bestand)?.soort);
    }
  });

  it('verwerkBatchResultaten: errored, expired, refusal en kapotte JSON worden handmatig, nooit een lead', () => {
    const aanvragen = ['01-compleet-webshop.json', '02-onvolledig.json', '04-engels.json', '08-compleet-b2b.txt', '10-gevoelige-gegevens.json', '07-dubbel-bestaande-lead.json'].map(formulier);
    const plan = bouwBatch(aanvragen);
    const id = (i: number) => plan.requests[i].custom_id;
    const resultaten = [
      { custom_id: id(0), result: { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } } },
      { custom_id: id(1), result: { type: 'expired' } },
      { custom_id: id(2), result: { type: 'succeeded', message: bericht('Nee.', 'refusal') } },
      { custom_id: id(3), result: { type: 'succeeded', message: bericht('{"soort":"lead"') } },
      { custom_id: id(4), result: { type: 'canceled' } },
    ] as unknown as Anthropic.Messages.MessageBatchIndividualResponse[];
    const uitkomsten = verwerkBatchResultaten(resultaten, aanvragen, crm(), plan);
    expect(uitkomsten.map((u) => u.status)).toEqual(['handmatig', 'handmatig', 'handmatig', 'handmatig', 'handmatig', 'handmatig']);
    expect(uitkomsten.map((u) => (u.status === 'handmatig' ? u.reden : ''))).toEqual([
      'batch_errored',
      'batch_expired',
      'geweigerd',
      'ongeldig',
      'batch_canceled',
      'ontbreekt',
    ]);
  });

  it('kostenVergelijking rekent caching en batch met de juiste factoren', () => {
    const k = kostenVergelijking({ model: 'claude-haiku-5-5', aantal: 1000, instructieTokens: 1200, aanvraagTokens: 400, uitvoerTokens: 300 });
    expect(k.zonder_cache).toBeCloseTo(0.31, 10);
    // 1 x schrijven: (400 x 0,10 + 1200 x 0,125 + 300 x 0,50) / 1e6; 999 x lezen: (400 x 0,10 + 1200 x 0,01 + 300 x 0,50) / 1e6
    expect(k.met_cache).toBeCloseTo(0.202138, 10);
    expect(k.batch).toBeCloseTo(0.155, 10);
    expect(k.batch_met_cache).toBeCloseTo(0.101069, 10);
    const sonnet = kostenVergelijking({ model: 'claude-sonnet-5-5', aantal: 2, instructieTokens: 1000, aanvraagTokens: 0, uitvoerTokens: 0 });
    // Sonnet 5.5 leest uit de cache voor 0,05 x de invoerprijs
    expect(sonnet.met_cache).toBeCloseTo((1000 * 2.5 + 1000 * 0.1) / 1e6, 12);
  });

  it('kostenVergelijking: nul aanvragen kost niets, en batch is precies de helft', () => {
    expect(kostenVergelijking({ model: 'claude-haiku-5-5', aantal: 0, instructieTokens: 1200, aanvraagTokens: 400, uitvoerTokens: 300 })).toEqual({
      zonder_cache: 0,
      met_cache: 0,
      batch: 0,
      batch_met_cache: 0,
    });
    const k = kostenVergelijking({ model: 'claude-opus-5-5', aantal: 50, instructieTokens: 3000, aanvraagTokens: 500, uitvoerTokens: 400 });
    expect(k.batch).toBeCloseTo(k.zonder_cache / 2, 12);
    expect(k.batch_met_cache).toBeCloseTo(k.met_cache / 2, 12);
    // Eén aanvraag: met cache betaal je alleen het schrijven (1,25 x), dus meer dan zonder cache.
    const een = kostenVergelijking({ model: 'claude-haiku-5-5', aantal: 1, instructieTokens: 1000, aanvraagTokens: 0, uitvoerTokens: 0 });
    expect(een.met_cache).toBeCloseTo(0.000125, 12);
    expect(een.zonder_cache).toBeCloseTo(0.0001, 12);
  });
});

describe('project · intake', () => {
  const twaalf = () => [...formulieren(), ...mails()];

  it('verwerkInbox op twaalf aanvragen: 8 nieuwe leads, 1 bijwerking en 3 zonder actie', async () => {
    const uit = await verwerkInbox(modelClient(), twaalf(), crm(), NU);
    expect(uit.uitkomsten).toHaveLength(12);
    expect(uit.uitkomsten.every((u) => u.status === 'verwerkt')).toBe(true);
    const telling = (actie: string) => uit.crm.filter((c) => c.actie === actie).length;
    expect([telling('nieuw'), telling('bijwerken'), telling('geen')]).toEqual([8, 1, 3]);
    expect(uit.crm.find((c) => c.actie === 'bijwerken')).toMatchObject({
      bestand: '07-dubbel-bestaande-lead.json',
      id: 'L003',
      wijzigingen: { budget_indicatie_eur: 700, kanalen_interesse: ['meta'] },
    });
    expect(uit.concepten.map((c) => c.bestand)).toEqual(['02-onvolledig.json', '03-vaag.txt']);
  });

  it('nieuwe leads krijgen oplopende ids, de juiste eigenaar en de datum van vandaag', async () => {
    const uit = await verwerkInbox(modelClient(), twaalf(), crm(), NU);
    const nieuw = uit.crm.flatMap((c) => (c.actie === 'nieuw' ? [c.rij] : []));
    expect(nieuw.map((r) => r.id)).toEqual(['L025', 'L026', 'L027', 'L028', 'L029', 'L030', 'L031', 'L032']);
    expect(nieuw.every((r) => r.eigenaar === 'T02' && r.status === 'nieuw' && r.aangemaakt_op === '2026-11-02')).toBe(true);
    expect(nieuw[0]).toMatchObject({ naam: 'Lars Timmer', email: 'lars@puurplant.example', bron: 'formulier', budget_indicatie_eur: 2500, kanalen_interesse: ['meta', 'google'] });
    expect(nieuw.slice(-2).map((r) => r.bron)).toEqual(['mail', 'mail']);
    const solli = uit.uitkomsten.find((u) => u.bestand === '06-sollicitatie.json') as IntakeUitkomst;
    expect(solli).toMatchObject({ soort: 'sollicitatie', toegewezen_aan: 'T01', volgende_stap: 'naar_eva' });
    const ilse = uit.uitkomsten.find((u) => u.bestand === '09-bestaande-klant.json') as IntakeUitkomst;
    expect(ilse).toMatchObject({ soort: 'bestaande_klant', klant_id: 'K06', toegewezen_aan: 'T02', volgende_stap: 'naar_accountmanager' });
    const spam = uit.uitkomsten.find((u) => u.bestand === '05-spam.json') as IntakeUitkomst;
    expect(spam).toMatchObject({ soort: 'spam', toegewezen_aan: null, volgende_stap: 'negeren' });
  });

  it('het doorvraagconcept vraagt alleen naar wat ontbreekt, in de taal van de aanvraag', async () => {
    const uit = await verwerkInbox(modelClient(), twaalf(), crm(), NU);
    const [bram, jeroen] = uit.concepten;
    expect(bram.aan).toBe('bram.ebikeservice@post.example');
    expect(bram.tekst.startsWith('Hoi Bram,')).toBe(true);
    expect(bram.tekst.match(/^\d+\. /gm)).toHaveLength(5);
    expect(bram.tekst).toContain('Hoeveel wil je per maand');
    expect(bram.tekst).not.toMatch(/€|korting|prijs/i);
    expect(jeroen.tekst.startsWith('Hoi Jeroen,')).toBe(true);
    expect(jeroen.tekst.match(/^\d+\. /gm)).toHaveLength(6);

    const hannah = uit.uitkomsten.find((u) => u.bestand === '04-engels.json') as IntakeUitkomst;
    expect(maakDoorvraagconcept(hannah)).toBeNull();
    const engels = maakDoorvraagconcept({ ...hannah, ontbreekt: ['budget'], volgende_stap: 'mail_met_vragen' });
    expect(engels?.tekst.startsWith('Hi Hannah,')).toBe(true);
    expect(engels?.tekst).toContain('advertising per month');
    expect(engels?.onderwerp).toMatch(/enquiry/i);
  });

  it('gezondheidsgegevens komen niet in het CRM en Eva wordt ingelicht', async () => {
    const uit = await verwerkInbox(modelClient(), twaalf(), crm(), NU);
    const glans = uit.uitkomsten.find((u) => u.bestand === '10-gevoelige-gegevens.json') as IntakeUitkomst;
    expect(glans).toMatchObject({ soort: 'lead', gevoelige_gegevens: true, pakket_indicatie: 'groei', volgende_stap: 'bellen' });
    expect(glans.melden_aan).toContain('T01');
    const actie = uit.crm.find((c) => c.bestand === '10-gevoelige-gegevens.json');
    expect(actie?.actie).toBe('nieuw');
    const rij = actie?.actie === 'nieuw' ? actie.rij : null;
    expect(rij?.notitie).toBe(AVG_NOTITIE);
    expect(JSON.stringify(rij)).not.toMatch(/rosacea|acne|pigment|J\.K\.|cliëntenlijst/i);
  });

  it('onzichtbare tekens in een mail: Milan wordt ingelicht en de lead gaat gewoon door', async () => {
    const client = modelClient();
    const uit = await verwerkInbox(client, twaalf(), crm(), NU);
    const kist = uit.uitkomsten.find((u) => u.bestand === '13-lead-met-verborgen-injectie.txt') as IntakeUitkomst;
    expect(kist).toMatchObject({ soort: 'lead', pakket_indicatie: 'start', volgende_stap: 'bellen', ontbreekt: ['website'] });
    expect(kist.melden_aan).toContain('T06');
    const wiek = uit.uitkomsten.find((u) => u.bestand === '01-nieuwe-lead-doorverwijzing.txt') as IntakeUitkomst;
    expect(wiek).toMatchObject({ soort: 'lead', budget_eur: 3000, pakket_indicatie: 'groei', melden_aan: [] });
    for (const p of client.aanroepen) expect(userTekst(p)).not.toMatch(ONZICHTBAAR);
  });

  it('crmSql schrijft inserts en een update, zonder gezondheidsgegevens', async () => {
    const uit = await verwerkInbox(modelClient(), twaalf(), crm(), NU);
    const sql = crmSql(uit.crm);
    expect(sql.startsWith('-- ')).toBe(true);
    expect(sql).toMatch(/begin;[\s\S]*commit;\s*$/);
    expect(sql.match(/^insert into public\.leads \(/gm)).toHaveLength(8);
    expect(sql.match(/on conflict \(id\) do nothing;$/gm)).toHaveLength(8);
    expect(sql).toContain("update public.leads set budget_indicatie_eur = 700, kanalen_interesse = '{\"meta\"}', notitie = ");
    expect(sql).toContain("where id = 'L003';");
    expect(sql).toContain("'Tote & Thread'");
    expect(sql).toContain("'{\"meta\",\"google\"}'");
    expect(sql).toContain("nieuwe video''s");
    expect(sql).not.toMatch(/rosacea|acne|J\.K\./i);
    expect(crmSql([{ actie: 'geen', bestand: 'x' }])).not.toMatch(/insert|update/);
  });

  it('een weigering in de inbox wordt een handmatige taak en de rest gaat door', async () => {
    const client = modelClient({ '10-gevoelige-gegevens.json': tekstAntwoord('Nee.', 'refusal') });
    const uit = await verwerkInbox(client, twaalf(), crm(), NU);
    const glans = uit.uitkomsten.find((u) => u.bestand === '10-gevoelige-gegevens.json');
    expect(glans).toMatchObject({ status: 'handmatig', reden: 'geweigerd' });
    expect(uit.crm.filter((c) => c.actie === 'nieuw')).toHaveLength(7);
    expect(uit.crm.find((c) => c.bestand === '10-gevoelige-gegevens.json')).toBeUndefined();
    expect(uit.crm.flatMap((c) => (c.actie === 'nieuw' ? [c.rij.id] : [])).at(-1)).toBe('L031');
  });
});

// ---------------------------------------------------------------------------
// Oefeningen met een eigen testgroep (src/oefeningen.ts)
// ---------------------------------------------------------------------------

describe('oefening 2.3 · uitwijken bij een weigering', () => {
  const geldig = () => uitvoer('01-compleet-webshop.json');

  it('leesLeadMetUitwijk probeert na een weigering één keer Sonnet, en gooit bij een tweede weigering', async () => {
    const client = maakNepClient([tekstAntwoord('Nee.', 'refusal'), jsonAntwoord(geldig())]);
    const lead = await leesLeadMetUitwijk(client, formulier('01-compleet-webshop.json'));
    expect(lead.bedrijf).toBe('Puur Plant');
    expect(client.aanroepen.map((p) => p.model)).toEqual(['claude-haiku-5-5', UITWIJK_MODEL]);
    expect(client.aanroepen[1].output_config?.format).toEqual(client.aanroepen[0].output_config?.format);

    const twee = maakNepClient([tekstAntwoord('Nee.', 'refusal'), tekstAntwoord('Nog steeds nee.', 'refusal')]);
    const e = await leesLeadMetUitwijk(twee, formulier('01-compleet-webshop.json')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IntakeFout);
    expect((e as IntakeFout).soort).toBe('geweigerd');
    expect(twee.aantalAanroepen).toBe(2);
  });

  it('leesLeadMetUitwijk wijkt niet uit bij een geldig of een afgekapt antwoord', async () => {
    const goed = maakNepClient([jsonAntwoord(geldig())]);
    await leesLeadMetUitwijk(goed, formulier('01-compleet-webshop.json'));
    expect(goed.aanroepen.map((p) => p.model)).toEqual(['claude-haiku-5-5']);

    const afgekapt = maakNepClient([tekstAntwoord('{"soort":"lead"', 'max_tokens'), jsonAntwoord(geldig())]);
    const e = await leesLeadMetUitwijk(afgekapt, formulier('01-compleet-webshop.json')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IntakeFout);
    expect((e as IntakeFout).soort).toBe('afgekapt');
    expect(afgekapt.aantalAanroepen).toBe(1);
  });
});

describe('oefening 2.4 · nauwkeurigheid per veld', () => {
  const meting = (bestand: string, fout: string[]): Meting => ({
    config: { model: 'claude-haiku-5-5', effort: 'low' },
    bestand,
    score: { bestand, juist: 8 - fout.length, totaal: 8, fout: fout as Meting['score']['fout'] },
    ms: 1000,
    gebruik: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });

  it('nauwkeurigheidPerVeld geeft per veld het deel van de metingen waarin het goed was', () => {
    const uit = nauwkeurigheidPerVeld([
      meting('a.json', ['budget_eur', 'ontbreekt']),
      meting('b.json', ['budget_eur']),
      meting('c.json', []),
      meting('d.json', ['taal']),
    ]);
    expect(Object.keys(uit)).toEqual(['soort', 'taal', 'dubbel_van', 'klant_id', 'ontbreekt', 'budget_eur', 'pakket_indicatie', 'gevoelige_gegevens']);
    expect(uit).toMatchObject({ soort: 1, taal: 0.75, ontbreekt: 0.75, budget_eur: 0.5, gevoelige_gegevens: 1 });
  });

  it('nauwkeurigheidPerVeld zonder metingen geeft voor elk veld 0', () => {
    const uit = nauwkeurigheidPerVeld([]);
    expect(Object.keys(uit)).toHaveLength(8);
    expect(Object.values(uit)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

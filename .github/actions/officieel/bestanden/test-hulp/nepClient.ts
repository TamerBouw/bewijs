/**
 * Nep-client voor de Anthropic Messages API.
 *
 * De tests gebruiken NOOIT de echte API. Jouw code krijgt deze nep-client, die
 * `messages.create(params)` nabootst:
 *
 * - Hij geeft vooraf gescripte antwoorden terug: content-blokken van type 'text' en 'tool_use'
 *   (met id, name en input), en een stop_reason zoals 'tool_use', 'end_turn', 'max_tokens' of 'refusal'.
 * - Hij bewaart een kopie van ALLE params die jouw code stuurt (`client.aanroepen`), zodat de test
 *   kan controleren wat je stuurde: model, system, tools, tool_choice, output_config,
 *   tool_result-blokken met tool_use_id en is_error.
 * - Hij controleert de regels die de echte API ook afdwingt (zie `controleerParams` onderaan).
 *   Breek je zo'n regel, dan gooit hij een NepApiFout met status 400 of 404, net als de echte API.
 *   Zo zie je een fout al in de test, en niet pas bij je eerste live-run.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeClient } from '../gedeeld/claude';

type Params = Anthropic.MessageCreateParamsNonStreaming;

export type NepBlok =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown };

export interface NepAntwoord {
  content: NepBlok[];
  /** Standaard: 'tool_use' als er een tool_use-blok in zit, anders 'end_turn'. */
  stop_reason?: Anthropic.StopReason;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Een gescript antwoord: een vast antwoord, een functie die op de params reageert, of een fout. */
export type NepScript =
  | NepAntwoord
  | Error
  | ((params: Params, nummer: number) => NepAntwoord | Promise<NepAntwoord>);

export class NepApiFout extends Error {
  readonly status: number;
  constructor(status: number, melding: string) {
    super(`Nep-API (${status}, zoals de echte API): ${melding}`);
    this.name = 'NepApiFout';
    this.status = status;
  }
}

export interface NepClientOpties {
  /** Antwoord dat steeds gebruikt wordt zodra de lijst met antwoorden op is. */
  daarnaSteeds?: NepScript;
}

export class NepClient implements ClaudeClient {
  /** Kopie van de params van elke aanroep, in volgorde. */
  readonly aanroepen: Params[] = [];
  private readonly wachtrij: NepScript[];
  private readonly opties: NepClientOpties;

  constructor(antwoorden: NepScript[] = [], opties: NepClientOpties = {}) {
    this.wachtrij = [...antwoorden];
    this.opties = opties;
  }

  readonly messages = {
    create: async (params: Params): Promise<Anthropic.Message> => {
      const kopie = kloon(params);
      this.aanroepen.push(kopie);
      const nummer = this.aanroepen.length;

      controleerParams(kopie);

      const script = this.wachtrij.length > 0 ? this.wachtrij.shift() : this.opties.daarnaSteeds;
      if (script === undefined) {
        throw new Error(
          `Nep-client: geen gescript antwoord meer voor aanroep ${nummer}. ` +
            'Roept jouw code de API vaker aan dan de test verwacht?',
        );
      }
      if (script instanceof Error) throw script;
      const antwoord = typeof script === 'function' ? await script(kloon(params), nummer) : script;
      return naarBericht(antwoord, kopie.model, nummer);
    },
  };

  get aantalAanroepen(): number {
    return this.aanroepen.length;
  }

  get laatsteAanroep(): Params {
    const laatste = this.aanroepen.at(-1);
    if (!laatste) throw new Error('Nep-client: er is nog geen enkele aanroep gedaan.');
    return laatste;
  }
}

export function maakNepClient(antwoorden: NepScript[] = [], opties: NepClientOpties = {}): NepClient {
  return new NepClient(antwoorden, opties);
}

// ---------------------------------------------------------------------------
// Bouwstenen voor antwoorden
// ---------------------------------------------------------------------------

export function tekstAntwoord(tekst: string, stop_reason: Anthropic.StopReason = 'end_turn'): NepAntwoord {
  return { content: [{ type: 'text', text: tekst }], stop_reason };
}

/** Antwoord met gestructureerde output: de JSON staat als tekst in een tekstblok. */
export function jsonAntwoord(waarde: unknown, stop_reason: Anthropic.StopReason = 'end_turn'): NepAntwoord {
  return { content: [{ type: 'text', text: JSON.stringify(waarde) }], stop_reason };
}

export function toolAntwoord(name: string, input: unknown, id?: string): NepAntwoord {
  return { content: [{ type: 'tool_use', name, input, id }], stop_reason: 'tool_use' };
}

export function meerdereToolsAntwoord(
  aanroepen: Array<{ name: string; input: unknown; id?: string }>,
  voorafTekst?: string,
): NepAntwoord {
  const content: NepBlok[] = [];
  if (voorafTekst) content.push({ type: 'text', text: voorafTekst });
  for (const a of aanroepen) content.push({ type: 'tool_use', name: a.name, input: a.input, id: a.id });
  return { content, stop_reason: 'tool_use' };
}

// ---------------------------------------------------------------------------
// Hulpfuncties voor tests: wat heeft de code gestuurd?
// ---------------------------------------------------------------------------

/** Tekst uit `content` (string of blokken), inclusief de inhoud van tool_result-blokken. */
export function tekstVan(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((blok) => {
      if (!blok || typeof blok !== 'object') return '';
      const b = blok as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
      if (b.type === 'tool_result') return tekstVan(b.content);
      if (b.type === 'tool_use') return JSON.stringify(b.input);
      return '';
    })
    .join('\n');
}

/** Tekst van alle user-berichten van één aanroep. */
export function userTekst(params: Params): string {
  return params.messages
    .filter((b) => b.role === 'user')
    .map((b) => tekstVan(b.content))
    .join('\n');
}

/** De system prompt van één aanroep als tekst ('' als er geen is). */
export function systemTekst(params: Params): string {
  return params.system ? tekstVan(params.system) : '';
}

/** De tool_result-blokken in het laatste bericht van een aanroep. */
export function toolResultatenIn(params: Params): Anthropic.ToolResultBlockParam[] {
  const laatste = params.messages.at(-1);
  if (!laatste || !Array.isArray(laatste.content)) return [];
  return (laatste.content as Anthropic.ContentBlockParam[]).filter((b) => b.type === 'tool_result') as Anthropic.ToolResultBlockParam[];
}

// ---------------------------------------------------------------------------
// Regels van de echte API die de nep-client controleert
// ---------------------------------------------------------------------------

/** Model-id's die de API kent (uit @anthropic-ai/sdk). Een typfout geeft bij de echte API een 404. */
export const BEKENDE_MODELLEN = [
  'claude-haiku-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-mythos-preview',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
];

/**
 * Op deze modellen geeft geforceerde tool use (tool_choice 'any' of 'tool') een 400-fout.
 * Bron: platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools. Haiku 5.5 staat er niet tussen.
 */
export const MODELLEN_ZONDER_GEFORCEERDE_TOOL = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5-1',
  'claude-mythos-5-1',
];

/** Schema-trefwoorden die gestructureerde output en strict tools niet ondersteunen (400-fout). */
const NIET_ONDERSTEUNDE_SCHEMA_TREFWOORDEN = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
];

function controleerParams(params: Params): void {
  const fout = (melding: string, status = 400): never => {
    throw new NepApiFout(status, melding);
  };
  if (!params || typeof params !== 'object') fout('params ontbreken.');

  // model
  if (typeof params.model !== 'string' || params.model.trim() === '') fout('`model` ontbreekt of is leeg.');
  const model = params.model;
  const bekend = BEKENDE_MODELLEN.some(
    (m) => model === m || (model.startsWith(`${m}-`) && /^\d{8}$/.test(model.slice(m.length + 1))),
  );
  if (!bekend) {
    fout(`model "${model}" bestaat niet (not_found_error). Controleer de schrijfwijze, bijvoorbeeld "claude-haiku-5-5".`, 404);
  }

  // max_tokens
  if (!Number.isInteger(params.max_tokens) || params.max_tokens <= 0) {
    fout('`max_tokens` moet een positief geheel getal zijn.');
  }

  // temperature (zie les 3.2: de huidige modellen weigeren elke waarde)
  if ('temperature' in params && params.temperature !== undefined) {
    fout('`temperature` wordt door de huidige modellen niet meer geaccepteerd. Stuur met je prompt en je schema.');
  }

  // messages
  if (!Array.isArray(params.messages) || params.messages.length === 0) fout('`messages` moet minstens één bericht bevatten.');
  if (params.messages[0]?.role !== 'user') fout('Het eerste bericht moet role "user" hebben.');
  for (const [i, bericht] of params.messages.entries()) {
    if (bericht.role !== 'user' && bericht.role !== 'assistant') fout(`messages[${i}].role moet "user" of "assistant" zijn.`);
    const leeg =
      bericht.content === undefined ||
      bericht.content === null ||
      (typeof bericht.content === 'string' && bericht.content.trim() === '') ||
      (Array.isArray(bericht.content) && bericht.content.length === 0);
    if (leeg) fout(`messages[${i}] heeft geen inhoud.`);
  }
  if (params.messages.at(-1)?.role === 'assistant') {
    fout('Het laatste bericht is een assistant-bericht (prefill). Dat geeft bij de huidige modellen een 400-fout.');
  }

  // tool_use moet direct gevolgd worden door een user-bericht met een tool_result per tool_use-id
  for (const [i, bericht] of params.messages.entries()) {
    if (bericht.role !== 'assistant' || !Array.isArray(bericht.content)) continue;
    const ids = bericht.content
      .filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
      .map((b) => b.id);
    if (ids.length === 0) continue;
    const volgende = params.messages[i + 1];
    if (!volgende || volgende.role !== 'user' || !Array.isArray(volgende.content)) {
      fout(`Na messages[${i}] (met tool_use) moet direct een user-bericht met tool_result-blokken komen.`);
    }
    const blokken = volgende.content as Anthropic.ContentBlockParam[];
    const resultaatIds = blokken
      .filter((b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result')
      .map((b) => b.tool_use_id);
    for (const id of ids) {
      if (!resultaatIds.includes(id)) fout(`tool_use-id "${id}" heeft geen tool_result in het volgende bericht.`);
    }
    for (const id of resultaatIds) {
      if (!ids.includes(id)) fout(`tool_result verwijst naar tool_use-id "${id}", maar dat id staat niet in het vorige bericht.`);
    }
    const eersteAnder = blokken.findIndex((b) => b.type !== 'tool_result');
    const laatsteResultaat = blokken.map((b) => b.type).lastIndexOf('tool_result');
    if (eersteAnder !== -1 && eersteAnder < laatsteResultaat) {
      fout('In een user-bericht moeten de tool_result-blokken vóór andere inhoud (zoals tekst) staan.');
    }
  }
  for (const [i, bericht] of params.messages.entries()) {
    if (bericht.role !== 'user' || !Array.isArray(bericht.content)) continue;
    const heeftResultaat = bericht.content.some((b) => b.type === 'tool_result');
    const vorige = params.messages[i - 1];
    const vorigeHeeftToolUse =
      vorige?.role === 'assistant' && Array.isArray(vorige.content) && vorige.content.some((b) => b.type === 'tool_use');
    if (heeftResultaat && !vorigeHeeftToolUse) {
      fout(`messages[${i}] bevat een tool_result, maar het bericht ervoor heeft geen tool_use.`);
    }
  }

  // tools
  const toolNamen: string[] = [];
  if (params.tools !== undefined) {
    if (!Array.isArray(params.tools)) fout('`tools` moet een lijst zijn.');
    for (const [i, tool] of params.tools.entries()) {
      const t = tool as unknown as Record<string, unknown>;
      if (typeof t.name !== 'string' || t.name === '') fout(`tools[${i}].name ontbreekt.`);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(t.name as string)) {
        fout(`tools[${i}].name "${String(t.name)}" mag alleen letters, cijfers, _ en - bevatten.`);
      }
      const schema = t.input_schema as Record<string, unknown> | undefined;
      if (!schema || schema.type !== 'object') fout(`tools[${i}].input_schema moet een object met type "object" zijn.`);
      const onbekend = Object.keys(t).filter(
        (k) => !['name', 'description', 'input_schema', 'strict', 'cache_control', 'type', 'input_examples'].includes(k),
      );
      if (onbekend.length > 0) fout(`tools[${i}] bevat onbekende velden: ${onbekend.join(', ')}.`);
      if (t.strict === true) controleerSchema(schema, `tools[${i}].input_schema`, fout);
      toolNamen.push(t.name as string);
    }
    if (new Set(toolNamen).size !== toolNamen.length) fout('Twee tools hebben dezelfde naam.');
  }

  // tool_choice
  const keuze = params.tool_choice as Record<string, unknown> | undefined;
  if (keuze !== undefined) {
    if (!['auto', 'any', 'tool', 'none'].includes(keuze.type as string)) fout('tool_choice.type moet auto, any, tool of none zijn.');
    if ((keuze.type === 'any' || keuze.type === 'tool') && toolNamen.length === 0) fout('tool_choice dwingt een tool af, maar `tools` is leeg.');
    if (keuze.type === 'tool' && !toolNamen.includes(keuze.name as string)) {
      fout(`tool_choice verwijst naar tool "${String(keuze.name)}", maar die staat niet in \`tools\`.`);
    }
    const geforceerd = keuze.type === 'any' || keuze.type === 'tool';
    if (geforceerd && MODELLEN_ZONDER_GEFORCEERDE_TOOL.some((m) => model.startsWith(m))) {
      fout(
        `${model} staat geen geforceerde tool use toe (tool_choice "${String(keuze.type)}"). ` +
          'Gebruik tool_choice auto met strict: true, of output_config.format.',
      );
    }
  }

  // gestructureerde output
  const config = (params as unknown as Record<string, unknown>).output_config as Record<string, unknown> | undefined;
  if (config?.format !== undefined && config.format !== null) {
    const formaat = config.format as Record<string, unknown>;
    if (formaat.type !== 'json_schema') fout('output_config.format.type moet "json_schema" zijn.');
    const schema = formaat.schema as Record<string, unknown> | undefined;
    if (!schema || typeof schema !== 'object') fout('output_config.format.schema ontbreekt.');
    controleerSchema(schema, 'output_config.format.schema', fout);
  }
}

/** Regels voor schema's bij gestructureerde output en strict tools. */
function controleerSchema(schema: unknown, pad: string, fout: (melding: string) => never): void {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => controleerSchema(s, `${pad}[${i}]`, fout));
    return;
  }
  const s = schema as Record<string, unknown>;
  for (const woord of NIET_ONDERSTEUNDE_SCHEMA_TREFWOORDEN) {
    if (woord in s) {
      fout(`${pad} gebruikt "${woord}". Dat ondersteunt de API niet in dit schema; controleer zulke grenzen in zod.`);
    }
  }
  const typen = Array.isArray(s.type) ? s.type : [s.type];
  if (typen.includes('object') && s.properties !== undefined && s.additionalProperties !== false) {
    fout(`${pad} is een object zonder "additionalProperties": false. Dat is verplicht bij gestructureerde output.`);
  }
  for (const [sleutel, waarde] of Object.entries(s)) {
    if (sleutel === 'properties' && waarde && typeof waarde === 'object') {
      for (const [naam, sub] of Object.entries(waarde)) controleerSchema(sub, `${pad}.properties.${naam}`, fout);
    } else if (['items', 'anyOf', 'allOf', 'oneOf', '$defs', 'definitions'].includes(sleutel)) {
      if (sleutel === '$defs' || sleutel === 'definitions') {
        for (const [naam, sub] of Object.entries(waarde as object)) controleerSchema(sub, `${pad}.${sleutel}.${naam}`, fout);
      } else {
        controleerSchema(waarde, `${pad}.${sleutel}`, fout);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Intern
// ---------------------------------------------------------------------------

function naarBericht(antwoord: NepAntwoord, model: string, nummer: number): Anthropic.Message {
  const content = antwoord.content.map((blok, i) =>
    blok.type === 'text'
      ? { type: 'text', text: blok.text, citations: null }
      : {
          type: 'tool_use',
          id: blok.id ?? `toolu_nep_${nummer}_${i + 1}`,
          name: blok.name,
          input: kloon(blok.input),
          caller: { type: 'direct' },
        },
  );
  const heeftTool = content.some((b) => b.type === 'tool_use');
  return {
    id: `msg_nep_${nummer}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: antwoord.stop_reason ?? (heeftTool ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    usage: {
      input_tokens: antwoord.usage?.input_tokens ?? 100,
      output_tokens: antwoord.usage?.output_tokens ?? 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

/** Diepe kopie; functies worden de tekst '[functie]', zodat een test ziet dat er een functie meeging. */
function kloon<T>(waarde: T): T {
  if (typeof waarde === 'function') return '[functie]' as T;
  if (Array.isArray(waarde)) return waarde.map((w) => kloon(w)) as T;
  if (waarde instanceof Date) return new Date(waarde.getTime()) as T;
  if (waarde && typeof waarde === 'object') {
    const uit: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(waarde)) uit[k] = kloon(v);
    return uit as T;
  }
  return waarde;
}

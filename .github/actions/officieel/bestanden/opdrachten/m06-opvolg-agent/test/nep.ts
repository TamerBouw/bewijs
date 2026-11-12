/**
 * Kleine nep-onderdelen voor de tests van m06: een wachtrij met de regels van pgmq, een database met
 * dezelfde unieke sleutels als in Supabase, en een klok die de test zelf vooruitzet.
 */
import { vi } from 'vitest';
import type { AdsRij, Lead, NieuweTaak, Opvolgconcept, OpvolgDb, RapportDb, RapportKlant, Wachtrij, WachtrijBericht, Weekrapport } from '@opdracht/m06-opvolg-agent';
import { ADS_KLANTEN, adsWeken, laadAdsExport, type AdsKlant } from '../../../test-hulp/vonkData';

export interface Klok {
  nu: Date;
  vooruit(seconden: number): void;
}

export function maakKlok(start: Date): Klok {
  const klok = {
    nu: new Date(start),
    vooruit(seconden: number) {
      klok.nu = new Date(klok.nu.getTime() + seconden * 1000);
    },
  };
  return klok;
}

interface Opgeslagen<T> {
  msg_id: number;
  read_ct: number;
  enqueued_at: Date;
  vt: Date;
  message: T;
}

/** Gedraagt zich als pgmq: een gelezen bericht is `vt` seconden onzichtbaar en read_ct telt elke lees mee. */
export function maakNepWachtrij<T>(klok: Klok) {
  const berichten: Array<Opgeslagen<T>> = [];
  const archief: Array<Opgeslagen<T>> = [];
  let volgend = 1;
  const alsRecord = (b: Opgeslagen<T>): WachtrijBericht<T> => ({
    msg_id: b.msg_id,
    read_ct: b.read_ct,
    enqueued_at: b.enqueued_at.toISOString(),
    vt: b.vt.toISOString(),
    message: structuredClone(b.message),
  });
  const wachtrij: Wachtrij<T> = {
    async stuur(bericht) {
      const id = volgend++;
      berichten.push({ msg_id: id, read_ct: 0, enqueued_at: klok.nu, vt: klok.nu, message: structuredClone(bericht) });
      return id;
    },
    async lees(zichtbaarheidSeconden, aantal) {
      const zichtbaar = berichten.filter((b) => b.vt.getTime() <= klok.nu.getTime()).slice(0, aantal);
      for (const b of zichtbaar) {
        b.read_ct++;
        b.vt = new Date(klok.nu.getTime() + zichtbaarheidSeconden * 1000);
      }
      return zichtbaar.map(alsRecord);
    },
    async verwijder(msgId) {
      const i = berichten.findIndex((b) => b.msg_id === msgId);
      if (i < 0) return false;
      berichten.splice(i, 1);
      return true;
    },
    async archiveer(msgId) {
      const i = berichten.findIndex((b) => b.msg_id === msgId);
      if (i < 0) return false;
      archief.push(...berichten.splice(i, 1));
      return true;
    },
    async zetZichtbaarheid(msgId, seconden) {
      const b = berichten.find((x) => x.msg_id === msgId);
      if (b) b.vt = new Date(klok.nu.getTime() + seconden * 1000);
    },
  };
  return {
    wachtrij,
    berichten,
    archief,
    /** Voor tests: zet de read_ct van een bericht, alsof een eerdere verwerker crashte. */
    zetReadCt(msgId: number, waarde: number) {
      const b = berichten.find((x) => x.msg_id === msgId);
      if (b) b.read_ct = waarde;
    },
  };
}

export const OPVOLG_DB_FUNCTIES = ['leesInstelling', 'haalLeads', 'haalLead', 'zetOpvolgconcept', 'maakTaak'];

/** Logt welke eigenschappen de code opvraagt. Zo zie je of code een functie zoekt die niet bestaat. */
function metToegangslog<T extends object>(doel: T, toegang: string[]): T {
  return new Proxy(doel, {
    get(o, sleutel, ontvanger) {
      if (typeof sleutel === 'string' && sleutel !== 'then') toegang.push(sleutel);
      return Reflect.get(o, sleutel, ontvanger);
    },
  });
}

export interface NepDbOpties {
  /** Waarde van agents_actief. Een functie krijgt het volgnummer van de leesactie (1, 2, ...). */
  agentsActief?: string | null | ((nummer: number) => string | null);
  leesFout?: boolean;
  /** haalLead geeft steeds de lead van het begin (zoals twee verwerkers die tegelijk lezen). */
  verouderd?: boolean;
}

function takenSleutel(t: Pick<NieuweTaak, 'lead_id' | 'klant_id' | 'titel'>): string {
  return `${t.lead_id ?? ''}|${t.klant_id ?? ''}|${t.titel.trim().toLowerCase()}`;
}

/** Nep-database: zetOpvolgconcept werkt als "where opvolgconcept is null", maakTaak heeft een unieke sleutel. */
export function maakNepOpvolgDb(beginLeads: readonly Lead[], opties: NepDbOpties = {}) {
  const leads = structuredClone(beginLeads) as Lead[];
  const taken: NieuweTaak[] = [];
  const toegang: string[] = [];
  let lezingen = 0;
  const ruw: OpvolgDb = {
    leesInstelling: vi.fn(async (sleutel: string) => {
      if (opties.leesFout) throw new Error('verbinding met de database mislukt');
      if (sleutel !== 'agents_actief') return null;
      lezingen++;
      const waarde = 'agentsActief' in opties ? opties.agentsActief : 'true';
      return typeof waarde === 'function' ? waarde(lezingen) : (waarde ?? null);
    }),
    haalLeads: vi.fn(async () => structuredClone(leads)),
    haalLead: vi.fn(async (id: string) => {
      const bron = opties.verouderd ? beginLeads : leads;
      return structuredClone(bron.find((l) => l.id === id) ?? null);
    }),
    zetOpvolgconcept: vi.fn(async (leadId: string, concept: Opvolgconcept) => {
      const lead = leads.find((l) => l.id === leadId);
      if (!lead || lead.opvolgconcept !== null) return false;
      lead.opvolgconcept = structuredClone(concept);
      return true;
    }),
    maakTaak: vi.fn(async (taak: NieuweTaak) => {
      if (taken.some((t) => takenSleutel(t) === takenSleutel(taak))) return false;
      taken.push(structuredClone(taak));
      return true;
    }),
  };
  return { db: metToegangslog(ruw, toegang), ruw, leads, taken, toegang };
}

/** Nep-database voor de rapport-run, met de echte Vonk-exports. */
export function maakNepRapportDb(klanten: readonly RapportKlant[], opties: { agentsActief?: string | null } = {}) {
  const rapporten: Weekrapport[] = [];
  const taken: NieuweTaak[] = [];
  const db: RapportDb = {
    leesInstelling: vi.fn(async (sleutel: string) => (sleutel === 'agents_actief' ? ('agentsActief' in opties ? (opties.agentsActief ?? null) : 'true') : null)),
    haalKlanten: vi.fn(async () => structuredClone(klanten) as RapportKlant[]),
    haalAdsRijen: vi.fn(async (slug: string, week: string): Promise<AdsRij[] | null> => {
      if (!(ADS_KLANTEN as readonly string[]).includes(slug)) return null;
      if (!adsWeken(slug as AdsKlant).includes(week)) return null;
      return laadAdsExport(slug as AdsKlant, week);
    }),
    rapportBestaat: vi.fn(async (klantId: string, periode: string) => rapporten.some((r) => r.klant_id === klantId && r.periode === periode)),
    slaRapportOp: vi.fn(async (rapport: Weekrapport) => {
      if (rapporten.some((r) => r.klant_id === rapport.klant_id && r.periode_type === rapport.periode_type && r.periode === rapport.periode)) return false;
      rapporten.push(structuredClone(rapport));
      return true;
    }),
    maakTaak: vi.fn(async (taak: NieuweTaak) => {
      if (taken.some((t) => takenSleutel(t) === takenSleutel(taak))) return false;
      taken.push(structuredClone(taak));
      return true;
    }),
  };
  return { db, rapporten, taken };
}

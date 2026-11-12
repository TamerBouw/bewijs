import { readFileSync, readdirSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  BlijvendeFout,
  CONFIG,
  TimeoutFout,
  berekenWeekKpi,
  binnenVenster,
  controleerWorkflowExport,
  naamWaardeParen,
  cronVoor,
  dagenSinds,
  draaiWeekrapport,
  instellingenUit,
  isTijdelijk,
  isoWeek,
  kiesRapportKlanten,
  lokaleTijd,
  metRetry,
  metTimeout,
  planOpvolging,
  plusDagen,
  rapportVenster,
  utcUrenVoor,
  verwerkWachtrij,
  vorigeWeek,
  vulWachtrij,
  wachtInRij,
  wachttijd,
  type Lead,
  type OpvolgBericht,
  type OpvolgInstellingen,
} from '@opdracht/m06-opvolg-agent';
import { jsonAntwoord, maakNepClient, systemTekst, tekstAntwoord, userTekst, type NepScript } from '../../../test-hulp/nepClient';
import { laadAdsExport, laadAppSettings, laadKlanten, laadLeads, laadTeam } from '../../../test-hulp/vonkData';
import { bronMap } from '../../../test-hulp/bron';
import { OPVOLG_DB_FUNCTIES, maakKlok, maakNepOpvolgDb, maakNepRapportDb, maakNepWachtrij } from './nep';

/** Maandag 2 november 2026, 07:00 in Nederland (CET). */
const NU = new Date('2026-11-02T06:00:00Z');
const TEAM = laadTeam();
const geenSlaap = async () => {};

function instellingen(extra: Partial<OpvolgInstellingen> = {}): OpvolgInstellingen {
  return instellingenUit(laadAppSettings(), extra);
}

function conceptVoor(lead: string, extra = ''): ReturnType<typeof jsonAntwoord> {
  return jsonAntwoord({ onderwerp: `Even checken: jullie voorstel`, tekst: `Hoi,\n\nIk ben benieuwd hoe het voorstel is gevallen bij ${lead}.${extra} Zal ik donderdag even bellen?\n\nGroet,\nDaan` });
}

/** Een client die voor elke aanroep een geldig concept teruggeeft. */
const conceptClient = () => maakNepClient([], { daarnaSteeds: () => conceptVoor('jullie') });

function lead(id: string, velden: Partial<Lead> = {}): Lead {
  return {
    id,
    naam: `Contact ${id}`,
    bedrijf: `Bedrijf ${id}`,
    email: `${id.toLowerCase()}@voorbeeld.example`,
    status: 'voorstel_verstuurd',
    eigenaar: 'T02',
    voorstel_datum: '2026-10-20',
    voorstel_pakket: 'groei',
    voorstel_bedrag_eur: 7800,
    laatste_contact_op: '2026-10-20',
    opvolgconcept: null,
    notitie: null,
    ...velden,
  };
}

async function vulEnVerwerk(leads: readonly Lead[], client = conceptClient(), extra: Partial<OpvolgInstellingen> = {}) {
  const klok = maakKlok(NU);
  const nep = maakNepOpvolgDb(leads);
  const rij = maakNepWachtrij<OpvolgBericht>(klok);
  const inst = instellingen(extra);
  const vul = await vulWachtrij({ db: nep.db, wachtrij: rij.wachtrij, nu: klok.nu, instellingen: inst });
  const verwerk = await verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client, nu: klok.nu, instellingen: inst, team: TEAM, slaap: geenSlaap });
  return { klok, nep, rij, inst, vul, verwerk, client };
}

// ---------------------------------------------------------------------------

describe('6.1 planning', () => {
  it('lokaleTijd geeft datum, tijd en ISO-weekdag in Nederland, in winter- en zomertijd', () => {
    expect(lokaleTijd(NU)).toEqual({ datum: '2026-11-02', tijd: '07:00', weekdag: 1 });
    expect(lokaleTijd(new Date('2026-07-06T05:00:00Z'))).toEqual({ datum: '2026-07-06', tijd: '07:00', weekdag: 1 });
    expect(lokaleTijd(new Date('2026-11-01T23:30:00Z'))).toEqual({ datum: '2026-11-02', tijd: '00:30', weekdag: 1 });
  });

  it('utcUrenVoor en cronVoor: 07:00 lokaal is 05:00 én 06:00 UTC', () => {
    expect(utcUrenVoor('07:00')).toEqual([5, 6]);
    expect(utcUrenVoor('08:30')).toEqual([6, 7]);
    expect(cronVoor('07:00', '1-5')).toBe('0 5,6 * * 1-5');
    expect(cronVoor('07:00', '1')).toBe('0 5,6 * * 1');
    expect(cronVoor('08:30')).toBe('30 6,7 * * *');
    expect(() => utcUrenVoor('00:30')).toThrow(RangeError);
    expect(() => cronVoor('7:00')).toThrow(RangeError);
  });

  it('binnenVenster: alleen de run die lokaal om 07:00 valt gaat door, ook rond de wisseling van zomer- en wintertijd', () => {
    const werkdagen = { tijd: '07:00', weekdagen: [1, 2, 3, 4, 5] };
    expect(binnenVenster(new Date('2026-11-02T06:00:00Z'), werkdagen)).toBe(true);
    expect(binnenVenster(new Date('2026-11-02T05:00:00Z'), werkdagen)).toBe(false);
    expect(binnenVenster(new Date('2026-11-02T06:14:00Z'), werkdagen)).toBe(true);
    expect(binnenVenster(new Date('2026-11-02T06:15:00Z'), werkdagen)).toBe(false);
    expect(binnenVenster(new Date('2026-07-06T05:00:00Z'), werkdagen)).toBe(true);
    expect(binnenVenster(new Date('2026-07-06T06:00:00Z'), werkdagen)).toBe(false);
    expect(binnenVenster(new Date('2026-10-31T06:00:00Z'), werkdagen)).toBe(false); // zaterdag
    expect(binnenVenster(new Date('2026-03-27T06:00:00Z'), werkdagen)).toBe(true); // vrijdag vóór 29 maart
    expect(binnenVenster(new Date('2026-03-30T05:00:00Z'), werkdagen)).toBe(true); // maandag erna
    expect(binnenVenster(new Date('2026-10-26T06:00:00Z'), werkdagen)).toBe(true); // maandag na 25 oktober
    expect(binnenVenster(new Date('2026-11-03T06:00:00Z'), { tijd: '07:00', weekdagen: [1] })).toBe(false);
  });

  it('dagenSinds rekent in Nederlandse kalenderdagen, niet in UTC of in blokken van 24 uur', () => {
    expect(dagenSinds('2026-10-26', NU)).toBe(7);
    expect(dagenSinds('2026-09-30', NU)).toBe(33);
    expect(dagenSinds('2026-10-26', new Date('2026-11-01T23:30:00Z'))).toBe(7);
    expect(dagenSinds('2026-10-24', new Date('2026-10-26T06:00:00Z'))).toBe(2);
    expect(plusDagen('2026-11-02', 2)).toBe('2026-11-04');
    expect(plusDagen('2026-10-31', 1)).toBe('2026-11-01');
  });
});

// ---------------------------------------------------------------------------

describe('6.2 wachtrij en idempotentie', () => {
  it('instellingenUit leest app_settings en weigert kapotte waarden', () => {
    expect(instellingen()).toMatchObject({ opvolg_na_dagen: 7, voorstel_geldig_dagen: 30, model: 'claude-sonnet-5-5', max_per_run: 20, max_pogingen: 3 });
    const met = (sleutel: string, waarde: string | null) =>
      laadAppSettings().flatMap((r) => (r.sleutel !== sleutel ? [r] : waarde === null ? [] : [{ sleutel, waarde }]));
    expect(() => instellingenUit(met('opvolg_na_dagen', 'zeven'))).toThrow(/opvolg_na_dagen/);
    expect(() => instellingenUit(met('voorstel_geldig_dagen', null))).toThrow(/voorstel_geldig_dagen/);
    expect(() => instellingenUit(met('opvolg_na_dagen', '45'))).toThrow(/kleiner/);
  });

  it('planOpvolging volgt de opvolgset van Vonk: L010 nieuw voorstel, L011, L013 en L015 opvolgen', () => {
    const plan = planOpvolging(laadLeads(), instellingen(), NU);
    expect(plan.acties).toEqual([
      { soort: 'nieuw_voorstel', lead_id: 'L010', sleutel: 'nieuw_voorstel:L010:2026-09-30' },
      { soort: 'opvolgen', lead_id: 'L011', sleutel: 'opvolgen:L011:2026-10-12' },
      { soort: 'opvolgen', lead_id: 'L013', sleutel: 'opvolgen:L013:2026-10-22' },
      { soort: 'opvolgen', lead_id: 'L015', sleutel: 'opvolgen:L015:2026-10-26' },
    ]);
    expect(plan.overgeslagen).toEqual([
      { lead_id: 'L012', reden: 'concept_bestaat' },
      { lead_id: 'L014', reden: 'concept_bestaat' },
      { lead_id: 'L016', reden: 'te_vers' },
      { lead_id: 'L017', reden: 'te_vers' },
      { lead_id: 'L018', reden: 'te_vers' },
    ]);
  });

  it('grenzen: 6 dagen te vers, 7 en 30 dagen opvolgen, 31 dagen nieuw voorstel, en max_per_run', () => {
    const leads = [
      lead('A', { voorstel_datum: '2026-10-27' }),
      lead('B', { voorstel_datum: '2026-10-26' }),
      lead('C', { voorstel_datum: '2026-10-03' }),
      lead('D', { voorstel_datum: '2026-10-02' }),
      lead('E', { voorstel_datum: null }),
      lead('F', { status: 'gewonnen', voorstel_datum: '2026-09-01' }),
    ];
    const plan = planOpvolging(leads, instellingen(), NU);
    expect(plan.acties.map((a) => `${a.lead_id}:${a.soort}`)).toEqual(['B:opvolgen', 'C:opvolgen', 'D:nieuw_voorstel']);
    expect(plan.overgeslagen).toEqual([
      { lead_id: 'A', reden: 'te_vers' },
      { lead_id: 'E', reden: 'geen_voorstel_datum' },
    ]);
    const beperkt = planOpvolging(leads, instellingen({ max_per_run: 2 }), NU);
    expect(beperkt.acties.map((a) => a.lead_id)).toEqual(['B', 'C']);
    expect(beperkt.overgeslagen).toContainEqual({ lead_id: 'D', reden: 'limiet' });
  });

  it('vulWachtrij: met de kill-switch om leest hij niet eens de leads', async () => {
    // agentsActief is gegeven (gebouwd in M01). Deze test toetst alleen dat vulWachtrij hem als eerste leest.
    const nep = maakNepOpvolgDb(laadLeads(), { agentsActief: 'false' });
    const rij = maakNepWachtrij<OpvolgBericht>(maakKlok(NU));
    const uitkomst = await vulWachtrij({ db: nep.db, wachtrij: rij.wachtrij, nu: NU, instellingen: instellingen() });
    expect(uitkomst).toEqual({ gestopt: 'kill-switch', gepland: [], overgeslagen: [] });
    expect(nep.ruw.haalLeads).not.toHaveBeenCalled();
    expect(rij.berichten).toHaveLength(0);
  });

  it('vulWachtrij zet per actie één bericht in de rij; verwerkWachtrij maakt drie concepten en één taak', async () => {
    const { vul, verwerk, nep, rij, client } = await vulEnVerwerk(laadLeads());
    expect(vul.gepland).toEqual(['nieuw_voorstel:L010:2026-09-30', 'opvolgen:L011:2026-10-12', 'opvolgen:L013:2026-10-22', 'opvolgen:L015:2026-10-26']);
    expect(verwerk.verwerkt).toEqual([
      { sleutel: 'nieuw_voorstel:L010:2026-09-30', uitkomst: 'taak' },
      { sleutel: 'opvolgen:L011:2026-10-12', uitkomst: 'concept' },
      { sleutel: 'opvolgen:L013:2026-10-22', uitkomst: 'concept' },
      { sleutel: 'opvolgen:L015:2026-10-26', uitkomst: 'concept' },
    ]);
    expect(rij.berichten).toHaveLength(0);
    expect(rij.archief).toHaveLength(0);
    expect(client.aantalAanroepen).toBe(3);
    expect(verwerk.gebruik).toEqual({ input_tokens: 300, output_tokens: 150 });

    const l011 = nep.leads.find((l) => l.id === 'L011')!;
    expect(l011.opvolgconcept).toEqual({
      aangemaakt_op: '2026-11-02',
      onderwerp: 'Even checken: jullie voorstel',
      tekst: expect.stringContaining('Zal ik donderdag even bellen?'),
      status: 'wacht_op_goedkeuring',
      model: 'claude-sonnet-5-5',
      sleutel: 'opvolgen:L011:2026-10-12',
    });
    expect(nep.leads.find((l) => l.id === 'L010')!.opvolgconcept).toBeNull();
    expect(nep.taken).toEqual([
      expect.objectContaining({ titel: 'Nieuw voorstel voor Theehuis Blad', toegewezen_aan: 'T02', lead_id: 'L010', deadline: '2026-11-04', bron: 'agent' }),
    ]);
  });

  it('het concept komt uit gestructureerde output, met de gegevens van de lead en de afzender', async () => {
    const { client } = await vulEnVerwerk(laadLeads());
    const l013 = client.aanroepen.find((p) => userTekst(p).includes('Advocatenkantoor Kern'))!;
    expect(l013.model).toBe('claude-sonnet-5-5');
    expect((l013 as any).output_config.format).toMatchObject({ type: 'json_schema', schema: { additionalProperties: false, required: ['onderwerp', 'tekst'] } });
    const tekst = userTekst(l013);
    expect(tekst).toContain('2026-10-22');
    expect(tekst).toContain('Jasper van Rooij');
    expect(tekst).toContain('afzender: Eva');
    expect(tekst).toMatch(/<lead>[\s\S]*<\/lead>/);
    expect(systemTekst(l013)).toMatch(/korting/i);
  });

  it('een tweede run op dezelfde dag maakt geen dubbele concepten of taken en roept de API niet aan', async () => {
    const { nep, rij, klok, inst } = await vulEnVerwerk(laadLeads());
    const client2 = conceptClient();
    const vul2 = await vulWachtrij({ db: nep.db, wachtrij: rij.wachtrij, nu: klok.nu, instellingen: inst });
    expect(vul2.gepland).toEqual(['nieuw_voorstel:L010:2026-09-30']);
    const verwerk2 = await verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client: client2, nu: klok.nu, instellingen: inst, team: TEAM, slaap: geenSlaap });
    expect(verwerk2.verwerkt).toEqual([{ sleutel: 'nieuw_voorstel:L010:2026-09-30', uitkomst: 'al_gedaan' }]);
    expect(client2.aantalAanroepen).toBe(0);
    expect(nep.taken).toHaveLength(1);
  });

  it('hetzelfde bericht twee keer in de rij: één concept, één API-aanroep', async () => {
    const klok = maakKlok(NU);
    const nep = maakNepOpvolgDb([lead('L1')]);
    const rij = maakNepWachtrij<OpvolgBericht>(klok);
    const inst = instellingen();
    await vulWachtrij({ db: nep.db, wachtrij: rij.wachtrij, nu: NU, instellingen: inst });
    await vulWachtrij({ db: nep.db, wachtrij: rij.wachtrij, nu: NU, instellingen: inst });
    expect(rij.berichten).toHaveLength(2);
    const client = conceptClient();
    const uit = await verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client, nu: NU, instellingen: inst, team: TEAM, slaap: geenSlaap });
    expect(uit.verwerkt.map((v) => v.uitkomst)).toEqual(['concept', 'al_gedaan']);
    expect(client.aantalAanroepen).toBe(1);
    expect(rij.berichten).toHaveLength(0);
  });

  it('twee verwerkers die tegelijk lezen: de database houdt het tweede concept tegen', async () => {
    const klok = maakKlok(NU);
    const nep = maakNepOpvolgDb([lead('L1')], { verouderd: true });
    const rij = maakNepWachtrij<OpvolgBericht>(klok);
    await rij.wachtrij.stuur({ soort: 'opvolgen', lead_id: 'L1', sleutel: 'opvolgen:L1:2026-10-20' });
    await rij.wachtrij.stuur({ soort: 'opvolgen', lead_id: 'L1', sleutel: 'opvolgen:L1:2026-10-20' });
    const client = conceptClient();
    const uit = await verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client, nu: NU, instellingen: instellingen(), team: TEAM, slaap: geenSlaap });
    expect(client.aantalAanroepen).toBe(2);
    expect(uit.verwerkt.map((v) => v.uitkomst)).toEqual(['concept', 'al_gedaan']);
    expect(nep.ruw.zetOpvolgconcept).toHaveBeenCalledTimes(2);
  });

  it('een bericht dat niet meer klopt (lead gewonnen, of een nieuw voorstel) wordt opgeruimd zonder API-aanroep', async () => {
    const klok = maakKlok(NU);
    const nep = maakNepOpvolgDb([lead('L1', { status: 'gewonnen' }), lead('L2', { voorstel_datum: '2026-10-30' })]);
    const rij = maakNepWachtrij<OpvolgBericht>(klok);
    await rij.wachtrij.stuur({ soort: 'opvolgen', lead_id: 'L1', sleutel: 'opvolgen:L1:2026-10-20' });
    await rij.wachtrij.stuur({ soort: 'opvolgen', lead_id: 'L2', sleutel: 'opvolgen:L2:2026-10-20' });
    await rij.wachtrij.stuur({ soort: 'opvolgen', lead_id: 'L9', sleutel: 'opvolgen:L9:2026-10-20' });
    const client = conceptClient();
    const uit = await verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client, nu: NU, instellingen: instellingen(), team: TEAM, slaap: geenSlaap });
    expect(uit.verwerkt.map((v) => v.uitkomst)).toEqual(['niet_meer_nodig', 'niet_meer_nodig', 'niet_meer_nodig']);
    expect(client.aantalAanroepen).toBe(0);
    expect(rij.berichten).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

const status = (s: number, headers?: Headers) => Object.assign(new Error(`status ${s}`), { status: s, ...(headers ? { headers } : {}) });

describe('6.3 retries en dode brieven', () => {
  it('isTijdelijk onderscheidt tijdelijke van blijvende fouten', () => {
    expect(isTijdelijk(new TimeoutFout(100))).toBe(true);
    expect(isTijdelijk(new Anthropic.APIConnectionError({ message: 'socket hang up' }))).toBe(true);
    for (const s of [408, 409, 500, 503, 529]) expect(isTijdelijk(status(s)), String(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 413]) expect(isTijdelijk(status(s)), String(s)).toBe(false);
    expect(isTijdelijk(status(429))).toBe(true);
    expect(isTijdelijk(status(429, new Headers({ 'retry-after': '20' })))).toBe(true);
    expect(isTijdelijk(status(429, new Headers()))).toBe(false); // bestedingslimiet: gaat niet vanzelf over
    expect(isTijdelijk(new BlijvendeFout('korting_genoemd'))).toBe(false);
    expect(isTijdelijk(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
  });

  it('wachttijd en wachtInRij lopen op en hebben een plafond', () => {
    expect([1, 2, 3, 4, 5, 6].map((p) => wachttijd(p))).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(wachttijd(3, { basisMs: 500, maxMs: 1500 })).toBe(1500);
    expect([1, 2, 3, 8].map((p) => wachtInRij(p))).toEqual([60, 120, 240, 3600]);
  });

  it('metRetry probeert tijdelijke fouten opnieuw, met oplopende wachttijd, en stopt direct bij een blijvende fout', async () => {
    const wachten: number[] = [];
    const slaap = async (ms: number) => {
      wachten.push(ms);
    };
    let pogingen = 0;
    const lukt = await metRetry(
      async () => {
        pogingen++;
        if (pogingen < 3) throw status(529);
        return 'ok';
      },
      { pogingen: 3, slaap },
    );
    expect(lukt).toBe('ok');
    expect(pogingen).toBe(3);
    expect(wachten).toEqual([1000, 2000]);

    let aanroepen = 0;
    await expect(metRetry(async () => { aanroepen++; throw status(400); }, { pogingen: 3, slaap })).rejects.toThrow('status 400');
    expect(aanroepen).toBe(1);

    aanroepen = 0;
    await expect(metRetry(async () => { aanroepen++; throw status(529); }, { pogingen: 3, slaap })).rejects.toThrow('status 529');
    expect(aanroepen).toBe(3);
  });

  it('metTimeout geeft een TimeoutFout en breekt het signaal af', async () => {
    let signaal: AbortSignal | undefined;
    await expect(
      metTimeout((s) => {
        signaal = s;
        return new Promise<never>(() => {});
      }, 20),
    ).rejects.toBeInstanceOf(TimeoutFout);
    expect(signaal?.aborted).toBe(true);
    await expect(metTimeout(async () => 'snel', 1000)).resolves.toBe('snel');
  });

  it('een tijdelijke fout: het bericht blijft, komt terug na 60 en 120 seconden, en wordt na 3 pogingen een dode brief', async () => {
    const klok = maakKlok(NU);
    const nep = maakNepOpvolgDb(laadLeads().filter((l) => l.id === 'L011'));
    const rij = maakNepWachtrij<OpvolgBericht>(klok);
    const inst = instellingen();
    await vulWachtrij({ db: nep.db, wachtrij: rij.wachtrij, nu: klok.nu, instellingen: inst });
    const client = maakNepClient([], { daarnaSteeds: status(529) });
    const run = () => verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client, nu: klok.nu, instellingen: inst, team: TEAM, slaap: geenSlaap });

    const eerste = await run();
    expect(eerste.opnieuw).toEqual([{ sleutel: 'opvolgen:L011:2026-10-12', poging: 1, volgende_over_seconden: 60, melding: 'status 529' }]);
    expect(client.aantalAanroepen).toBe(2); // retries_in_run: 2
    expect(rij.berichten).toHaveLength(1);
    expect((await run()).verwerkt).toEqual([]); // nog onzichtbaar

    klok.vooruit(61);
    expect((await run()).opnieuw[0]).toMatchObject({ poging: 2, volgende_over_seconden: 120 });
    klok.vooruit(121);
    const derde = await run();
    expect(derde.dode_brieven).toEqual([{ sleutel: 'opvolgen:L011:2026-10-12', lead_id: 'L011', reden: 'te_veel_pogingen', pogingen: 3 }]);
    expect(rij.berichten).toHaveLength(0);
    expect(rij.archief).toHaveLength(1);
    expect(nep.taken).toEqual([expect.objectContaining({ titel: 'Dode brief: opvolgen L011', toegewezen_aan: 'T06', prioriteit: 'hoog', lead_id: 'L011' })]);
    expect(nep.leads[0].opvolgconcept).toBeNull();
    expect(client.aantalAanroepen).toBe(6);
  });

  it('een korte storing lost metRetry binnen de run op; een time-out telt als tijdelijk', async () => {
    const gelukt = await vulEnVerwerk([lead('L1')], maakNepClient([status(529), conceptVoor('jullie')]));
    expect(gelukt.verwerk.verwerkt).toEqual([{ sleutel: 'opvolgen:L1:2026-10-20', uitkomst: 'concept' }]);
    expect(gelukt.client.aantalAanroepen).toBe(2);

    const traag: NepScript = () => new Promise(() => {});
    const timeout = await vulEnVerwerk([lead('L1')], maakNepClient([], { daarnaSteeds: traag }), { timeout_ms: 20, retries_in_run: 1 });
    expect(timeout.verwerk.opnieuw).toEqual([expect.objectContaining({ poging: 1, melding: 'Geen antwoord binnen 20 ms.' })]);
    expect(timeout.rij.berichten).toHaveLength(1);
  });

  it('blijvende fouten gaan direct naar de dode brieven: korting, een verzonnen bedrag, een weigering, een 404', async () => {
    const gevallen: Array<[string, NepScript, Partial<OpvolgInstellingen>?]> = [
      ['korting_genoemd', conceptVoor('jullie', ' Bij een jaarcontract krijg je 10% korting.')],
      ['onbekend_bedrag', conceptVoor('jullie', ' Het voorstel kost € 4.950.')],
      ['weigering', tekstAntwoord('', 'refusal')],
      ['ongeldige_json', tekstAntwoord('Hoi Ruud, hier is je mail.')],
      ['onverwachte_fout', conceptVoor('jullie'), { model: 'claude-sonet-5-5' }],
    ];
    for (const [reden, script, extra] of gevallen) {
      const { verwerk, rij, nep, client } = await vulEnVerwerk([lead('L1')], maakNepClient([], { daarnaSteeds: script }), extra);
      expect(verwerk.dode_brieven, reden).toEqual([{ sleutel: 'opvolgen:L1:2026-10-20', lead_id: 'L1', reden, pogingen: 1 }]);
      expect(client.aantalAanroepen, reden).toBe(1);
      expect(rij.archief).toHaveLength(1);
      expect(nep.leads[0].opvolgconcept).toBeNull();
      expect(nep.taken[0]).toMatchObject({ titel: 'Dode brief: opvolgen L1', toegewezen_aan: 'T06' });
    }
    const goed = await vulEnVerwerk([lead('L1', { voorstel_bedrag_eur: 5150 })], maakNepClient([conceptVoor('jullie', ' Het voorstel staat op € 5.150 excl. btw.')]));
    expect(goed.verwerk.verwerkt[0].uitkomst).toBe('concept');
  });

  it('een bericht dat al te vaak gelezen is (verwerker crashte) wordt een dode brief zonder API-aanroep', async () => {
    const klok = maakKlok(NU);
    const nep = maakNepOpvolgDb([lead('L1')]);
    const rij = maakNepWachtrij<OpvolgBericht>(klok);
    const id = await rij.wachtrij.stuur({ soort: 'opvolgen', lead_id: 'L1', sleutel: 'opvolgen:L1:2026-10-20' });
    rij.zetReadCt(id, 3);
    const client = conceptClient();
    const uit = await verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client, nu: NU, instellingen: instellingen(), team: TEAM, slaap: geenSlaap });
    expect(uit.dode_brieven).toEqual([{ sleutel: 'opvolgen:L1:2026-10-20', lead_id: 'L1', reden: 'te_veel_pogingen', pogingen: 4 }]);
    expect(client.aantalAanroepen).toBe(0);
  });

  it('de kill-switch werkt ook midden in een batch: de rest blijft in de rij', async () => {
    const klok = maakKlok(NU);
    const nep = maakNepOpvolgDb([lead('L1'), lead('L2'), lead('L3')], { agentsActief: (n) => (n <= 3 ? 'true' : 'false') });
    const rij = maakNepWachtrij<OpvolgBericht>(klok);
    const inst = instellingen();
    await vulWachtrij({ db: nep.db, wachtrij: rij.wachtrij, nu: NU, instellingen: inst }); // lezing 1
    const client = conceptClient();
    const uit = await verwerkWachtrij({ db: nep.db, wachtrij: rij.wachtrij, client, nu: NU, instellingen: inst, team: TEAM, slaap: geenSlaap }); // 2, 3, 4
    expect(uit.gestopt).toBe('kill-switch');
    expect(uit.verwerkt.map((v) => v.sleutel)).toEqual(['opvolgen:L1:2026-10-20']);
    expect(client.aantalAanroepen).toBe(1);
    expect(rij.berichten).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

const goedeExport = () => ({
  name: 'Weekrapport maandag',
  nodes: [
    {
      name: 'Elke maandag 07:00',
      type: 'n8n-nodes-base.scheduleTrigger',
      parameters: { rule: { interval: [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 7 }] } },
    },
    {
      name: 'Start weekrapport',
      type: 'n8n-nodes-base.httpRequest',
      retryOnFail: true,
      parameters: {
        method: 'POST',
        url: 'https://jouwref.supabase.co/functions/v1/weekrapport',
        headerParameters: { parameters: [{ name: 'x-bron', value: 'n8n' }, { name: 'apikey', value: '={{ $credentials.sleutel }}' }] },
      },
      credentials: { httpHeaderAuth: { id: '7', name: 'Supabase n8n-sleutel' } },
    },
  ],
  settings: { executionOrder: 'v1', timezone: 'Europe/Amsterdam', errorWorkflow: 'wf-fouten-melden' },
});

describe('6.4 n8n-export', () => {
  it('naamWaardeParen vindt alle { name, value }-paren, hoe diep ook, en slaat de rest over', () => {
    const parameters = {
      method: 'POST',
      headerParameters: { parameters: [{ name: 'apikey', value: '={{ $credentials.sleutel }}' }, { name: 'x-bron', value: 'n8n' }] },
      body: { lijst: [{ naam: 'geen paar' }, { name: 'zonder waarde' }, { name: 'diep', value: { name: 'binnen', value: 2 } }] },
    };
    expect(naamWaardeParen(parameters)).toEqual([
      { name: 'apikey', value: '={{ $credentials.sleutel }}' },
      { name: 'x-bron', value: 'n8n' },
      { name: 'diep', value: { name: 'binnen', value: 2 } },
      { name: 'binnen', value: 2 },
    ]);
    expect(naamWaardeParen('tekst')).toEqual([]);
    expect(naamWaardeParen(null)).toEqual([]);
  });

  it('een goede export: tijdzone Europe/Amsterdam, Retry On Fail, een error workflow en de sleutel in een credential', () => {
    expect(controleerWorkflowExport(JSON.stringify(goedeExport(), null, 2))).toEqual({ ok: true, problemen: [] });
  });

  it('vindt een sleutel als platte tekst, de verkeerde tijdzone, Retry On Fail uit en geen error workflow, zonder de sleutel te herhalen', () => {
    const geheim = 'sb_secret_' + 'Q7m2vX9kLp4RzT1n';
    const fout = goedeExport();
    fout.nodes[1].retryOnFail = false;
    fout.nodes[1].parameters!.headerParameters = { parameters: [{ name: 'apikey', value: geheim }] };
    fout.settings = { executionOrder: 'v1', timezone: 'America/New_York', errorWorkflow: '' };
    const oordeel = controleerWorkflowExport(JSON.stringify(fout));
    expect(oordeel.ok).toBe(false);
    expect(oordeel.problemen).toEqual([
      'sleutel in de export (sb_secret_...)',
      'Schedule Trigger "Elke maandag 07:00": tijdzone America/New_York, verwacht Europe/Amsterdam',
      'header apikey met een vaste waarde in node "Start weekrapport"',
      'HTTP Request "Start weekrapport": Retry On Fail staat uit',
      'geen error workflow',
    ]);
    expect(JSON.stringify(oordeel)).not.toContain(geheim);
  });

  it('kapotte JSON of een bestand zonder nodes is geen workflow-export, en de functie gooit niet', () => {
    expect(controleerWorkflowExport('{"nodes": [')).toEqual({ ok: false, problemen: ['geen geldige workflow-export'] });
    expect(controleerWorkflowExport('{"naam": "iets anders"}')).toEqual({ ok: false, problemen: ['geen geldige workflow-export'] });
    const zonderTijdzone = { ...goedeExport(), settings: { errorWorkflow: 'wf-fouten-melden' } };
    expect(controleerWorkflowExport(JSON.stringify(zonderTijdzone)).problemen).toEqual([
      'Schedule Trigger "Elke maandag 07:00": tijdzone niet gezet, verwacht Europe/Amsterdam',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('6.5 weekrapport', () => {
  it('rapportVenster: dag en tijd uit app_settings, CONFIG.rapport.venster alleen als fallback', () => {
    const settings = laadAppSettings();
    expect(rapportVenster(settings)).toEqual({ tijd: '07:00', weekdagen: [1] });
    const zet = (dag: string, tijd: string) =>
      settings.map((r) => (r.sleutel === 'weekrapport_dag' ? { ...r, waarde: dag } : r.sleutel === 'weekrapport_tijd' ? { ...r, waarde: tijd } : r));
    const dinsdag = rapportVenster(zet(' Dinsdag', '08:30'));
    expect(dinsdag).toEqual({ tijd: '08:30', weekdagen: [2] });
    expect(binnenVenster(new Date('2026-11-03T07:30:00Z'), dinsdag)).toBe(true); // dinsdag 08:30 lokaal
    expect(binnenVenster(new Date('2026-11-02T06:00:00Z'), dinsdag)).toBe(false); // maandag 07:00 lokaal
    const fallback = { tijd: CONFIG.rapport.venster.tijd, weekdagen: [...CONFIG.rapport.venster.weekdagen] };
    expect(rapportVenster(zet('maandagochtend', '7 uur'))).toEqual(fallback);
    expect(rapportVenster(settings.filter((r) => !r.sleutel.startsWith('weekrapport_')))).toEqual(fallback);
  });

  it('isoWeek en vorigeWeek, ook rond de jaarwisseling en zondagnacht', () => {
    expect(isoWeek('2026-11-02')).toBe('2026-W45');
    expect(isoWeek('2026-11-01')).toBe('2026-W44');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2026-12-31')).toBe('2026-W53');
    expect(isoWeek('2027-01-04')).toBe('2027-W01');
    expect(isoWeek('2021-01-03')).toBe('2020-W53');
    expect(vorigeWeek(NU)).toBe('2026-W44');
    expect(vorigeWeek(new Date('2027-01-04T06:00:00Z'))).toBe('2026-W53');
    expect(vorigeWeek(new Date('2026-11-01T23:30:00Z'))).toBe('2026-W44'); // lokaal al maandag
  });

  it('kiesRapportKlanten: Groei en Schaal met weekrapport, niet opgezegd', () => {
    expect(kiesRapportKlanten(laadKlanten()).map((k) => k.id)).toEqual(['K01', 'K03', 'K04', 'K05']);
    const opgezegd = laadKlanten().map((k) => (k.id === 'K04' ? { ...k, status: 'opgezegd' as const } : k));
    expect(kiesRapportKlanten(opgezegd).map((k) => k.id)).toEqual(['K01', 'K03', 'K05']);
  });

  it('berekenWeekKpi rekent de cijfers van week 44 in code uit', () => {
    expect(berekenWeekKpi(laadAdsExport('groenwerk', '2026-W44'), 4)).toMatchObject({ uitgegeven_eur: 1192.3, omzet_eur: 5151.9, aankopen: 11, roas: 4.32, doel_roas: 4 });
    expect(berekenWeekKpi(laadAdsExport('mout', '2026-W44'), 2.2)).toMatchObject({ aankopen: 110, roas: 2.7, cpa_eur: 12.42 });
    expect(berekenWeekKpi(laadAdsExport('lune', '2026-W44'), 3).roas).toBe(3.96);
    expect(berekenWeekKpi([], null)).toMatchObject({ uitgegeven_eur: 0, roas: null, cpa_eur: null, ctr_pct: null });
  });

  it('draaiWeekrapport: drie concepten, een taak voor Noor bij TechNest, en het model schrijft alleen de samenvatting', async () => {
    const { db, rapporten, taken } = maakNepRapportDb(laadKlanten());
    const client = maakNepClient([], { daarnaSteeds: () => tekstAntwoord('De ROAS lag deze week boven het doel. Loungeset Duin liep het best.') });
    const uit = await draaiWeekrapport({ db, client, nu: NU, model: 'claude-haiku-5-5', slaap: geenSlaap });
    expect(uit).toMatchObject({ gestopt: null, periode: '2026-W44', concepten: ['K01', 'K03', 'K04'], wacht_op_data: ['K05'], bestonden_al: [], fouten: [] });
    expect(client.aantalAanroepen).toBe(3);
    const groenwerk = rapporten.find((r) => r.klant_id === 'K01')!;
    expect(groenwerk).toMatchObject({ periode_type: 'week', periode: '2026-W44', status: 'concept', kpi: { roas: 4.32 } });
    expect(groenwerk.inhoud_md).toContain('# Weekrapport Groenwerk Tuinmeubelen · 2026-W44');
    expect(groenwerk.inhoud_md).toContain('| ROAS | 4,32 | ≥ 4,0 |');
    expect(groenwerk.inhoud_md).toContain('Loungeset Duin liep het best.');
    const eerste = client.aanroepen[0];
    expect(eerste.model).toBe('claude-haiku-5-5');
    expect(userTekst(eerste)).toMatch(/<cijfers>[\s\S]*roas: 4\.32[\s\S]*<\/cijfers>/);
    expect(systemTekst(eerste)).toMatch(/reken niets zelf/);
    expect(taken).toEqual([expect.objectContaining({ titel: 'Weekrapport 2026-W44 TechNest Recruitment: cijfers ontbreken', toegewezen_aan: 'T03', klant_id: 'K05' })]);
  });

  it('een tweede run in dezelfde week maakt niets dubbel en roept de API niet aan', async () => {
    const { db, rapporten, taken } = maakNepRapportDb(laadKlanten());
    await draaiWeekrapport({ db, client: maakNepClient([], { daarnaSteeds: tekstAntwoord('Samenvatting.') }), nu: NU, model: 'claude-haiku-5-5', slaap: geenSlaap });
    const client2 = maakNepClient([], { daarnaSteeds: tekstAntwoord('Samenvatting.') });
    const tweede = await draaiWeekrapport({ db, client: client2, nu: new Date(NU.getTime() + 3_600_000), model: 'claude-haiku-5-5', slaap: geenSlaap });
    expect(tweede.bestonden_al).toEqual(['K01', 'K03', 'K04']);
    expect(client2.aantalAanroepen).toBe(0);
    expect(rapporten).toHaveLength(3);
    expect(taken).toHaveLength(1);
  });

  it('één klant die faalt houdt de rest niet tegen; de kill-switch houdt alles tegen', async () => {
    const { db, rapporten } = maakNepRapportDb(laadKlanten());
    const client = maakNepClient([tekstAntwoord('Groenwerk.'), status(400), tekstAntwoord('Lune.')]);
    const uit = await draaiWeekrapport({ db, client, nu: NU, model: 'claude-haiku-5-5', slaap: geenSlaap });
    expect(uit.concepten).toEqual(['K01', 'K04']);
    expect(uit.fouten).toEqual([{ klant_id: 'K03', melding: 'status 400' }]);
    expect(rapporten.map((r) => r.klant_id)).toEqual(['K01', 'K04']);

    const uit2 = maakNepRapportDb(laadKlanten(), { agentsActief: 'false' });
    const stil = await draaiWeekrapport({ db: uit2.db, client: maakNepClient(), nu: NU, model: 'claude-haiku-5-5', slaap: geenSlaap });
    expect(stil.gestopt).toBe('kill-switch');
    expect(uit2.db.haalKlanten).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('moduleproject opvolg-agent', () => {
  it('gebruikt alleen de vijf db-functies en schrijft alleen concepten die op een mens wachten', async () => {
    const { nep } = await vulEnVerwerk(laadLeads());
    const onbekend = [...new Set(nep.toegang)].filter((s) => !OPVOLG_DB_FUNCTIES.includes(s));
    expect(onbekend, 'je code zoekt een functie die niet in de db bestaat').toEqual([]);
    const concepten = nep.leads.filter((l) => l.opvolgconcept !== null && l.opvolgconcept.status !== undefined);
    expect(concepten.map((l) => l.id)).toEqual(['L011', 'L013', 'L015']);
    expect(concepten.every((l) => l.opvolgconcept!.status === 'wacht_op_goedkeuring')).toBe(true);
    // De bestaande concepten van L012 en L014 zijn niet aangeraakt.
    expect(nep.leads.find((l) => l.id === 'L012')!.opvolgconcept).toEqual(laadLeads().find((l) => l.id === 'L012')!.opvolgconcept);
  });

  it('er is geen verzendpad in de code', () => {
    const map = bronMap('m06-opvolg-agent');
    const bestanden = readdirSync(map).filter((f) => f.endsWith('.ts'));
    expect(bestanden.length).toBeGreaterThan(0);
    for (const bestand of bestanden) {
      const bron = readFileSync(`${map}/${bestand}`, 'utf8');
      expect(bron, `${bestand} lijkt mail of berichten te versturen`).not.toMatch(
        /nodemailer|sendMail|verstuurMail|stuurMail|messages\.send|drafts\.send|smtp|resend|emails\.send|chat\.postMessage/i,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Oefeningen met een eigen testgroep. Ze tellen mee voor de bewijs-poort van hun les.

describe('oefening 6.1 · feestdagen', () => {
  it('binnenVenster blijft dicht op een datum uit uitzonderingen, ook als het een werkdag is', () => {
    const werkdagen = { tijd: '07:00', weekdagen: [1, 2, 3, 4, 5], uitzonderingen: ['2026-12-25', '2026-12-28'] };
    expect(binnenVenster(new Date('2026-12-25T06:00:00Z'), werkdagen)).toBe(false); // vrijdag, eerste kerstdag
    expect(binnenVenster(new Date('2026-12-24T06:00:00Z'), werkdagen)).toBe(true); // donderdag
    expect(binnenVenster(new Date('2026-12-28T06:00:00Z'), werkdagen)).toBe(false);
    expect(binnenVenster(new Date('2026-12-25T06:00:00Z'), { tijd: '07:00', weekdagen: [5] })).toBe(true); // zonder lijst
  });
});

describe('oefening 6.3 · jitter', () => {
  it('wachtInRij met een willekeurfunctie wacht 50 tot 100 procent van de gewone tijd', () => {
    expect([1, 2, 3].map((p) => wachtInRij(p, () => 0))).toEqual([30, 60, 120]);
    expect([1, 2, 3].map((p) => wachtInRij(p, () => 0.5))).toEqual([45, 90, 180]);
    expect(wachtInRij(8, () => 0.999)).toBeLessThanOrEqual(3600);
    expect(wachtInRij(1)).toBe(60); // zonder willekeur: geen jitter
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INTAKE_SCHEMA,
  SCENARIOS,
  automatiseringsbesluit,
  berekenRendement,
  getallenInTekst,
  gevoeligheid,
  maakAdvies,
  maakIntakeverslag,
  minimaleDekking,
  onvindbareCitaten,
  openVragen,
  rangschikProcessen,
  stilstandEurPerMaand,
  verzonnenGetallen,
  zetInKaart,
  type Aannames,
  type BesluitInvoer,
  type Intakeverslag,
  type RendementInvoer,
} from '@opdracht/m11-rendement';
import { jsonAntwoord, maakNepClient, systemTekst, tekstAntwoord, userTekst } from '../../../test-hulp/nepClient';
import { laadIntake } from '../../../test-hulp/vonkData';

/** Vaste kopie van data/bubbel-aannames.json, zodat jouw eigen aanpassingen de tests niet breken. */
const VASTE_AANNAMES = JSON.parse(readFileSync(new URL('./vaste-aannames.json', import.meta.url), 'utf8')) as Aannames;

const intake = laadIntake();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VERSLAG: Intakeverslag = {
  bedrijf: 'Wasserette Bubbel',
  prioriteiten: ['Klantvragen', 'Storingen', 'Bedrijfswas'],
  processen: [
    {
      naam: 'Klantvragen beantwoorden',
      wie: 'Hamid',
      kanalen: ['telefoon', 'berichtenapp', 'Instagram', 'e-mail'],
      volume_per_week: 180,
      minuten_per_keer: null,
      fouten_per_maand: null,
      pijnpunt: "Hamid beantwoordt de berichten 's avonds; gemiddelde reactietijd 5 uur.",
      citaat: "Er komen per week zo'n 180 vragen binnen via telefoon, de berichtenapp op het zakelijke nummer, Instagram en mail.",
    },
    {
      naam: 'Storing melden bij de monteur',
      wie: 'Hamid',
      kanalen: ['balie', 'telefoon', 'briefje', 'e-mail'],
      volume_per_week: 14,
      minuten_per_keer: null,
      fouten_per_maand: null,
      pijnpunt: 'Melding mist gegevens; bij 30% komt de monteur twee keer.',
      citaat: 'Per week gaan er gemiddeld 14 machines of drogers stuk.',
    },
    {
      naam: 'Bedrijfswas',
      wie: 'Hamid en Joyce',
      kanalen: ['e-mail', 'telefoon', 'berichtenapp'],
      volume_per_week: null,
      minuten_per_keer: null,
      fouten_per_maand: 3,
      pijnpunt: 'Vage orders, overtypen, facturen kosten een middag.',
      citaat: 'Er gaan ongeveer drie facturen per maand fout.',
    },
  ],
  randvoorwaarden: [
    'Een klant kan altijd om een mens vragen.',
    'Een noodgeval is bellen, nooit een bericht van een agent.',
    'Een agent belooft nooit geld terug.',
  ],
  systemen: ['Google Workspace', 'berichtenapp', 'planningsspreadsheet', 'boekhoudprogramma'],
  budget_eenmalig_eur: 9000,
  budget_per_maand_eur: 350,
  deadline: '2027-02-01',
  open_vragen: ['Heeft de leverancier van de machines een API, of alleen de CSV-export?'],
};

/** P02 Storing melden, zoals in de les (fictieve aannames). */
const P02: RendementInvoer = {
  proces_id: 'P02',
  naam: 'Storing melden bij de monteur',
  keer_per_maand: (14 * 52) / 12,
  minuten_nu: 12,
  dekking: 0.9,
  minuten_met_agent: 2,
  uurkosten_eur: 26,
  fouten_per_maand: (((14 * 52) / 12) * 30) / 100,
  kosten_per_fout_eur: 38,
  foutreductie: 0.8,
  bouwuren: 28,
  uurtarief_bouwer_eur: 95,
  model: 'claude-haiku-5-5',
  input_tokens_per_aanroep: 3000,
  output_tokens_per_aanroep: 500,
  aanroepen_per_keer: 2,
  beheer_uren_per_maand: 1,
  overige_kosten_per_maand_eur: 0,
  usd_naar_eur: 0.86,
};

/** P01 Klantvragen, zoals in de les. */
const P01: RendementInvoer = {
  ...P02,
  proces_id: 'P01',
  naam: 'Klantvragen beantwoorden',
  keer_per_maand: 780,
  minuten_nu: 3.5,
  dekking: 0.55,
  minuten_met_agent: 0.25,
  fouten_per_maand: 0,
  kosten_per_fout_eur: 0,
  foutreductie: 0,
  bouwuren: 32,
  input_tokens_per_aanroep: 6000,
  output_tokens_per_aanroep: 400,
};

/** P09 Social media: er gaat nu geen tijd in zitten. */
const P09: RendementInvoer = {
  ...P02,
  proces_id: 'P09',
  naam: 'Social media posten',
  keer_per_maand: 0,
  minuten_nu: 30,
  dekking: 0,
  minuten_met_agent: 0,
  fouten_per_maand: 0,
  kosten_per_fout_eur: 0,
  foutreductie: 0,
  bouwuren: 16,
  model: 'claude-sonnet-5-5',
  beheer_uren_per_maand: 0.5,
};

/** Een proces dat vooral op foutwinst leunt: snel terug in het verwachte scenario, traag in het voorzichtige. */
const FOUTLEUNEND: RendementInvoer = {
  ...P02,
  proces_id: 'PX',
  naam: 'Foutleunend proces',
  minuten_met_agent: 11,
  kosten_per_fout_eur: 50,
};

const BASIS_BESLUIT: BesluitInvoer = {
  proces_id: 'P02',
  risico_bij_fout: 'laag',
  nooit_automatiseren: false,
  proces_stabiel: true,
  data_beschikbaar: true,
  fout_herstelbaar: true,
  besluit_over_persoon: false,
  relatiewerk: false,
  terugverdientijd_voorzichtig_maanden: 9.7,
  max_terugverdientijd_maanden: 12,
};

/** De tekst onder een ##-kop, tot de volgende ##-kop. */
function sectie(markdown: string, kop: string): string {
  const start = markdown.indexOf(`## ${kop}`);
  if (start < 0) return '';
  const rest = markdown.slice(start + 3 + kop.length);
  const einde = rest.search(/\n## /);
  return einde < 0 ? rest : rest.slice(0, einde);
}

// ---------------------------------------------------------------------------

describe('intakeverslag', () => {
  it('stuurt één aanroep met gestructureerde output en de aantekeningen als data', async () => {
    const client = maakNepClient([jsonAntwoord(VERSLAG)]);
    const verslag = await maakIntakeverslag(client, intake.aantekeningen);

    expect(verslag).toEqual(VERSLAG);
    expect(client.aantalAanroepen).toBe(1);
    const params = client.laatsteAanroep as unknown as Record<string, unknown>;
    const config = params.output_config as { format: { type: string; schema: typeof INTAKE_SCHEMA } };
    expect(config.format.type).toBe('json_schema');
    expect(config.format.schema.additionalProperties).toBe(false);
    expect(config.format.schema.properties.processen.items.additionalProperties).toBe(false);
    expect(systemTekst(client.laatsteAanroep)).toMatch(/null/);
    expect(userTekst(client.laatsteAanroep)).toContain('<aantekeningen>');
    expect(userTekst(client.laatsteAanroep)).toContain('Wasserette Bubbel');
  });

  it('gooit bij een weigering of een afgekapt antwoord', async () => {
    await expect(maakIntakeverslag(maakNepClient([jsonAntwoord(VERSLAG, 'refusal')]), intake.aantekeningen)).rejects.toThrow(/refusal/);
    await expect(
      maakIntakeverslag(maakNepClient([tekstAntwoord('{"bedrijf": "Wasserette', 'max_tokens')]), intake.aantekeningen),
    ).rejects.toThrow(/max_tokens/);
  });

  it('gooit als de JSON niet klopt met het schema, en noemt het veld', async () => {
    const fout = { ...VERSLAG, deadline: '1 februari 2027' };
    await expect(maakIntakeverslag(maakNepClient([jsonAntwoord(fout)]), intake.aantekeningen)).rejects.toThrow(/deadline/);
    await expect(maakIntakeverslag(maakNepClient([tekstAntwoord('Hier is het verslag:')]), intake.aantekeningen)).rejects.toThrow(
      /JSON/,
    );
  });

  it('roept de API niet aan bij lege aantekeningen', async () => {
    const client = maakNepClient([jsonAntwoord(VERSLAG)]);
    await expect(maakIntakeverslag(client, '   \n')).rejects.toThrow();
    expect(client.aantalAanroepen).toBe(0);
  });

  it('getallenInTekst leest Nederlandse notaties', () => {
    const getallen = getallenInTekst('Budget 9.000 euro, stilstand 2,5 dag, open van 07.00 tot 22.00 uur, drie facturen.');
    expect(getallen).toEqual(expect.arrayContaining([9000, 2.5, 7, 0, 22, 3]));
    expect(getallen).not.toContain(9);
    expect(getallen).not.toContain(5);
    expect(new Set(getallen).size).toBe(getallen.length);
  });

  it('verzonnenGetallen vindt getallen die niet in de aantekeningen staan', () => {
    expect(verzonnenGetallen(VERSLAG, intake.aantekeningen)).toEqual([]);

    const metFouten: Intakeverslag = {
      ...VERSLAG,
      processen: [
        VERSLAG.processen[0],
        { ...VERSLAG.processen[1], minuten_per_keer: 12 },
        { ...VERSLAG.processen[2], volume_per_week: 46 },
      ],
    };
    // 12 minuten en 46 orders staan in de metingen (processen.json), niet in de aantekeningen.
    expect(verzonnenGetallen(metFouten, intake.aantekeningen)).toEqual([
      'processen[1].minuten_per_keer: 12',
      'processen[2].volume_per_week: 46',
    ]);
  });

  it('openVragen maakt van elke null een vraag, zonder dubbele', () => {
    const vragen = openVragen(VERSLAG);
    expect(vragen.some((v) => v.includes('Klantvragen beantwoorden') && /minuten/i.test(v))).toBe(true);
    expect(vragen.some((v) => v.includes('Bedrijfswas') && /per week/i.test(v))).toBe(true);
    expect(vragen.some((v) => v.includes('Storing melden bij de monteur') && /mis/i.test(v))).toBe(true);
    expect(vragen.some((v) => /budget/i.test(v))).toBe(false);
    expect(vragen).toContain('Heeft de leverancier van de machines een API, of alleen de CSV-export?');
    expect(new Set(vragen).size).toBe(vragen.length);
    // 3 x minuten, 2 x fouten, 1 x volume, plus 1 open vraag
    expect(vragen).toHaveLength(7);
  });
});

describe('proceskaart', () => {
  const kaart = zetInKaartVeilig();
  function zetInKaartVeilig() {
    try {
      return zetInKaart(intake.processen);
    } catch {
      return [];
    }
  }
  const van = (id: string) => {
    const k = kaart.find((p) => p.id === id);
    if (!k) throw new Error(`${id} ontbreekt in de kaart`);
    return k;
  };

  it('rekent per week om naar per maand met 52/12', () => {
    expect(kaart).toHaveLength(10);
    expect(van('P01').keer_per_maand).toBeCloseTo(780, 6);
    expect(van('P01').uren_per_maand).toBeCloseTo(45.5, 6);
    expect(van('P01').kosten_per_maand_eur).toBeCloseTo(1183, 6);
    expect(van('P04').keer_per_maand).toBe(23);
    expect(van('P04').uren_per_maand).toBeCloseTo(5.75, 6);
  });

  it('leidt fouten per maand af, of laat ze leeg (null) als niemand ze telde', () => {
    expect(van('P02').fouten_per_maand).toBeCloseTo(18.2, 6);
    expect(van('P04').fouten_per_maand).toBe(3);
    expect(van('P01').fouten_per_maand).toBeNull();
    expect(van('P01').ontbreekt).toContain('fouten_per_maand');
    expect(van('P02').ontbreekt).not.toContain('fouten_per_maand');
  });

  it('markeert een proces zonder bestaand werk', () => {
    expect(van('P09').uren_per_maand).toBe(0);
    expect(van('P09').ontbreekt).toContain('volume');
  });

  it('neemt risico, gevoelige gegevens en nooit_automatiseren over', () => {
    expect(van('P10').nooit_automatiseren).toBe(true);
    expect(van('P10').risico_bij_fout).toBe('kritiek');
    expect(van('P01').nooit_automatiseren).toBe(false);
    expect(van('P03').gevoelige_gegevens).toContain('sleutelcodes vakantiewoningen');
  });

  it('telt alle tien processen samen: ongeveer 119 uur en 3.106 euro per maand', () => {
    const uren = kaart.reduce((som, p) => som + p.uren_per_maand, 0);
    const kosten = kaart.reduce((som, p) => som + p.kosten_per_maand_eur, 0);
    expect(uren).toBeCloseTo(119.45, 1);
    expect(kosten).toBeCloseTo(3105.77, 1);
  });

  it('gooit zonder uurkosten', () => {
    expect(() => zetInKaart({ ...intake.processen, uurkosten_eur: 0 })).toThrow(/uurkosten/);
  });
});

describe('rendement', () => {
  it('berekent tijdwinst, foutwinst, runkosten en terugverdientijd (P02)', () => {
    const r = berekenRendement(P02);
    expect(r.proces_id).toBe('P02');
    expect(r.bespaarde_uren_per_maand).toBeCloseTo(9.1, 6);
    expect(r.tijdwinst_eur_per_maand).toBeCloseTo(236.6, 6);
    expect(r.foutwinst_eur_per_maand).toBeCloseTo(553.28, 6);
    expect(r.modelkosten_eur_per_maand).toBeCloseTo(0.057391, 5);
    expect(r.beheerkosten_eur_per_maand).toBe(95);
    expect(r.runkosten_eur_per_maand).toBeCloseTo(95.057391, 5);
    expect(r.netto_eur_per_maand).toBeCloseTo(694.822609, 5);
    expect(r.bouwkosten_eur).toBe(2660);
    expect(r.terugverdientijd_maanden).toBeCloseTo(3.8283, 3);
  });

  it('P01: de modelkosten zijn de kleinste post', () => {
    const r = berekenRendement(P01);
    expect(r.modelkosten_eur_per_maand).toBeCloseTo(1.07328, 6);
    expect(r.tijdwinst_eur_per_maand).toBeCloseTo(604.175, 6);
    expect(r.modelkosten_eur_per_maand).toBeLessThan(r.beheerkosten_eur_per_maand);
    expect(r.terugverdientijd_maanden).toBeCloseTo(5.983, 2);
  });

  it('geeft null als terugverdientijd wanneer er netto niets overblijft', () => {
    const r = berekenRendement(P09);
    expect(r.netto_eur_per_maand).toBeCloseTo(-47.5, 6);
    expect(r.terugverdientijd_maanden).toBeNull();
  });

  it('weigert een controletijd van 0 en waarden buiten 0..1', () => {
    expect(() => berekenRendement({ ...P02, minuten_met_agent: 0 })).toThrow(/controletijd/i);
    expect(() => berekenRendement({ ...P02, dekking: 1.2 })).toThrow(RangeError);
    expect(() => berekenRendement({ ...P02, dekking: 1.2 })).toThrow(/dekking/);
    expect(() => berekenRendement({ ...P02, foutreductie: -0.1 })).toThrow(/foutreductie/);
    expect(() => berekenRendement({ ...P02, bouwuren: -1 })).toThrow(RangeError);
    // Geen dekking en geen controletijd mag wel: dan doet de agent niets.
    expect(() => berekenRendement({ ...P02, dekking: 0, minuten_met_agent: 0 })).not.toThrow();
  });

  it('gevoeligheid geeft de zes scenario\'s in vaste volgorde, zonder de invoer te veranderen', () => {
    const kopie = { ...P02 };
    const uitkomst = gevoeligheid(P02);
    expect(uitkomst.map((s) => s.scenario)).toEqual([...SCENARIOS]);
    expect(P02).toEqual(kopie);
    const netto = Object.fromEntries(uitkomst.map((s) => [s.scenario, s.rendement.netto_eur_per_maand]));
    expect(netto.verwacht).toBeCloseTo(694.823, 2);
    expect(netto.halve_dekking).toBeCloseTo(576.52, 1);
    expect(netto.dubbele_controle).toBeCloseTo(647.5, 1);
    expect(netto.geen_foutreductie).toBeCloseTo(141.54, 1);
    expect(netto.duurder_model).toBeCloseTo(693.732, 2);
    expect(netto.voorzichtig).toBeCloseTo(330.64, 1);
    const voorzichtig = uitkomst.find((s) => s.scenario === 'voorzichtig');
    expect(voorzichtig?.rendement.bouwkosten_eur).toBeCloseTo(3192, 6);
    expect(voorzichtig?.rendement.terugverdientijd_maanden).toBeCloseTo(9.654, 2);
  });

  it('duurder_model laat een proces zonder model zonder model', () => {
    const zonderModel = { ...P02, model: null };
    const duurder = gevoeligheid(zonderModel).find((s) => s.scenario === 'duurder_model');
    expect(duurder?.rendement.modelkosten_eur_per_maand).toBe(0);
  });

  it('rangschikt op het voorzichtige scenario, met "nooit terugverdiend" achteraan', () => {
    const verwacht = [FOUTLEUNEND, P01].map((i) => berekenRendement(i).terugverdientijd_maanden ?? Infinity);
    expect(verwacht[0]).toBeLessThan(verwacht[1]); // verwacht: foutleunend is sneller terug
    const lijst = rangschikProcessen([P09, FOUTLEUNEND, P01, P02]);
    expect(lijst.map((r) => r.proces_id)).toEqual(['P02', 'P01', 'PX', 'P09']);
    expect(lijst.map((r) => r.rang)).toEqual([1, 2, 3, 4]);
    expect(lijst[0].voorzichtig.terugverdientijd_maanden).toBeCloseTo(9.654, 2);
    expect(lijst[3].voorzichtig.terugverdientijd_maanden).toBeNull();
  });
});

describe('besluit', () => {
  it('stabiel, herstelbaar en rendabel: automatisch', () => {
    const b = automatiseringsbesluit(BASIS_BESLUIT);
    expect(b).toMatchObject({ proces_id: 'P02', niveau: 'automatisch' });
    expect(b.redenen.length).toBeGreaterThan(0);
  });

  it('nooit_automatiseren of kritiek risico: niet, ook als het rendement goed is', () => {
    const noodgeval = automatiseringsbesluit({ ...BASIS_BESLUIT, proces_id: 'P10', nooit_automatiseren: true, risico_bij_fout: 'kritiek' });
    expect(noodgeval.niveau).toBe('niet');
    expect(noodgeval.redenen.join(' ')).toMatch(/mens/i);
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, risico_bij_fout: 'kritiek' }).niveau).toBe('niet');
  });

  it('instabiel proces of geen data: eerst vereenvoudigen, met een reden per oorzaak', () => {
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, proces_stabiel: false }).niveau).toBe('eerst_vereenvoudigen');
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, data_beschikbaar: false }).niveau).toBe('eerst_vereenvoudigen');
    const beide = automatiseringsbesluit({ ...BASIS_BESLUIT, proces_stabiel: false, data_beschikbaar: false });
    expect(beide.redenen).toHaveLength(2);
  });

  it('eerst vereenvoudigen gaat voor het rendement', () => {
    const b = automatiseringsbesluit({ ...BASIS_BESLUIT, proces_stabiel: false, terugverdientijd_voorzichtig_maanden: null });
    expect(b.niveau).toBe('eerst_vereenvoudigen');
  });

  it('rendement komt niet rond: niet (de grens zelf mag wel)', () => {
    const nooit = automatiseringsbesluit({ ...BASIS_BESLUIT, terugverdientijd_voorzichtig_maanden: null });
    expect(nooit.niveau).toBe('niet');
    expect(nooit.redenen.join(' ')).toMatch(/terugverdien/i);
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, terugverdientijd_voorzichtig_maanden: 12.5 }).niveau).toBe('niet');
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, terugverdientijd_voorzichtig_maanden: 12 }).niveau).toBe('automatisch');
  });

  it('hoog risico, onherstelbare fout, een persoon of relatiewerk: voorbereiden', () => {
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, risico_bij_fout: 'hoog' }).niveau).toBe('voorbereiden');
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, fout_herstelbaar: false }).niveau).toBe('voorbereiden');
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, relatiewerk: true }).niveau).toBe('voorbereiden');
    const persoon = automatiseringsbesluit({ ...BASIS_BESLUIT, besluit_over_persoon: true });
    expect(persoon.niveau).toBe('voorbereiden');
    expect(persoon.redenen.join(' ')).toMatch(/persoon/i);
    const alles = automatiseringsbesluit({ ...BASIS_BESLUIT, risico_bij_fout: 'hoog', fout_herstelbaar: false, relatiewerk: true, besluit_over_persoon: true });
    expect(alles.redenen).toHaveLength(4);
  });

  it('een besluit over een persoon is nooit automatisch, in welke combinatie dan ook', () => {
    const ja = [true, false];
    for (const stabiel of ja)
      for (const data of ja)
        for (const herstelbaar of ja)
          for (const relatie of ja)
            for (const risico of ['laag', 'middel', 'hoog'] as const)
              for (const t of [null, 1, 12, 30]) {
                const b = automatiseringsbesluit({
                  ...BASIS_BESLUIT,
                  besluit_over_persoon: true,
                  proces_stabiel: stabiel,
                  data_beschikbaar: data,
                  fout_herstelbaar: herstelbaar,
                  relatiewerk: relatie,
                  risico_bij_fout: risico,
                  terugverdientijd_voorzichtig_maanden: t,
                });
                expect(b.niveau).not.toBe('automatisch');
                expect(b.redenen.length).toBeGreaterThan(0);
              }
  });
});

describe('advies', () => {
  it('Bubbel: fase 1 is P02 en P01, fase 2 is P03 en P05, de rest niet', () => {
    const advies = maakAdvies(intake.processen, VASTE_AANNAMES);
    expect(advies.fase1).toEqual(['P02', 'P01']);
    expect(advies.fase2).toEqual(['P03', 'P05']);
    expect(advies.niet).toEqual(['P04', 'P06', 'P07', 'P08', 'P09', 'P10']);
    expect(advies.besluiten.map((b) => b.proces_id)).toEqual(intake.processen.processen.map((p) => p.id));
    expect(advies.rangschikking[0].proces_id).toBe('P02');
  });

  it('fase 1 blijft binnen het budget, ook bij 20% uitloop', () => {
    const advies = maakAdvies(intake.processen, VASTE_AANNAMES);
    expect(advies.bouwkosten_fase1_eur).toBeCloseTo(6840, 6);
    expect(advies.runkosten_fase1_eur_per_maand).toBeCloseTo(216.1307, 3);
    expect(advies.bouwkosten_fase1_voorzichtig_eur).toBeCloseTo(7980, 6);
    expect(advies.binnen_budget_voorzichtig).toBe(true);
  });

  it('wat niet meer in het budget past, schuift naar fase 2', () => {
    const krap: Aannames = { ...VASTE_AANNAMES, budget: { eenmalig_eur: 5000, per_maand_eur: 350 } };
    const advies = maakAdvies(intake.processen, krap);
    expect(advies.fase1).toEqual(['P02']);
    expect(advies.fase2).toContain('P01');
    expect(advies.bouwkosten_fase1_eur).toBeCloseTo(3800, 6);
    expect(sectie(advies.markdown, 'Fase 2: eerst vereenvoudigen')).toContain('Past niet meer binnen het budget van fase 1.');
  });

  it('het document heeft de vaste koppen en de bedragen uit code', () => {
    const { markdown } = maakAdvies(intake.processen, VASTE_AANNAMES);
    expect(markdown.startsWith('# Advies automatisering Wasserette Bubbel')).toBe(true);
    for (const kop of ['Samenvatting', 'Rangschikking', 'Fase 1', 'Fase 2: eerst vereenvoudigen', 'Niet automatiseren, en waarom', 'Gevoeligheid', 'Aannames']) {
      expect(markdown, kop).toContain(`\n## ${kop}`);
    }
    expect(sectie(markdown, 'Samenvatting')).toContain('€ 6.840');
    expect(sectie(markdown, 'Samenvatting')).toContain('€ 7.980');
    const niet = sectie(markdown, 'Niet automatiseren, en waarom');
    expect(niet).toContain('P10');
    expect(niet).not.toContain('P02');
    expect(sectie(markdown, 'Gevoeligheid')).toContain('voorzichtig');
  });

  it('elke aanname komt in het document', () => {
    const aannames = sectie(maakAdvies(intake.processen, VASTE_AANNAMES).markdown, 'Aannames');
    for (const p of VASTE_AANNAMES.processen) for (const tekst of p.aannames) expect(aannames).toContain(tekst);
  });

  it('een proces zonder aanname geeft een fout met het proces-id', () => {
    const zonderP10: Aannames = { ...VASTE_AANNAMES, processen: VASTE_AANNAMES.processen.filter((p) => p.proces_id !== 'P10') };
    expect(() => maakAdvies(intake.processen, zonderP10)).toThrow(/P10/);
  });
});

// ---------------------------------------------------------------------------
// Oefeningen met een eigen testgroep (tellen mee voor de bewijs-poort van hun les)
// ---------------------------------------------------------------------------

describe('oefening 11.1 · onvindbareCitaten', () => {
  it('elk citaat uit het verslag staat letterlijk in de aantekeningen', () => {
    expect(onvindbareCitaten(VERSLAG, intake.aantekeningen)).toEqual([]);
  });

  it('een aangepast of leeg citaat wordt gevonden; witruimte telt niet, hoofdletters wel', () => {
    const verslag: Intakeverslag = {
      ...VERSLAG,
      processen: [
        { ...VERSLAG.processen[0], citaat: VERSLAG.processen[0].citaat.replace(/ /g, '  \n ') },
        { ...VERSLAG.processen[1], citaat: 'Per week gaan er gemiddeld 15 machines of drogers stuk.' },
        { ...VERSLAG.processen[2], citaat: VERSLAG.processen[2].citaat.toUpperCase() },
      ],
    };
    expect(onvindbareCitaten(verslag, intake.aantekeningen)).toEqual(['Storing melden bij de monteur', 'Bedrijfswas']);
    const leeg: Intakeverslag = { ...VERSLAG, processen: [{ ...VERSLAG.processen[0], citaat: '   ' }] };
    expect(onvindbareCitaten(leeg, intake.aantekeningen)).toEqual(['Klantvragen beantwoorden']);
  });
});

describe('oefening 11.2 · stilstand', () => {
  const proces = (id: string) => {
    const p = intake.processen.processen.find((x) => x.id === id);
    if (!p) throw new Error(`${id} ontbreekt`);
    return p;
  };

  it('storingen: keer per maand x stilstanddagen x verlies per dag', () => {
    expect(stilstandEurPerMaand(proces('P02'), 38)).toBeCloseTo(((14 * 52) / 12) * 2.5 * 38, 6);
    expect(stilstandEurPerMaand(proces('P02'), 38)).toBeCloseTo(5763.33, 2);
  });

  it('zonder stilstanddagen: null, ook bij een proces per maand', () => {
    expect(stilstandEurPerMaand(proces('P01'), 38)).toBeNull();
    expect(stilstandEurPerMaand(proces('P04'), 38)).toBeNull();
    expect(stilstandEurPerMaand({ ...proces('P04'), gemiddelde_stilstand_dagen: 1 }, 10)).toBe(230);
  });
});

describe('oefening 11.3 · minimale dekking', () => {
  it('P01: de dekking waarbij klantvragen precies in 12 maanden terugverdiend zijn', () => {
    const d = minimaleDekking(P01, 12);
    expect(d).toBeCloseTo(0.318076, 5);
    expect(berekenRendement({ ...P01, dekking: d ?? 0 }).terugverdientijd_maanden).toBeCloseTo(12, 6);
  });

  it('0 als het zonder tijdwinst al lukt, null als het met dekking 1 niet lukt', () => {
    expect(minimaleDekking(P02, 12)).toBe(0); // de foutwinst alleen is al genoeg
    expect(minimaleDekking(P01, 1)).toBeNull();
    expect(minimaleDekking(P09, 12)).toBeNull();
  });

  it('weigert een maximum van 0 maanden', () => {
    expect(() => minimaleDekking(P01, 0)).toThrow(RangeError);
  });
});

describe('oefening 11.4 · bijzondere persoonsgegevens', () => {
  it('nooit hoger dan voorbereiden, met een reden', () => {
    const b = automatiseringsbesluit({ ...BASIS_BESLUIT, bijzondere_persoonsgegevens: true });
    expect(b.niveau).toBe('voorbereiden');
    expect(b.redenen.join(' ')).toMatch(/bijzondere/i);
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, bijzondere_persoonsgegevens: false }).niveau).toBe('automatisch');
  });

  it('de strengere regels gaan voor: niet en eerst vereenvoudigen blijven staan', () => {
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, bijzondere_persoonsgegevens: true, risico_bij_fout: 'kritiek' }).niveau).toBe('niet');
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, bijzondere_persoonsgegevens: true, proces_stabiel: false }).niveau).toBe('eerst_vereenvoudigen');
    expect(automatiseringsbesluit({ ...BASIS_BESLUIT, bijzondere_persoonsgegevens: true, terugverdientijd_voorzichtig_maanden: 30 }).niveau).toBe('niet');
  });
});

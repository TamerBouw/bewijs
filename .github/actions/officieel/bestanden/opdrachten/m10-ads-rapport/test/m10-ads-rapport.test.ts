import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  beslisCpa,
  beslisKlant,
  briefingBatch,
  cijferregel,
  controleerCopy,
  controleerRapportTekst,
  cpcEnCpm,
  doelRoasMeta,
  formaatVan,
  formatDag,
  formatEuro,
  formatRoas,
  formatVerschil,
  formatWeek,
  groepeer,
  keurRapportGoed,
  klantWeek,
  leesExport,
  maakBriefings,
  maakWeekpakket,
  naarGoedkeuringen,
  naarTaken,
  rapportFeiten,
  regelsUitSettings,
  schrijfRapport,
  schrijfVarianten,
  verstuurRapport,
  verwerkBatchResultaten,
  vindGroei,
  volgendeTestdag,
  vorigeWeek,
  type AdsKlant,
  type AdsRij,
  type Beslisregels,
  type CopyVariant,
  type Teamlid,
} from '@opdracht/m10-ads-rapport';
import { jsonAntwoord, maakNepClient, systemTekst, tekstAntwoord, userTekst, type NepAntwoord } from '../../../test-hulp/nepClient';
import {
  ADS_KLANTEN,
  adsWeken,
  laadAdsCsv,
  laadAdsExport,
  laadAppSettings,
  laadKlantdossier,
  laadKlanten,
  laadTeam,
} from '../../../test-hulp/vonkData';

const NU = '2026-11-02';
const WEEK = '2026-W44';
const KOP = 'week,rapportage_start,rapportage_eind,campagne,advertentieset,advertentie,vertoningen,bereik,klikken,uitgegeven_eur,aankopen,omzet_eur';

const klant = (slug: AdsKlant) => {
  const k = laadKlanten().find((x) => x.slug === slug);
  if (!k) throw new Error(slug);
  return k;
};
const rijenVan = (slug: AdsKlant) => adsWeken(slug).flatMap((w) => leesExport(laadAdsCsv(slug, w)));
const regels = (): Beslisregels => regelsUitSettings(laadAppSettings());
const adviezenVan = (slug: AdsKlant, week = WEEK) => beslisKlant(rijenVan(slug), doelRoasMeta(klant(slug)), regels(), week);
const teamlid = (naam: string): Teamlid => {
  const t = laadTeam().find((x) => x.naam === naam);
  if (!t) throw new Error(naam);
  return t;
};

/** Een synthetische reeks rijen voor één advertentie. */
function reeks(
  weken: Array<Partial<AdsRij> & { week: string }>,
  vast: Partial<AdsRij> = {},
): AdsRij[] {
  return weken.map((w) => ({
    rapportage_start: '',
    rapportage_eind: '',
    campagne: 'Test | Prospecting',
    advertentieset: 'Breed',
    advertentie: 'Test – video',
    vertoningen: 10_000,
    bereik: 8_000,
    klikken: 150,
    uitgegeven_eur: 100,
    aankopen: 2,
    omzet_eur: 300,
    ...vast,
    ...w,
  }));
}

// ---------------------------------------------------------------------------
describe('adsExport', () => {
  it('leest elke Vonk-export precies zoals de referentie-parser', () => {
    for (const slug of ADS_KLANTEN) {
      for (const week of adsWeken(slug)) {
        expect(leesExport(laadAdsCsv(slug, week)), `${slug} ${week}`).toEqual(laadAdsExport(slug, week));
      }
    }
    const [eerste] = leesExport(laadAdsCsv('groenwerk', '2026-W44'));
    expect(eerste).toEqual({
      week: '2026-W44',
      rapportage_start: '2026-10-26',
      rapportage_eind: '2026-11-01',
      campagne: 'Najaar | Prospecting',
      advertentieset: 'Breed | 25-65 | heel NL',
      advertentie: 'Loungeset Duin – video 15s',
      vertoningen: 47253,
      bereik: 29350,
      klikken: 680,
      uitgegeven_eur: 430,
      aankopen: 5,
      omzet_eur: 2800,
    });
    expect(leesExport(laadAdsCsv('groenwerk', '2026-W44')).map((r) => r.campagne)).toContain('Retargeting, 30 dagen');
  });

  it('kolommen op naam in elke volgorde, met een kolomkaart, puntkomma en Nederlandse getallen', () => {
    const csv =
      'Advertentie;Week;rapportage_start;rapportage_eind;campagne;advertentieset;Uitgegeven bedrag (EUR);vertoningen;bereik;klikken;aankopen;omzet_eur\n' +
      'Test – reel;2026-W44;2026-10-26;2026-11-01;Najaar | Prospecting;Breed;1.234,56;12.345;9.876;210;7;"2.469,12"\n';
    const [rij] = leesExport(csv, { Advertentie: 'advertentie', Week: 'week', 'Uitgegeven bedrag (EUR)': 'uitgegeven_eur' });
    expect(rij).toMatchObject({ advertentie: 'Test – reel', week: '2026-W44', uitgegeven_eur: 1234.56, vertoningen: 12345, bereik: 9876, omzet_eur: 2469.12 });
  });

  it('BOM, CRLF en lege regels geven geen fout', () => {
    const regel = '2026-W44,2026-10-26,2026-11-01,C,S,A – story,2000,1500,20,"12,50",0,0.00';
    const rijen = leesExport(`\uFEFF${KOP}\r\n\r\n${regel}\r\n   \r\n${regel}\r\n\r\n`);
    expect(rijen).toHaveLength(2);
    expect(rijen[0].week).toBe('2026-W44');
    expect(rijen[0].uitgegeven_eur).toBe(12.5);
  });

  it('een ontbrekende kolom of een kapot getal geeft een fout met kolomnaam en regelnummer', () => {
    expect(() => leesExport(KOP.replace(',klikken', '') + '\n')).toThrow(/klikken/);
    const kapot = `${KOP}\n2026-W44,2026-10-26,2026-11-01,C,S,A,1000,800,10,abc,0,0\n`;
    expect(() => leesExport(kapot)).toThrow(/Regel 2.*uitgegeven_eur/);
  });

  it('groepeer: per advertentie per week CTR, frequentie, ROAS en CPA; bereik tel je niet op', () => {
    const teak = groepeer(rijenVan('groenwerk')).find((r) => r.advertentie === 'Teak eettafel Kaap – carrousel');
    expect(teak?.weken.map((w) => w.week)).toEqual(['2026-W41', '2026-W42', '2026-W43', '2026-W44']);
    const w44 = teak?.weken.at(-1);
    expect(w44?.ctr).toBeCloseTo(147 / 24107, 12);
    expect(w44?.frequentie).toBeCloseTo(24107 / 6344, 12);
    expect(w44?.roas).toBeCloseTo(395 / 270, 12);
    expect(w44?.cpa_eur).toBeCloseTo(270, 12);
    expect(teak?.totaal.uitgegeven_eur).toBeCloseTo(1140, 9);
    expect(teak && 'frequentie' in teak.totaal).toBe(false);
    const winterhoes = groepeer(rijenVan('groenwerk')).find((r) => r.advertentie === 'Winterhoes – UGC review');
    expect(winterhoes?.weken[0].cpa_eur).toBeNull();
    expect(winterhoes?.weken[0].roas).toBe(0);
    const set = groepeer(rijenVan('groenwerk'), 'advertentieset').find((r) => r.advertentieset === 'Breed | 25-65 | heel NL');
    expect(set?.advertentie).toBe('');
    expect(set?.weken.at(-1)?.uitgegeven_eur).toBeCloseTo(764.3, 9);
    expect(set?.weken.at(-1)?.frequentie).toBeNull();
    expect(set?.retargeting).toBe(false);
    expect(groepeer(rijenVan('mout')).filter((r) => r.retargeting).map((r) => r.advertentie)).toEqual(['Eerste levering gratis verzonden']);
  });

  it('klantWeek: totaal van de week met de week ervoor; zonder vorige week null', () => {
    const kw = klantWeek(rijenVan('groenwerk'), WEEK);
    expect(kw.week.uitgegeven_eur).toBeCloseTo(1192.3, 9);
    expect(kw.week.aankopen).toBe(11);
    expect(kw.week.roas).toBeCloseTo(5151.9 / 1192.3, 12);
    expect(kw.vorige?.week).toBe('2026-W43');
    expect(kw.vorige?.uitgegeven_eur).toBeCloseTo(1042, 9);
    expect(kw.verschil_uitgaven).toBeCloseTo(150.3 / 1042, 12);
    expect(klantWeek(rijenVan('groenwerk'), '2026-W41').vorige).toBeNull();
    expect(vorigeWeek('2026-W01')).toBe('2025-W52');
    expect(() => klantWeek(rijenVan('groenwerk'), '2026-W45')).toThrow(/2026-W45/);
  });
});

// ---------------------------------------------------------------------------
describe('oefening 10.1 · cpc en cpm', () => {
  it('Teak eettafel Kaap in week 44: CPC € 1,84 (270 / 147) en CPM € 11,20', () => {
    const teak = groepeer(rijenVan('groenwerk')).find((r) => r.advertentie === 'Teak eettafel Kaap – carrousel');
    const w44 = teak?.weken.at(-1);
    if (!w44) throw new Error('Teak week 44 ontbreekt: maak eerst groepeer af (les 10.1)');
    const { cpc_eur, cpm_eur } = cpcEnCpm(w44);
    expect(cpc_eur).toBeCloseTo(270 / 147, 12);
    expect(cpm_eur).toBeCloseTo((270 / 24107) * 1000, 12);
    expect(formatEuro(cpc_eur ?? 0)).toBe('€ 1,84');
    expect(formatEuro(cpm_eur ?? 0)).toBe('€ 11,20');
  });

  it('zonder klikken of vertoningen: null, geen Infinity', () => {
    expect(cpcEnCpm({ vertoningen: 0, klikken: 0, uitgegeven_eur: 12.5 })).toEqual({ cpc_eur: null, cpm_eur: null });
    expect(cpcEnCpm({ vertoningen: 2000, klikken: 0, uitgegeven_eur: 10 })).toEqual({ cpc_eur: null, cpm_eur: 5 });
  });
});

// ---------------------------------------------------------------------------
describe('beslisregels', () => {
  it('regelsUitSettings leest app_settings (tekst) en gooit bij een ontbrekende of kapotte waarde', () => {
    expect(regels()).toEqual({
      min_vertoningen: 1000,
      pauzeer_na_eur: 60,
      vermoeidheid_min_frequentie: 3,
      vermoeidheid_min_ctr_daling_pct: 30,
      opschalen_factor: 1.25,
      opschalen_stap_pct: 20,
      opschalen_min_conversies: 3,
      groei_min_pct: 10,
      max_budgetwijziging_pct_zonder_eva: 20,
    });
    const zonder = laadAppSettings().filter((s) => s.sleutel !== 'pauzeer_advies_na_eur_zonder_conversie');
    expect(() => regelsUitSettings(zonder)).toThrow(/pauzeer_advies_na_eur_zonder_conversie/);
    const kapot = laadAppSettings().map((s) => (s.sleutel === 'vermoeidheid_min_frequentie' ? { ...s, waarde: 'hoog' } : s));
    expect(() => regelsUitSettings(kapot)).toThrow(/vermoeidheid_min_frequentie/);
    const komma = laadAppSettings().map((s) => (s.sleutel === 'vermoeidheid_min_frequentie' ? { ...s, waarde: '3,5' } : s));
    expect(regelsUitSettings(komma).vermoeidheid_min_frequentie).toBe(3.5);
    const eigen = [...laadAppSettings(), { sleutel: 'groei_min_pct_per_week', waarde: '15' }];
    expect(regelsUitSettings(eigen).groei_min_pct).toBe(15);
  });

  it('doelRoasMeta uit de KPI’s van de klant', () => {
    expect(ADS_KLANTEN.map((s) => doelRoasMeta(klant(s)))).toEqual([4, 2.2, 3]);
    const fysio = laadKlanten().find((k) => k.slug === 'fysiopunt');
    expect(() => doelRoasMeta(fysio as NonNullable<typeof fysio>)).toThrow(/FysioPunt/);
  });

  it('vindt per klant de patronen uit de data: winnaar, vermoeidheid en pauzeren (week 44)', () => {
    const tabel = (slug: AdsKlant) => Object.fromEntries(adviezenVan(slug).map((a) => [a.advertentie, a.actie]));
    expect(tabel('groenwerk')).toEqual({
      'Loungeset Duin – video 15s': 'opschalen',
      'Teak eettafel Kaap – carrousel': 'nieuwe_creative',
      'Klantreview – bank op het terras': 'laten_lopen',
      'Vroegboek – collectie 2027 carrousel': 'laten_lopen',
      'Winterhoes – UGC review': 'pauzeren',
    });
    expect(tabel('mout')).toEqual({
      'Proefpakket UGC – barista thuis': 'opschalen',
      'Single origin – carrousel': 'nieuwe_creative',
      'Reel – van boon tot kop': 'opschalen',
      'Eerste levering gratis verzonden': 'laten_lopen',
      'Gebrand binnen 7 dagen – statisch': 'pauzeren',
    });
    expect(tabel('lune')).toEqual({
      'Collectie Maan – statisch': 'nieuwe_creative',
      'Unboxing reel – oorbellen Maan': 'opschalen',
      'Atelier-reel – zo maken we het': 'laten_lopen',
      'Nog in je winkelmand – carrousel': 'laten_lopen',
      'Gravering – story': 'pauzeren',
    });
    for (const slug of ADS_KLANTEN) for (const a of adviezenVan(slug)) expect(a.reden.trim().length, a.advertentie).toBeGreaterThan(0);
  });

  it('controlegeval: retargeting met frequentie boven 3 maar een stabiele CTR is niet moe, en schalen we niet op', () => {
    const groen = adviezenVan('groenwerk').find((a) => a.retargeting);
    expect(groen?.cijfers.frequentie_laatste).toBeGreaterThan(3);
    expect(groen).toMatchObject({ actie: 'laten_lopen', regel: null });
    const lune = adviezenVan('lune').find((a) => a.retargeting);
    expect(lune?.cijfers.frequentie_laatste).toBeGreaterThan(3);
    for (const a of [lune, adviezenVan('mout').find((x) => x.retargeting)]) {
      expect(a).toMatchObject({ actie: 'laten_lopen', regel: 4 });
      expect(a?.reden).toMatch(/retargeting/i);
    }
  });

  it('grensgevallen: pauzeren pas vanaf 60 euro over alle weken samen; onder 1.000 vertoningen geen oordeel', () => {
    expect(adviezenVan('lune', '2026-W43').find((a) => a.advertentie === 'Gravering – story')?.actie).toBe('laten_lopen');
    expect(adviezenVan('mout', '2026-W43').find((a) => a.advertentie === 'Gebrand binnen 7 dagen – statisch')?.actie).toBe('laten_lopen');
    const r = regels();
    const precies = reeks([{ week: '2026-W43', uitgegeven_eur: 30, aankopen: 0, omzet_eur: 0 }, { week: '2026-W44', uitgegeven_eur: 30, aankopen: 0, omzet_eur: 0 }]);
    expect(beslisKlant(precies, 3, r)[0]).toMatchObject({ actie: 'pauzeren', regel: 2 });
    const net = reeks([{ week: '2026-W44', uitgegeven_eur: 59.99, aankopen: 0, omzet_eur: 0 }]);
    expect(beslisKlant(net, 3, r)[0].actie).toBe('laten_lopen');
    const weinig = reeks([{ week: '2026-W44', vertoningen: 999, bereik: 900, uitgegeven_eur: 500, aankopen: 0, omzet_eur: 0 }]);
    expect(beslisKlant(weinig, 3, r)[0]).toMatchObject({ actie: 'geen_oordeel', regel: 1 });
  });

  it('vermoeidheid: frequentie hoger dan 3,0 én CTR minstens 30% onder de beste week', () => {
    const r = regels();
    const moe = (frequentie: number, klikken: number) =>
      beslisKlant(
        reeks([
          { week: '2026-W43', vertoningen: 10_000, bereik: 5_000, klikken: 200 },
          { week: '2026-W44', vertoningen: 9_000, bereik: Math.round(9_000 / frequentie), klikken },
        ]),
        3,
        r,
      )[0].actie;
    expect(moe(3.5, 126)).toBe('nieuwe_creative'); // CTR 1,40% tegen 2,00%: precies 30% lager
    expect(moe(3.5, 127)).not.toBe('nieuwe_creative'); // net minder dan 30% lager
    expect(moe(3.0, 50)).not.toBe('nieuwe_creative'); // frequentie precies 3,0
  });

  it('winnaar: twee opeenvolgende weken ROAS >= 1,25 x doel met >= 3 aankopen; anders niet', () => {
    const r = regels();
    const twee = (a: Partial<AdsRij>, b: Partial<AdsRij>) => beslisKlant(reeks([{ week: '2026-W43', ...a }, { week: '2026-W44', ...b }]), 4, r)[0];
    expect(twee({ uitgegeven_eur: 100, omzet_eur: 500, aankopen: 3 }, { uitgegeven_eur: 100, omzet_eur: 500, aankopen: 3 }).actie).toBe('opschalen');
    expect(twee({ uitgegeven_eur: 100, omzet_eur: 500, aankopen: 2 }, { uitgegeven_eur: 100, omzet_eur: 900, aankopen: 9 }).actie).toBe('laten_lopen');
    expect(twee({ uitgegeven_eur: 100, omzet_eur: 499, aankopen: 5 }, { uitgegeven_eur: 100, omzet_eur: 900, aankopen: 9 }).actie).toBe('laten_lopen');
    const gat = beslisKlant(reeks([{ week: '2026-W42', omzet_eur: 900, aankopen: 9 }, { week: '2026-W44', omzet_eur: 900, aankopen: 9 }]), 4, r)[0];
    expect(gat.actie).toBe('laten_lopen');
    const retargeting = beslisKlant(reeks([{ week: '2026-W43', omzet_eur: 900, aankopen: 9 }, { week: '2026-W44', omzet_eur: 900, aankopen: 9 }], { campagne: 'Retargeting, 14 dagen' }), 4, r)[0];
    expect(retargeting).toMatchObject({ actie: 'laten_lopen', regel: 4 });
  });

  it('vindGroei: per klant precies de groeiende advertentieset; een groei van 0,7% per week telt niet', () => {
    const groei = (slug: AdsKlant, r = regels()) => vindGroei(rijenVan(slug), doelRoasMeta(klant(slug)), r, WEEK).map((g) => `${g.campagne} › ${g.advertentieset}`);
    expect(groei('groenwerk')).toEqual(['Vroegboek voorjaar 2027 › Vergelijkbaar met kopers 1%']);
    expect(groei('mout')).toEqual(['Abonnement | Reels › Instagram Reels | breed 25-55']);
    expect(groei('lune')).toEqual(['Collectie Maan | Prospecting › Instagram Reels | 20-45']);
    // Zonder minimum telt de najaarscampagne van Groenwerk (680, 685, 690, 764 euro) ook als groei.
    expect(groei('groenwerk', { ...regels(), groei_min_pct: 0 })).toContain('Najaar | Prospecting › Breed | 25-65 | heel NL');
    expect(vindGroei(rijenVan('groenwerk'), 4, regels(), '2026-W43')).toEqual([]);
  });

  it('naarGoedkeuringen: opschalen en pauzeren worden voorstellen in goedkeuringen; boven 20% alleen Eva', () => {
    const team = laadTeam();
    const voorstellen = naarGoedkeuringen(adviezenVan('groenwerk'), 'K01', regels(), team);
    expect(voorstellen.map((v) => [v.actie_type, v.payload.advertentie])).toEqual([
      ['budget_wijzigen', 'Loungeset Duin – video 15s'],
      ['campagne_pauzeren', 'Winterhoes – UGC review'],
    ]);
    expect(voorstellen[0]).toMatchObject({ status: 'wachtend', voorgesteld_door: 'agent:ads-rapport', mag_goedkeuren: ['T01', 'T03'] });
    expect(voorstellen[0].payload).toMatchObject({ klant_id: 'K01', wijziging_pct: 20 });
    expect(voorstellen[1].mag_goedkeuren).toEqual(['T01', 'T03']);
    const groot = naarGoedkeuringen(adviezenVan('groenwerk'), 'K01', { ...regels(), opschalen_stap_pct: 25 }, team);
    expect(groot[0].mag_goedkeuren).toEqual(['T01']);
  });

  it('volgendeTestdag: de eerstvolgende donderdag, nooit vrijdag', () => {
    expect(volgendeTestdag('2026-11-02')).toBe('2026-11-05');
    expect(volgendeTestdag('2026-11-05')).toBe('2026-11-12');
    expect(volgendeTestdag('2026-11-06')).toBe('2026-11-12');
    expect(volgendeTestdag('2026-12-31')).toBe('2027-01-07');
  });
});

// ---------------------------------------------------------------------------
describe('oefening 10.2 · cpa-regel', () => {
  const eenReeks = (uitgegeven: [number, number], aankopen: [number, number]) =>
    groepeer(
      reeks([
        { week: '2026-W43', uitgegeven_eur: uitgegeven[0], aankopen: aankopen[0] },
        { week: '2026-W44', uitgegeven_eur: uitgegeven[1], aankopen: aankopen[1] },
      ]),
    )[0];

  it('CPA boven het maximum na genoeg uitgaven: een eigen advies met de CPA in de reden', () => {
    const advies = beslisCpa(eenReeks([60, 60], [3, 3]), 16);
    expect(advies).toEqual({
      actie: 'cpa_te_hoog',
      sleutel: 'Test | Prospecting › Breed › Test – video',
      reden: 'CPA € 20,00 sinds de start, boven het maximum van € 16,00.',
    });
    expect(beslisCpa(eenReeks([50, 50], [2, 3]), 16)?.actie).toBe('cpa_te_hoog'); // precies 100 euro telt mee
  });

  it('geen advies onder de grens, onder het maximum of zonder aankoop', () => {
    expect(beslisCpa(eenReeks([60, 60], [4, 4]), 16)).toBeNull(); // CPA 15
    expect(beslisCpa(eenReeks([45, 45], [1, 1]), 16)).toBeNull(); // 90 euro: te weinig uitgegeven
    expect(beslisCpa(eenReeks([80, 80], [0, 0]), 16)).toBeNull(); // geen aankoop: dat is regel 2
  });
});

// ---------------------------------------------------------------------------
/** De voorbeeldzinnen uit het klantdossier: "- "zin" ..." onder **Goed** en **Fout**. */
function voorbeeldzinnen(slug: AdsKlant): { goed: string[]; fout: string[] } {
  const tekst = laadKlantdossier(slug).tekst;
  const blok = (van: string, tot: RegExp) => {
    const start = tekst.indexOf(van);
    const rest = tekst.slice(start + van.length);
    const eind = rest.search(tot);
    return (eind === -1 ? rest : rest.slice(0, eind))
      .split('\n')
      .map((r) => /^- "(.+?)"/.exec(r.trim())?.[1])
      .filter((z): z is string => Boolean(z));
  };
  return { goed: blok('**Goed**', /\*\*Fout\*\*/), fout: blok('**Fout**', /\n## /) };
}

describe('copyControle', () => {
  it('de goede voorbeeldzinnen uit elk klantdossier gaan er zonder bevinding door', () => {
    for (const slug of ADS_KLANTEN) {
      const { goed } = voorbeeldzinnen(slug);
      expect(goed.length, slug).toBe(3);
      for (const zin of goed) expect(controleerCopy(zin, slug), `${slug}: ${zin}`).toEqual({ toegestaan: true, bevindingen: [] });
    }
  });

  it('de foute voorbeeldzinnen uit elk klantdossier worden geblokkeerd', () => {
    for (const slug of ADS_KLANTEN) {
      const { fout } = voorbeeldzinnen(slug);
      expect(fout.length, slug).toBe(3);
      for (const zin of fout) {
        const c = controleerCopy(zin, slug);
        expect(c.toegestaan, `${slug}: ${zin}`).toBe(false);
        for (const b of c.bevindingen) {
          expect(b.regel.length).toBeGreaterThan(0);
          expect(['blokkeren', 'markeren']).toContain(b.ernst);
          expect(zin.toLowerCase()).toContain(b.fragment.toLowerCase().replace(/^\d+ emoji$/, ''));
          expect(b.uitleg.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('voorwaarden: "gratis" en "versgebrand" mogen met de voorwaarde erbij', () => {
    expect(controleerCopy('Gratis bezorging vanaf 500 euro, tot achter in de tuin.', 'groenwerk').toegestaan).toBe(true);
    expect(controleerCopy('Gratis bezorging tot achter in de tuin.', 'groenwerk').toegestaan).toBe(false);
    expect(controleerCopy('Versgebrand: binnen 7 dagen na het branden bij je.', 'mout').toegestaan).toBe(true);
    expect(controleerCopy('Versgebrand en zo bij je.', 'mout').toegestaan).toBe(false);
    expect(controleerCopy('Massief goud? Nee: verguld zilver.', 'lune').toegestaan).toBe(false);
  });

  it('toon in code: Lune hooguit één emoji, Groenwerk geen uitroeptekens', () => {
    expect(controleerCopy('hoi jij 🌙 Getij is er.', 'lune').toegestaan).toBe(true);
    expect(controleerCopy('hoi jij 🌙🌊 Getij is er.', 'lune').bevindingen.map((b) => b.regel)).toContain('ln-emoji');
    expect(controleerCopy('Twintig zomers mee!', 'groenwerk').toegestaan).toBe(false);
  });

  it('markeren is geen blokkeren: een mens kijkt (van-prijs, prijs bij Groenwerk, bio bij Mout)', () => {
    const vanPrijs = controleerCopy('Oorbellen Getij: van 59 voor 49 euro.', 'lune');
    expect(vanPrijs.toegestaan).toBe(true);
    expect(vanPrijs.bevindingen.map((b) => [b.regel, b.ernst])).toContainEqual(['ln-vanprijs', 'markeren']);
    expect(controleerCopy('Loungeset Duin, 1.199 euro.', 'groenwerk').bevindingen.map((b) => b.regel)).toEqual(['gw-prijs']);
    expect(controleerCopy('Onze bio-lijn: drie koffies.', 'mout').bevindingen.map((b) => b.ernst)).toEqual(['markeren']);
  });

  it('Meta-regels gelden voor elke klant: persoonlijke kenmerken, onrealistische uitkomsten, speciale categorieën', () => {
    for (const slug of ADS_KLANTEN) {
      expect(controleerCopy('Ben jij 65-plus en wil je minder gedoe?', slug).toegestaan, slug).toBe(false);
      expect(controleerCopy('Heb je last van een stijve nek na het werk?', slug).toegestaan, slug).toBe(false);
      expect(controleerCopy('Binnen 2 weken 3 kilo lichter met elke kop.', slug).toegestaan, slug).toBe(false);
      const vacature = controleerCopy('Vacature: wij zoeken een collega voor ons team.', slug);
      expect(vacature.toegestaan, slug).toBe(true);
      expect(vacature.bevindingen.map((b) => b.regel), slug).toContain('meta-speciale-categorie');
    }
  });
});

// ---------------------------------------------------------------------------
const variant = (invalshoek: string, velden: Partial<CopyVariant> = {}): CopyVariant => ({
  invalshoek,
  hook: 'Kijk eerst goed.',
  kop: 'Zo is het gemaakt',
  primaire_tekst: 'Kijk eerst goed. Zo is het gemaakt, stap voor stap.',
  onderbouwing: 'handgemaakt in ons atelier',
  ...velden,
});
const brief = (slug: AdsKlant) => ({
  klant: slug,
  klantnaam: klant(slug).naam,
  product: 'Collectie Maan',
  aanleiding: 'Creative is moe',
  feiten: klant(slug).mag,
  aantal: 3,
});

describe('copyVarianten', () => {
  it('één aanroep met gestructureerde output; alleen het dossier van deze klant, met cache_control', async () => {
    const client = maakNepClient([jsonAntwoord({ varianten: [variant('atelier'), variant('cadeau'), variant('materiaal')] })]);
    const { varianten, aanroepen } = await schrijfVarianten(client, brief('lune'), laadKlantdossier('lune').tekst);
    expect(aanroepen).toBe(1);
    expect(client.aantalAanroepen).toBe(1);
    expect(varianten.map((v) => v.status)).toEqual(['klaar_voor_review', 'klaar_voor_review', 'klaar_voor_review']);
    const p = client.laatsteAanroep;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect((p as unknown as { output_config: { format: { type: string } } }).output_config.format.type).toBe('json_schema');
    const system = systemTekst(p);
    expect(system).toMatch(/Hypoallergeen/);
    for (const ander of ['Groenwerk', 'Mout', 'Korrel', 'TechNest', 'FysioPunt']) expect(system, ander).not.toContain(ander);
    const blokken = p.system as Anthropic.TextBlockParam[];
    expect(Array.isArray(blokken) && blokken.some((b) => b.cache_control?.type === 'ephemeral' && b.text.includes('Hypoallergeen'))).toBe(true);
    expect(userTekst(p)).toContain('Collectie Maan');
  });

  it('een geblokkeerde variant gaat één keer terug met de bevindingen, en komt dan goed door', async () => {
    const client = maakNepClient([
      jsonAntwoord({ varianten: [variant('atelier'), variant('materiaal', { kop: 'Massief gouden oorbellen' }), variant('cadeau')] }),
      jsonAntwoord({ varianten: [variant('materiaal', { kop: 'Verguld zilver, met de hand' })] }),
    ]);
    const { varianten, aanroepen } = await schrijfVarianten(client, brief('lune'), laadKlantdossier('lune').tekst);
    expect(aanroepen).toBe(2);
    expect(varianten.map((v) => v.status)).toEqual(['klaar_voor_review', 'klaar_voor_review', 'klaar_voor_review']);
    expect(varianten[1].kop).toBe('Verguld zilver, met de hand');
    const tweede = client.laatsteAanroep;
    expect(tweede.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(userTekst(tweede)).toMatch(/Verguld zilver is geen goud/);
  });

  it('blijft hij geblokkeerd, dan houdt hij die status en volgt er geen derde aanroep', async () => {
    const client = maakNepClient([
      jsonAntwoord({ varianten: [variant('urgentie', { hook: 'Alleen vandaag.' }), variant('atelier')] }),
      jsonAntwoord({ varianten: [variant('urgentie', { hook: 'Laatste kans.' })] }),
    ]);
    const { varianten } = await schrijfVarianten(client, brief('lune'), laadKlantdossier('lune').tekst);
    expect(client.aantalAanroepen).toBe(2);
    expect(varianten.map((v) => v.status)).toEqual(['geblokkeerd', 'klaar_voor_review']);
    expect(varianten[0].controle.bevindingen.map((b) => b.regel)).toContain('ln-urgentie');
  });

  it('lengte en dubbele invalshoek worden in code gecontroleerd; een weigering is een fout', async () => {
    const lang = 'x'.repeat(41);
    const client = maakNepClient([
      jsonAntwoord({ varianten: [variant('atelier', { kop: lang }), variant('atelier'), variant('cadeau')] }),
      jsonAntwoord({ varianten: [variant('atelier', { kop: lang })] }),
    ]);
    const { varianten } = await schrijfVarianten(client, brief('lune'), laadKlantdossier('lune').tekst);
    expect(varianten[0].controle.bevindingen.map((b) => b.regel)).toContain('lengte-kop');
    expect(varianten[1].controle.bevindingen.map((b) => [b.regel, b.ernst])).toContainEqual(['dubbele-invalshoek', 'markeren']);
    await expect(schrijfVarianten(maakNepClient([jsonAntwoord({ varianten: [] }, 'refusal')]), brief('mout'), 'dossier')).rejects.toThrow(/refusal/);
  });
});

// ---------------------------------------------------------------------------
describe('briefingPijplijn', () => {
  it('formaatVan leest het formaat uit de advertentienaam', () => {
    expect(
      ['Loungeset Duin – video 15s', 'Proefpakket UGC – barista thuis', 'Unboxing reel – oorbellen Maan', 'Teak eettafel Kaap – carrousel', 'Gravering – story', 'Collectie Maan – statisch', 'Eerste levering gratis verzonden'].map(formaatVan),
    ).toEqual(['video', 'ugc', 'reel', 'carrousel', 'story', 'statisch', 'onbekend']);
  });

  it('maakBriefings: vermoeidheid krijgt het formaat van de winnaar; deadline dinsdag, testdag donderdag', () => {
    const b = maakBriefings(klant('groenwerk'), 'groenwerk', adviezenVan('groenwerk'), WEEK, NU);
    expect(b.map((x) => [x.advertentie, x.aanleiding, x.formaat_nu, x.formaat_voorstel])).toEqual([
      ['Loungeset Duin – video 15s', 'winnaar', 'video', 'video'],
      ['Teak eettafel Kaap – carrousel', 'vermoeidheid', 'carrousel', 'video'],
    ]);
    expect(b[1]).toMatchObject({ klant: 'groenwerk', klant_id: 'K01', deadline: '2026-11-03', testdag: '2026-11-05', voor: ['T04', 'T05'] });
    expect(b[1].verboden).toEqual(klant('groenwerk').mag_niet);
    expect(b[1].feiten).toEqual(klant('groenwerk').mag);
    expect(b[1].klantgoedkeuring).toMatch(/Ruben/);
    expect(maakBriefings(klant('lune'), 'lune', adviezenVan('lune'), WEEK, NU)[0].klantgoedkeuring).toMatch(/Yara/);
    expect(maakBriefings(klant('mout'), 'mout', adviezenVan('mout'), WEEK, NU).map((x) => x.advertentie)).toEqual([
      'Proefpakket UGC – barista thuis',
      'Single origin – carrousel',
      'Reel – van boon tot kop',
    ]);
  });

  it('elke briefing-id is een geldige en unieke custom_id, ook bij lange of dubbele namen', () => {
    const lang = 'Een heel lange advertentienaam – met een en-dash, accenten als café en crème en nog veel meer woorden – video';
    const dubbel = adviezenVan('lune').filter((a) => a.actie === 'nieuwe_creative').flatMap((a) => [{ ...a, advertentie: lang }, { ...a, advertentie: lang }]);
    const alle = [...ADS_KLANTEN.flatMap((s) => maakBriefings(klant(s), s, adviezenVan(s), WEEK, NU)), ...maakBriefings(klant('lune'), 'lune', dubbel, WEEK, NU)];
    for (const b of alle) expect(b.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(new Set(alle.map((b) => b.id)).size).toBe(alle.length);
  });

  it('briefingBatch: één geldig Messages-verzoek per briefing, met alleen het eigen klantdossier', async () => {
    const briefings = ADS_KLANTEN.flatMap((s) => maakBriefings(klant(s), s, adviezenVan(s), WEEK, NU));
    const dossiers = Object.fromEntries(ADS_KLANTEN.map((s) => [s, laadKlantdossier(s).tekst]));
    const verzoeken = briefingBatch(briefings, dossiers);
    expect(verzoeken.map((v) => v.custom_id)).toEqual(briefings.map((b) => b.id));
    const client = maakNepClient([], { daarnaSteeds: jsonAntwoord({ concepten: [] }) });
    for (const v of verzoeken) await client.messages.create(v.params); // de nep-API controleert elk verzoek
    const lune = verzoeken.find((v) => v.custom_id.startsWith('lune'));
    const tekst = lune ? systemTekst(lune.params) : '';
    expect(tekst).toContain('Atelier Lune');
    expect(tekst).not.toContain('Groenwerk');
    expect(tekst).not.toContain('Mout');
    expect(() => briefingBatch(briefings, { groenwerk: 'x' })).toThrow(/mout|lune/);
  });

  it('verwerkBatchResultaten: geslaagd wordt gecontroleerd; mislukt, verlopen, afgekapt of ontbrekend moet opnieuw', () => {
    const briefings = maakBriefings(klant('lune'), 'lune', adviezenVan('lune'), WEEK, NU);
    const concept = (hook: string) => ({ titel: 'Atelier', formaat: 'reel', hook, tekst_op_beeld: 'Met de hand gemaakt', beeldidee: 'Handen aan het werk', onderbouwing: 'handgemaakt' });
    const bericht = (inhoud: string, stop: Anthropic.StopReason = 'end_turn') =>
      ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: inhoud, citations: null }], stop_reason: stop, stop_sequence: null, usage: {} }) as unknown as Anthropic.Message;
    const resultaten = [
      { custom_id: briefings[0].id, result: { type: 'succeeded', message: bericht(JSON.stringify({ concepten: [concept('Zo maken we het.'), concept('Massief goud, alleen vandaag.')] })) } },
      { custom_id: briefings[1].id, result: { type: 'expired' } },
    ] as unknown as Anthropic.Messages.MessageBatchIndividualResponse[];
    const { klaar, opnieuw } = verwerkBatchResultaten(resultaten, briefings);
    expect(klaar).toHaveLength(1);
    expect(klaar[0].concepten.map((c) => c.controle.toegestaan)).toEqual([true, false]);
    expect(opnieuw).toEqual([briefings[1].id]);
    const kapot = [
      { custom_id: briefings[0].id, result: { type: 'succeeded', message: bericht('{"concepten": [', 'max_tokens') } },
      { custom_id: briefings[1].id, result: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'x' } } } },
    ] as unknown as Anthropic.Messages.MessageBatchIndividualResponse[];
    expect(verwerkBatchResultaten(kapot, briefings).opnieuw.sort()).toEqual([briefings[0].id, briefings[1].id].sort());
    expect(verwerkBatchResultaten([], briefings).opnieuw).toEqual(briefings.map((b) => b.id));
  });

  it('naarTaken: een taak voor Sem en een voor Lotte, zonder geblokkeerde concepten', () => {
    const [moe] = maakBriefings(klant('lune'), 'lune', adviezenVan('lune'), WEEK, NU);
    const ok = { titel: 'Atelier', formaat: 'reel', hook: 'Zo maken we het.', tekst_op_beeld: 'Met de hand', beeldidee: 'Handen', onderbouwing: 'handgemaakt', controle: { toegestaan: true, bevindingen: [] } };
    const fout = { ...ok, titel: 'Goud', hook: 'Massief goud.', controle: { toegestaan: false, bevindingen: [] } };
    const taken = naarTaken({ briefing: moe, concepten: [ok, fout] });
    expect(taken.map((t) => t.toegewezen_aan)).toEqual(['T04', 'T05']);
    expect(taken[0]).toMatchObject({ klant_id: 'K04', deadline: '2026-11-03', status: 'open', prioriteit: 'hoog', bron: 'agent', lead_id: null });
    expect(taken[0].omschrijving).toContain('Zo maken we het.');
    expect(taken[0].omschrijving).not.toContain('Massief goud');
    expect(taken[0].omschrijving).toMatch(/Yara/);
  });
});

// ---------------------------------------------------------------------------
describe('klantrapport', () => {
  const feitenVan = (slug: AdsKlant, week = WEEK) =>
    rapportFeiten(klant(slug), rijenVan(slug), week, adviezenVan(slug, week), vindGroei(rijenVan(slug), doelRoasMeta(klant(slug)), regels(), week), NU, regels());
  const tekstVanModel = (velden: Partial<{ wat_viel_op: string[]; wat_we_gaan_doen: string[]; nodig_van_je: string | null }> = {}): NepAntwoord =>
    jsonAntwoord({
      wat_viel_op: ['De video van de loungeset blijft de winnaar, met een ROAS (omzet per euro advertentiebudget) van 6,51.'],
      wat_we_gaan_doen: ['Donderdag 5 november zetten we een nieuwe creative voor de teaktafel live.'],
      nodig_van_je: 'Mogen we de vroegboekcampagne een groter deel van het budget geven?',
      ...velden,
    });

  it('opmaak volgens de rapportagestandaard', () => {
    expect(formatWeek('2026-W44')).toBe('week 44 (26 oktober t/m 1 november)');
    expect(formatWeek('2026-W45')).toBe('week 45 (2 november t/m 8 november)');
    expect(formatEuro(1192.3)).toBe('€ 1.192,30');
    expect(formatRoas(5151.9 / 1192.3)).toBe('4,32');
    expect(formatRoas(null)).toBe('n.v.t.');
    expect(formatVerschil(150.3 / 1042)).toBe('+14%');
    expect(formatVerschil(-0.052)).toBe('-5%');
    expect(formatDag('2026-11-05')).toBe('donderdag 5 november');
  });

  it('cijferregel: precies het voorbeeld uit de rapportagestandaard voor Groenwerk week 44', () => {
    expect(cijferregel(klantWeek(rijenVan('groenwerk'), WEEK))).toBe('Uitgaven € 1.192,30 (+14%), 11 aankopen, ROAS 4,32 (was 4,71).');
    expect(cijferregel(klantWeek(rijenVan('groenwerk'), '2026-W41'))).toBe('Uitgaven € 880,00, 10 aankopen, ROAS 5,66.');
  });

  it('rapportFeiten: alles uitgerekend en opgemaakt in code, zonder e-mailadressen', () => {
    const f = feitenVan('groenwerk');
    expect(f).toMatchObject({ klant: 'Groenwerk Tuinmeubelen', klant_id: 'K01', periode: WEEK, week_label: 'week 44 (26 oktober t/m 1 november)', doel_roas: '4,00' });
    expect(f.winnaars).toEqual([{ advertentie: 'Loungeset Duin – video 15s', roas: '6,65 en 6,51' }]);
    expect(f.moe).toEqual([{ advertentie: 'Teak eettafel Kaap – carrousel', frequentie: '3,8', ctr_nu: '0,61%', ctr_beste: '1,62%' }]);
    expect(f.pauzeren).toEqual([{ advertentie: 'Winterhoes – UGC review', uitgegeven: '€ 64,30' }]);
    expect(f.groei.map((g) => g.advertentieset)).toEqual(['Vergelijkbaar met kopers 1%']);
    expect(f.acties.join(' ')).toContain('donderdag 5 november');
    expect(f.nodig_van_klant).toHaveLength(1);
    expect(JSON.stringify(f)).not.toMatch(/@/);
    expect(feitenVan('mout').retargeting_niet_opschalen).toEqual(['Eerste levering gratis verzonden']);
  });

  it('schrijfRapport: één aanroep; cijfers en tabel uit code, tekst van het model, status concept', async () => {
    const client = maakNepClient([tekstVanModel()]);
    const kw = klantWeek(rijenVan('groenwerk'), WEEK);
    const rapport = await schrijfRapport(client, feitenVan('groenwerk'), kw);
    expect(client.aantalAanroepen).toBe(1);
    expect((client.laatsteAanroep as unknown as { output_config: { format: { type: string } } }).output_config.format.type).toBe('json_schema');
    expect(userTekst(client.laatsteAanroep)).toContain('Uitgaven € 1.192,30 (+14%)');
    expect(rapport).toMatchObject({ klant_id: 'K01', periode_type: 'week', periode: WEEK, status: 'concept', controle: { problemen: [], terugval: false } });
    const md = rapport.inhoud_md;
    expect(md.startsWith('**Week 44 (26 oktober t/m 1 november)**')).toBe(true);
    expect(md).toContain('Uitgaven € 1.192,30 (+14%), 11 aankopen, ROAS 4,32 (was 4,71).');
    expect(md).toContain('| Uitgaven | € 1.192,30 | € 1.042,00 | +14% |');
    expect(md).toContain('**Wat viel op**');
    expect(md).toContain('ROAS (omzet per euro advertentiebudget) van 6,51');
    expect(md).toContain('**Wat we van je nodig hebben**');
    expect(md).not.toMatch(/Groet/);
    expect(rapport.woorden).toBeLessThanOrEqual(250);
  });

  it('een verzonnen getal, een uitroepteken of een belofte: terug naar de standaardtekst', async () => {
    const kw = klantWeek(rijenVan('groenwerk'), WEEK);
    const verzonnen = await schrijfRapport(maakNepClient([tekstVanModel({ wat_viel_op: ['De ROAS steeg naar 7,10.'] })]), feitenVan('groenwerk'), kw);
    expect(verzonnen.controle.terugval).toBe(true);
    expect(verzonnen.controle.problemen.join(' ')).toContain('7,10');
    expect(verzonnen.inhoud_md).not.toContain('7,10');
    expect(verzonnen.inhoud_md).toContain('"Loungeset Duin – video 15s" is de winnaar (ROAS 6,65 en 6,51).');
    const roep = await schrijfRapport(maakNepClient([tekstVanModel({ wat_we_gaan_doen: ['Volgende week verdubbelen we je omzet!'] })]), feitenVan('groenwerk'), kw);
    expect(roep.controle.terugval).toBe(true);
    expect(controleerRapportTekst('We garanderen meer omzet.', feitenVan('groenwerk')).join(' ')).toMatch(/belofte/);
    const lang = await schrijfRapport(maakNepClient([tekstVanModel({ wat_viel_op: ['woord '.repeat(240)] })]), feitenVan('groenwerk'), kw);
    expect(lang.controle.problemen.join(' ')).toMatch(/250/);
    const weigert = await schrijfRapport(maakNepClient([tekstAntwoord('Nee', 'refusal')]), feitenVan('groenwerk'), kw);
    expect(weigert.controle.terugval).toBe(true);
    expect(weigert.status).toBe('concept');
  });

  it('goedkeuren: alleen de accountmanager of Eva; pas dan staat er een naam onder', async () => {
    const rapport = await schrijfRapport(maakNepClient([tekstVanModel()]), feitenVan('groenwerk'), klantWeek(rijenVan('groenwerk'), WEEK));
    expect(() => keurRapportGoed(rapport, teamlid('Noor'), klant('groenwerk'), '2026-11-02T09:15:00+01:00')).toThrow(/Noor/);
    expect(() => keurRapportGoed(rapport, teamlid('Fleur'), klant('groenwerk'), '2026-11-02T09:15:00+01:00')).toThrow(/Fleur/);
    expect(() => keurRapportGoed(rapport, teamlid('Daan'), klant('mout'), '2026-11-02T09:15:00+01:00')).toThrow(/Daan/);
    const goed = keurRapportGoed(rapport, teamlid('Daan'), klant('groenwerk'), '2026-11-02T09:15:00+01:00');
    expect(goed).toMatchObject({ status: 'goedgekeurd', beoordeeld_door: 'T02', beoordeeld_op: '2026-11-02T09:15:00+01:00' });
    expect(goed.inhoud_md.endsWith('Groet,\nDaan')).toBe(true);
    expect(keurRapportGoed(rapport, teamlid('Eva'), klant('groenwerk'), NU).status).toBe('goedgekeurd');
    expect(() => keurRapportGoed(goed, teamlid('Daan'), klant('groenwerk'), NU)).toThrow(/goedgekeurd/);
  });

  it('versturen: nooit een concept, en nooit twee keer', async () => {
    const rapport = await schrijfRapport(maakNepClient([tekstVanModel()]), feitenVan('groenwerk'), klantWeek(rijenVan('groenwerk'), WEEK));
    const stuur = vi.fn(async () => ({ id: 'resend-1' }));
    await expect(verstuurRapport(rapport, klant('groenwerk'), { stuur }, NU)).rejects.toThrow(/concept/);
    expect(stuur).not.toHaveBeenCalled();
    const goed = keurRapportGoed(rapport, teamlid('Daan'), klant('groenwerk'), NU);
    const verstuurd = await verstuurRapport(goed, klant('groenwerk'), { stuur }, '2026-11-02T10:02:00+01:00');
    expect(stuur).toHaveBeenCalledTimes(1);
    expect(stuur.mock.calls[0]).toEqual([{ aan: 'ruben@groenwerk.example', onderwerp: 'Weekrapport week 44 (26 oktober t/m 1 november)', tekst: goed.inhoud_md }]);
    expect(verstuurd).toMatchObject({ status: 'verstuurd', verstuurd_op: '2026-11-02T10:02:00+01:00' });
    await expect(verstuurRapport(verstuurd, klant('groenwerk'), { stuur }, NU)).rejects.toThrow(/verstuurd/);
    expect(stuur).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe('weekpakket', () => {
  /** Nep-model: antwoordt op basis van het gevraagde schema. */
  const nepModel = () =>
    maakNepClient([], {
      daarnaSteeds: (params) => {
        const schema = (params as unknown as { output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } } }).output_config?.format?.schema;
        if (schema?.properties && 'varianten' in schema.properties) {
          return jsonAntwoord({ varianten: [variant('vakmanschap'), variant('gebruik'), variant('aanbod')] });
        }
        return jsonAntwoord({ wat_viel_op: ['De winnaar blijft de winnaar.'], wat_we_gaan_doen: ['Donderdag zetten we een nieuwe creative live.'], nodig_van_je: null });
      },
    });
  const invoer = (slug: AdsKlant, velden: Partial<Parameters<typeof maakWeekpakket>[1]> = {}) => ({
    klant: klant(slug),
    slug,
    dossier: laadKlantdossier(slug).tekst,
    exports: adsWeken(slug).map((w) => laadAdsCsv(slug, w)),
    settings: laadAppSettings(),
    team: laadTeam(),
    week: WEEK,
    nu: NU,
    ...velden,
  });

  it('maakt voor alle drie de klanten het pakket: adviezen, groei, goedkeuringen, briefings, copy en rapport', async () => {
    const verwacht: Record<AdsKlant, { goedkeuringen: number; briefings: number; copy: string[] }> = {
      groenwerk: { goedkeuringen: 2, briefings: 2, copy: ['Teak eettafel Kaap – carrousel'] },
      mout: { goedkeuringen: 3, briefings: 3, copy: ['Single origin – carrousel'] },
      lune: { goedkeuringen: 2, briefings: 2, copy: ['Collectie Maan – statisch'] },
    };
    for (const slug of ADS_KLANTEN) {
      const client = nepModel();
      const pakket = await maakWeekpakket(client, invoer(slug));
      expect(pakket.adviezen, slug).toHaveLength(5);
      expect(pakket.groei, slug).toHaveLength(1);
      expect(pakket.goedkeuringen, slug).toHaveLength(verwacht[slug].goedkeuringen);
      expect(pakket.briefings, slug).toHaveLength(verwacht[slug].briefings);
      expect(pakket.copy.map((c) => c.advertentie), slug).toEqual(verwacht[slug].copy);
      expect(pakket.copy[0].varianten.every((v) => v.status === 'klaar_voor_review'), slug).toBe(true);
      expect(pakket.rapport).toMatchObject({ klant_id: klant(slug).id, periode: WEEK, status: 'concept' });
      expect(pakket.rapport.inhoud_md).toContain(cijferregel(klantWeek(rijenVan(slug), WEEK)));
      expect(pakket.aanroepen, slug).toBe(2);
      expect(client.aantalAanroepen, slug).toBe(2);
    }
  });

  it('kill-switch: met agents_actief op false gebeurt er niets', async () => {
    const client = nepModel();
    const uit = laadAppSettings().map((s) => (s.sleutel === 'agents_actief' ? { ...s, waarde: 'false' } : s));
    await expect(maakWeekpakket(client, invoer('lune', { settings: uit }))).rejects.toThrow(/agents_actief/);
    expect(client.aantalAanroepen).toBe(0);
  });

  it('een eerdere week: latere exports tellen niet mee', async () => {
    const pakket = await maakWeekpakket(nepModel(), invoer('lune', { week: '2026-W43', nu: '2026-10-26' }));
    expect(pakket.rapport.periode).toBe('2026-W43');
    expect(pakket.adviezen.find((a) => a.advertentie === 'Gravering – story')?.actie).toBe('laten_lopen');
    expect(pakket.goedkeuringen.map((g) => g.actie_type)).not.toContain('campagne_pauzeren');
    expect(pakket.briefings.every((b) => b.testdag === '2026-10-29')).toBe(true);
  });
});

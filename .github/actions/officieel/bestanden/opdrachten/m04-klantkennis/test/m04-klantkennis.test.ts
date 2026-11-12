import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  BRIEFING_KOPPEN,
  BRIEFING_SYSTEEM,
  CLAIMREGELS,
  KLANT_VAN_KENNISDOC,
  alsZoekresultaat,
  betekenisRanking,
  bouwBriefingVerzoek,
  bouwKennisbank,
  controleerClaims,
  controleerKlantgrens,
  controleerTekstregels,
  cosinus,
  filterKlantgrens,
  hybrideRanking,
  kiesBinnenBudget,
  knipInStukken,
  leesMerkprofiel,
  maakLokaleZoeker,
  maakMerkblok,
  regelsZonderBron,
  schatTokens,
  schrijfBriefing,
  splitsBlok,
  telWoorden,
  trefwoordRanking,
  trefwoordVraag,
  verwerkAntwoord,
  voorbeeldtekstenUit,
  type Merkprofiel,
  type Stuk,
  type Treffer,
} from '@opdracht/m04-klantkennis';
import type { ClaudeClient } from '../../../gedeeld/claude';
import { maakNepClient, tekstAntwoord, type NepAntwoord } from '../../../test-hulp/nepClient';
import {
  KLANT_SLUGS,
  laadKennis,
  laadKlantdossier,
  laadKlantdossiers,
  laadKlanten,
  type KlantSlug,
  type VonkDocument,
} from '../../../test-hulp/vonkData';

// --- hulpjes ------------------------------------------------------------------------------

const KENNIS = laadKennis();
const DOSSIERS = laadKlantdossiers();
const KLANTEN = laadKlanten();

/** Lui en eenmalig: zo faalt een TODO in bouwKennisbank per test, niet bij het inlezen van het bestand. */
function eenmalig<T>(maak: () => T): () => T {
  let waarde: T | undefined;
  return () => (waarde ??= maak());
}
const kennisStukken = eenmalig(() => bouwKennisbank(KENNIS, []));
const alleStukken = eenmalig(() => bouwKennisbank(KENNIS, DOSSIERS));

function profielVan(slug: KlantSlug): Merkprofiel {
  const klant = KLANTEN.find((k) => k.slug === slug);
  if (!klant) throw new Error(`klant ${slug} ontbreekt`);
  return leesMerkprofiel(laadKlantdossier(slug), klant);
}

function treffer(stuk: Stuk, rang: number): Treffer {
  return { stuk, score: 1 / (50 + rang), trefwoordRang: rang, betekenisRang: null };
}

/** Elke niet-lege regel van een document, zonder koppen: die moet ergens in een stuk terugkomen. */
function inhoudsregels(doc: VonkDocument): string[] {
  return doc.tekst
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r !== '' && !/^#{1,2}\s/.test(r));
}

interface NepBron {
  source: string;
  title: string;
  cited_text: string;
}
interface NepTekstblok {
  text: string;
  bronnen?: NepBron[];
}

function blokken(lijst: NepTekstblok[]): Anthropic.ContentBlock[] {
  return lijst.map((b) => ({
    type: 'text' as const,
    text: b.text,
    citations: b.bronnen
      ? b.bronnen.map((c, i) => ({
          type: 'search_result_location' as const,
          cited_text: c.cited_text,
          source: c.source,
          title: c.title,
          search_result_index: i,
          start_block_index: 0,
          end_block_index: 1,
        }))
      : null,
  })) as Anthropic.ContentBlock[];
}

/**
 * Eigen kleine nep bovenop de nep-client: die geeft tekstblokken altijd citations: null.
 * Deze wrapper laat de nep-client de params controleren en zet daarna blokken mét citaten in het antwoord.
 */
function nepMetCitaten(antwoorden: Array<{ blokken: NepTekstblok[]; stop_reason?: NepAntwoord['stop_reason'] }>) {
  const nep = maakNepClient(antwoorden.map((a) => tekstAntwoord('vervangen', a.stop_reason ?? 'end_turn')));
  let i = 0;
  const client: ClaudeClient = {
    messages: {
      create: async (params) => {
        const bericht = await nep.messages.create(params);
        const antwoord = antwoorden[i++];
        return { ...bericht, content: blokken(antwoord.blokken) };
      },
    },
  };
  return { client, nep };
}

const GROENWERK_NU = 'kennis/06-case-groenwerk.md#nu-najaar-2026';
const GROENWERK_USPS = 'klantdossiers/groenwerk.md#usp-s-mag-je-gebruiken';
const GROENWERK_DOELGROEPEN = 'klantdossiers/groenwerk.md#doelgroepen';

function groenwerkBriefing(voorbeeldteksten: string[]): NepTekstblok[] {
  return [
    { text: '## Doel\n' },
    {
      text: 'In het laagseizoen sturen we op hoezen, onderhoud en de vroegboekcampagne voor 2027.',
      bronnen: [{ source: GROENWERK_NU, title: 'Case: Groenwerk Tuinmeubelen › Nu (najaar 2026)', cited_text: 'In het laagseizoen sturen we op hoezen, onderhoud en de vroegboekcampagne voor 2027.' }],
    },
    { text: '\n\n## Doelgroep\n' },
    {
      text: 'Vroegboekers die in de winter al de collectie van volgend voorjaar bestellen voor de korting en de levering in maart.',
      bronnen: [{ source: GROENWERK_DOELGROEPEN, title: 'Groenwerk › Doelgroepen', cited_text: 'Vroegboekers: kopers die in de winter al de collectie van volgend voorjaar bestellen.' }],
    },
    { text: '\n\n## Kernboodschap\n' },
    {
      text: 'Vroegboekkorting van 10% op de collectie 2027, geldig tot en met 1 maart 2027.',
      bronnen: [{ source: GROENWERK_USPS, title: 'Groenwerk › USP’s', cited_text: 'Vroegboekkorting van 10% op de collectie 2027, geldig tot en met 1 maart 2027.' }],
    },
    { text: '\n\n## Wat mag en wat niet\n' },
    {
      text: 'Schrijf "weinig onderhoud" en noem hardhout nooit onderhoudsvrij, want teak vergrijst.',
      bronnen: [{ source: 'klantdossiers/groenwerk.md#verboden-claims', title: 'Groenwerk › Verboden claims', cited_text: 'Hardhout "onderhoudsvrij" noemen.' }],
    },
    { text: `\n\n## Voorbeeldteksten\n${voorbeeldteksten.map((v) => `- ${v}`).join('\n')}\n\n## Beeld\n` },
    { text: 'Korte video in de showroom met mensen in beeld, met de levering in maart als haakje voor de vroegboekers.' },
    { text: '\n\n## Open vragen\n[WEET IK NIET: Welk budget krijgt de vroegboekcampagne in januari?]' },
  ];
}

const GOEDE_TEKSTEN = [
  'Nu bestellen, in maart in je tuin. Met 10% vroegboekkorting tot 1 maart.',
  'Teak dat mooi zilvergrijs wordt. Eén keer per jaar olie en hij gaat twintig zomers mee.',
  'Kom zitten voordat je kiest: de showroom is ook in de winter open.',
];

// --- 4.1 ----------------------------------------------------------------------------------

describe('4.1 het kennispakket van het bureau', () => {
  const werkwijze = KENNIS.find((d) => d.bestand === '01-werkwijze.md') as VonkDocument;

  it('knipInStukken maakt per ##-sectie een stuk met een stabiel id, bron en titel als context', () => {
    const stukken = knipInStukken(werkwijze, { soort: 'kennis', klant: null });
    const ids = stukken.map((s) => s.id);
    expect(ids).toContain('kennis/01-werkwijze.md#beslisregels-voor-advertenties');
    expect(ids).toContain('kennis/01-werkwijze.md#ons-weekritme');
    expect(ids[0]).toBe('kennis/01-werkwijze.md#intro');
    const beslis = stukken.find((s) => s.id.endsWith('#beslisregels-voor-advertenties')) as Stuk;
    expect(beslis).toMatchObject({ bron: 'kennis/01-werkwijze.md', soort: 'kennis', klant: null, titel: 'Werkwijze van Bureau Vonk › Beslisregels voor advertenties' });
    expect(beslis.inhoud.startsWith(`${beslis.titel}\n\n`)).toBe(true);
    expect(beslis.tekst).toContain('1.000 vertoningen');
    expect(beslis.tekst).not.toMatch(/^##/m);
    expect(beslis.woorden).toBe(telWoorden(beslis.tekst));
    expect(knipInStukken(werkwijze, { soort: 'kennis', klant: null })).toEqual(stukken);
  });

  it('bouwKennisbank: unieke ids, nergens meer dan maxWoorden, geen lege stukken', () => {
    const bank = bouwKennisbank(KENNIS, DOSSIERS, { maxWoorden: 120 });
    expect(new Set(bank.map((s) => s.id)).size).toBe(bank.length);
    for (const s of bank) {
      expect(s.tekst.trim(), s.id).not.toBe('');
      expect(s.woorden, s.id).toBeLessThanOrEqual(120);
    }
    expect(bank.filter((s) => s.soort === 'kennis').length).toBeGreaterThanOrEqual(KENNIS.length * 4);
    expect(bank.filter((s) => s.soort === 'klantdossier').length).toBeGreaterThanOrEqual(DOSSIERS.length * 6);
  });

  it('er gaat geen tekst verloren: elke inhoudsregel van elk document staat in een stuk', () => {
    const bank = bouwKennisbank(KENNIS, DOSSIERS, { maxWoorden: 120 });
    for (const doc of [...KENNIS, ...DOSSIERS]) {
      const tekst = bank.filter((s) => s.bron.endsWith(`/${doc.bestand}`)).map((s) => s.tekst).join('\n');
      for (const regel of inhoudsregels(doc)) expect(tekst, `${doc.bestand}: "${regel.slice(0, 60)}"`).toContain(regel);
    }
  });

  it('een tabel die gesplitst moet worden, krijgt in elk deel de kopregel terug', () => {
    const rijen = Array.from({ length: 40 }, (_, i) => `| Week ${i + 1} | ${i * 10} euro uitgegeven aan advertenties | ${i} conversies uit Meta |`);
    const doc: VonkDocument = { bestand: 'test-tabel.md', titel: 'Testtabel', tekst: ['# Testtabel', '', '## Cijfers', '| Week | Uitgaven | Conversies |', '|---|---|---|', ...rijen].join('\n') };
    const stukken = knipInStukken(doc, { soort: 'kennis', klant: null, maxWoorden: 60 });
    expect(stukken.length).toBeGreaterThan(2);
    expect(stukken.map((s) => s.id)).toEqual(stukken.map((_, i) => `kennis/test-tabel.md#cijfers-${i + 1}`));
    for (const s of stukken) {
      expect(s.tekst.startsWith('| Week | Uitgaven | Conversies |\n|---|---|---|'), s.id).toBe(true);
      expect(s.woorden, s.id).toBeLessThanOrEqual(60);
    }
  });

  it('splitsBlok: een tabel per rij met de kopregels, een lijst per punt, tekst per zin; een kort blok blijft heel', () => {
    expect(splitsBlok('Kort blok van vijf woorden.', 10)).toEqual(['Kort blok van vijf woorden.']);
    const tabel = ['| a | b |', '|---|---|', '| een twee drie | vier vijf |', '| zes zeven acht | negen tien |'].join('\n');
    expect(splitsBlok(tabel, 8)).toEqual([
      '| a | b |\n|---|---|\n| een twee drie | vier vijf |',
      '| a | b |\n|---|---|\n| zes zeven acht | negen tien |',
    ]);
    const lijst = ['- een twee drie vier', '  vijf zes', '- zeven acht negen tien', '- elf twaalf'].join('\n');
    expect(splitsBlok(lijst, 7)).toEqual(['- een twee drie vier\n  vijf zes', '- zeven acht negen tien\n- elf twaalf']);
    expect(splitsBlok('Eén twee drie. Vier vijf zes! Zeven acht negen?', 6)).toEqual(['Eén twee drie. Vier vijf zes!', 'Zeven acht negen?']);
    const groot = 'een twee drie vier vijf zes zeven acht negen tien elf twaalf';
    expect(splitsBlok(groot, 5)).toEqual([groot]);
  });

  it('kennis over één klant hoort bij die klant; dossiers bij hun eigen slug; de rest is bureaubreed', () => {
    expect(KLANT_VAN_KENNISDOC['06-case-groenwerk.md']).toBe('groenwerk');
    const bank = bouwKennisbank(KENNIS, DOSSIERS);
    for (const s of bank) {
      if (s.bron === 'kennis/06-case-groenwerk.md') expect(s.klant, s.id).toBe('groenwerk');
      else if (s.soort === 'kennis') expect(s.klant, s.id).toBeNull();
      else expect(s.bron, s.id).toBe(`klantdossiers/${s.klant}.md`);
    }
  });
});

// --- 4.2 ----------------------------------------------------------------------------------

describe('4.2 klantdossiers: merk, toon en verboden claims', () => {
  it('leesMerkprofiel leest toon, doelgroepen, USP’s, verboden claims en voorbeeldzinnen van alle zes klanten', () => {
    for (const slug of KLANT_SLUGS) {
      const p = profielVan(slug);
      expect(p.slug).toBe(slug);
      expect(p.toon.length, `${slug} toon`).toBeGreaterThanOrEqual(4);
      expect(p.doelgroepen.length, `${slug} doelgroepen`).toBeGreaterThanOrEqual(1);
      expect(p.usps.length, `${slug} usps`).toBeGreaterThanOrEqual(4);
      expect(p.verboden.length, `${slug} verboden`).toBeGreaterThanOrEqual(5);
      expect(p.goedeVoorbeelden, `${slug} goed`).toHaveLength(3);
      expect(p.fouteVoorbeelden.length, `${slug} fout`).toBeGreaterThanOrEqual(2);
      for (const punt of [...p.toon, ...p.verboden]) expect(punt).not.toMatch(/\*\*|^[-*] /);
    }
    expect(profielVan('groenwerk').verboden[0]).toMatch(/onderhoudsvrij/);
    expect(profielVan('fysiopunt').privacy.length).toBeGreaterThanOrEqual(4);
    expect(profielVan('fysiopunt').gevoelig).toBe(true);
    expect(profielVan('korrel').fouteVoorbeelden).not.toContain('Een stockfoto van een stokbrood op een houten plank');
  });

  it('maakMerkblok zet het profiel in tags en is voor hetzelfde profiel altijd dezelfde tekst', () => {
    const p = profielVan('lune');
    const blok = maakMerkblok(p);
    expect(blok).toMatch(/^<klant slug="lune">/);
    for (const tag of ['toon', 'verboden_claims', 'mag_gebruiken']) {
      expect(blok).toContain(`<${tag}>`);
      expect(blok).toContain(`</${tag}>`);
    }
    expect(blok).toContain('Hypoallergeen');
    expect(maakMerkblok(profielVan('lune'))).toBe(blok);
    expect(blok).not.toContain('<privacy>');
    expect(maakMerkblok(profielVan('fysiopunt'))).toContain('<privacy>');
  });

  it('controleerClaims: elk fout voorbeeld uit elk dossier geeft minstens één melding', () => {
    for (const slug of KLANT_SLUGS) {
      for (const zin of profielVan(slug).fouteVoorbeelden) {
        expect(controleerClaims(zin, slug).length, `${slug}: "${zin}"`).toBeGreaterThan(0);
      }
    }
  });

  it('controleerClaims: geen enkel goed voorbeeld en geen enkele USP geeft een verboden-melding', () => {
    for (const slug of KLANT_SLUGS) {
      const p = profielVan(slug);
      for (const zin of p.goedeVoorbeelden) expect(controleerClaims(zin, slug), `${slug}: "${zin}"`).toEqual([]);
      for (const usp of p.usps) {
        expect(controleerClaims(usp, slug).filter((o) => o.ernst === 'verboden'), `${slug} usp: "${usp}"`).toEqual([]);
      }
    }
  });

  it('controleerClaims werkt per zin en per klant, met de uitzondering in dezelfde zin', () => {
    expect(controleerClaims('Gratis bezorging vanaf 500 euro, tot achter in de tuin.', 'groenwerk')).toEqual([]);
    const los = controleerClaims('Gratis bezorging. Vanaf 500 euro.', 'groenwerk');
    expect(los.map((o) => o.regel)).toEqual(['groenwerk_gratis']);
    expect(los[0].zin).toBe('Gratis bezorging.');
    expect(controleerClaims('Onderhoudsvrij teak.', 'mout').map((o) => o.regel)).not.toContain('groenwerk_onderhoudsvrij');
    expect(controleerClaims('Alleen vandaag: 10% extra.', 'technest').map((o) => o.regel)).toContain('nep_urgentie');
    expect(CLAIMREGELS.every((r) => !r.patroon.flags.includes('g'))).toBe(true);
    for (const slug of KLANT_SLUGS) expect(CLAIMREGELS.some((r) => r.klant === slug), slug).toBe(true);
  });

  it('controleerKlantgrens vindt namen van andere klanten, maar niet de eigen klant', () => {
    const tekst = 'Net als bij Koffiebranderij Mout werken reels goed. Ruben vindt dat ook. Groenwerk wil video.';
    const meldingen = controleerKlantgrens(tekst, 'groenwerk', KLANTEN);
    expect(meldingen.map((o) => o.omschrijving).join(' ')).toMatch(/mout/i);
    expect(meldingen.every((o) => o.regel === 'andere_klant' && o.ernst === 'verboden')).toBe(true);
    expect(meldingen.some((o) => /groenwerk/i.test(o.omschrijving))).toBe(false);
    expect(controleerKlantgrens('De mout van de bierbrouwer.', 'groenwerk', KLANTEN)).toEqual([]);
    expect(controleerKlantgrens('Vraag het aan Mirthe.', 'lune', KLANTEN).length).toBe(1);
  });
});

// --- 4.3 ----------------------------------------------------------------------------------

describe('4.3 zoeken in kennis: trefwoord, betekenis en hybride', () => {

  it('trefwoordRanking vindt het juiste stuk in de kennis van Vonk', () => {
    const top = (vraag: string) => trefwoordRanking(kennisStukken(), vraag, 3)[0]?.id;
    expect(top('Wat is de opzegtermijn na de minimale looptijd?')).toBe('kennis/04-prijsafspraken.md#looptijd-en-opzeggen');
    expect(top('Wanneer is een advertentie vermoeid? frequentie en CTR')).toBe('kennis/01-werkwijze.md#beslisregels-voor-advertenties');
    expect(top('Wat kost een jaarcontract Groei?')).toBe('kennis/04-prijsafspraken.md#rekenvoorbeelden-totaal-voor-de-minimale-looptijd');
    expect(top('Hoe reken je ROAS en CPA uit?')).toBe('kennis/03-rapportagestandaard.md#definities');
  });

  it('trefwoordRanking: scores aflopend, alleen stukken met een zoekwoord, stopwoorden tellen niet', () => {
    const lijst = trefwoordRanking(kennisStukken(), 'testaankoop meting', 10);
    expect(lijst.length).toBeGreaterThan(1);
    for (let i = 1; i < lijst.length; i++) expect(lijst[i - 1].score).toBeGreaterThanOrEqual(lijst[i].score);
    expect(lijst.every((s) => s.score > 0)).toBe(true);
    expect(trefwoordRanking(kennisStukken(), 'de het een en van', 10)).toEqual([]);
    expect(trefwoordRanking(kennisStukken(), 'xyzzy kwantum', 10)).toEqual([]);
  });

  it('trefwoordVraag maakt een OF-zoekvraag voor Postgres, zonder stopwoorden en met accenten', () => {
    expect(trefwoordVraag('Welke vragen staan in de onboardingvragenlijst?')).toBe('vragen or staan or onboardingvragenlijst');
    expect(trefwoordVraag('Mag een agent patiëntgegevens in een prompt zetten?')).toBe('agent or patiëntgegevens or prompt or zetten');
    expect(trefwoordVraag('ROAS, roas en -CPA')).toBe('roas or cpa');
    expect(trefwoordVraag('de het een')).toBe('');
  });

  it('hybrideRanking rekent Reciprocal Rank Fusion zoals de Supabase-functie (k = 50)', () => {
    const uit = hybrideRanking(['a', 'b', 'c'], ['c', 'a', 'd']);
    expect(uit.map((h) => h.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(uit[0].score).toBeCloseTo(1 / 51 + 1 / 52, 10);
    expect(uit[0]).toMatchObject({ trefwoordRang: 1, betekenisRang: 2 });
    expect(uit.find((h) => h.id === 'd')).toMatchObject({ trefwoordRang: null, betekenisRang: 3 });
    expect(uit.find((h) => h.id === 'd')?.score).toBeCloseTo(1 / 53, 10);
    const zwaar = hybrideRanking(['a', 'b', 'c'], ['c', 'a', 'd'], { gewichtBetekenis: 2 });
    expect(zwaar[0].id).toBe('c');
    expect(hybrideRanking(['a', 'b', 'c'], [], { max: 2 }).map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('cosinus en betekenisRanking', () => {
    expect(cosinus([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosinus([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosinus([3, 4], [6, 8])).toBeCloseTo(1, 10);
    expect(() => cosinus([1, 2, 3], [1, 2])).toThrow(/lengte/);
    const lijst = betekenisRanking(new Map([['x', [0, 1]], ['y', [1, 0.1]], ['z', [1, 0]]]), [1, 0], 2);
    expect(lijst.map((s) => s.id)).toEqual(['z', 'y']);
  });

  it('hybride vindt wat trefwoord mist: "onboardingvragenlijst" (vectoren zijn hier met de hand gemaakt)', async () => {
    const vraag = 'Welke vragen staan in de onboardingvragenlijst?';
    const doel = 'kennis/02-onboarding.md#de-onboardingvragenlijst';
    expect(trefwoordRanking(kennisStukken(), vraag, 5)[0].id).not.toBe(doel);
    const vectoren = new Map(kennisStukken().map((s) => [s.id, s.id === doel ? [1, 0] : [0, 1]] as const));
    const zoek = maakLokaleZoeker(kennisStukken(), { vectoren, vraagNaarVector: () => [1, 0] });
    const treffers = await zoek({ klant: 'mout', tekst: vraag, max: 4 });
    expect(treffers[0].stuk.id).toBe(doel);
    expect(treffers[0].betekenisRang).toBe(1);
    expect(treffers[0].trefwoordRang).not.toBeNull();
  });

  it('maakLokaleZoeker filtert op klant: nooit een stuk van een andere klant', async () => {
    const zoek = maakLokaleZoeker(alleStukken());
    for (const slug of KLANT_SLUGS) {
      const treffers = await zoek({ klant: slug, tekst: 'doelgroepen toon verboden claims voorbeeldzinnen', max: 10 });
      expect(treffers.length, slug).toBeGreaterThan(0);
      for (const t of treffers) expect(t.stuk.klant === null || t.stuk.klant === slug, `${slug}: ${t.stuk.id}`).toBe(true);
    }
    const groen = await zoek({ klant: 'mout', tekst: 'testaankoop meting showroom', max: 10 });
    expect(groen.some((t) => t.stuk.bron === 'kennis/06-case-groenwerk.md')).toBe(false);
  });

  it('filterKlantgrens weert stukken van een andere klant en anonimiseert namen in bureaustukken', () => {
    const weekritme = alleStukken().find((s) => s.id === 'kennis/01-werkwijze.md#ons-weekritme') as Stuk;
    const caseGroen = alleStukken().find((s) => s.bron === 'kennis/06-case-groenwerk.md') as Stuk;
    expect(weekritme.tekst).toContain('Mout');
    const uit = filterKlantgrens([treffer(weekritme, 1), treffer(caseGroen, 2)], 'lune', KLANTEN);
    expect(uit.geweigerd).toEqual([{ stukId: caseGroen.id, reden: expect.stringMatching(/groenwerk/) }]);
    expect(uit.toegestaan).toHaveLength(1);
    expect(uit.toegestaan[0].stuk.tekst).not.toContain('Mout');
    expect(uit.toegestaan[0].stuk.tekst).toContain('[andere klant]');
    expect(weekritme.tekst).toContain('Mout');
    const eigen = filterKlantgrens([treffer(weekritme, 1)], 'mout', KLANTEN);
    expect(eigen.toegestaan[0].stuk.tekst).toContain('Mout');
  });
});

// --- 4.4 ----------------------------------------------------------------------------------

describe('4.4 bronvermelding en "dat weet ik niet"', () => {
  const stuk = (id: string) => alleStukken().find((s) => s.id === id) as Stuk;

  it('alsZoekresultaat maakt een search_result-blok met één tekstblok per alinea en citations aan', () => {
    const s = stuk('kennis/01-werkwijze.md#budgetregels');
    const blok = alsZoekresultaat(s);
    expect(blok).toMatchObject({ type: 'search_result', source: s.id, title: s.titel, citations: { enabled: true } });
    expect(blok.content.length).toBeGreaterThanOrEqual(1);
    expect(blok.content.every((c) => c.type === 'text' && c.text.trim() !== '')).toBe(true);
    const tweeAlineas: Stuk = { ...s, tekst: 'Eerste alinea.\n\nTweede alinea.' };
    expect(alsZoekresultaat(tweeAlineas).content.map((c) => c.text)).toEqual(['Eerste alinea.', 'Tweede alinea.']);
    const metLijst: Stuk = { ...s, tekst: 'Inleiding.\n\n- Oorbellen Getij: 49 euro.\n- Ketting Getij: 89 euro.\n\n| Week | ROAS |\n|---|---|\n| 44 | 4,32 |' };
    expect(alsZoekresultaat(metLijst).content.map((c) => c.text)).toEqual([
      'Inleiding.',
      '- Oorbellen Getij: 49 euro.',
      '- Ketting Getij: 89 euro.',
      '| Week | ROAS |\n|---|---|\n| 44 | 4,32 |',
    ]);
  });

  it('bouwBriefingVerzoek: zoekresultaten vóór de opdracht, citations overal aan, geen output_config.format', async () => {
    const zoek = maakLokaleZoeker(alleStukken());
    const treffers = await zoek({ klant: 'groenwerk', tekst: 'Vroegboekcampagne collectie 2027 in januari', max: 5 });
    const params = bouwBriefingVerzoek(profielVan('groenwerk'), treffers, { klant: 'groenwerk', onderwerp: 'Vroegboekcampagne collectie 2027 in januari' });
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params).not.toHaveProperty('temperature');
    expect((params as unknown as { output_config?: { format?: unknown } }).output_config?.format).toBeUndefined();
    const inhoud = params.messages[0].content as Anthropic.ContentBlockParam[];
    expect(params.messages).toHaveLength(1);
    const resultaten = inhoud.filter((b): b is Anthropic.SearchResultBlockParam => b.type === 'search_result');
    expect(resultaten.map((r) => r.source)).toEqual(treffers.map((t) => t.stuk.id));
    expect(resultaten.every((r) => r.citations?.enabled === true)).toBe(true);
    expect(inhoud.at(-1)).toMatchObject({ type: 'text' });
    expect((inhoud.at(-1) as Anthropic.TextBlockParam).text).toContain('Vroegboekcampagne collectie 2027 in januari');
    await maakNepClient([tekstAntwoord('ok')]).messages.create(params);
  });

  it('bouwBriefingVerzoek weigert stukken van een andere klant en een lege lijst', () => {
    const mout = stuk('klantdossiers/mout.md#verboden-claims');
    expect(() => bouwBriefingVerzoek(profielVan('groenwerk'), [treffer(mout, 1)], { klant: 'groenwerk', onderwerp: 'x' })).toThrow(/mout/);
    expect(() => bouwBriefingVerzoek(profielVan('groenwerk'), [], { klant: 'groenwerk', onderwerp: 'x' })).toThrow(/weet-ik-niet/);
  });

  it('de system prompt legt het weet-ik-niet-pad en de koppen vast', () => {
    expect(BRIEFING_SYSTEEM).toContain('[WEET IK NIET:');
    for (const kop of BRIEFING_KOPPEN) expect(BRIEFING_SYSTEEM).toContain(`## ${kop}`);
    expect(BRIEFING_SYSTEEM).toMatch(/andere klant/i);
  });

  it('verwerkAntwoord nummert de bronnen, vindt de weet-ik-niet-vragen en regels zonder bron', () => {
    const uit = verwerkAntwoord(blokken(groenwerkBriefing(GOEDE_TEKSTEN)));
    expect(uit.bronnen.map((b) => [b.nummer, b.stukId])).toEqual([
      [1, GROENWERK_NU],
      [2, GROENWERK_DOELGROEPEN],
      [3, GROENWERK_USPS],
      [4, 'klantdossiers/groenwerk.md#verboden-claims'],
    ]);
    expect(uit.bronnen[0].citaten).toEqual(['In het laagseizoen sturen we op hoezen, onderhoud en de vroegboekcampagne voor 2027.']);
    expect(uit.tekst).toContain('voor 2027.[1]');
    expect(uit.tekst).toMatch(/## Bronnen\n\[1\] .+\(kennis\/06-case-groenwerk\.md#nu-najaar-2026\)/);
    expect(uit.ruweTekst).not.toContain('[1]');
    expect(uit.vragen).toEqual(['Welk budget krijgt de vroegboekcampagne in januari?']);
    expect(uit.regelsZonderBron).toEqual(['Korte video in de showroom met mensen in beeld, met de levering in maart als haakje voor de vroegboekers.']);
    expect(uit.ontbrekendeKoppen).toEqual([]);
  });

  it('regelsZonderBron: alleen beweringen van 8+ woorden buiten Voorbeeldteksten en Open vragen zonder geraakt bereik', () => {
    const met = 'Deze zin heeft acht woorden en komt uit een bron.';
    const zonder = 'Deze zin heeft ook acht woorden maar geen enkele bron.';
    const ruw = ['## Doel', met, zonder, 'Kort, zonder bron.', '', '## Voorbeeldteksten', '- Een voorbeeldtekst van acht woorden zonder bron erbij.', '## Open vragen', '[WEET IK NIET: Welk budget krijgt de campagne in januari?]'].join('\n');
    const start = ruw.indexOf(met);
    expect(regelsZonderBron(ruw, [[start, start + met.length]])).toEqual([zonder]);
    expect(regelsZonderBron(ruw, [])).toEqual([met, zonder]);
    expect(regelsZonderBron(`## Beeld\n  [WEET IK NIET: Mag Sem filmen in de showroom of alleen buiten?]  `, [])).toEqual([]);
    expect(regelsZonderBron(`## Beeld\n  ${zonder}  `, [])).toEqual([zonder]);
  });

  it('verwerkAntwoord meldt ontbrekende koppen en voorbeeldtekstenUit pakt alleen de copy', () => {
    const uit = verwerkAntwoord(blokken([{ text: '## Doel\nIets zonder bron, maar wel met acht of meer woorden erin.' }]));
    expect(uit.ontbrekendeKoppen).toEqual(BRIEFING_KOPPEN.filter((k) => k !== 'Doel'));
    expect(uit.bronnen).toEqual([]);
    expect(uit.regelsZonderBron).toHaveLength(1);
    const ruw = verwerkAntwoord(blokken(groenwerkBriefing(GOEDE_TEKSTEN))).ruweTekst;
    const copy = voorbeeldtekstenUit(ruw);
    expect(copy).toContain('twintig zomers');
    expect(copy).not.toContain('onderhoudsvrij');
    expect(copy).not.toContain('## Beeld');
  });
});

// --- 4.5 ----------------------------------------------------------------------------------

describe('4.5 context beheren bij lange dossiers', () => {
  const zinnen = Array.from({ length: 70 }, (_, i) => `Productregel ${i + 1}: de loungeset Duin heeft kussens van ${20 + i} centimeter dik en een frame van aluminium.`);
  const lang: VonkDocument = {
    bestand: 'groenwerk.md',
    titel: 'Groenwerk Tuinmeubelen: brand guidelines',
    tekst: [laadKlantdossier('groenwerk').tekst, '', '## Productinformatie', zinnen.join(' ')].join('\n'),
  };

  it('een lange sectie wordt opgesplitst in genummerde stukken die elk de titel als context hebben', () => {
    const stukken = knipInStukken(lang, { soort: 'klantdossier', klant: 'groenwerk', maxWoorden: 150 });
    const product = stukken.filter((s) => s.id.startsWith('klantdossiers/groenwerk.md#productinformatie'));
    expect(product.length).toBeGreaterThanOrEqual(5);
    expect(product.map((s) => s.id)).toEqual(product.map((_, i) => `klantdossiers/groenwerk.md#productinformatie-${i + 1}`));
    for (const s of product) {
      expect(s.woorden).toBeLessThanOrEqual(150);
      expect(s.inhoud.startsWith('Groenwerk Tuinmeubelen: brand guidelines › Productinformatie\n\n')).toBe(true);
      expect(s.tekst).toMatch(/^Productregel \d+:/);
    }
    expect(product.map((s) => s.tekst).join(' ')).toBe(zinnen.join(' '));
  });

  it('schatTokens is een veilige schatting: 1 token per 3 tekens, naar boven afgerond', () => {
    expect(schatTokens('')).toBe(0);
    expect(schatTokens('abc')).toBe(1);
    expect(schatTokens('abcd')).toBe(2);
    expect(schatTokens('x'.repeat(3000))).toBe(1000);
  });

  it('kiesBinnenBudget: op volgorde, binnen budget, zonder dubbele stukken, hoogstens maxPerBron per bron', () => {
    const stukken = knipInStukken(lang, { soort: 'klantdossier', klant: 'groenwerk', maxWoorden: 150 });
    const product = stukken.filter((s) => s.id.includes('#productinformatie'));
    const ander = stukken.find((s) => s.id.endsWith('#verboden-claims')) as Stuk;
    const kennisStuk = kennisStukken().find((s) => s.id === 'kennis/04-prijsafspraken.md#kortingen') as Stuk;
    const lijst = [...product.map((s, i) => treffer(s, i + 1)), treffer(product[0], 99), treffer(kennisStuk, 100), treffer(ander, 101)];

    const ruim = kiesBinnenBudget(lijst, 100_000, { maxPerBron: 2 });
    expect(ruim.gekozen.map((t) => t.stuk.id)).toEqual([product[0].id, product[1].id, kennisStuk.id]);
    expect(ruim.weggelaten).toContainEqual({ stukId: product[0].id, reden: 'dubbel' });
    expect(ruim.weggelaten).toContainEqual({ stukId: product[2].id, reden: 'max_per_bron' });
    expect(ruim.weggelaten).toContainEqual({ stukId: ander.id, reden: 'max_per_bron' });
    expect(ruim.tokens).toBe(ruim.gekozen.reduce((som, t) => som + schatTokens(t.stuk.inhoud), 0));

    const krap = schatTokens(product[0].inhoud) + schatTokens(kennisStuk.inhoud);
    const smal = kiesBinnenBudget([treffer(product[0], 1), treffer(product[1], 2), treffer(kennisStuk, 3)], krap);
    expect(smal.gekozen.map((t) => t.stuk.id)).toEqual([product[0].id, kennisStuk.id]);
    expect(smal.weggelaten).toEqual([{ stukId: product[1].id, reden: 'budget' }]);
    expect(smal.tokens).toBeLessThanOrEqual(krap);
  });

  it('het vaste deel staat vooraan in system met cache_control, en is gelijk voor twee onderwerpen', async () => {
    const zoek = maakLokaleZoeker(alleStukken());
    const p = profielVan('mout');
    const a = bouwBriefingVerzoek(p, await zoek({ klant: 'mout', tekst: 'cadeaupakketten december', max: 4 }), { klant: 'mout', onderwerp: 'cadeaupakketten december' });
    const b = bouwBriefingVerzoek(p, await zoek({ klant: 'mout', tekst: 'proefpakket thuisbaristas', max: 4 }), { klant: 'mout', onderwerp: 'proefpakket thuisbaristas' });
    expect(Array.isArray(a.system)).toBe(true);
    const system = a.system as Anthropic.TextBlockParam[];
    expect(system[0].text).toBe(BRIEFING_SYSTEEM);
    expect(system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    expect(system.at(-1)?.text).toBe(maakMerkblok(p));
    expect(b.system).toEqual(a.system);
    expect(JSON.stringify(a.system)).not.toContain('cadeaupakketten december');
  });
});

// --- moduleproject ----------------------------------------------------------------------------

describe('moduleproject: de briefing-agent', () => {
  const opdracht = { klant: 'groenwerk' as const, onderwerp: 'Vroegboekcampagne collectie 2027 in januari, met hoezen en onderhoud' };
  const deps = () => ({ zoek: maakLokaleZoeker(alleStukken()), profiel: profielVan('groenwerk'), klanten: KLANTEN });

  it('schrijft een briefing met bronnen en zonder overtredingen', async () => {
    const { client, nep } = nepMetCitaten([{ blokken: groenwerkBriefing(GOEDE_TEKSTEN) }]);
    const uit = await schrijfBriefing(client, opdracht, deps());
    expect(uit.status).toBe('klaar');
    expect(uit.aanroepen).toBe(1);
    expect(nep.aantalAanroepen).toBe(1);
    expect(uit.bronnen.length).toBeGreaterThanOrEqual(3);
    expect(uit.overtredingen.filter((o) => o.ernst === 'verboden')).toEqual([]);
    expect(uit.vragen).toEqual(['Welk budget krijgt de vroegboekcampagne in januari?']);
    expect(uit.tekst).toContain('## Bronnen');
    expect(uit.gebruikteStukken.length).toBeGreaterThan(0);
    const verstuurd = nep.laatsteAanroep.messages[0].content as Anthropic.ContentBlockParam[];
    const bronnen = verstuurd.filter((b): b is Anthropic.SearchResultBlockParam => b.type === 'search_result').map((b) => b.source);
    expect(bronnen).toEqual(uit.gebruikteStukken);
    expect(bronnen.every((id) => !/klantdossiers\/(?!groenwerk)/.test(id))).toBe(true);
  });

  it('een verboden claim in de voorbeeldteksten geeft één herkansing met de reden erbij', async () => {
    const fout = ['Onderhoudsvrij teak, twintig zomers lang.', ...GOEDE_TEKSTEN.slice(1)];
    const { client, nep } = nepMetCitaten([{ blokken: groenwerkBriefing(fout) }, { blokken: groenwerkBriefing(GOEDE_TEKSTEN) }]);
    const uit = await schrijfBriefing(client, opdracht, deps());
    expect(uit.status).toBe('klaar');
    expect(uit.aanroepen).toBe(2);
    const tweede = nep.aanroepen[1].messages[0].content as Anthropic.ContentBlockParam[];
    expect((tweede.at(-1) as Anthropic.TextBlockParam).text).toMatch(/onderhoudsvrij/i);
  });

  it('blijft de claim staan, dan is de status afgekeurd; een andere klant noemen telt ook', async () => {
    const fout = ['Gratis bezorging, net als bij Koffiebranderij Mout.', ...GOEDE_TEKSTEN.slice(1)];
    const { client } = nepMetCitaten([{ blokken: groenwerkBriefing(fout) }, { blokken: groenwerkBriefing(fout) }]);
    const uit = await schrijfBriefing(client, opdracht, deps());
    expect(uit.status).toBe('afgekeurd');
    expect(uit.aanroepen).toBe(2);
    expect(uit.overtredingen.map((o) => o.regel)).toEqual(expect.arrayContaining(['groenwerk_gratis', 'andere_klant']));
  });

  it('zonder bruikbare kennis: weet_ik_niet met een vraag, en geen API-aanroep', async () => {
    const nep = maakNepClient([]);
    const uit = await schrijfBriefing(nep, { klant: 'lune', onderwerp: 'xyzzy kwantum' }, { ...deps(), profiel: profielVan('lune') });
    expect(uit.status).toBe('weet_ik_niet');
    expect(uit.vragen[0]).toMatch(/WEET IK NIET/);
    expect(uit.vragen[0]).toContain('Atelier Lune');
    expect(nep.aantalAanroepen).toBe(0);
  });

  it('afgekapt of zonder alle koppen is onvolledig; een opdracht voor een andere klant gooit', async () => {
    const { client } = nepMetCitaten([{ blokken: [{ text: '## Doel\nHalf' }], stop_reason: 'max_tokens' }]);
    const uit = await schrijfBriefing(client, opdracht, deps());
    expect(uit.status).toBe('onvolledig');
    await expect(schrijfBriefing(client, { klant: 'mout', onderwerp: 'x' }, deps())).rejects.toThrow(/groenwerk/);
  });
});

// --- oefeningen ---------------------------------------------------------------------------

describe('oefening 4.2 · controleerTekstregels', () => {
  const maan = '\u{1F319}';
  const golf = '\u{1F30A}';

  it('Lune: hooguit één emoji per tekst; de goede voorbeeldzinnen gaan erdoor', () => {
    const fout = controleerTekstregels(`hoi jij ${maan} Getij is er ${golf}`, 'lune');
    expect(fout.map((o) => o.regel)).toEqual(['lune_emoji']);
    expect(fout[0]).toMatchObject({ ernst: 'verboden', zin: `hoi jij ${maan} Getij is er ${golf}` });
    for (const zin of profielVan('lune').goedeVoorbeelden) expect(controleerTekstregels(zin, 'lune'), zin).toEqual([]);
    expect(controleerTekstregels(`Proef ${maan} en ${golf}`, 'mout')).toEqual([]);
  });

  it('FysioPunt: geen emoji en geen uitroeptekens; regels gelden per tekst en per klant', () => {
    expect(controleerTekstregels(`Direct terecht ${maan}`, 'fysiopunt').map((o) => o.regel)).toEqual(['fysiopunt_emoji']);
    expect(controleerTekstregels('Direct terecht!', 'fysiopunt').map((o) => o.regel)).toEqual(['fysiopunt_uitroepteken']);
    for (const zin of profielVan('fysiopunt').goedeVoorbeelden) expect(controleerTekstregels(zin, 'fysiopunt'), zin).toEqual([]);
    expect(controleerTekstregels('Nu bestellen!', 'groenwerk')).toEqual([]);
  });
});

describe('oefening 4.5 · verplichte stukken', () => {
  const privacy = () => alleStukken().find((s) => s.id === 'klantdossiers/fysiopunt.md#privacy-verplicht-voor-iedereen-die-met-deze-klant-werkt') as Stuk;

  it('een verplicht stuk staat bij elk onderwerp vooraan in gekozen, ook als het niet gevonden is', async () => {
    expect(privacy(), 'privacystuk van FysioPunt').toBeDefined();
    const zoek = maakLokaleZoeker(alleStukken());
    for (const onderwerp of ['Avondspreekuur in de wijk onder de aandacht', 'Nieuwe fysiotherapeut op locatie Zuid', 'xyzzy kwantum']) {
      const treffers = await zoek({ klant: 'fysiopunt', tekst: onderwerp, max: 8 });
      const keuze = kiesBinnenBudget(treffers, 6000, { maxPerBron: 3, verplicht: [privacy()] });
      expect(keuze.gekozen[0].stuk.id, onderwerp).toBe(privacy().id);
      expect(keuze.gekozen[0]).toMatchObject({ score: 0, trefwoordRang: null, betekenisRang: null });
      expect(keuze.gekozen.filter((t) => t.stuk.id === privacy().id), onderwerp).toHaveLength(1);
    }
  });

  it('een verplicht stuk telt mee voor het budget, voor dubbel en voor maxPerBron', () => {
    const p = privacy();
    const ander = alleStukken().filter((s) => s.bron === 'klantdossiers/fysiopunt.md' && s.id !== p.id).slice(0, 3);
    const lijst = [treffer(p, 1), ...ander.map((s, i) => treffer(s, i + 2))];
    const keuze = kiesBinnenBudget(lijst, 100_000, { maxPerBron: 2, verplicht: [p] });
    expect(keuze.gekozen.map((t) => t.stuk.id)).toEqual([p.id, ander[0].id]);
    expect(keuze.weggelaten).toContainEqual({ stukId: p.id, reden: 'dubbel' });
    expect(keuze.weggelaten).toContainEqual({ stukId: ander[1].id, reden: 'max_per_bron' });
    const krap = kiesBinnenBudget([treffer(ander[0], 1)], 1, { verplicht: [p] });
    expect(krap.gekozen.map((t) => t.stuk.id)).toEqual([p.id]);
    expect(krap.tokens).toBe(schatTokens(p.inhoud));
    expect(krap.weggelaten).toEqual([{ stukId: ander[0].id, reden: 'budget' }]);
  });
});

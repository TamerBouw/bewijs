// Manifest van de officiële testbestanden en de starters.
//
//   npx tsx scripts/manifest.ts            JSON met de hashes van deze checkout en welke mappen gestart zijn
//   npx tsx scripts/manifest.ts --schrijf  schrijft bewijs/manifest.json (alleen voor beheerders, bij een release)
//
// - "officieel" is een sha256 per bestand over de bestanden die niemand mag aanpassen: opdrachten/*/test/**,
//   test-hulp/**, data/**, scripts/**, vitest.config.ts, package.json, package-lock.json en
//   .github/workflows/bewijs.yml. De platformworkflow zet precies deze bestanden (behalve bewijs.yml) uit de
//   platformrepo over de code van de cursist voordat de tests draaien.
//   "totaal" is de sha256 over de regels "<hash>  <pad>", gesorteerd op pad. Dat getal gaat mee in elk bewijs.
// - "starters" is per map een sha256 over opdrachten/<map>/src/**. Een map is gestart als die hash afwijkt van
//   de officiële starterhash in bewijs/manifest.json (of als de map daar niet in staat).
// - CRLF telt als LF, zodat een checkout op Windows dezelfde hash geeft.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENTIE = path.join(ROOT, 'bewijs', 'manifest.json');

interface Manifest {
  versie: string;
  algoritme: 'sha256';
  toelichting: string;
  totaal: string;
  officieel: Record<string, string>;
  starters: Record<string, string>;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const posix = (p: string) => p.split(path.sep).join('/');

function bestandenOnder(map: string): string[] {
  const absoluut = path.join(ROOT, map);
  if (!existsSync(absoluut)) return [];
  const uit: string[] = [];
  for (const naam of readdirSync(absoluut)) {
    if (naam === 'node_modules' || naam === '.DS_Store') continue;
    const rel = posix(path.join(map, naam));
    if (statSync(path.join(ROOT, rel)).isDirectory()) uit.push(...bestandenOnder(rel));
    else uit.push(rel);
  }
  return uit;
}

function hashBestand(rel: string): string {
  const inhoud = readFileSync(path.join(ROOT, rel));
  // Tekst met CRLF hasht als LF. Binaire bestanden (met een nulbyte) blijven zoals ze zijn.
  return sha256(inhoud.includes(0) ? inhoud : inhoud.toString('utf8').replace(/\r\n/g, '\n'));
}

function totaalVan(hashes: Record<string, string>): string {
  return sha256(
    Object.keys(hashes)
      .sort()
      .map((p) => `${hashes[p]}  ${p}\n`)
      .join(''),
  );
}

function mappen(): string[] {
  return readdirSync(path.join(ROOT, 'opdrachten'))
    .filter((m) => statSync(path.join(ROOT, 'opdrachten', m)).isDirectory())
    .sort();
}

export function berekenOfficieel(): Record<string, string> {
  const paden = [
    ...mappen().flatMap((m) => bestandenOnder(`opdrachten/${m}/test`)),
    ...bestandenOnder('test-hulp'),
    ...bestandenOnder('data'),
    ...bestandenOnder('scripts'),
    'vitest.config.ts',
    'package.json',
    'package-lock.json',
    '.github/workflows/bewijs.yml',
  ].filter((p) => existsSync(path.join(ROOT, p)));
  return Object.fromEntries(paden.sort().map((p) => [p, hashBestand(p)]));
}

export function berekenStarters(): Record<string, string> {
  const uit: Record<string, string> = {};
  for (const m of mappen()) {
    const src = Object.fromEntries(bestandenOnder(`opdrachten/${m}/src`).sort().map((p) => [p, hashBestand(p)]));
    uit[m] = totaalVan(src);
  }
  return uit;
}

function leesReferentie(): Manifest | null {
  try {
    return JSON.parse(readFileSync(REFERENTIE, 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

const officieel = berekenOfficieel();
const starters = berekenStarters();

if (process.argv.includes('--schrijf')) {
  const manifest: Manifest = {
    versie: JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string,
    algoritme: 'sha256',
    toelichting:
      'Officiële hashes van de testbestanden en de starters. Gemaakt met: npx tsx scripts/manifest.ts --schrijf. ' +
      'Het platform vergelijkt het bewijs met zijn eigen kopie van dit bestand, niet met deze.',
    totaal: totaalVan(officieel),
    officieel,
    starters,
  };
  mkdirSync(path.dirname(REFERENTIE), { recursive: true });
  writeFileSync(REFERENTIE, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`bewijs/manifest.json geschreven: ${Object.keys(officieel).length} bestanden, ${Object.keys(starters).length} starters.`);
} else {
  const referentie = leesReferentie();
  const afwijkend = referentie
    ? Object.keys({ ...referentie.officieel, ...officieel }).filter((p) => referentie.officieel[p] !== officieel[p]).sort()
    : [];
  console.log(
    JSON.stringify({
      totaal: totaalVan(officieel),
      gelijk_aan_referentie: referentie ? referentie.totaal === totaalVan(officieel) : null,
      afwijkend,
      mappen: Object.keys(starters).map((map) => ({
        map,
        // Zonder referentie, of een map die daar niet in staat: altijd testen.
        gestart: !referentie || referentie.starters[map] !== starters[map],
      })),
    }),
  );
}

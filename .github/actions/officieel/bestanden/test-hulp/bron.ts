import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bepaalt welke code de tests gebruiken:
 * - standaard: jouw code in `opdrachten/<map>/src/`
 * - met OPLOSSING=1: de referentie-oplossing in `oplossingen/<map>/` (alleen in de beheerdersversie)
 *
 * Zowel vitest.config.ts als de tests gebruiken dit bestand, zodat er maar één plek is
 * waar die keuze wordt gemaakt.
 */

/** Hoofdmap van de repo, altijd met '/' (ook op Windows). */
export const REPO_MAP = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  .replace(/\\/g, '/');

export const OPLOSSING_MODUS = process.env.OPLOSSING === '1';

export function controleerOplossingenMap(): void {
  if (OPLOSSING_MODUS && !existsSync(`${REPO_MAP}/oplossingen`)) {
    throw new Error(
      'OPLOSSING=1 is gezet, maar de map oplossingen/ bestaat niet. ' +
        'In de deelnemersversie zitten geen oplossingen: draai de tests zonder OPLOSSING=1.',
    );
  }
}

/** Map met de broncode die getest wordt (bevat index.ts). */
export function bronMap(opdracht: string): string {
  return OPLOSSING_MODUS ? `${REPO_MAP}/oplossingen/${opdracht}` : `${REPO_MAP}/opdrachten/${opdracht}/src`;
}

/** Map met de overige bestanden van een opdracht (zoals kennispakket.md of testset/). */
export function opdrachtMap(opdracht: string): string {
  return OPLOSSING_MODUS ? `${REPO_MAP}/oplossingen/${opdracht}` : `${REPO_MAP}/opdrachten/${opdracht}`;
}

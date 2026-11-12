import { defineConfig } from 'vitest/config';
import { OPLOSSING_MODUS, REPO_MAP, controleerOplossingenMap } from './test-hulp/bron.ts';

controleerOplossingenMap();

/**
 * Tests importeren altijd uit `@opdracht/<map>`.
 *
 *   @opdracht/m03-offerte-json             -> opdrachten/m03-offerte-json/src/index.ts
 *   @opdracht/m04-kennispakket/kennispakket.md -> opdrachten/m04-kennispakket/kennispakket.md
 *
 * Met OPLOSSING=1 (alleen beheerders) wijzen dezelfde imports naar oplossingen/<map>/.
 */
const code = OPLOSSING_MODUS ? `${REPO_MAP}/oplossingen/$1/index.ts` : `${REPO_MAP}/opdrachten/$1/src/index.ts`;
const bestanden = OPLOSSING_MODUS ? `${REPO_MAP}/oplossingen/$1/$2` : `${REPO_MAP}/opdrachten/$1/$2`;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@opdracht\/([^/]+)$/, replacement: code },
      { find: /^@opdracht\/([^/]+)\/(.+)$/, replacement: bestanden },
    ],
  },
  test: {
    include: ['opdrachten/*/test/**/*.test.ts', 'test-hulp/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    unstubEnvs: true,
    restoreMocks: true,
  },
});

// Referentie voor het platform: hoe een melding van het testbewijs wordt gecontroleerd.
// Geen pakketten nodig (Node 22, node:crypto). Gebruik in de API van het platform, of als voorbeeld.
//
//   import { controleerMelding } from './controleer-bewijs.mjs';
//   const uitkomst = await controleerMelding({ token, body, config });
//   // { ok: true, claims } of { ok: false, reden }
//
// config:
//   issuer      'https://token.actions.githubusercontent.com'
//   jwksUrl     standaard `${issuer}/.well-known/jwks` (of jwks: { keys: [...] } om te testen)
//   audience    'tamerbouw'
//   versies     { '<job_workflow_sha>': { ref: 'tamerbouw/bewijs/.github/workflows/test.yml@refs/tags/v1.0.0',
//                                          manifest: '<totaal uit bewijs/manifest.json van die versie>' }, ... }
//               Alleen de sha's van uitgebrachte versies. Een bewegende tag (v1) wijst naar een van die sha's.
//   tags        toegestane refs van de platformworkflow, bijvoorbeeld
//               ['tamerbouw/bewijs/.github/workflows/test.yml@refs/tags/v1', '…@refs/tags/v1.0.0']
//   modules     ['m01-live-agent', …] (de sleutels van starters in het manifest)
//   events      ['push', 'workflow_dispatch']
//   repoVan     optioneel: (repository, repository_id) => true als dit de repo van een bekende cursist is
import { createPublicKey, createVerify } from 'node:crypto';

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function sleutels(config) {
  if (config.jwks) return config.jwks.keys;
  const url = config.jwksUrl ?? `${config.issuer}/.well-known/jwks`;
  const antwoord = await fetch(url);
  if (!antwoord.ok) throw new Error(`JWKS niet op te halen: HTTP ${antwoord.status}`);
  return (await antwoord.json()).keys;
}

/** Controleert handtekening en tijd van een GitHub-OIDC-token. Geeft de claims of gooit. */
export async function controleerToken(token, config, nu = Date.now()) {
  const delen = String(token ?? '').split('.');
  if (delen.length !== 3) throw new Error('geen JWT');
  const kop = JSON.parse(b64url(delen[0]).toString('utf8'));
  const claims = JSON.parse(b64url(delen[1]).toString('utf8'));
  if (kop.alg !== 'RS256') throw new Error(`algoritme ${kop.alg} niet toegestaan`);
  const jwk = (await sleutels(config)).find((k) => k.kid === kop.kid);
  if (!jwk) throw new Error(`onbekende sleutel ${kop.kid}`);
  const geldig = createVerify('RSA-SHA256')
    .update(`${delen[0]}.${delen[1]}`)
    .verify(createPublicKey({ key: jwk, format: 'jwk' }), b64url(delen[2]));
  if (!geldig) throw new Error('handtekening klopt niet');
  const sec = Math.floor(nu / 1000);
  if (claims.iss !== config.issuer) throw new Error(`issuer ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(config.audience)) throw new Error(`audience ${claims.aud}`);
  if (typeof claims.exp !== 'number' || claims.exp < sec - 60) throw new Error('token verlopen');
  if (typeof claims.nbf === 'number' && claims.nbf > sec + 60) throw new Error('token nog niet geldig');
  return claims;
}

/** Controleert één melding: token, platformworkflow, repo, commit en manifest. */
export async function controleerMelding({ token, body, config, nu = Date.now() }) {
  let claims;
  try {
    claims = await controleerToken(token, config, nu);
  } catch (e) {
    return { ok: false, reden: `token: ${e.message}` };
  }
  // 1. Het bewijs komt uit de platformworkflow, op een uitgebrachte versie.
  if (!config.tags.includes(claims.job_workflow_ref)) {
    return { ok: false, reden: `job_workflow_ref ${claims.job_workflow_ref} is niet de platformworkflow op een vaste tag` };
  }
  const versie = config.versies[claims.job_workflow_sha];
  if (!versie) return { ok: false, reden: `job_workflow_sha ${claims.job_workflow_sha} is geen uitgebrachte versie` };
  // 2. De melding gaat over deze repo en deze commit.
  if (!body || typeof body !== 'object') return { ok: false, reden: 'geen body' };
  if (body.repo !== claims.repository) return { ok: false, reden: `repo ${body.repo} ≠ token ${claims.repository}` };
  if (body.sha !== claims.sha) return { ok: false, reden: `sha ${body.sha} ≠ token ${claims.sha}` };
  if (!config.events.includes(claims.event_name)) return { ok: false, reden: `event ${claims.event_name}` };
  if (config.repoVan && !config.repoVan(claims.repository, claims.repository_id)) {
    return { ok: false, reden: `repo ${claims.repository} hoort bij geen bekende cursist` };
  }
  // 3. Extra controle: het manifest is dat van de versie die de workflow draaide.
  if (body.manifest !== versie.manifest) return { ok: false, reden: 'manifest hoort niet bij deze platformversie' };
  // 4. De inhoud.
  if (body.status !== 'groen') return { ok: false, reden: `status ${body.status}` };
  if (!config.modules.includes(body.module)) return { ok: false, reden: `onbekende module ${body.module}` };
  if (!(body.groep === null || (typeof body.groep === 'string' && body.groep.length > 0 && body.groep.length <= 200))) {
    return { ok: false, reden: 'ongeldige groep' };
  }
  // Opslaan: één rij per (repository_id, sha, module, groep); bij twijfel de officiële tests zelf op die sha draaien.
  return { ok: true, claims };
}

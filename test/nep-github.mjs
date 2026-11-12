// Nep-GitHub en nep-platform voor test/simuleer.sh. Alleen lokaal; niets hiervan gaat naar productie.
//   GET  /token?audience=tamerbouw[&scenario=…]  een RS256-token zoals ACTIONS_ID_TOKEN_REQUEST_URL het geeft
//   GET  /.well-known/jwks                         de publieke sleutel
//   POST /api/bewijs                               controleert met platform/controleer-bewijs.mjs en logt
// Gebruik: node nep-github.mjs <poort> <log.jsonl> <config.json>
//   config.json: { repository, repository_id, sha, job_workflow_ref, job_workflow_sha, manifest, modules }
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { controleerMelding } from '../platform/controleer-bewijs.mjs';

const [poort, log, configPad] = process.argv.slice(2);
const c = JSON.parse(readFileSync(configPad, 'utf8'));
const issuer = `http://127.0.0.1:${poort}`;
const echt = generateKeyPairSync('rsa', { modulusLength: 2048 });
const vals = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...echt.publicKey.export({ format: 'jwk' }), kid: 'nep-1', alg: 'RS256', use: 'sig' };

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function teken(claims, sleutel = echt.privateKey) {
  const kop = b64({ alg: 'RS256', typ: 'JWT', kid: 'nep-1' });
  const inhoud = b64(claims);
  const handtekening = createSign('RSA-SHA256').update(`${kop}.${inhoud}`).sign(sleutel).toString('base64url');
  return `${kop}.${inhoud}.${handtekening}`;
}

const config = {
  issuer,
  jwks: { keys: [jwk] },
  audience: 'tamerbouw',
  tags: [c.job_workflow_ref],
  versies: { [c.job_workflow_sha]: { ref: c.job_workflow_ref, manifest: c.manifest } },
  modules: c.modules,
  events: ['push', 'workflow_dispatch'],
};

createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  if (req.method === 'GET' && url.pathname === '/token') {
    if (req.headers.authorization !== 'bearer nep-request-token' || url.searchParams.get('audience') !== 'tamerbouw') {
      res.writeHead(403).end('{}');
      return;
    }
    const scenario = url.searchParams.get('scenario') ?? 'platform';
    const nu = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer, aud: 'tamerbouw', iat: nu, nbf: nu, exp: nu + 300,
      repository: c.repository, repository_id: c.repository_id, sha: c.sha, ref: 'refs/heads/main', event_name: 'push',
      workflow_ref: `${c.repository}/.github/workflows/bewijs.yml@refs/heads/main`,
      job_workflow_ref: c.job_workflow_ref, job_workflow_sha: c.job_workflow_sha,
    };
    // De cursist draait een eigen workflow in plaats van die van het platform.
    if (scenario === 'eigen') {
      claims.job_workflow_ref = claims.workflow_ref;
      claims.job_workflow_sha = c.sha;
    }
    if (scenario === 'onbekende-versie') claims.job_workflow_sha = 'f'.repeat(40);
    if (scenario === 'verlopen') claims.exp = nu - 600;
    const token = teken(claims, scenario === 'valse-sleutel' ? vals.privateKey : echt.privateKey);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ value: token }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/.well-known/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/bewijs') {
    let tekst = '';
    for await (const deel of req) tekst += deel;
    let body = null;
    try { body = JSON.parse(tekst); } catch { /* blijft null */ }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const uitkomst = await controleerMelding({ token, body, config });
    appendFileSync(log, JSON.stringify({ ok: uitkomst.ok, reden: uitkomst.reden ?? null, body }) + '\n');
    res.writeHead(uitkomst.ok ? 200 : 403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: uitkomst.ok }));
    return;
  }
  res.writeHead(404).end();
}).listen(Number(poort), '127.0.0.1', () => console.log(`nep-github luistert op ${issuer}`));

#!/usr/bin/env bash
# Lokale proef van de platformworkflow, zonder GitHub: dezelfde stappen als de jobs test en meld in
# .github/workflows/test.yml, met een nep-OIDC (test/nep-github.mjs) en de echte controle van het platform
# (platform/controleer-bewijs.mjs).
#
# Gebruik: bash test/simuleer.sh <cursusrepo met oplossingen/ en node_modules/> [werkmap]
#
# Wat het nadoet:
#   - een cursist die m11 af heeft, en in m03 zijn src aanpaste én de tests "makkelijker" maakte, en in
#     data/ een verwachting veranderde;
#   - job test: zet-officieel.sh, testbewijs.sh met BEWIJS_MELDINGEN, zonder OIDC-variabelen;
#   - job meld: meld-bewijs.sh met een OIDC-token van de nep-GitHub;
#   - wat het platform moet weigeren: een eigen workflow van de cursist, een onbekende versie, een verlopen
#     of vals token, een ander manifest, een andere repo of commit.
set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CURSUS="$(cd "${1:?pad naar de cursusrepo ontbreekt}" && pwd)"
WERK="${2:-$HIER/test/.werk}"
BESTANDEN="$HIER/.github/actions/officieel/bestanden"
fout=0
check() { if eval "$2"; then echo "  OK    $1"; else echo "  FOUT  $1"; fout=1; fi; }

[ -f "$BESTANDEN/bewijs/manifest.json" ] || { echo "Draai eerst: bash werk-bij.sh $CURSUS"; exit 1; }
rm -rf "$WERK" && mkdir -p "$WERK"
C="$WERK/cursist"

echo "== Repo van de cursist maken"
mkdir -p "$C"
(cd "$CURSUS" && tar cf - --exclude=node_modules --exclude=./oplossingen --exclude=./tsconfig.oplossing.json .) | (cd "$C" && tar xf -)
cp "$CURSUS/oplossingen/m11-rendement/index.ts" "$C/opdrachten/m11-rendement/src/index.ts"
echo "// eigen werk" >>"$C/opdrachten/m03-agent-lus/src/index.ts"
for t in "$C"/opdrachten/m03-agent-lus/test/*.test.ts; do
  printf "import { it, expect } from 'vitest';\nit('alles goed', () => expect(1).toBe(1));\n" >"$t"
done
echo '{"geknoeid": true}' >"$C/data/bureau-vonk/app_settings.json"
ln -s "$CURSUS/node_modules" "$C/node_modules"

echo "== Job test (zonder token)"
bash "$HIER/.github/actions/officieel/zet-officieel.sh" "$BESTANDEN" "$C"
check "test van m03 is weer de officiële" "cmp -s '$C/opdrachten/m03-agent-lus/test/m03-agent-lus.test.ts' '$BESTANDEN/opdrachten/m03-agent-lus/test/m03-agent-lus.test.ts'"
check "data/ is weer de officiële" "cmp -s '$C/data/bureau-vonk/app_settings.json' '$BESTANDEN/data/bureau-vonk/app_settings.json'"
check "src/ van de cursist blijft staan" "grep -q '// eigen werk' '$C/opdrachten/m03-agent-lus/src/index.ts'"
(
  cd "$C"
  env -u ACTIONS_ID_TOKEN_REQUEST_URL -u ACTIONS_ID_TOKEN_REQUEST_TOKEN -u TAMERBOUW_BEWIJS_URL -u TAMERBOUW_BEWIJS_TOKEN \
    BEWIJS_MELDINGEN="$WERK/meldingen.jsonl" GITHUB_STEP_SUMMARY="$WERK/samenvatting-test.md" \
    bash scripts/testbewijs.sh >"$WERK/test.log" 2>&1
  echo $? >"$WERK/test.exit"
)
check "testjob exit 0" "[ \"\$(cat '$WERK/test.exit')\" = 0 ]"
check "m11 als hele map opgeschreven" "grep -q '\"module\":\"m11-rendement\",\"groep\":null' '$WERK/meldingen.jsonl'"
check "m03 niet als hele map (de echte tests zijn rood)" "! grep -q '\"module\":\"m03-agent-lus\",\"groep\":null' '$WERK/meldingen.jsonl'"
check "een niet-gestarte map (m02) staat er niet in" "! grep -q 'm02-lead-intake' '$WERK/meldingen.jsonl'"

echo "== Job meld (met nep-OIDC)"
POORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
SHA_CURSIST=0123456789abcdef0123456789abcdef01234567
SHA_PLATFORM=89abcdef0123456789abcdef0123456789abcdef
REF='tamerbouw/bewijs/.github/workflows/test.yml@refs/tags/v1'
jq -n --arg sha "$SHA_CURSIST" --arg ref "$REF" --arg psha "$SHA_PLATFORM" \
  --arg manifest "$(jq -r .totaal "$BESTANDEN/bewijs/manifest.json")" --argjson modules "$(jq -c '.starters | keys' "$BESTANDEN/bewijs/manifest.json")" \
  '{repository: "cursist/tamer-bouw-opdrachten", repository_id: "123456", sha: $sha, job_workflow_ref: $ref, job_workflow_sha: $psha, manifest: $manifest, modules: $modules}' >"$WERK/nep-config.json"
node "$HIER/test/nep-github.mjs" "$POORT" "$WERK/platform.jsonl" "$WERK/nep-config.json" >"$WERK/nep.log" 2>&1 &
NEP=$!
trap 'kill $NEP 2>/dev/null' EXIT
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$POORT/.well-known/jwks" >/dev/null && break; sleep 0.1; done

meld() { # meld <scenario>  -> exit van meld-bewijs.sh
  env -i PATH="$PATH" HOME="$HOME" GITHUB_REPOSITORY=cursist/tamer-bouw-opdrachten GITHUB_SHA="$SHA_CURSIST" \
    GITHUB_STEP_SUMMARY="$WERK/samenvatting-meld.md" TAMERBOUW_BEWIJS_URL="http://127.0.0.1:$POORT/api/bewijs" \
    ACTIONS_ID_TOKEN_REQUEST_URL="http://127.0.0.1:$POORT/token?api-version=2.0&scenario=$1" \
    ACTIONS_ID_TOKEN_REQUEST_TOKEN=nep-request-token \
    bash "$BESTANDEN/scripts/meld-bewijs.sh" "$WERK/meldingen.jsonl" >>"$WERK/meld.log" 2>&1
}
aantal=$(grep -c . "$WERK/meldingen.jsonl")
meld platform; code=$?
check "meldjob exit 0" "[ $code = 0 ]"
check "platform accepteert alle $aantal meldingen" "[ \"\$(jq -s 'map(select(.ok)) | length' '$WERK/platform.jsonl')\" = $aantal ]"
: >"$WERK/platform.jsonl"

for scenario in eigen onbekende-versie verlopen valse-sleutel; do
  meld "$scenario"; code=$?
  check "weigert token '$scenario' (exit $code)" "[ $code != 0 ] && [ \"\$(jq -s 'map(select(.ok)) | length' '$WERK/platform.jsonl')\" = 0 ]"
  : >"$WERK/platform.jsonl"
done

# Met een geldig token, maar een body die niet klopt (iemand die zelf een POST maakt).
TOKEN=$(curl -s -H 'Authorization: bearer nep-request-token' "http://127.0.0.1:$POORT/token?audience=tamerbouw" | jq -r .value)
post() { curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$POORT/api/bewijs" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1"; }
GOED=$(jq -nc --arg sha "$SHA_CURSIST" --arg m "$(jq -r .totaal "$BESTANDEN/bewijs/manifest.json")" '{repo: "cursist/tamer-bouw-opdrachten", sha: $sha, module: "m11-rendement", groep: null, status: "groen", manifest: $m}')
check "zelfde body met geldig token: 200" "[ \"\$(post '$GOED')\" = 200 ]"
check "ander manifest: 403" "[ \"\$(post \"\$(jq -c '.manifest = \"abc\"' <<<'$GOED')\")\" = 403 ]"
check "andere repo: 403" "[ \"\$(post \"\$(jq -c '.repo = \"iemand/anders\"' <<<'$GOED')\")\" = 403 ]"
check "andere commit: 403" "[ \"\$(post \"\$(jq -c '.sha = \"ffff\"' <<<'$GOED')\")\" = 403 ]"
check "onbekende module: 403" "[ \"\$(post \"\$(jq -c '.module = \"m99-nep\"' <<<'$GOED')\")\" = 403 ]"

echo
echo "Meldingen: $(tr '\n' ' ' <"$WERK/meldingen.jsonl")"
echo "Logs in $WERK (test.log, meld.log, platform.jsonl)."
[ "$fout" -eq 0 ] && echo "Alle controles OK." || echo "Er zijn controles mislukt."
exit "$fout"

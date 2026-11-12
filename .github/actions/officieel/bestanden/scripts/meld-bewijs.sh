#!/usr/bin/env bash
# Meldt het testbewijs aan het platform, met een OIDC-token van GitHub. Draait in de meldjob van de
# platformworkflow (tamerbouw/bewijs/.github/workflows/test.yml), NA de testjob en zonder jouw code:
# de testjob heeft geen OIDC-recht, deze job draait alleen dit script uit de platformrepo.
#
# Gebruik: bash meld-bewijs.sh <meldingen.jsonl>
#   <meldingen.jsonl>: per regel {"module": "m02-lead-intake", "groep": null | "<buitenste describe>"},
#   geschreven door scripts/testbewijs.sh met BEWIJS_MELDINGEN.
#
# - repo en sha komen uit GitHub (GITHUB_REPOSITORY, GITHUB_SHA), niet uit het bestand.
# - manifest is het totaal uit bewijs/manifest.json naast dit script: de officiële bestanden van deze
#   platformversie, dezelfde die de testjob over je code zette.
# - Een module die niet in het manifest staat, of een groepsnaam die geen gewone tekst is, wordt niet gemeld.
# - Zonder TAMERBOUW_BEWIJS_URL wordt er niets verstuurd (exit 0).
set -uo pipefail

BESTAND="${1:-}"
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_BESTAND="$HIER/../bewijs/manifest.json"
URL="${TAMERBOUW_BEWIJS_URL:-}"
SAMENVATTING="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ -z "$BESTAND" ] || [ ! -s "$BESTAND" ]; then
  echo "Geen groene mappen of groepen: er is niets te melden."
  exit 0
fi
if [ -z "$URL" ] || [[ "$URL" == *PLATFORM-DOMEIN* ]]; then
  echo "::warning::Geen platformadres ingesteld (TAMERBOUW_BEWIJS_URL): er wordt niets verstuurd."
  exit 0
fi
if [ -z "${GITHUB_REPOSITORY:-}" ] || [ -z "${GITHUB_SHA:-}" ]; then
  echo "::error::GITHUB_REPOSITORY en GITHUB_SHA ontbreken: dit script draait alleen in GitHub Actions."
  exit 1
fi
if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
  echo "::error::Geen OIDC beschikbaar. De workflow van de cursist moet 'permissions: id-token: write' geven."
  exit 1
fi

MANIFEST=$(jq -r '.totaal' "$MANIFEST_BESTAND")
MODULES=$(jq -c '.starters | keys' "$MANIFEST_BESTAND")

# GitHub geeft het token in het veld "value" (zoals @actions/core getIDToken het leest).
OIDC=$(curl -sS --fail --max-time 20 -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=tamerbouw" | jq -r '.value // empty')
if [ -z "$OIDC" ]; then
  echo "::error::Geen OIDC-token gekregen."
  exit 1
fi
echo "::add-mask::$OIDC"

# Alleen geldige regels, elke combinatie één keer.
# -R en fromjson?: elke regel apart, zodat een kapotte regel de rest niet meeneemt.
MELDINGEN=$(jq -R -c --argjson modules "$MODULES" '
  fromjson? | select(type == "object" and (.module | type) == "string")
  | select(.module as $m | any($modules[]; . == $m))
  | select(.groep == null or ((.groep | type) == "string" and (.groep | length) <= 200 and (.groep | test("^[^\\n\\r]+$"))))
  | {module, groep}' "$BESTAND" 2>/dev/null | sort -u)
OVERGESLAGEN=$(( $(grep -c . "$BESTAND") - $(grep -c . <<<"$MELDINGEN") ))

{
  echo "## Bewijs gemeld"
  echo
  echo "Manifest: \`${MANIFEST:0:12}…\` · commit \`${GITHUB_SHA:0:7}\`"
  echo
  echo "| Opdracht | Groep | Platform |"
  echo "|---|---|---|"
} >>"$SAMENVATTING"

fout=0
while IFS= read -r regel; do
  [ -n "$regel" ] || continue
  payload=$(jq -c --arg repo "$GITHUB_REPOSITORY" --arg sha "$GITHUB_SHA" --arg manifest "$MANIFEST" \
    '{repo: $repo, sha: $sha, module, groep, status: "groen", manifest: $manifest}' <<<"$regel")
  module=$(jq -r '.module' <<<"$regel")
  groep=$(jq -r '.groep // "(hele map)"' <<<"$regel")
  if curl --fail-with-body -sS --max-time 20 --retry 2 --retry-all-errors -X POST "$URL" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $OIDC" -d "$payload" >/dev/null; then
    echo "GEMELD: $module / $groep"
    echo "| $module | $groep | ontvangen |" >>"$SAMENVATTING"
  else
    fout=1
    echo "::error::Het bewijs voor $module / $groep kwam niet aan bij het platform."
    echo "| $module | $groep | MISLUKT |" >>"$SAMENVATTING"
  fi
done <<<"$MELDINGEN"

if [ "$OVERGESLAGEN" -gt 0 ]; then
  echo "::warning::$OVERGESLAGEN regel(s) in de meldingen waren ongeldig en zijn niet gemeld."
fi
if [ "$fout" -ne 0 ]; then
  echo "Niet elk bewijs kwam aan. Start de run opnieuw via Actions → Re-run jobs."
  exit 1
fi
echo "Klaar: alle groene mappen en groepen zijn gemeld."

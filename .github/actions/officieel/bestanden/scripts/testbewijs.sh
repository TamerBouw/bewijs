#!/usr/bin/env bash
# Testbewijs: test de gestarte opdrachtmappen en meldt wat groen is aan het platform.
#
# - Een map is gestart als opdrachten/<map>/src/ afwijkt van de officiële starter (bewijs/manifest.json).
#   Niet-gestarte mappen worden overgeslagen. ALLES=1 test ze toch.
# - Per gestarte map: npx vitest run opdrachten/<map>/. Is de map groen, dan één melding voor de map.
#   Is hij rood, dan een melding per testgroep (buitenste describe-blok) die wél helemaal groen is.
# - In de platformworkflow (BEWIJS_MELDINGEN gezet): elke groene map of groep wordt een regel
#   {"module": …, "groep": …} in dat bestand. Er wordt dan niets verstuurd en geen token gevraagd: de tests
#   (en dus jouw code) draaien in een job zonder OIDC-recht. Een tweede job meldt met scripts/meld-bewijs.sh.
# - Zonder BEWIJS_MELDINGEN (lokaal): POST {repo, sha, module, groep, status: "groen", manifest} naar
#   TAMERBOUW_BEWIJS_URL, met TAMERBOUW_BEWIJS_TOKEN als fallback om te testen: het platform accepteert
#   alleen OIDC uit de platformworkflow.
# - manifest is de sha256 over de officiële testbestanden (scripts/manifest.ts).
# - De job faalt NIET op een rode map in uitvoering. Hij faalt alleen als een melding niet aankomt, of
#   met STRIKT=1 als een geteste map rood is (voor les 1.4: groen voordat iets live gaat).
#
# Lokaal: bash scripts/testbewijs.sh   (zonder URL wordt er niets verstuurd)
set -uo pipefail

URL="${TAMERBOUW_BEWIJS_URL:-}"
TOKEN_LOKAAL="${TAMERBOUW_BEWIJS_TOKEN:-}"
STRIKT="${STRIKT:-}"
ALLES="${ALLES:-}"
REPO="${GITHUB_REPOSITORY:-lokaal}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo onbekend)}"
SAMENVATTING="${GITHUB_STEP_SUMMARY:-/dev/null}"
UITVOER="${BEWIJS_UITVOER:-${RUNNER_TEMP:-/tmp}/testbewijs}"
mkdir -p "$UITVOER"

# --- Manifest en gestarte mappen -------------------------------------------------------------
if ! MANIFEST_JSON=$(npx --no-install tsx scripts/manifest.ts); then
  echo "::error::scripts/manifest.ts faalde; zonder manifest geen bewijs."
  exit 1
fi
MANIFEST=$(jq -r '.totaal' <<<"$MANIFEST_JSON")
if [ "$(jq -r '.gelijk_aan_referentie' <<<"$MANIFEST_JSON")" = "false" ]; then
  echo "::warning::Officiële testbestanden wijken af van bewijs/manifest.json: $(jq -r '.afwijkend | join(", ")' <<<"$MANIFEST_JSON"). Het platform weigert dit bewijs."
fi

# --- Hoe er gemeld wordt ----------------------------------------------------------------------
kan_melden=0
AUTH=""
MELDINGEN="${BEWIJS_MELDINGEN:-}"
if [ -n "$MELDINGEN" ]; then
  # Platformworkflow: alleen opschrijven; de meldjob verstuurt met OIDC.
  : >"$MELDINGEN"
  kan_melden=2
elif [ -z "$URL" ]; then
  echo "Geen TAMERBOUW_BEWIJS_URL: de tests draaien wel, maar er wordt geen bewijs verstuurd."
elif [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
  # GitHub geeft het token terug in het veld "value" (zoals @actions/core getIDToken het leest).
  OIDC=$(curl -sS --fail --max-time 20 -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=tamerbouw" | jq -r '.value // empty')
  if [ -n "$OIDC" ]; then
    echo "::add-mask::$OIDC"
    AUTH="$OIDC"
    kan_melden=1
  else
    echo "::error::Geen OIDC-token gekregen. Staat 'permissions: id-token: write' in de workflow?"
  fi
elif [ -n "$TOKEN_LOKAAL" ]; then
  echo "Lokaal met TAMERBOUW_BEWIJS_TOKEN: alleen om te testen, het platform accepteert alleen OIDC."
  AUTH="$TOKEN_LOKAAL"
  kan_melden=1
else
  echo "Geen OIDC-token beschikbaar (niet in GitHub Actions) en geen TAMERBOUW_BEWIJS_TOKEN: er wordt niets verstuurd."
fi

# meld <module> <groep of leeg>  -> 0 bij succes
meld() {
  local payload
  if [ "$kan_melden" -eq 2 ]; then
    jq -nc --arg module "$1" --arg groep "$2" '{module: $module, groep: (if $groep == "" then null else $groep end)}' >>"$MELDINGEN"
    return 0
  fi
  payload=$(jq -nc --arg repo "$REPO" --arg sha "$SHA" --arg module "$1" --arg groep "$2" --arg manifest "$MANIFEST" \
    '{repo: $repo, sha: $sha, module: $module, groep: (if $groep == "" then null else $groep end), status: "groen", manifest: $manifest}')
  curl --fail-with-body -sS --max-time 20 --retry 2 --retry-all-errors \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH" \
    -d "$payload" >/dev/null
}

# bewijs_voor <module> <groep>  -> zet $bewijs en eventueel $meldfout
bewijs_voor() {
  bewijs="niet verstuurd"
  if [ "$kan_melden" -eq 2 ]; then
    meld "$1" "$2"
    bewijs="wordt gemeld"
  elif [ "$kan_melden" -eq 1 ]; then
    if meld "$1" "$2"; then
      bewijs="verstuurd"
    else
      bewijs="MISLUKT"
      meldfout=1
      echo "::error::Het bewijs voor $1${2:+ / $2} kon niet naar het platform worden gestuurd."
    fi
  fi
}

rood=0
meldfout=0
getest=0
{
  echo "## Testbewijs"
  echo
  echo "Manifest: \`${MANIFEST:0:12}…\`${STRIKT:+ · strikte modus}"
  echo
  echo "| Opdracht | Tests | Bewijs |"
  echo "|---|---|---|"
} >>"$SAMENVATTING"

for pad in opdrachten/*/; do
  map=$(basename "$pad")
  [ -d "opdrachten/$map/test" ] || continue
  # Let op: in jq is false "leeg" voor //, dus expliciet op null testen.
  gestart=$(jq -r --arg m "$map" '[.mappen[] | select(.map == $m) | .gestart][0] | if . == null then true else . end' <<<"$MANIFEST_JSON")
  if [ "$gestart" != "true" ] && [ -z "$ALLES" ]; then
    echo "OVERGESLAGEN: $map (nog niet gestart)"
    echo "| $map | niet gestart | - |" >>"$SAMENVATTING"
    continue
  fi
  getest=$((getest + 1))
  json="$UITVOER/$map.json"
  rm -f "$json"

  echo "::group::Tests $map"
  npx vitest run "opdrachten/$map/" --reporter=default --reporter=json --outputFile.json="$json"
  code=$?
  echo "::endgroup::"

  if [ "$code" -eq 0 ]; then
    echo "GROEN: $map"
    bewijs_voor "$map" ""
    echo "| $map | GROEN | $bewijs |" >>"$SAMENVATTING"
    continue
  fi

  rood=1
  if [ -n "$STRIKT" ]; then
    echo "::error::ROOD: de tests van $map falen (strikte modus)."
  else
    echo "::notice::IN UITVOERING: $map heeft nog rode tests."
  fi
  echo "| $map | in uitvoering | - |" >>"$SAMENVATTING"

  # Groene testgroepen in een rode map apart melden.
  if [ -s "$json" ]; then
    groepen=$(jq -r '
      [.testResults[]?.assertionResults[]? | {g: (.ancestorTitles[0] // ""), s: .status}]
      | map(select(.g != "")) | group_by(.g)
      | map(select(all(.[]; .s == "passed")) | .[0].g) | .[]' "$json" 2>/dev/null || true)
    while IFS= read -r groep; do
      [ -n "$groep" ] || continue
      bewijs_voor "$map" "$groep"
      echo "| $map / $groep | GROEN | $bewijs |" >>"$SAMENVATTING"
    done <<<"$groepen"
  fi
done

if [ "$meldfout" -ne 0 ]; then
  echo "Niet elk bewijs kwam aan bij het platform. Start de run opnieuw."
  exit 1
fi
if [ -n "$STRIKT" ] && [ "$rood" -ne 0 ]; then
  echo "Strikte modus: niet alle geteste mappen zijn groen."
  exit 1
fi
if [ "$getest" -eq 0 ]; then
  echo "Nog geen map gestart: er is niets getest."
elif [ "$rood" -ne 0 ]; then
  echo "Klaar. Mappen in uitvoering hebben nog rode tests; dat is normaal. Groene groepen zijn gemeld."
else
  echo "Alle gestarte mappen zijn groen."
fi

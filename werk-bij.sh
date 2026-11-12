#!/usr/bin/env bash
# Werkt de officiële bestanden van de platformrepo bij uit de cursusrepo (bij elke release).
# Gebruik: bash werk-bij.sh <pad-naar-cursusrepo>
#
# Daarna: controleer de diff, commit, en zet de tags (zie README.md, "Een nieuwe versie uitbrengen").
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURSUS="$(cd "${1:?pad naar de cursusrepo ontbreekt}" && pwd)"
DOEL="$HIER/.github/actions/officieel/bestanden"

[ -f "$CURSUS/bewijs/manifest.json" ] || { echo "Geen bewijs/manifest.json in $CURSUS. Draai daar eerst: npx tsx scripts/manifest.ts --schrijf"; exit 1; }
# Het manifest moet bij de bestanden passen, anders weigert het platform elk bewijs van deze versie.
(cd "$CURSUS" && npx --no-install tsx scripts/manifest.ts | jq -e '.gelijk_aan_referentie == true' >/dev/null) \
  || { echo "bewijs/manifest.json past niet bij de officiële bestanden. Draai: npx tsx scripts/manifest.ts --schrijf"; exit 1; }

rm -rf "$DOEL"
mkdir -p "$DOEL/opdrachten"
for map in "$CURSUS"/opdrachten/*/; do
  naam=$(basename "$map")
  [ -d "$map/test" ] || continue
  mkdir -p "$DOEL/opdrachten/$naam"
  cp -R "$map/test" "$DOEL/opdrachten/$naam/test"
done
for pad in test-hulp data scripts bewijs; do
  cp -R "$CURSUS/$pad" "$DOEL/$pad"
done
for bestand in vitest.config.ts package.json package-lock.json .npmrc; do
  [ -f "$CURSUS/$bestand" ] && cp "$CURSUS/$bestand" "$DOEL/$bestand"
done
find "$DOEL" -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true

echo "Bijgewerkt: $(find "$DOEL" -type f | wc -l) bestanden, versie $(jq -r .versie "$DOEL/bewijs/manifest.json"), manifest $(jq -r .totaal "$DOEL/bewijs/manifest.json")."
echo "Geef dit manifest-totaal aan het platform als het verwachte manifest van deze versie."

#!/usr/bin/env bash
# Zet de officiële bestanden over de code van de cursist.
# Gebruik: bash zet-officieel.sh <bron: bestanden/ van deze platformversie> <doel: werkmap van de cursist>
#
# Wat de cursist in deze paden heeft, telt niet: ze worden eerst weggehaald en dan uit de bron gezet.
#   opdrachten/<map>/test/   (per map die in de bron staat; eigen tests horen in opdrachten/<map>/eigen/)
#   test-hulp/   data/   scripts/   bewijs/
#   vitest.config.ts   package.json   package-lock.json   .npmrc
# Alles daarbuiten (src/, eigen/, live/, supabase/, gedeeld/) blijft van de cursist.
set -euo pipefail

BRON="${1:?bron ontbreekt}"
DOEL="${2:?doel ontbreekt}"
[ -f "$BRON/bewijs/manifest.json" ] || { echo "::error::Geen bewijs/manifest.json in $BRON: platformversie onvolledig."; exit 1; }

for map in "$BRON"/opdrachten/*/; do
  naam=$(basename "$map")
  rm -rf "$DOEL/opdrachten/$naam/test"
  mkdir -p "$DOEL/opdrachten/$naam"
  cp -R "$BRON/opdrachten/$naam/test" "$DOEL/opdrachten/$naam/test"
done
# Een testmap die niet bij het platform hoort (bijvoorbeeld opdrachten/m99/test), draait ook niet mee.
for map in "$DOEL"/opdrachten/*/; do
  naam=$(basename "$map")
  [ -d "$BRON/opdrachten/$naam" ] || rm -rf "$DOEL/opdrachten/$naam/test"
done

for pad in test-hulp data scripts bewijs; do
  rm -rf "${DOEL:?}/$pad"
  cp -R "$BRON/$pad" "$DOEL/$pad"
done
for bestand in vitest.config.ts package.json package-lock.json .npmrc; do
  if [ -f "$BRON/$bestand" ]; then cp "$BRON/$bestand" "$DOEL/$bestand"; else rm -f "$DOEL/$bestand"; fi
done

echo "Officiële bestanden gezet: manifest $(jq -r '.totaal' "$BRON/bewijs/manifest.json" | cut -c1-12)…, versie $(jq -r '.versie' "$BRON/bewijs/manifest.json")."

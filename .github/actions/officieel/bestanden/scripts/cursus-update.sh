#!/usr/bin/env bash
# Haalt de nieuwste versie van de cursus binnen, zonder je eigen werk te raken.
#
# Gebruik (in de map tamer-bouw-opdrachten):   npm run cursus-update
# Op Windows in Git Bash kan ook:                bash scripts/cursus-update.sh
#
# Wat het doet:
# - de officiële bestanden (tests, test-hulp, data, scripts, bewijs, workflow, package.json, uitleg) worden die
#   van de cursus;
# - per opdrachtmap alleen test/, HINTS.md en README.md; je eigen code in src/, eigen/, live/ en supabase/
#   blijft staan;
# - een opdrachtmap die nieuw is in de cursus, komt er helemaal bij;
# - daarna npm ci en één commit "Cursusupdate". Pushen doe je zelf met: git push
set -euo pipefail

hoofd() {
  local upstream_url="https://github.com/tamerbouw/tamer-bouw-opdrachten.git"
  local ref="upstream/main"

  cd "$(git rev-parse --show-toplevel)"
  if [ -n "$(git status --porcelain)" ]; then
    echo "Je hebt wijzigingen die nog niet zijn vastgelegd. Leg ze eerst vast:"
    echo '  git add -A && git commit -m "Mijn werk"'
    echo "en start daarna opnieuw: npm run cursus-update"
    exit 1
  fi

  git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$upstream_url"
  # Met twee remotes vraagt gh welke repo bedoeld is; dat is altijd je eigen kopie (origin).
  if command -v gh >/dev/null 2>&1; then gh repo set-default "$(git remote get-url origin)" >/dev/null 2>&1 || true; fi
  echo "Nieuwste versie ophalen..."
  git fetch -q upstream

  local pad
  for pad in test-hulp data scripts bewijs .github/workflows/bewijs.yml vitest.config.ts package.json \
             package-lock.json .npmrc tsconfig.json .gitignore .env.example README.md START-HIER.md BEWIJS.md \
             CHANGELOG.md VERSIES.md LICENSE-cursist.md; do
    if git cat-file -e "$ref:$pad" 2>/dev/null; then git checkout "$ref" -- "$pad"; fi
  done

  local map deel
  while IFS= read -r map; do
    if [ -d "$map" ]; then
      for deel in test HINTS.md README.md; do
        if git cat-file -e "$ref:$map/$deel" 2>/dev/null; then git checkout "$ref" -- "$map/$deel"; fi
      done
    else
      git checkout "$ref" -- "$map"
      echo "Nieuw: $map"
    fi
  done < <(git ls-tree -d --name-only "$ref" opdrachten/)

  echo "Onderdelen installeren..."
  npm ci --silent

  git add -A
  if git diff --cached --quiet; then
    echo "Je hebt de nieuwste versie al."
    exit 0
  fi
  git commit -q -m "Cursusupdate $(git rev-parse --short "$ref")"
  echo "Bijgewerkt. Stuur het naar GitHub met: git push"
}

# Alles staat in een functie: zo leest bash het hele script in voordat dit bestand zelf wordt bijgewerkt.
hoofd "$@"
exit 0

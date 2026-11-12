# bewijs: de testworkflow van het platform

Deze repo is van het platform, niet van de cursist. De repo van elke cursist roept één herbruikbare workflow aan:

```yaml
uses: tamerbouw/bewijs/.github/workflows/test.yml@v1
```

## Wat de workflow doet

| Job | Rechten | Wat |
|---|---|---|
| `test` | `contents: read`, geen token | checkt de code van de cursist uit, zet de officiële bestanden van deze versie eroverheen (`opdrachten/*/test/**`, `test-hulp/**`, `data/**`, `scripts/**`, `bewijs/manifest.json`, `vitest.config.ts`, `package.json`, `package-lock.json`, `.npmrc`), draait `npm ci` en de tests, en schrijft de groene mappen en groepen in een artifact |
| `meld` | `id-token: write` | draait alleen `scripts/meld-bewijs.sh` uit deze repo en stuurt elke melding met een OIDC-token naar het platform |

- De code van de cursist draait dus nooit in een job waarin een OIDC-token te krijgen is.
- `uses: $/.github/actions/officieel` verwijst naar deze repo op precies de commit die draait (GitHub-functie van juli 2026, runner 2.336.0 of nieuwer). Workflow, officiële bestanden en meldscript horen zo altijd bij dezelfde versie.
- De officiële bestanden staan in `.github/actions/officieel/bestanden/`. Je zet ze er met `werk-bij.sh`, nooit met de hand.

## Wat het platform controleert

`platform/controleer-bewijs.mjs` is de referentie (Node 22, geen pakketten). Per melding:

1. Handtekening van het token met de JWKS van `https://token.actions.githubusercontent.com`; `iss` gelijk, `aud` is `tamerbouw`, `exp` en `nbf` kloppen.
2. `job_workflow_ref` is `tamerbouw/bewijs/.github/workflows/test.yml@refs/tags/v1` (of een andere uitgebrachte tag), en `job_workflow_sha` is de commit van een uitgebrachte versie. Een cursist die een eigen workflow schrijft, krijgt een token met zijn eigen `job_workflow_ref`, en dat wordt geweigerd.
3. `repository` en `sha` in het token zijn gelijk aan `repo` en `sha` in de body. `repository_id` hoort bij een bekende cursist; `event_name` is `push` of `workflow_dispatch`.
4. Extra controle: `manifest` in de body is het manifest-totaal van die versie.
5. Eén rij per `(repository_id, sha, module, groep)`. Bij twijfel draait het platform de officiële tests zelf op die commit.

## Vóór lancering

- [ ] Kies de GitHub-organisatie van het platform en zet deze repo daar neer als `bewijs`. Hij moet **openbaar** zijn: een herbruikbare workflow uit een andere organisatie of een persoonlijk account kan GitHub alleen uit een openbare repo aanroepen. Hij bevat alleen tests, testdata en scripts, geen lesteksten of oplossingen. Wil je de tests niet openbaar, dan moet het platform ze via een eigen API uitgeven; die variant is niet gebouwd.
- [ ] Vervang in de cursusrepo `tamerbouw` overal door de organisatie van het platform: in `.github/workflows/bewijs.yml` en in de adressen in `START-HIER.md` en M00. Dat is de enige instelling; de cursist stelt niets in.
- [ ] Vul in deze repo het adres van het platform in, in `.github/workflows/test.yml` (`TAMERBOUW_BEWIJS_URL`, nu `https://PLATFORM-DOMEIN/api/bewijs`).
- [ ] `bash werk-bij.sh <cursusrepo>`, commit, zet de tags `v1.0.0` en `v1` op die commit, en push ze.
- [ ] Geef het platform de configuratie: de toegestane `job_workflow_ref`'s, de sha van `v1.0.0` met het manifest-totaal dat `werk-bij.sh` toont, de modules en de audience `tamerbouw`.
- [ ] Doe één echte run vanuit een testrepo die van de template is gemaakt. Dat is het enige wat lokaal niet te testen is (zie hieronder). Controleer in de Summary van de run de twee jobs, en in het platform dat de melding is geaccepteerd.

## Een nieuwe versie uitbrengen

1. In de cursusrepo: `npx tsx scripts/manifest.ts --schrijf`.
2. Hier: `bash werk-bij.sh <cursusrepo>`, de diff bekijken, committen.
3. Tag `v1.x.y` op de nieuwe commit en verzet `v1` (`git tag -f v1 && git push -f origin v1`). Breekt de versie de tests van lopende cursisten, gebruik dan `v2` en pas `bewijs.yml` in de template aan.
4. Voeg de nieuwe sha met zijn manifest toe aan de configuratie van het platform. Oude versies blijven geldig.

## Lokaal testen

```bash
bash werk-bij.sh <cursusrepo>
bash test/simuleer.sh <cursusrepo>      # de cursusrepo met oplossingen/ en node_modules/
```

De proef doet beide jobs na, met een nep-OIDC die echte RS256-tokens tekent, en de controle uit `platform/controleer-bewijs.mjs`:

- **Testjob:** de tests en data van de cursist worden overschreven en zijn eigen code blijft staan. Een map met "makkelijker" gemaakte tests telt niet als groen, en een niet-gestarte map wordt overgeslagen.
- **Meldjob:** het bewijs wordt geaccepteerd.
- **Geweigerd:** een eigen workflow van de cursist, een onbekende versie, een verlopen of vals getekend token, een ander manifest, een andere repo of commit, en een onbekende module.

Niet lokaal te testen, dus te controleren bij de eerste echte run:

- dat GitHub `uses: tamerbouw/bewijs/...@v1` vanuit een persoonlijk account oplost (de repo moet openbaar zijn);
- `$/` in een aangeroepen workflow;
- `upload-artifact` en `download-artifact` tussen de jobs;
- de echte claims `job_workflow_ref` en `job_workflow_sha` in het token van GitHub.

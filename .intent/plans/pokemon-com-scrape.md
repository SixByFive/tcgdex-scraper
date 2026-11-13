---
id: plan-pokemon-com-scrape
title: Scrape pokemon.com across 6 locales for a new set
type: plan
status: active
created: '2026-11-06T22:00:00.000Z'
updated: '2026-11-06T22:00:00.000Z'
system: scrape
decisions:
  - DEC-0005
  - DEC-0006
constraints: []
tags:
  - pokemon-com
  - playwright
  - cache
---
## Goal

Given a pokemon.com set slug (e.g. `me06` for Delta Reign), produce one `ScrapedCard` JSON per card (1..total) under `cache/pokemon-com/<setId>/NNN.json`, where total is discovered from the EN footer.

## Reason

New sets must be added to cards-database with correct name, HP, attacks, weakness, retreat, illustrator, Pokédex IDs, and 6-locale translations before enrichment can layer marketplace IDs on top. pokemon.com is the only source that reliably covers all required locales (DEC-0005).

## Rules

**URL shape per locale** (configured in `config.json → locales`):

- en: `/uk/pokemon-tcg/pokemon-cards/series/{slug}/{n}/`
- de: `/de/pokemon-sammelkartenspiel/pokemon-karten/serien/{slug}/{n}/`
- fr: `/fr/jcc-pokemon/cartes-pokemon/series/{slug}/{n}/`
- it: `/it/gcc/archivio-carte/series/{slug}/{n}/`
- es: `/es/jcc-pokemon/cartas-pokemon/series/{slug}/{n}/`
- pt: `/br/pokemon-estampas-ilustradas/cartas-de-pokemon/series/{slug}/{n}/`
- es-mx: not available → fall back to `es` at emit time

**Order of operations:**
1. Fetch EN page 1; read `footer N/TOTAL rarity` to learn total card count.
2. For each n in 1..total, fetch all 6 locales in parallel (concurrency 3 via `p-limit`).
3. Parse each page with cheerio; extract structural fields from EN, name/attack-text from each locale.
4. Capture pokedexSlug from any `a[href*="/pokedex/"]`.
5. Write one JSON per card; HTML cache (`cache/*.html`) is kept so re-parses are instant.
6. Chain `resolvePokedex(setId)` automatically — fills `structural.dexIds` from PokéAPI with slug aliases (e.g. `nidoran-female` → `nidoran-f`).

**Structural fields come from EN only.** Per-locale blocks carry only `name`, `evolvesFromName`, and `abilities[].name/effect` (translations).

**Cost arrays use `data-energy-type` or the `icon-<type>` class, never the localised `title` attribute.**

**Image URLs are captured per locale and later proxied through `/img?url=…` for display.**

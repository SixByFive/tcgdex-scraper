---
id: plan-pokedex-resolution
title: Resolve Pokédex slug → national dex IDs via PokéAPI
type: plan
status: active
created: '2026-11-06T22:00:00.000Z'
updated: '2026-11-06T22:00:00.000Z'
system: scrape
decisions: []
constraints: []
tags:
  - pokeapi
  - dex-id
---
## Goal

For every scraped card with a `pokedexSlug`, resolve the national Pokédex number (or numbers, for multi-form cards) and write it back to the card's `structural.dexIds`.

## Reason

pokemon.com does not expose the Pokédex integer in its card markup — only the slug (e.g. `heracross`). The tcgdex Card schema uses `dexId: number[]`. PokéAPI (`/api/v2/pokemon-species/{slug}`) gives the integer in one request per slug.

## Rules

- Chained automatically at the end of `scrapeSet` — users do not need to run it separately.
- Also exposed as its own CLI command `pokedex <setId>` so re-resolution is possible without a full re-scrape.
- One PokéAPI request per unique slug across the set, throttled to 150 ms between calls to be polite.
- Response cached to `cache/pokeapi-species.json` so re-runs are free.
- A slug alias map (`nidoran-female` → `nidoran-f`, `nidoran-male` → `nidoran-m`) handles pokemon.com → PokéAPI naming mismatches.
- Null results (species not found) are cached as `null` but retried on next run (so a one-off API hiccup doesn't poison the cache permanently).
- Trainers and Energies have no `pokedexSlug` and are skipped.

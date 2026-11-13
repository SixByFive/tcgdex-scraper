---
id: sys-scrape
title: Pokémon TCG card scraper
type: system
created: '2026-11-06T22:00:00.000Z'
updated: '2026-11-06T22:00:00.000Z'
plans:
  - plan-pokemon-com-scrape
  - plan-pokedex-resolution
decisions:
  - DEC-0005
  - DEC-0006
tags:
  - pokemon-com
  - playwright
  - cards-database
---
## Overview

Standalone scraper that collects new-set card data from pokemon.com across 6 international locales (en, de, fr, it, es, pt) and resolves Pokédex IDs via PokéAPI. Output is a cache of per-card JSON files that the enrichment system turns into cards-database `.ts` sources.

**Source of truth:** pokemon.com regional sub-sites, driven by Playwright (DataDome bot-wall defeats plain fetch).

**Output:** `cache/pokemon-com/<setId>/NNN.json` — one ScrapedCard per card number, with structural fields (types, HP, attacks, weakness, retreat, illustrator, rarity, Pokédex slug + dex IDs) and per-locale translated name/attack name/effect.

## Boundaries

- Only touches pokemon.com for card data and pokeapi.co for dex resolution.
- Never writes to cards-database — that is enrichment's job.
- Never computes marketplace IDs or variants — that is enrichment's job.
- Image URLs are captured per locale but images are not downloaded by this system (the UI proxies them on demand).

## Key Decisions

- [DEC-0005] pokemon.com is the single source of truth for card content; one EN page per card provides structural data (types, costs are English-keyed via `data-energy-type`), and the per-locale pages provide only translations.
- [DEC-0006] Playwright with visible Chromium is required — DataDome blocks headless and plain `fetch`.

---
id: sys-web-ui
title: Local web UI
type: system
created: '2026-11-06T22:00:00.000Z'
updated: '2026-11-06T22:00:00.000Z'
plans:
  - plan-web-ui
decisions:
  - DEC-0004
tags:
  - ui
  - server
---
## Overview

A browser-based UI served by a local Node HTTP server (`src/ui/server.ts`). Single page at `http://localhost:5173`, vanilla JS, no build step. Lists scraped sets and cards-database sets, shows per-set card grids with live-updating tiles during scrapes, and (upcoming) runs enrichment dry-run → variant mapping panel → apply.

## Boundaries

- One port (5173 by default). Starts via `bun run src/cli.ts ui` (or `bunx tsx` on Windows).
- Static files and SSE delivered from Node; images are proxied through `/img` to bypass pokemon.com hotlink protection.
- Spawns scraper/enrichment commands as child processes (`bunx tsx src/cli.ts …`); never runs them in-process.
- Writes nothing to disk directly other than through the spawned commands.

## Key Decisions

- [DEC-0004] SSE for live run output; `fs.watch` for cache-directory changes; no WebSockets.

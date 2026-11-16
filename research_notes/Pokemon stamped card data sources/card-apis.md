# Card-data APIs and datasets as sources of STAMPED Pokemon TCG printings (2020-2026)

Research date: 2026-11-14. VERIFIED = I fetched it live. INFERRED = deduced. Unauthenticated, polite request rates (about 8 req/s, one or two sequential scanners).

## 1. TCGdex: stamp coverage, sourcing, licence, bulk access

### Takeaway
TCGdex is the only free, unauthenticated source I found that models stamps as a first-class field (variants_detailed[].stamp[], about 130 enumerated stamp values), with a per-variant Cardmarket id (often) and TCGplayer id (rarely, only recent ME sets). Coverage is uneven and hand-curated by contributors: some sets with real stamped printings show none, and stamped variants frequently lack TCGplayer ids. New sets get cards within about a day, but stamped variants and ids arrive piecemeal in follow-up PRs.

### Cited Findings
- VERIFIED: Card endpoint returns `variants` (flags: firstEdition, holo, normal, reverse, wPromo) and `variants_detailed[]` with `type, size, stamp[], thirdParty{cardmarket,tcgplayer}, variantId, pricing{cardmarket,tcgplayer}`. For sv08.5-082 (Lugia ex): the plain holo has cardmarket 805474 + tcgplayer 610437; stamped set-logo variants carry only cardmarket ids (841280 normal, 841281 normal jumbo, 868293 holo, 868296 holo jumbo) and `pricing.tcgplayer: null`. Command: `curl -s https://api.tcgdex.net/v2/en/cards/sv08.5-082` — [TCGdex API](https://api.tcgdex.net/v2/en/cards/sv08.5-082)
- VERIFIED: Pricing in the card response is live (Cardmarket `updated: 2026-11-13T22:22:54Z`, EUR avg/low/trend/avg1/avg7/avg30). Same source.
- VERIFIED: The `/v2/en/sets/{id}` endpoint lists cards without variants; stamps need one request per card (`GET /v2/en/cards/{setId}-{localId}`). GraphQL (`POST https://api.tcgdex.net/v2/graphql`) accepted `variants_detailed{type size stamp}` but returned `null` for every card in sv08.5 (so not usable for stamps in bulk). Command: `curl -s -X POST https://api.tcgdex.net/v2/graphql -H 'content-type: application/json' -d '{"query":"{ set(id:\"sv08.5\"){ cards{ id variants_detailed{ type size stamp } } } }"}'`
- VERIFIED: The cards-database repo defines `VariantStamps` (about 130 values, including set-logo, pre-release, pokemon-center, staff, snowflake, 30th-pokeday, player-rewards-program, gamestop, eb-games, trick-or-trade, ace-trainer, game-on, regional-championships, poke-ball-league / great-ball-league / ultra-ball-league / master-ball-league, professor-program, worlds-20xx, 25th-celebration, fossil-museum, horizons, pokemon-together, thank-you, illustration-contest-2022/2024, many player-name stamps). The code comment says `stamp` should be renamed `stamps` in v3, and a card may carry several stamps (example: set-logo + staff). `variant_detailed` also has `size` (standard|jumbo), `foil` (pokeball, greatball, masterball, etc.), `subtype`. — [interfaces.d.ts](https://raw.githubusercontent.com/tcgdex/cards-database/master/interfaces.d.ts)
- VERIFIED: Sourcing is hand-curated TypeScript card files (`data/<Series>/<Set>/<number>.ts`) edited through GitHub PRs; each variant is a literal object with type/stamp/thirdParty. Example: `data/Scarlet & Violet/Prismatic Evolutions/082.ts`. — [raw file](https://raw.githubusercontent.com/tcgdex/cards-database/master/data/Scarlet%20%26%20Violet/Prismatic%20Evolutions/082.ts)
- VERIFIED: Very recent maintenance: latest commits on 2026-11-13 ("feat(data): add the Pokémon Game On stamp (#2535)", "fix: Delta Reign cardmarket ID's (#2571)"); repo pushed_at 2026-11-13, about 1,185 stars. Commands: `curl -s "https://api.github.com/repos/tcgdex/cards-database/commits?path=data&per_page=8"`, `curl -s https://api.github.com/search/commits?q=repo:tcgdex/cards-database+stamp` — [GitHub commits API](https://api.github.com/repos/tcgdex/cards-database/commits?path=data&per_page=8)
- VERIFIED: Set-addition latency (git history by set directory): Delta Reign (me06, released 2026-11-06) added by PR #2536 on 2026-11-07 (about 1 day), cardmarket id fix on 2026-11-13. Ascended Heroes (released 2026-01-30) added 2026-01-31; "Add new ME variant types & Pricing IDs for ASC" on 2026-04-15 (about 2.5 months later); TCGplayer product ids PR on 2026-03-07. Phantasmal Flames (released 2025-11-14) added 2025-11-15, Cardmarket ids 2025-11-20, TCGplayer ids 2026-03-07, thirdParty moved into variants 2026-04-21. — commit history of [Delta Reign](https://api.github.com/repos/tcgdex/cards-database/commits?path=data/Mega%20Evolution/Delta%20Reign), [Ascended Heroes](https://api.github.com/repos/tcgdex/cards-database/commits?path=data/Mega%20Evolution/Ascended%20Heroes), [Phantasmal Flames](https://api.github.com/repos/tcgdex/cards-database/commits?path=data/Mega%20Evolution/Phantasmal%20Flames)
- VERIFIED: Delta Reign (me06) via API on 2026-11-14: 141 cards, 0 stamped variants (too new, 1 week).
- VERIFIED licence: MIT for the database (GitHub licence API: `mit`; README: "The Database is licensed under the MIT License"). Not affiliated with Nintendo/TPC. Self-hostable via Dockerfile (port 3000); official SDKs JS/TS, PHP, Java/Kotlin (Python also listed on site). Repo folders: data, data-asia, meta, scripts, server. — [GitHub README](https://github.com/tcgdex/cards-database), [tcgdex.dev](https://tcgdex.dev/)
- VERIFIED: The public API documents no rate limit anywhere I looked (docs and homepage silent); response headers had no rate-limit fields. Site says the API "is costly to run" and asks for sponsorship. — [tcgdex.dev](https://tcgdex.dev/)
- VERIFIED: CONTRIBUTING documents building all 18 languages; compile runs `git log` over about 34,000 files (10+ minutes), so a full local build of the JSON is feasible offline. — [CONTRIBUTING.md](https://raw.githubusercontent.com/tcgdex/cards-database/master/CONTRIBUTING.md)

### Measured stamp coverage (English, REST per-card scan; script `tcgdex_stamp_scan.py` iterates `GET /v2/en/sets/{id}` then `GET /v2/en/cards/{cardId}` with 80 ms delay)

| Set | Release | Cards | Cards w/ stamp | Stamped variants | Distinct stamps seen | Provider ids on stamped variants |
|---|---|---|---|---|---|---|
| swsh1 Sword & Shield | 2020-02 | 216 | 0 | 0 | none | n/a |
| swsh2 Rebel Clash | 2020 | 209 | n/a | (1 each) | gamestop, eb-games, snowflake, set-logo x2, regional-championships x2, staff, poke-ball-league | not measured |
| swsh3 Darkness Ablaze | 2020 | 201 | n/a | | thank-you x3, player-rewards-program x2, set-logo | not measured |
| swsh9 Brilliant Stars | 2022-02 | 186 | 2 | 2 | set-logo, regional-championships | |
| swsh10 Astral Radiance | 2022-05 | 216 | 4 | 4 | set-logo x2, snowflake, regional-championships | CM 4, TCGp 0 |
| swsh12 Silver Tempest | 2022-11 | 215 | 3 | 5 | snowflake x2, set-logo, gamestop, eb-games | CM 5, TCGp 0 |
| swsh12.5 Crown Zenith | 2023-01 | 160 | 0 | 0 | none | n/a |
| sv01 Scarlet & Violet | 2023-03 | 258 | 0 | 0 | none | n/a |
| sv03.5 151 | 2023-09 | 207 | 5 | 8 | set-logo, gamestop, eb-games, pokemon-center, pokemon-together x2, snowflake x2 | CM 8, TCGp 0 |
| sv04.5 Paldean Fates | 2024-01 | 245 | 1 | 1 | pokemon-day | CM 1, TCGp 0 |
| sv06.5 Shrouded Fable | 2024-08 | 99 | 1 | 1 | set-logo | CM 1, TCGp 0 |
| sv07 Stellar Crown | 2024-09 | 175 | 9 | 14 | set-logo x11, gamestop, eb-games, snowflake | CM 14, TCGp 0 |
| sv08 Surging Sparks | 2024-11 | 252 | 20 | 28 | player-rewards-program x14, set-logo x7, horizons x3, gym-challenge x3, snowflake | CM 11 / none 17, TCGp 0 |
| sv08.5 Prismatic Evolutions | 2025-01 | 180 | 14 | 18 | set-logo 16, snowflake 1, 30th-pokeday 1 | CM 18, TCGp 0 |
| sv09 Journey Together | 2025-03 | 190 | 28 | 46 | set-logo 11, player-rewards-program 26, snowflake, master/ultra-ball-league, gamestop, eb-games, gym-challenge x2, regional-championships x2, staff | CM 13 / none 33, TCGp 0 |
| sv10 Destined Rivals | 2025-05 | 244 | 9 | 14 | set-logo 12, staff 4, eb-games | CM 14, TCGp 0 |
| sv10.5w White Flare | 2025-07 | 173 | 3 | 3 | set-logo x2, fossil-museum | CM 3, TCGp 3 |
| sv10.5b Black Bolt | 2025-07 | 172 | 10 | 20 | set-logo x2, player-rewards-program x8, gym-challenge x3, liao-fu-guan x3, great/ultra-ball-league, professor-program, jose-cruz-galindo-resendiz | CM 17 / none 3, TCGp 19 |
| me01 Mega Evolution | 2025-09 | 188 | 26 | 41 | player-rewards-program 31, set-logo 3, 30th-pokeday, trick-or-trade, gamestop, eb-games, regional-championships x2, staff, ultra-ball-league | CM 7 / none 34, TCGp 0 |
| me02 Phantasmal Flames | 2025-11 | 130 | 3 | 4 | set-logo x2, eb-games, gamestop | CM 4, TCGp 4 |
| me02.5 Ascended Heroes | 2026-01 | 295 | 6 | 9 | player-rewards-program x9 | CM 9, TCGp 9 |
| me03 Perfect Order | 2026-03 | 124 | 18 | 24 | player-rewards-program 18, set-logo 2, gamestop, eb-games, regional-championships x2, staff | CM 11 / none 13, TCGp 11 |
| me04 Chaos Rising | 2026-05 | 122 | 3 | 4 | gamestop, eb-games, set-logo x2 | CM 4, TCGp 2 |
| me05 Pitch Black | 2026-07 | 120 | 0 | 0 | none (4 months after release) | n/a |
| swsh4.5 Shining Fates | 2021-02 | 73 | 0 | 0 | none | n/a |
| swsh11 Lost Origin | 2022-09 | 217 | 2 | 4 | snowflake, set-logo, gamestop, eb-games | CM 4, TCGp 0 |
| me06 Delta Reign | 2026-11-06 | 141 | 0 | 0 | none yet | n/a |

(Rows for swsh2 and swsh3 come from a scan file produced by a script that is not mine (see Gaps); treat as indicative. sv02-sv06, swsh6 were still scanning when notes were written and are not reported.)

- VERIFIED observation: stamp tags are present but sparse. Roughly 1-28 stamped cards per main set; sv09 and me01/me03 are the richest because player-rewards-program (Play! Pokemon Prize Pack series) stamps were entered. Pre-release/set-logo stamps in particular are hugely under-represented relative to reality for sv01-sv06, swsh1, swsh12.5 (0 found), where real set-logo prerelease/Build & Battle promos exist in the real world (INFERRED from my knowledge of prerelease packs; Bulbapedia notes prerelease cards carry the set logo since HGSS — [Bulbapedia Prerelease cards](https://bulbapedia.bulbagarden.net/wiki/Prerelease_cards_(TCG))).
- VERIFIED: TCGplayer ids on stamped variants are absent in all SV sets measured and only appear for sv10.5w onward (White Flare, Black Bolt, me02, me02.5, me03, partially me04). Cardmarket ids: present for most stamped variants in sv07-sv10, but absent on 33/46 (sv09), 17/28 (sv08), 34/41 (me01), 13/24 (me03), meaning those stamped variants (mostly player-rewards-program) have no CM id (probably because Cardmarket does not list them separately: INFERRED).
- VERIFIED: Pokemon Center / Pre-release (`pre-release`) stamps appear in the type enum but did not appear in any measured set (only one `pokemon-center` in sv03.5), so Pokemon Center / prerelease printings are largely tracked only inside promo series (swshp, svp, mep). Contributor scan of swshp (not my script) showed set-logo 93, staff 45, 25th-celebration 23, worlds-2022 8, etc. — treat as indicative.

### Inferences
- A usable join key is (setId, localId) then match on (type, size, stamp[]) to our variant; variantId is an opaque hash that may change (INFERRED, not verified).
- Missing stamped variants in TCGdex should be treated as "unknown", not "none exist", given sv01/swsh1/swsh12.5 all report 0.
- TCGdex stamped coverage appears to be tied to contributor effort rather than a systematic source (Cardmarket's product list is the likely origin of the ids; the repo commit titles "Add Cardmarket IDs", "Add TCGplayer product IDs", "Add print variants" support this).

### Gaps
- Did not measure sv02-sv06, swsh2-swsh8 myself; did not compare against Bulbapedia set lists card by card.
- Rate limit unknown (not documented); no JSON dump/release artifact found, only the repo and self-hosted build. Non-English languages not measured (the stamp/variant data is per set, not per language, but `data-asia` has separate files).
- Whether `variantId` is stable across data releases not tested.

## 2. pokemontcg.io API v2

### Takeaway
pokemontcg.io has no stamp, prerelease, or variant fields and is deprecated; it models only price-type buckets. It does not expose Cardmarket/TCGplayer product ids (only a pricing URL keyed by its own card id). Not suitable as a stamp source.

### Cited Findings
- VERIFIED: docs banner: API "deprecated", migrate to Scrydex; v1 gets no data updates; existing keys work through 2027-03-01; new registrations unavailable; unauthenticated access allowed with much lower limits (numbers not published on the page). — [docs.pokemontcg.io](https://docs.pokemontcg.io/)
- VERIFIED: Data still updating in Nov 2026: sets list orders me6 Delta Reign (2026/11/06) first; `GET https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=6`. Prices are stale for some cards (tcgplayer updatedAt 2026/10/15; cardmarket updatedAt 2026/06/11 or 2026/02/22 on swshp-SWSH020/SWSH039).
- VERIFIED: Card object keys for sv8pt5-82: id, name, supertype, subtypes, hp, types, rules, attacks, weaknesses, resistances, retreatCost, set, number, rarity, nationalPokedexNumbers, legalities, regulationMark, images, tcgplayer. No stamp/variant field. `curl -s https://api.pokemontcg.io/v2/cards/sv8pt5-82`. Only one card per (set, number); the stamped printings are not separate cards. — [API](https://api.pokemontcg.io/v2/cards/sv8pt5-82), [Card object docs](https://docs.pokemontcg.io/api-reference/cards/card-object)
- VERIFIED: tcgplayer.prices keys: normal, holofoil, reverseHolofoil, 1stEditionHolofoil, 1stEditionNormal; cardmarket has averageSellPrice, trendPrice, avg1/7/30, reverseHolo*. Docs list no product ids; urls are `prices.pokemontcg.io/tcgplayer/<cardId>`. Example swshp-SWSH020 Pikachu. — [Card object docs](https://docs.pokemontcg.io/api-reference/cards/card-object)
- VERIFIED: Intermittent HTTP 502 responses from api.pokemontcg.io during my queries (some bulk set queries failed).
- VERIFIED: Data repo PokemonTCG/pokemon-tcg-data: pushed 2026-11-08, GitHub reports no licence file (`license: None`). — [GitHub API](https://api.github.com/repos/PokemonTCG/pokemon-tcg-data)

### Inferences
- Because it is deprecated and keys sunset 2027-03-01, do not build on it.

### Gaps
- Exact rate limit numbers not published on the page I fetched.

## 3. Scrydex (scrydex.com, successor to pokemontcg.io)

### Takeaway
Scrydex is paid (no free tier on pricing page) and its documented card model has a `variants[]` array with names like unlimitedHolofoil / firstEditionShadowlessHolofoil, not stamps; no marketplace ids are documented. Not verified to model set-logo/prerelease stamps; likely they appear as separate cards/expansions or not at all.

### Cited Findings
- VERIFIED: Multi-game API (Pokemon, MTG, Lorcana, Gundam, One Piece, Riftbound), successor to pokemontcg.io; secret-key auth, credits, rate-limit docs exist. — [scrydex.com/docs](https://scrydex.com/docs)
- VERIFIED pricing: Starter $29/mo 5,000 credits; Growth $99/mo 50,000; Professional $399/mo 250,000; Enterprise custom 1M+. 1 credit per request, price history 3, Vision 5; no free tier mentioned. — [scrydex.com/pricing](https://scrydex.com/pricing)
- VERIFIED: Pokemon card object fields: id, name, supertype, subtypes, types, hp, level, evolves_from, rules, ancient_trait, abilities, attacks, weaknesses, resistances, retreat_cost, number, printed_number, rarity, rarity_code, artist, national_pokedex_numbers, regulation_mark, expansion_sort_order, images, expansion{...}, language, language_code, variants[name, images, prices, pop_reports]. Docs do not list TCGplayer/Cardmarket ids and do not mention stamp/prerelease. Language filter via `/pokemon/v1/en/cards`. — [Scrydex card docs](https://scrydex.com/docs/pokemon/cards), [API reference](https://scrydex.com/docs/pokemon/api-reference)
- INFERRED/secondhand: third-party guide claims bulk CSV export at /api/v2/export and Japanese variants/promos. — [cardgrader.ai guide](https://cardgrader.ai/blog/pokemon-card-api) (not verified)

### Inferences
- Can't verify without an API key whether Scrydex exposes stamped prints as separate card ids (e.g. "Pikachu (Prerelease)"); would need a paid starter plan test.

### Gaps
- No live Scrydex data fetched (requires key). Rate-limit doc page not fetched (URL guessed returned 404). Per-variant marketplace ids unknown.

## 4. PokeData (pokedata.io)

### Takeaway
Paid, non-commercial-only, redistribution prohibited. Credit-based API with set/card/pricing endpoints; stamp/variant fields not documented in the pages I could see.

### Cited Findings
- VERIFIED: "Official paid Pokedata API"; "Non-commercial use only"; subscription at pokedata.io/pro. Endpoints (Postman metadata): `GET /v0/account` (0 credits), `/v0/search?query=...&asset_type=CARD` (1), `/v0/sets` (5), `/v0/set?set_id=533` (5), `/v0/pricing?id=1&asset_type=CARD` (10), `/v0/population?id=1&asset_type=CARD` (5). Search result keys: id, language, name, num, release_date, secret, set_code, set_id, set_name. — [Postman docs](https://documenter.gw.postman.com/view/metadata/2sA3JF9iWW)
- VERIFIED terms: current tier "Platinum" for individuals, not businesses; "You cannot redistribute Data from the Pokedata API, website, or application for any reason". — [Pokedata API Terms](https://www.pokedata.io/api-terms)

### Inferences
- Licence terms make it unsuitable as a source for a published dataset.

### Gaps
- Variant/stamp fields, marketplace ids, rate limits: not documented in what I could fetch.

## 5. Other sources and per-variant marketplace ids

### Takeaway
No other free dataset with stamp fields surfaced. Of everything checked, only TCGdex ties per-variant Cardmarket (and sometimes TCGplayer) product ids to stamps, via (set, localId). CardTrader has a separate "Prerelease Promos" expansion on its site but its API needs a token.

### Cited Findings
- VERIFIED: TCGdex `thirdParty.cardmarket` and `thirdParty.tcgplayer` are per-variant product ids (see section 1); CardTrader ids are not provided by TCGdex, pokemontcg.io, Scrydex docs, or PokeData docs I read.
- Search results (not fetched in depth): TCGCollector's card database log names Mega Evolution Promos variants "Prerelease" and "Prerelease (Staff)" (e.g. Miraidon, MEP 082) — [tcgcollector.com card-database-log](https://www.tcgcollector.com/card-database-log/intl); CardTrader has a Prerelease Promos expansion — [CardTrader](https://www.cardtrader.com/en/games/pokemon/expansions/prerelease-promos-93ef3ad1-7c41-41ce-979f-4382e93f6035/categories). TCGCollector's tools docs host (tools.docs.tcgcollector.com) did not resolve (ENOTFOUND).
- Search result: pokemonpricetracker.com offers a Pokemon API; its docs page rendered only "Loading..." so I could not verify fields (SPA).
- Search results: GitHub repos cajogos/pokemon-tcg-data, Pepper0ni/pokemon-tcg-data (forks of the pokemontcg data), flibustier/pokemon-tcg-pocket-database (Pocket digital game, not physical stamps) — not inspected for stamp fields.

### Inferences
- Joining to our cards: TCGdex (setId, localId, variant) gives CM and sometimes TCGplayer ids; CardTrader ids would have to be matched separately (CardTrader blueprints API requires a token, not tested).

### Gaps
- CardTrader API, TCGCollector data access, pokemonpricetracker fields, Cardmarket's own product list: not verified.
- Stamped prints of sets with 0 in TCGdex (sv01 to sv06, swsh1, swsh12.5) not cross-checked against Bulbapedia.

## Process note
A parallel researcher sharing my scratchpad overwrote my first `scan.py`, which corrupted several early output files; I re-ran with a uniquely named script (`...\scratchpad\cardapis_mine\tcgdex_stamp_scan.py`). Figures in the table above for sv08.5 to me04, swsh9, swsh10, swsh12, swsh12.5, sv01, sv03.5, sv04.5, sv06.5, sv07, sv08, me06 come from my own scan; swsh2/swsh3/swshp numbers come from the other script's output and are indicative only.

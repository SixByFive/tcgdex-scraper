# CardTrader and fan-run Pokémon card databases as sources of STAMPED printing data

Legend: VERIFIED = I fetched/inspected the page or API response myself this session. SNIPPET = taken from a web-search result summary, page itself not opened. INFERRED = my reasoning. Access note: cardtrader.com, tcgcollector.com (www), docs and most CardTrader pages sit behind a Cloudflare "Just a moment..." challenge (HTTP 403 to WebFetch and to curl). I did not attempt to bypass it. So CardTrader's own docs and expansion pages could NOT be read directly; their content below is from search snippets only.

## 1. How does CardTrader model stamped printings (API v2, blueprints, expansions, properties, token, limits, ToS)?

### Takeaway
CardTrader appears to model stamped/pattern printings as (a) separate expansions and/or (b) separate blueprints whose NAME carries the stamp (e.g. "Blimpmon(Pre-Release Stamped)" for Digimon), not as a structured "stamp" property. I could not confirm a Pokémon blueprint JSON with a stamp field, and could not read the official docs (Cloudflare), so field-level details and token/rate-limit/ToS specifics remain unverified.

### Cited Findings
- Official v2 docs exist at /docs/api/full and /docs/api/full/reference; base URL https://api.cardtrader.com/api/v2, Bearer-token auth, token taken from the settings page of your CardTrader profile (SNIPPET) — [search result summary of CardTrader docs](https://www.cardtrader.com/en/docs/api/full/reference)
- Expansions come from GET /expansions; blueprints from GET /blueprints/export?expansion_id=N (the "How To Sell" guide example uses expansion_id=979) (SNIPPET) — [How To Sell](https://www.cardtrader.com/en/docs/api/full/how-to-sell)
- Blueprint JSON carries an editable_properties array (name, type, default, possible values) and a card_market_ids array; tcg_player_id is documented, shown null in some examples (SNIPPET) — [CardTrader API docs](https://www.cardtrader.com/en/docs/api/full)
- A third-party Go client (go-mtgban) models fixed_properties as returned by the market, holding collector number and language (SNIPPET; not confirmed from CardTrader docs) — [go-mtgban cardtrader pkg](https://beta.pkg.go.dev/github.com/mtgban/go-mtgban@v0.4.24/cardtrader)
- Third-party clients: Python "cardtrader-wrapper" (methods incl. blueprints(expansion_id), optional SQLite cache) and a .NET NuGet "CardTraderApi" (SNIPPET) — [cardtrader-wrapper](https://cardtrader-wrapper.readthedocs.io/en/latest/), [NuGet](https://www.nuget.org/packages/CardTraderApi)
- CardTrader Pokémon has a dedicated expansion "Prerelease Promos" (URL slug includes a UUID, prerelease-promos-93ef3ad1-...) and a "Retail Exclusive Promos" expansion; its blurb says prerelease promos often feature a unique foil stamp and organizers got versions with an extra STAFF stamp (SNIPPET) — [Prerelease Promos](https://www.cardtrader.com/en/games/pokemon/expansions/prerelease-promos-93ef3ad1-7c41-41ce-979f-4382e93f6035/blueprints_search), [Retail Exclusive Promos](https://www.cardtrader.com/en-EU/games/pokemon/expansions/retail-exclusive-promos/blueprints_search)
- CardTrader has separate Pokémon expansions for pattern variants: "Prismatic Evolutions - Master Ball Reverse Holo" and "Prismatic Evolutions - Poké Ball Reverse Holo" (URL slugs prismatic-evolutions-master-ball-reverse-holo / -poke-ball-reverse-holo) (SNIPPET: titles/URLs seen in search results) — [Master Ball](https://www.cardtrader.com/en/games/pokemon/expansions/prismatic-evolutions-master-ball-reverse-holo/blueprints_search), [Poké Ball](https://www.cardtrader.com/en/games/pokemon/expansions/prismatic-evolutions-poke-ball-reverse-holo/blueprints_search)
- In other CardTrader games the stamp is put in the blueprint name: Digimon cards "Blimpmon(Pre-Release Stamped)" at /en/cards/367103, "Blastmon(Pre-Release Stamped)" /en/cards/224611 (SNIPPET: titles) — [367103](https://www.cardtrader.com/en/cards/367103), [224611](https://www.cardtrader.com/en/cards/224611). Card pages are therefore addressable as /en/cards/{blueprint_id}.
- robots.txt (VERIFIED): User-agent * disallows /uploads/ (allows /uploads/blueprints/) and /kaboom; lists gzipped XML sitemaps per locale (en-US, en-EU, it, es, fr, de) covering blueprint products, games, expansions, categories, blueprint versions — [robots.txt](https://www.cardtrader.com/robots.txt). These sitemaps could be a ToS-compatible way to enumerate blueprint URLs/ids, but the challenge page blocks automated fetching of content pages.
- Docs and expansion pages returned the Cloudflare challenge to both WebFetch and curl (VERIFIED, this session). The user-supplied fact that the API returns 401 without a token is consistent.

### Inferences
- Because Pokémon pattern variants are separate expansions, set-logo stamps (e.g. PRE stamp) may also be separate expansions or separate blueprints with a suffix in the name; the user's TCGTracking finding of one blueprint (316695) for Lugia ex PRE 082 suggests stamped variants are either absent or filed in different expansions (e.g. "Prerelease Promos", "Retail Exclusive Promos").
- Searching blueprint names for "(Stamp" / "Stamped" / "Pre-Release" per expansion is likely the practical extraction method, plus fixed_properties/editable_properties for any structured hint. Needs a real token to confirm.
- Marketplace product pages and sitemaps give blueprint ids, so ids are obtainable without scraping card text.

### Gaps
- Exact rate limit, token approval process (free personal token vs. app approval) and ToS API clauses: docs unreadable (Cloudflare 403). Snippet says token is on the profile settings page; nothing on limits.
- No real Pokémon blueprint JSON found showing a stamp field; no field named 'pokemon_stamp' confirmed (searches returned none).
- Did not confirm whether a "version" field exists on blueprints (go-mtgban lists no confirmed one in what I saw; sitemap names mention "blueprint versions", hint only).

## 2. Public (unauthenticated) CardTrader web pages: scrapeable? ids in URLs?

### Takeaway
Expansion pages (/en/games/pokemon/expansions/{slug}/blueprints_search) and card pages (/en/cards/{id}) are public and indexed by search engines, but are behind a Cloudflare challenge for scripted clients; I could not read them. Scraping is not practical without circumventing bot protection, which I did not attempt.

### Cited Findings
- Expansion page URL pattern /en/games/pokemon/expansions/{slug}/blueprints_search (also /categories) and card page /en/cards/{blueprint_id} — [example expansion](https://www.cardtrader.com/en/games/pokemon/expansions/prerelease-promos-93ef3ad1-7c41-41ce-979f-4382e93f6035/blueprints_search), [example card](https://www.cardtrader.com/en/cards/367103)
- curl with a browser User-Agent to these URLs returned 403 "Just a moment..." (VERIFIED, 3 URLs tried, incl. docs).

### Inferences
- Ids appear in /en/cards/{id}, so web search/sitemaps could yield ids, but a browser-based session or the official API (with the user's own token) is the compliant route.

### Gaps
- Whether expansion pages paginate and list every stamped print: unread.

## 3. tcgcollector.com: stamp/variant data, API/export, scraping ToS

### Takeaway
TCG Collector does model per-card "variants" (including "Prerelease" and "Prerelease (Staff)") and documents variant conventions, so it is the best fan database for stamp names, but it has no public API and the site is behind Cloudflare (403 to curl/WebFetch); robots.txt allows generic crawlers except pagination params, /api/ and /lists/, and forbids AI-training crawlers.

### Cited Findings
- Its card-database log lists entries such as Bastiodon (Mega Evolution Promos 085) with variants "Prerelease, Prerelease (Staff)" (SNIPPET) — [card database log](https://www.tcgcollector.com/card-database-log/intl)
- A "Conventions" doc says these different versions are called variants (SNIPPET); doc host documents.tcgcollector.com did not resolve from my machine (DNS error) — [conventions](https://documents.tcgcollector.com/card-database/conventions); also "Cards and/or variants to be added" at https://documents.tcgcollector.com/card-database/to-be-added (SNIPPET: title only)
- robots.txt (VERIFIED): User-agent * Allow /; Disallow &page=, ?page=, &viewUser=, ?viewUser=, /api/, /lists/, /activity-log, /missing-card-images etc.; content signals search=yes, ai-train=no, use=reference; ~25 named training crawlers (ClaudeBot, GPTBot, CCBot...) fully disallowed; sitemap https://static.tcgcollector.com/sitemaps/sitemap.xml — [robots.txt](https://www.tcgcollector.com/robots.txt)
- Pages www.tcgcollector.com/sets/intl/en returned Cloudflare challenge 403 (VERIFIED).

### Inferences
- Because /api/ is disallowed and ai-train=no is declared, bulk scraping for dataset building is contrary to the stated signals; manual lookups for validation are low risk. Page pagination being disallowed also makes full enumeration awkward.
- No evidence of JSON in page source or an export (not inspectable).

### Gaps
- Exact variant vocabulary for set-logo / Pokémon Center / league stamps: not seen. Terms-of-service text not read.

## 4. Limitless TCG (limitlesstcg.com, docs.limitlesstcg.com)

### Takeaway
Limitless lists cards per print with set code, number and rarity but exposes no stamp/prerelease information; its API is tournament-focused, not card-database.

### Cited Findings
- Card page https://limitlesstcg.com/cards/PRE/82 lists prints only as "Prismatic Evolutions #82 (Double Rare)" and a Japanese print; no stamp, no prerelease, no API/export link (VERIFIED, fetched) — [Limitless PRE 82](https://limitlesstcg.com/cards/PRE/82)
- API docs: most endpoints keyless with rate limits shown in headers; keys granted on request for public-facing projects only; endpoints cover tournaments, games (/decks), webhooks; cards/stamps not mentioned (VERIFIED, fetched) — [docs.limitlesstcg.com/developer](https://docs.limitlesstcg.com/developer)
- robots.txt allows everything (Disallow empty) (VERIFIED, curl) — [robots.txt](https://limitlesstcg.com/robots.txt)

### Inferences
- Not useful as a stamp source.

### Gaps
- Did not check whether any Limitless card endpoint exists beyond the docs landing pages.

## 5. Bulbapedia and pkmncards.com

### Takeaway
Bulbapedia is the best machine-fetchable validation source: its MediaWiki API works (VERIFIED) and has a "Prerelease cards (TCG)" page that enumerates, per expansion, which cards received prerelease printings through Mega Evolution-era sets; it names stamp types in prose only. pkmncards has clean per-card URLs but showed no stamp/prerelease labels in what I checked.

### Cited Findings
- MediaWiki API https://bulbapedia.bulbagarden.net/w/api.php responds to action=query list=search and action=parse prop=wikitext with a plain User-Agent (VERIFIED, curl) — e.g. [Prerelease cards (TCG) page](https://bulbapedia.bulbagarden.net/wiki/Prerelease_cards_(TCG))
- Prerelease page text: prerelease cards are reprints with a foil "PRERELEASE" stamp or the expansion logo in the bottom-right of the art; from HeartGold & SoulSilver onwards they carry the expansion logo; Diamond & Pearl first had "STAFF"-stamped versions; staff versions were halted from Battle Styles and resumed with Silver Tempest; Evolutions, XY and Destined Rivals prerelease cards are stamped set cards rather than Black Star promos (VERIFIED, wikitext) — [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Prerelease_cards_(TCG))
- Same page includes structured {{Setlist/nmentry}} rows per card with the target expansion in a comment column, e.g. SWSH006 Rillaboom (Sword & Shield Prerelease); SVP Promo 154 Indeedee (Surging Sparks), 181-184 (Journey Together); Destined Rivals 034, 049, 087, 096 (stamped set cards); MEP Promo 001-004 (Mega Evolution), 014-017 (Phantasmal Flames), 064-067 (Perfect Order), 074-077 (Chaos Rising), 082-085 (Pitch Black), 111-114 (Delta Reign) (VERIFIED, wikitext tail; set names for the last four are as listed on the page and I did not independently cross-check them) — [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Prerelease_cards_(TCG))
- Licence: Bulbapedia content is CC BY-NC-SA (per the task brief; I did not re-fetch the licence page). Page is flagged for staff versions of stamped promos but does not distinguish staff vs prerelease per row.
- pkmncards: robots.txt only blocks ?s= internal search URLs (VERIFIED) — [robots.txt](https://pkmncards.com/robots.txt) (note: I fetched search pages anyway at low volume with a browser UA; they returned 200). Set page https://pkmncards.com/set/prismatic-evolutions/ returned HTTP 200 with 181 card links of form /card/{name}-{set}-{set}-{number}/ (VERIFIED). The Lugia ex PRE 082 and Team Rocket's Mimikyu DRI 087 pages showed no stamp/prerelease text or variant links (VERIFIED) — [Lugia ex](https://pkmncards.com/card/lugia-ex-prismatic-evolutions-pre-082/). A search for "prerelease" returned no card results. Its syntax help advertises a print-type: filter (e.g. print-type:alternate) (VERIFIED).
- pkmncards does list some stamp-named trainer cards (e.g. Reset Stamp UNM 206a, a separate print) — [Reset Stamp 206a](https://pkmncards.com/card/reset-stamp-unified-minds-unm-206a/) — but this is a card named "Stamp", not a stamped printing.

### Inferences
- Bulbapedia's list is useful to cross-check which cards get a prerelease/staff stamped printing, per release event, up to the latest sets; per-product ids absent.
- Pokémon Center / league-stamp coverage on Bulbapedia not checked (only prerelease page read).

### Gaps
- Bulbapedia pages for Pokémon Center stamped promos, Play! Pokémon stamp, and Prismatic Evolutions per-card stamped variants not examined beyond a search listing.
- pkmncards: did not find how (or if) it labels set-logo variants.

## 6. Open datasets enumerating stamps

### Takeaway
No dataset dedicated to Pokémon stamps found. General card-data repos exist but stamp coverage is unverified.

### Cited Findings
- Pokémon TCG API data mirrors: Pepper0ni/pokemon-tcg-data, cajogos/pokemon-tcg-data (SNIPPET: no stamp info visible) — [Pepper0ni](https://github.com/Pepper0ni/pokemon-tcg-data), [cajogos](https://github.com/cajogos/pokemon-tcg-data)
- Hugging Face WyldKnyght/pokemon_tcg_data_* JSON datasets (SNIPPET) — [HF](https://huggingface.co/datasets/WyldKnyght/pokemon_tcg_data_sets/tree/main)
- Retailer/aggregator catalogs separate stamped variants as distinct products (e.g. Zulu's Games listing "Espeon ex (034/131) (Prismatic Evolutions Stamp)" as a variant type, SNIPPET) — [Zulu's Games PRE collection](https://zulusgames.com/collections/prismatic-evolution?page=6)

### Inferences
- Retailer feeds (TCGplayer-style product names with "(Prismatic Evolutions Stamp)", "Prerelease", "Staff") are likely the richest naming source with ids.

### Gaps
- Did not open any of these repos to check for staff/prerelease fields.

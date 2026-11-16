# TCGplayer ecosystem and aggregators as sources of stamped Pokemon TCG printing data

Legend: VERIFIED = I fetched/inspected it live on 2026-11-14 (curl of tcgcsv.com, or WebFetch of docs). INFERRED = my deduction.

## Does TCGplayer list stamped printings as separate products/groups, and how are they named?

### Takeaway
TCGplayer lists stamped printings as separate products, but only for PROMO-type printings (prerelease/staff promos, Pokemon Center exclusives, Prize Pack, Battle Academy, worlds etc.), which live in promo/misc groups. Set-logo stamped copies of regular set cards (like Lugia ex sv08.5-082) do NOT exist as separate products in the main set groups; no stamped duplicates were found in any 2020+ main-set group.

### Cited Findings (all VERIFIED from https://tcgcsv.com/tcgplayer/3/groups and /3/{groupId}/products, fetched 2026-11-14)
- Category 3 has 221 groups ([groups](https://tcgcsv.com/tcgplayer/3/groups)) - same count as TCGTracking. No group is named "prerelease", "stamp", "staff" or "Pokemon Center". There are NO "SV: Prismatic Evolutions Promos" or "Prerelease Cards" groups.
- Group names relevant 2020-26: 2585 SWSH01 base; 2545 "SWSH: Sword & Shield Promo Cards"; 22872 "SV: Scarlet & Violet Promo Cards" (280 products); 24451 "ME: Mega Evolution Promo" (152); 22880 "Prize Pack Series Cards" (891); 24529 "Player Placement Trainer Promos" (4); 24864 "Southeast Asia Exclusives" (37); 2686 "Battle Academy" (2020) and 3051 "Battle Academy 2022"; 23520 Battle Academy 2024; 2374 "Miscellaneous Cards & Products" (1537); 1539 "League & Championship Cards"; 2332 "Professor Program Promos" (League Staff etc., e.g. 717552 "Rosa's Encouragement - 084/088 [Staff]"); 2289 "Blister Exclusives"; 1938 "Alternate Art Promos"; 23561 "Trick or Trade BOOster Bundle 2024"; McDonald's groups (24938, 24163, 23306, 3150, 2782).
- Prismatic Evolutions group 23821 (398 products): only Pokemon Center ETB (593324, 600697 case, 616165 code card), Dollar General ETB (670607), Sam's Club bundle (678555), plus "(Poke Ball Pattern)" 610536-610636 and "(Master Ball Pattern)" 610637-610704 card products. No Prerelease/Staff/stamp products. Only one "Lugia ex" product in the group. ("Pattern" = holo pattern variant, not a stamp.)
- SV promo group 22872 names: "Quaquaval - 005 (Prerelease)" (487751), "Tinkaton - 020 (Prerelease) [Staff]" (512506), "Gouging Fire - 151 (Staff)" (607013), "Hop's Snorlax - 184 (Prerelease)" (623238), "Sprigatito - 191 (Pokemon Horizons Stamped)" (595036), "Paradise Resort - 224 (World Championships 2025) [Staff]" (649234). Counts of bracket tags: Prerelease 57, Staff 39, Cosmos Holo 25, Pokemon Center Exclusive 16, Illustration Contest 2024 3, World Championships 2023/24/25, Asia Championship Series 23-24. The prerelease cards here are the SVP-numbered promo cards (e.g. "005"), not stamped base-set cards. Extended data `Number`="005", Rarity "Promo".
- SWSH promo group 2545: "Rillaboom - SWSH006 (Prerelease)" (208261) and "... (Prerelease) [Staff]" (208260); "Sunflora - SWSH269 (Prerelease) [STAFF]" (451884); "Finneon - SWSH240 (Prerelease Staff)" (680245); "Professor Burnet - SWSH167 (25th Anniversary Stamp)" (247300); "Dragonite (Silver Tempest Stamped)" (547707); also "(Full Art)", "(Illustration Contest 2022)", "(World Championships 2022)".
- MEP group 24451: "Alakazam - 009 (Pokemon Center Exclusive)" (656261), "Alakazam - 003 [Staff]" (656385), "Slowbro - 083 (Pitch Black Stamped)" (706129), "Miraidon - 082 (Pitch Black Stamped)" (706135), "Dhelmise - 084 (Prerelease)" (706137), "(30th Celebration)" x18, "(World Championships 2026)", "(Asia Championship Series 24-25)".
- Prize Pack group 22880: "Grass Energy (Prize Pack Series 1)" (476138), "Teal Mask Ogerpon ex - 025/167 (Prize Pack Series 6)" (619166), "Zekrom ex - 034/086 (Left Stamp)" (671743) / "(Right Stamp)" (704471), "Bug Catching Set - 143/167 (Left Stamp)" (709703), plus 189 "(Cosmos Holo)" items. These are main-set cards reprinted with a Prize Pack series mark - the closest TCGplayer gets to "stamped main-set cards".
- Battle Academy groups: "Sizzlipede - 046/264 (#1 Cinderace Stamped)" (268077), "Charmander - 18/147 (#1 Charizard Stamped)" (219029), "(Mewtwo Stamped)".
- Pokemon Center ETB/other exclusives per set group are SEALED products only (e.g. 24831 "Delta Reign Pokemon Center Elite Trainer Box (Exclusive)" 712104; 24655 Chaos Rising 684452). Retail exclusives: "Delta Reign Single Pack Blister (Target Exclusive) [Keldeo]" (712109).
- Recent groups present (supports coverage to the present): 24831 ME06 Delta Reign (2026-11-06), 24688 ME05 Pitch Black, 24655 ME04 Chaos Rising, 24587 ME03 Perfect Order, 24541 Ascended Heroes, 24448 ME02 Phantasmal Flames, 24380 ME01, 24722 ME: 30th Celebration, 24325/24326 Black Bolt/White Flare.
- Scrape of all 2020+ main-set groups for "stamp/prerelease/staff/league" in product names found only sealed Pokemon Center boxes, "Prerelease Kit" sealed items (SM era), and unrelated trainer cards ("Unfair Stamp", "Reset Stamp", "Pokemon Center Lady"). No per-card set-logo stamp products. Duplicate collector numbers inside main sets are pattern variants (Black Bolt 061/086 etc.), not stamps.
- Name grammar observed: `{Name} - {number or number/total} ({Tag}) [{Tag2}]`, parentheses = variant/program (Prerelease, Pokemon Center Exclusive, X Stamped, Cosmos Holo, Prize Pack Series N, Left/Right Stamp, World Championships YYYY), square brackets = Staff/Winner/Participation/Top 32 or sealed-product subtype. Number may be absent (older / some promos). `cleanName` strips punctuation (e.g. "Alakazam 003 Staff"). Inconsistencies: "Cosmo Holo" vs "Cosmos Holo", "Pok�mon Center Exclusive" mojibake, "(Staff)" vs "[Staff]" vs "[STAFF]", "(Prerelease Staff)".

### Inferences
- The Cardmarket-only ids for stamped Lugia ex in TCGdex have no TCGplayer counterpart; TCGplayer treats the set-logo stamped copy (prerelease/promo-pack variants of main-set cards) as not separately listed. Stamps for main-set cards (e.g. Pokemon Center / set-logo stamped Lugia ex) therefore cannot be sourced from TCGplayer product ids.
- Only stamp-ish data usable from TCGplayer: SVP/SWSH/MEP promo prerelease/staff/PC-exclusive cards (promo numbering), Prize Pack, Battle Academy, "Pitch Black Stamped"/"Silver Tempest Stamped" promo-set cards.

### Gaps
- Whether TCGplayer SKU-level "printing" lists stamps for main-set cards (SKU data is not in TCGCSV; TCGplayer web store not inspected).
- Complete product-id lists for stamped promos in all groups; only the top names/counts above were inspected.

## TCGCSV (tcgcsv.com): coverage, format, terms

### Takeaway
TCGCSV is a free, unauthenticated daily JSON mirror of TCGplayer's catalog (all 221 Pokemon groups including promo groups), and contains the promo/prerelease/staff products that need to be parsed from names. It is the best programmatic source of TCGplayer product ids, but not for set-logo stamps on main-set cards.

### Cited Findings
- VERIFIED: updates daily ~20:00 UTC; `last-updated.txt` returned 2026-11-13T20:05:52+0000 — [tcgcsv.com](https://tcgcsv.com/), [last-updated](https://tcgcsv.com/last-updated.txt)
- VERIFIED endpoints (HTTP 200, no auth): `/tcgplayer/categories`, `/tcgplayer/3/groups` (221 groups; fields groupId, name, abbreviation, isSupplemental, publishedOn, modifiedOn, categoryId), `/tcgplayer/3/{groupId}/products`, `/tcgplayer/3/{groupId}/prices`, plus `ProductsAndPrices.csv` per group (200 OK) and archive `https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z` (200 OK, price-only archive).
- VERIFIED product object: productId, name, cleanName, imageUrl, categoryId, groupId, url (tcgplayer product URL), modifiedOn, imageCount, presaleInfo, extendedData [name/displayName/value: Number, Rarity, CardText, ...]. Prices object: productId, lowPrice, midPrice, highPrice, marketPrice, directLowPrice, subTypeName (Normal/Holofoil/Reverse Holofoil).
- Usage guidelines (docs): sync once per 24h, check last-updated.txt first, custom User-Agent required, ~100ms sleep, throttle 10 min if too fast, >10,000 req/24h may ban, no calls from user-facing apps, CORS blocks browsers, no formal ToS — [tcgcsv docs](https://tcgcsv.com/docs), [FAQ](https://tcgcsv.com/faq)
- VERIFIED: I fetched ~221 product lists with 8 parallel curl workers without issue (all succeeded).

### Inferences
- A full Pokemon sync is ~222 requests, well inside limits.
- Match to our card: group via set abbreviation/name/publishedOn -> `extendedData.Number` (normalise "134" vs "134/142"), name before " - ", tags from the parentheses/brackets. Our printing stamp mapping: "(Prerelease)" -> prerelease stamp, "[Staff]" -> staff stamp, "(Pokemon Center Exclusive)" -> PC stamp, "(X Stamped)" -> set-logo stamp for that set, "(Prize Pack Series N)" -> Play! Pokemon series mark.

### Gaps
- Did not check whether TCGTracking removes these promo groups (user says none named prerelease/stamp/staff; consistent with TCGplayer having no such groups anyway).

## Official TCGplayer API (api.tcgplayer.com)

### Takeaway
New access keys are not being granted; existing keys reportedly work. Not an option.

### Cited Findings
- Dev docs state "We are no longer granting new API access at this time"; terms give TCGplayer sole discretion — [TCGplayer docs](https://docs.tcgplayer.com/docs/getting-started), [terms](https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions) (via search summary; I did not fetch these pages directly)
- Closure date disputed: after eBay 2022 acquisition vs late 2024 — [apigraveyard](https://apigraveyard.com/tcgplayer-api/), [flipzi](https://flipzi.io/api/guides/tcgplayer-api-alternatives/) (competitors, treat cautiously).

### Inferences
- TCGCSV is effectively the public proxy for this API's data.

### Gaps
- Exact date and rate limits for existing keys not confirmed.

## Other aggregators

### Takeaway
None expose documented stamp fields I could confirm. JustTCG (free 1,000 calls/mo) and Scrydex (paid) are keyed; PriceCharting needs paid subscription. Stamp extraction would be name parsing in all cases.

### Cited Findings
- JustTCG: free $0, 1,000 calls/month, 100/day, 10/min, 20 cards/request, personal non-commercial; Starter $19 (10k/mo), Pro $49, Enterprise $149; base `https://api.justtcg.com/v1`, `x-api-key` header, endpoints /games, /sets, /cards (GET, POST batch up to 200), /v2/cards — VERIFIED from [pricing](https://justtcg.com/pricing) and [docs](https://justtcg.com/docs). Card/variant schema (tcgplayerId, printing) not read: INFERRED to include TCGplayer ids since it advertises "Identifiers"; unverified. Requires API key (account) so not tested live.
- Scrydex (successor to pokemontcg.io): Starter $29/mo 5,000 credits, Growth $99, Pro $399; no free tier/rate limits stated; Pokemon resources: cards, expansions, sealed products, listings, price history; card has `variants` list (name, images, prices) e.g. unlimitedHolofoil, firstEditionShadowlessHolofoil; no tcgplayer id or stamp field in card object docs — [pricing](https://scrydex.com/pricing), [docs](https://scrydex.com/docs), [cards](https://scrydex.com/docs/pokemon/cards).
- PriceCharting: API requires paid subscription (40-char token `t`), 1 call/sec, CSV only for Legendary tier; fields include id, `tcg-id` (trading cards), product-name, console-name; promo/stamp naming not documented — [docs](https://www.pricecharting.com/api-documentation).
- PokemonPriceTracker docs page rendered only "Loading..." (JS) — not verified. PokeData docs URL returned 404 — not verified.

### Inferences
- For any keyed service, match by set + collector number + name, then derive the stamp from the variant/product name; since they all source from TCGplayer/Cardmarket, they likely inherit the same promo-only coverage.

### Gaps
- PokemonPriceTracker, PokeData, other "Pokemon Price API" variants: no verified info on stamps, limits, ids.
- No live call to any keyed API (no credentials per constraints).
- Scrydex stamped variant naming for 2023-2026 sets unverified; worth checking its expansion/card JSON for sv08.5 Lugia ex if a key is ever available.

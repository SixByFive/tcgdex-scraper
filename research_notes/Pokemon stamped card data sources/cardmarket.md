# Cardmarket as a source of structured data on stamped Pokemon TCG printings

Legend: [VERIFIED] = I fetched/inspected it myself this session. [INFERRED] = my reasoning. Local analysis used the catalogue downloaded 2026-11-14 (createdAt 2026-11-12T15:13:35+0100, 75,695 products) and a shallow clone of tcgdex/cards-database (checked out 2026-11-14).

## Q1. Is there an expansion list (names for idExpansion) and what does the official API require?

### Takeaway
No public Cardmarket download gives expansion names. The only name source I found is TCGdex's hand-maintained `cm_expansions.ts` (name -> idExpansion). The official API 2.0 has expansion endpoints, but Cardmarket is not accepting new API applications, and the API docs pages returned HTTP 410 to my fetcher.

### Cited Findings
- [VERIFIED] Catalogue JSON `products_singles_6.json` returns 200. Top-level keys are `version`, `createdAt`, `products`. Product fields are idProduct, name, idCategory, categoryName, idExpansion, idMetacard, dateAdded; there is no stamp, version or expansion-name field. Older products have dateAdded `0000-00-00 00:00:00`. — https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json
- [VERIFIED] `products_nonsingles_6.json` returns 200 and `price_guide_6.json` returns 200 (price guide has idProduct, idCategory, avg/low/trend/avg1/avg7/avg30 plus -holo variants; no stamp or name field). Guessed filenames `productList/expansions_6.json` and `expansionList/expansions_6.json` returned 403, so I found no public expansion file. — https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json , https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json
- [VERIFIED] TCGdex maintains `scripts/utils-data/cm_expansions.ts`, a Map of Cardmarket expansion name -> idExpansion (about 700 lines). It maps 5944 = "Prismatic Evolutions" and 6009 = "Prismatic Evolutions: Additionals". Other Additionals expansions include 6455 Ascended Heroes: Additionals, 6290 Mega Evolution: Additionals, 6300 Phantasmal Flames: Additionals, 6140 Destined Rivals: Additionals, 6088 Journey Together: Additionals, 6197 Black Bolt: Additionals, 6198 White Flare: Additionals, 6409 MEGA Dream ex: Additionals, 6220 Terastal Festival ex: Additionals. Promo expansions: 5241 SV Black Star Promos, 2916 SWSH Black Star Promos, 6232 MEP Black Star Promos, 5212 Scarlet & Violet Promos, 3214 Sword & Shield Promos, 6230 M-P Promos. — https://github.com/tcgdex/cards-database/blob/master/scripts/utils-data/cm_expansions.ts
- [VERIFIED] Cardmarket's help page says it is "not accepting applications for access to the Cardmarket API"; credentials must not be shared with third-party apps; no rate limits or detailed API terms are given there. — https://help.cardmarket.com/en/cardmarket-api
- [VERIFIED via search snippet only] API 2.0 docs list Expansions and Expansion Singles endpoints; the Price Guide endpoint is restricted to widget/3rd-party/dedicated apps of powersellers/professionals; the old Product List (File) endpoint is deprecated. The API doc pages themselves returned HTTP 410 Gone to my fetch, so field lists were not inspected. — https://api.cardmarket.com/ws/documentation/API_2.0:Market_Place_Information , https://api.cardmarket.com/ws/documentation/API_2.0:PriceGuide
- [Unverified, third-party] A PHP SDK page claims the API host moves to apiv2.cardmarket.com and old host is disabled by 2026-05-01. — https://packagist.org/packages/pisko999/cardmarket-php-sdk
- Cardmarket news says price guide and product catalog downloads are available to all logged-in users and were split into separate pages. — https://news.cardmarket.com/en/FoW/adding-non-singles-and-accessories-to-the-price-guide

### Inferences
- A new developer cannot realistically get API access now; the practical expansion-name source is TCGdex's map (or scraping expansion pages, which returned 403 to a plain fetch: https://www.cardmarket.com/en/Pokemon/Expansions/Prismatic-Evolutions).
- Rate limits and OAuth app types (dedicated/widget/3rd party) could not be confirmed from primary docs.

### Gaps
- API 2.0 field list for Expansions/Product (is there a "version" field?) - docs 410. Rate limits - not found. Whether the catalogue downloads require login (the S3 URLs were open to plain curl) - not stated anywhere I could fetch.

## Q2. How do stamped products look on Cardmarket pages/UI; is there a version or stamp attribute?

### Takeaway
In the catalogue there is no stamp/version attribute and names are not disambiguated; stamped printings are separate idProducts with the same name as the base card. I could not load the website (403), so UI labels like "(V.2)" are not verified.

### Cited Findings
- [VERIFIED] Lugia ex [Hyper Whirlpool] (idMetacard 443324) has 8 products: 801340 (idExp 5927 Generations Start Decks, 2024-11-21), 805474 (5944 Prismatic Evolutions, 2025-01-09), 841280 and 841281 (6009 Additionals, 2025-08-05, 17:29 and 17:30), 867085 (6416 Blade Awakening), 868293 and 868296 (6009, 2026-01-26, 14:02 and 14:04), 898303 (6634). All names are identical. — local analysis of catalogue above
- [VERIFIED] Name text in catalogue is "Card [Attack | Attack]" with no stamp words. Of 326 names matching Stamp/Staff/V.n/Prerelease, all are attack names (e.g. "Tyranitar [Dark Aura | Stamp]"), none are stamp labels. — catalogue
- [VERIFIED] TCGdex's Lugia ex (PRE 082) lists 805474 as holo, and 841280 (normal, set-logo), 841281 (normal, jumbo, set-logo), 868293 (holo, set-logo), 868296 (holo, set-logo, jumbo). So TCGdex confirms the 4 stamped ids and encodes size/foil by hand. — https://github.com/tcgdex/cards-database/blob/master/data/Scarlet%20%26%20Violet/Prismatic%20Evolutions/082.ts

### Inferences
- Cardmarket's website presumably shows version labels like "(V.2)" for same-name products in one expansion, but I could not verify this; website returned 403 to automated fetch.

### Gaps
- Website product-page HTML (version field, stamp text) not inspected. No source found describing "V.2" labeling.

## Q3. Does the price guide / catalogue distinguish stamped versions?

### Takeaway
No. The only distinguishing signals are idExpansion, dateAdded, idProduct order and the shared idMetacard.

### Cited Findings
- [VERIFIED] Price guide record fields: idProduct, idCategory, avg, low, trend, avg1, avg7, avg30 and -holo twins (the -holo columns relate to foil prices, not stamp). — price_guide_6.json URL above
- [VERIFIED] Expansion 6009 (Prismatic Evolutions: Additionals) has 243 products, 123 distinct idMetacard. 211 were added 2025-01 (mostly pairs of identical names, e.g. Exeggcute [Ram] x2 - consistent with Poke Ball/Master Ball reverse foils, since TCGdex lists PRE Regigigas reverse pokeball as 806532 - [INFERRED] pairing), plus 11 "Live Code Card" items, plus later additions (2025-08 x8, 2025-11 x8 Eeveelution items, 2026-01 the 2 jumbo/holo Lugia). — catalogue + TCGdex 086.ts
- [VERIFIED] Same pattern in Obsidian Flames (270 products): base card and later-added duplicate, e.g. Rowlet [Razor Wing] 725093 (2023-07-31) vs 789503 (2024-09-18). TCGdex tags such later items as snowflake etc.

## Q4. Community datasets mapping Cardmarket ids to stamps; how TCGdex does it

### Takeaway
TCGdex is the only dataset I found that carries per-variant Cardmarket ids with a `stamp` array; ids are linked by script (name prefix + expansion) and stamps/size/foil are curated manually. pokemontcg.io, tcgcollector, Scrydex were not checked.

### Cited Findings
- [VERIFIED] `scripts/loadCardMarket.ts` downloads products_singles_6.json; `scripts/linkCardToCardmarket.ts` assigns `thirdParty.cardmarket` by `product.name.startsWith(cardName) && idExpansion === set.thirdParty.cardmarket` (first match only), so it cannot find stamped duplicates by itself. — https://github.com/tcgdex/cards-database/tree/master/scripts
- [VERIFIED] interfaces.d.ts: `VariantStamps` is a large union (set-logo, staff, pre-release, pokemon-center, snowflake, 30th-pokeday, player-rewards-program, ace-trainer, gamestop, eb-games, trick-or-trade etc.); `stamp?: Array<VariantStamps>` per variant with `size`, `foil`, `thirdParty`. — https://github.com/tcgdex/cards-database/blob/master/interfaces.d.ts
- [VERIFIED] I parsed TCGdex SWSH/SV/ME variants having stamp + cardmarket id and looked up the product's expansion in the catalogue. Results (stamp: counts by Cardmarket expansion): set-logo 207 (SWSH Black Star Promos 49, SV Black Star Promos 36, MEP Black Star Promos 20, PRE Additionals 16, Stellar Crown 11...); set-logo+staff 55 (SV/MEP promos, Destined Rivals: Additionals 3); snowflake 30 (spread over the main set, e.g. Paldea Evolved, Evolving Skies, Journey Together: Additionals, Prismatic Evolutions: Additionals); pokemon-center 28 (SV Black Star Promos 19, MEP Black Star Promos 8, 151 1); pre-release (Obsidian Flames 3, main set); 30th-pokeday (Mega Evolution: Additionals, Prismatic Evolutions: Additionals); gamestop/eb-games (Additionals plus unnamed 6516/6518); trick-or-trade (Trick or Trade 2024, Mega Evolution: Additionals); player-rewards-program (Play! Pokemon Prize Pack Series expansions and 6616). — local analysis of tcgdex clone vs catalogue

### Inferences
- Stamped products appear in at least four kinds of Cardmarket expansion: the main set (prerelease, snowflake), "<Set>: Additionals", promo sets (Black Star, MEP), and dedicated product sets (Prize Pack Series, Trick or Trade). So idExpansion alone does NOT identify a stamp.

### Gaps
- pokemontcg.io, tcgcollector, Scrydex, other GitHub repos mapping CM ids to stamps: not investigated (tool budget). 

## Q5. Can the stamp be inferred reliably from idExpansion + dateAdded + siblings?

### Takeaway
Partially. It reliably detects "this idProduct is a non-base duplicate of a card" but cannot name the stamp; naming needs an external source (TCGdex, Bulbapedia, TCGplayer product names).

### Cited Findings (tested on Lugia)
- [VERIFIED] Grouping by idMetacard + name yields Lugia siblings; the base one is the earliest in the card's own set expansion (805474 in 5944). Four extras in the sibling "Additionals" expansion 6009 correspond exactly to TCGdex's four set-logo ids. Sub-structure: sorted by idProduct, the 2025-08-05 pair (841280, 841281) and the 2026-01-26 pair (868293, 868296) are consecutive; TCGdex maps the first of each pair to standard and the second to jumbo, and first pair = normal, second pair = holo. [Pattern holds for this card only; verified against TCGdex data, not Cardmarket's site.]

### Inferences
- Method: (1) map idExpansion to names via cm_expansions; (2) pair main expansion with its "Additionals" expansion; (3) group by (name, idMetacard); (4) within a group, the base is the product in the main set; extras in Additionals, promo sets or later-added duplicates are candidate stamped/foil variants; (5) cluster extras by dateAdded batch and idProduct adjacency; (6) assign stamp names from an external reference. Ambiguity: Additionals also holds Poke Ball/Master Ball reverse foils (non-stamps), so a duplicate does not imply a stamp. Treat output as candidates for manual review.

### Gaps
- No tests on Pokemon Center, prerelease or staff sets beyond the aggregate counts above.

## Q6. Legal / ToS

### Takeaway
I found no explicit license for the catalogue downloads; the API route is closed to new applicants; scraping the website is the highest-risk route (and returned 403 to my fetch). Verify Cardmarket's Terms before reuse.

### Cited Findings
- [VERIFIED] API credentials must not be shared with third-party apps; Cardmarket may revoke access. — https://help.cardmarket.com/en/cardmarket-api
- Third-party services relay Cardmarket price data "with attribution" from the public Price Guide, per tcgindex.io terms (secondhand). — https://tcgindex.io/terms
- TCGdex itself (an open-source project) downloads and uses the catalogue JSON in its public scripts, so there is precedent for using the download for id linkage. — https://github.com/tcgdex/cards-database/blob/master/scripts/loadCardMarket.ts

### Gaps
- Cardmarket's general Terms and Conditions text on automated access / data reuse were not fetched. No statement of catalogue license found.

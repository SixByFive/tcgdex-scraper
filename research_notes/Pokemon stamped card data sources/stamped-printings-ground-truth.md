# Stamped / promo-stamped Pokémon TCG printings, 2020-2026 (ground truth for measuring data sources)

Method note: Bulbapedia (all variants, incl. mobile and MediaWiki API), Pokebeach, CardTrader and TCGplayer pages returned HTTP 403 or Cloudflare challenges to my fetch tooling. I could only read their WebSearch snippets. The only full-coverage data I could read was the TCGdex API, which I scanned programmatically (every card of every swsh/sv/me set, on 2026-11-14). TCGdex is therefore a *yardstick but not independent ground truth*: it is the thing being measured, and it also under-covers. Everything marked VERIFIED-TCGDEX means "TCGdex says so"; it does not mean the printing exists or that TCGdex is complete. Independent confirmation is cited where I found it.

## 1. Which stamped printings exist, per set (what TCGdex currently carries, plus independent evidence)

### Takeaway
Stamped printings are numerous but mostly concentrated in a few buckets: (a) set-logo / "prerelease" stamped reprints of 1 to ~16 cards per main set, (b) retail-exclusive stamps (GameStop/EB Games) on 1 card per set, (c) Play! Pokémon Player Rewards / Gym Challenge / league-ball / Professor-program stamps on 10 to 30+ cards in recent sets, and (d) tournament-placement and Pokémon Center stamps living in the SVP/MEP/SWSHP promo sets. TCGdex has per-card variants for these, but its per-set coverage is uneven (e.g. zero stamps on ME05, ME06, Crown Zenith, Shining Fates, Evolving-era Trainer Galleries).

### Cited Findings

**TCGdex per-set stamp counts (number of cards that carry >=1 stamped variant; scan of 2026-11-14).** Source: [TCGdex API](https://api.tcgdex.net/v2/en/sets/sv08.5) (per-set scan; reproducible with `/v2/en/series/{swsh|sv|me}` then `/cards/{id}`):

Sword & Shield
- swsh2 Rebel Clash: gamestop 1, eb-games 1, snowflake 1, set-logo 2, regional-championships 2, staff 1, poke-ball-league 1
- swsh3 Darkness Ablaze: thank-you 3, player-rewards-program 2, set-logo 1
- swsh4 Vivid Voltage: set-logo 2, staff 1
- swsh5 Battle Styles: gamestop 1, eb-games 1
- swsh6 Chilling Reign: snowflake 4
- swsh7 Evolving Skies: player-rewards-program 4, snowflake 3
- swsh8 Fusion Strike: snowflake 1, national-championships 2, staff 1
- swsh9 Brilliant Stars: set-logo 1, regional-championships 1
- swsh10 Astral Radiance: set-logo 2, snowflake 1, regional-championships 1
- swsh10.5 Pokémon GO: player-rewards-program 1 plus 4 named-player stamps (jesse-parker, gabriel-fernandez, shao-tong-yen, sakuya-ota); also 3 "peelable-ditto" subtype variants
- swsh11 Lost Origin: snowflake 1, set-logo 1, gamestop 1, eb-games 1
- swsh12 Silver Tempest: snowflake 2, set-logo 1, gamestop 1, eb-games 1
- swsh12.5 Crown Zenith, swsh3.5 Champion's Path, swsh4.5 Shining Fates, swsh1 Sword & Shield: ZERO stamped variants in TCGdex
- swshp (SWSH Black Star Promos, 307 cards): set-logo 93, staff 45, 25th-celebration 23, worlds-2022 8, player-rewards-program 6, illustration-contest-2022 3, plus single-card eb-games/gamestop/snowflake/professor-program, named players, champion/finalist/semi/quarter/top-16/top-32
- cel25cc Celebrations Classic Collection: 25th-celebration 2

Scarlet & Violet
- sv02 Paldea Evolved: snowflake 5, set-logo 2, horizons 1, rain-city 1, trick-or-trade 1, gamestop 1, asia-promo 1
- sv03 Obsidian Flames: pre-release 3 (Palafin 062, Toxtricity 072, Togekiss 085), set-logo 3 (Espeon 086; Umbreon 130 reverse), trick-or-trade 5, player-rewards-program 10, gym-challenge 3, snowflake 1 (Eiscue ex), eb-games 1, gamestop 1 (Umbreon 130), asia-promo 1, regional-championships 1, worlds-2024 1
- sv03.5 151: set-logo 1 (Bulbasaur 001), gamestop 1 + eb-games 1 (Charmander 004), pokemon-center 1 (Squirtle 007), pokemon-together 2 + snowflake 2 (Pikachu 025, Eevee 133)
- sv04 Paradox Rift: set-logo 3, snowflake 3, gamestop 1, eb-games 1
- sv04.5 Paldean Fates: pokemon-day 1 (Ceruledge 040)
- sv05 Temporal Forces: set-logo 8, player-rewards-program 24, international-championship (EU/LATAM/NA) x [plain, champion, top-eight, staff] on Buddy-Buddy Poffin 144, gym-challenge 1, master-ball-league 2 (incl. judge), regional-championships 2, professor-program 1, pokemon-day 1 (Pikachu 051), gamestop 1 (Koraidon 119 reverse), eb-games 1
- sv06 Twilight Masquerade: set-logo 5, gamestop 1, eb-games 1, snowflake 1
- sv06.5 Shrouded Fable: set-logo 1 (Kingdra ex 012)
- sv07 Stellar Crown: set-logo 11, gamestop 1, eb-games 1 (Archaludon 107), snowflake 1 (Crabominable 149)
- sv08 Surging Sparks: player-rewards-program 14, set-logo 7, horizons 3, gym-challenge 3, snowflake 1
- sv08.5 Prismatic Evolutions: set-logo 16 cards (Leafeon ex 006, Flareon ex 014, Vaporeon ex 023, Glaceon ex 026, Jolteon ex 030, Espeon ex 034, Sylveon ex 041, Lucario ex 051, Umbreon ex 060, Tyranitar ex 064, Eevee ex 075, Snorlax ex 076, Lugia ex 082 x4), snowflake 1 (Glaceon ex 026), 30th-pokeday 1 (Sylveon 040)
- sv09 Journey Together: set-logo 11, player-rewards-program 26, snowflake 1 (Articuno 032), gamestop 1 / eb-games 1 (Hop's Snorlax 117), gym-challenge 2, regional-championships 2, staff 1, master-ball-league 1, ultra-ball-league 1
- sv10 Destined Rivals: set-logo 12 (Team Rocket's Moltres ex 031/208/229, Ethan's Typhlosion 034, Misty's Gyarados 049, TR Articuno 051, TR Zapdos 070, TR Mimikyu 087, TR Tyranitar 096), staff 4 (034, 049, 087, 096), eb-games 1 (TR Zapdos 070); NO gamestop entry (possible gap)
- sv10.5b Black Bolt: set-logo 2, player-rewards-program 8, gym-challenge 3, ultra-ball-league 1, great-ball-league 1, liao-fu-guan 3, jose-cruz-galindo-resendiz 1, professor-program 1
- sv10.5w White Flare: set-logo 2 (Reshiram ex 020, Zoroark 062), fossil-museum 1 (Archeops 051)
- sve Scarlet & Violet Energy: player-rewards-program 32, professor-program 16
- svp (SVP Black Star Promos, 226 cards): set-logo 75, staff 39, pokemon-center 19, worlds-2023 7, worlds-2024 8, worlds-2025 8, player-rewards-program 5, top-8/16/32, semi-finalist, finalist 3 each, horizons 3, illustration-contest-2024 3, professor-program 3, asia-2023-24 1, winner 1
- sv01 Scarlet & Violet base, sv06.5 aside, ZERO stamped variants on sv01.

Mega Evolution
- me01 Mega Evolution: 30th-pokeday 1 (Bulbasaur 001 reverse), set-logo 3 (Xerneas 064, Yveltal 088, Bulbasaur 133), gamestop 1 + eb-games 1 (Yveltal 088), trick-or-trade 1 (Spiritomb 087), regional-championships 2, staff 1, ultra-ball-league 1, player-rewards-program 31 (normal and holo variants)
- me02 Phantasmal Flames: set-logo 2 (Genesect 008, Reshiram 017), gamestop 1 + eb-games 1 (Suicune 026)
- me02.5 Ascended Heroes: player-rewards-program 9 only
- me03 Perfect Order: player-rewards-program 18, set-logo 2 (Aurorus 024, Luxray 028), gamestop 1 + eb-games 1 (Gengar 050), regional-championships 2, staff 1
- me04 Chaos Rising: gamestop 1, eb-games 1, set-logo 2
- me05 Pitch Black, me06 Delta Reign: ZERO stamped variants in TCGdex (me06 appears very recent and may simply be uncatalogued)
- mep MEP Black Star Promos (112): set-logo 36, staff 21 (almost all as ['set-logo','staff'] combos), pokemon-center 8 (Alakazam 009, Riolu 010, Charcadet 022, N's Zekrom 031, Tyrunt 070, Fennekin 080, Zarude 088, Nidorina 101), ace-trainer 2, winner 1
- mee Mega Evolution Energy: 30th-anniversary 8; 30th (30th Celebration): 30th-anniversary 158 of 161; 30th-c: 30

**Independent corroboration (web, mostly snippets):**
- Prerelease cards are reprints of a selected card with a "PRERELEASE" stamp or the expansion logo; from HeartGold & SoulSilver on they carry the expansion logo instead of the word PRERELEASE — [Bulbapedia Prerelease cards (via search snippet)](https://bulbapedia.bulbagarden.net/wiki/Prerelease_cards_(TCG)). Starting Fates Collide there are four prerelease cards per set (kits) plus four STAFF versions for organizers (same snippet source).
- STAFF prerelease promos were paused from Battle Styles (Mar 2021) and returned with Silver Tempest (Nov 2022), so seven sets (Battle Styles through Lost Origin) have no staff promos — [PokeGuardian](https://www.pokeguardian.com/563244_staff-prerelease-promos-have-been-temporarily-paused) via search summary. Consistent with TCGdex: swsh5/6/7/9/10/11 show no staff stamps on set cards.
- Prismatic Evolutions stamps per Bulbapedia (via snippet): "Prismatic Evolutions" stamp on Surprise Box exclusives Leafeon ex (006), Glaceon ex (026), Flareon ex (014), Eevee ex (075), Sylveon ex 041 and on Premium/Special Collection cards (Lucario ex, Tyranitar ex, Lugia ex, Snorlax ex); Two-Pack Blister Eevee carries a "Pokémon Day 2025" stamp; snowflake stamp on Holiday Calendar 2025 exclusives (Glaceon ex 026 PRE, Articuno 032 JTT) — [Bulbapedia PRE](https://bulbapedia.bulbagarden.net/wiki/Prismatic_Evolutions_(TCG)), [Bulbapedia JTT](https://bulbapedia.bulbagarden.net/wiki/Journey_Together_(TCG)). A retail listing sells a "complete set of 9" PRE stamped promos — [Solesavy](https://store.solesavy.com/products/2025-pokemon-pre-en-prismatic-evolutions-stamped-promo-cards-complete-set-of-9-ungraded-card). Note: 9 per that listing vs 16 set-logo cards in TCGdex; TCGdex likely includes box-topper and collection stamps (Surprise Box / Premium Collection / Special Collection) beyond the 9; unresolved.
- Mega Evolution Pokémon Center ETBs: the Pokémon Center edition added a full-art foil Riolu or Alakazam promo with a Pokémon Center logo stamp (Alakazam = MEP009, Riolu = MEP010) plus extra packs — [Bulbapedia ME merchandise (snippet)](https://bulbapedia.bulbagarden.net/wiki/Mega_Evolution_TCG_Series_merchandise), [Core TCG](https://coretcg.com/Products/203688/3/24451/Riolu---010---Mega-Evolution-Pokemon-Center-Elite-Trainer-Box-Promo). Matches TCGdex mep 009/010.
- Pokémon Center stamp on 151 Squirtle 007 reverse holo (preorder promo) — [PokeCardValues](https://pokecardvalues.co.uk/cards/Squirtle-007-165-Reverse-Holo-Pokemon-Center-Stamp-151/sv3pt5-007-3-103/). Matches TCGdex sv03.5 007.
- Pokémon Day 2025: Eevee (in PRE blister) and a League-exclusive holo Sylveon with Pokémon Day stamp — [Pokebeach via search snippet](https://www.pokebeach.com/?p=299739), [Destructoid](https://destructoid.com/all-pokemon-day-2025-promo-cards-and-how-to-get-them). Pokémon Day 2026: League promo reverse-holo Bulbasaur (ME 001/132) with Pokémon Day 2026 / 30th anniversary stamp, given at Leagues on 2026-02-27 — [PokeGuardian](https://www.pokeguardian.com/2995052_pokemon-day-2026-pokemon-day-event-held-at-pokemon-leagues-special-pokemon-day-bulbasaur-promo-distributed). A Pokémon Day 2026 Collection holds a Pikachu with Pokémon Day stamp — same search results. TCGdex has the Bulbasaur 001 as '30th-pokeday' on me01 and Sylveon 040 as '30th-pokeday' on sv08.5: this is TCGdex's naming for what the Pokémon Day stamps are; note the 2025 Sylveon predates the 30th anniversary year, so the label '30th-pokeday' on a 2025 card is likely a TCGdex naming quirk (INFERRED).
- Phantasmal Flames prerelease/Build & Battle promos: stamped Ceruledge, Zacian, Flygon, Toxtricity (MEP 014-017); staff sets exist — [Dittobase](https://www.dittobase.com/tcg/events/phantasmal-flames-prerelease), [Core TCG Ceruledge listing](https://coretcg.com/Products/203667/3/24451/Ceruledge---014---Stamped-Pre-Release-Promo). Matches TCGdex mep 014-017 set-logo and set-logo+staff.
- Stellar Crown and Twilight Masquerade prerelease promos are stamped SVP 115-118 and SVP 133-136 (4 each) — eBay listings via search ([eBay.de](https://www.ebay.de/itm/227050568570)). So prerelease promos in SV mostly live in SVP/MEP numbering with a set-logo stamp, not in the main set.
- Winner stamp used for 2025 Worlds Celebration cards (Aug 2025), Gym-stamped Present Pack exclusives in MY/SG/PH — [Bulbapedia via search snippet](https://bulbapedia.bulbagarden.net/wiki/Winner_cards_(TCG)).

### Inferences
- Order of magnitude: typical modern main set has ~5 to 25 stamped printings in the marketplaces (4 prerelease + 4 staff + 1-2 retail + a few set-logo box promos; plus 10-30 Player Rewards/League variants on trainer/item cards), i.e. ~5-12% of card count in recent sets. Mega-era promo sets MEP/SVP have ~60-100 stamped variants each (about half of their entries).
- TCGdex's `set-logo` is a catch-all: prerelease stamps in the HGSS-and-later "expansion logo" style are labeled `set-logo` by TCGdex, and `pre-release` is only used where the stamp literally says "Prerelease" (sv03 Obsidian Flames in this data). A marketplace that names such cards "(Prerelease)" will not match TCGdex's `set-logo` by name alone.
- The `staff` stamp in TCGdex is typically combined with `set-logo` on the same variant (['set-logo','staff']), while some old-style singletons are `['staff']` only.

### Gaps
- I could not open Bulbapedia, TCGplayer, CardTrader, Pokébeach or Serebii page bodies, so per-set official card lists (e.g. exactly which 9 PRE stamped promos, exact Prerelease kit cards for me03/me04/me05/me06, SV prerelease card lists) are not independently confirmed. Needs a browser-based fetch or a different network path.
- ME05 Pitch Black and ME06 Delta Reign have zero stamps in TCGdex; I did not confirm whether prerelease, GameStop or Pokémon Center stamped cards exist for them (very likely they do, INFERRED from the pattern).
- sv10 Destined Rivals has no GameStop stamp in TCGdex despite GameStop appearing for most neighboring sets; may be a real gap or GameStop's US retail program ending (unverified).

## 2. Marketplace identification (name suffixes, expansions)

### Takeaway
I could only find confirming evidence for CardTrader ("Prerelease Promos" / "Retail Exclusive Promos" expansions, "(Pre-Release Stamped)" suffix) and generic retailer wording ("Stamped Pre-Release Promo", "Pokemon Center Stamp"). I did NOT obtain direct evidence for TCGplayer "(Prerelease)"/"(Staff)" names or Cardmarket "(V.2)" conventions; treat those as unverified.

### Cited Findings
- CardTrader has separate Pokémon expansions "Prerelease Promos" and "Retail Exclusive Promos"; a card is titled like "AncientKazemon(Pre-Release Stamped)" — [CardTrader Prerelease Promos](https://www.cardtrader.com/en/games/pokemon/expansions/prerelease-promos-93ef3ad1-7c41-41ce-979f-4382e93f6035/categories), [CardTrader Retail Exclusive Promos](https://www.cardtrader.com/en/games/pokemon/expansions/retail-exclusive-promos/categories), [card example](https://www.cardtrader.com/en/cards/306822) (the example shown is Digimon; Pokémon naming is parallel; per search snippet).
- Retailer titles use "Stamped Pre-Release Promo" (e.g. "Ceruledge - 014 - Stamped Pre-Release Promo") and "Pokemon Center Stamp" (e.g. "Squirtle 007 Pokemon Center Stamp - 151 Pre-Order Promo") — [Core TCG](https://coretcg.com/Products/203667/3/24451/Ceruledge---014---Stamped-Pre-Release-Promo), [PokeCardValues](https://pokecardvalues.co.uk/cards/Squirtle-007-165-Reverse-Holo-Pokemon-Center-Stamp-151/sv3pt5-007-3-103/). PokeCardValues also names Mega Evolution Bulbasaur 133 as "holo mega evolution stamp" (a box-topper stamp).
- TCGdex itself links variants to marketplace ids: for variants that share a card but differ by stamp, `thirdParty.cardmarket` carries a distinct product id per stamped variant (e.g. PRE Glaceon ex 026: normal 805415, set-logo 810425, snowflake 845410) while stamped variants often have `tcgplayer: null` — [TCGdex PRE 026](https://api.tcgdex.net/v2/en/cards/sv08.5-026). So at least on Cardmarket stamped variants are separate product ids; TCGplayer coverage is the weaker side for stamped variants.
- Poké Ball / Master Ball patterns are NOT stamps: TCGdex PRE 001 lists 4 variants: Normal, Reverse, "Pokéball foil" (reverse type, variantId ...) and "Master Ball foil" (reverse type), with separate TCGplayer holofoil prices — [TCGdex PRE 001](https://api.tcgdex.net/v2/en/cards/sv08.5-001). In TCGdex these appear in `variants_detailed` with type `reverse` and no `stamp`, so a stamp-only filter will not count them; however they may be distinguished by `subtype` in some sets (the scan found `subtype` only for swsh10.5 'peelable-ditto' and mfb).

### Inferences
- Because stamped variants are separate Cardmarket product ids with `tcgplayer:null`, the likely loss pattern when a source lacks them is "missing variants on the Cardmarket side first, TCGplayer side almost entirely".
- The 'Poké Ball/Master Ball' foil is a foil pattern on a regular-set card (SV8.5 onward: PRE, Black Bolt/White Flare, etc.) and is orders of magnitude more numerous than stamps (every non-rare card gets a Poké Ball reverse variant in those sets). Keep it out of stamp counts.

### Gaps
- No direct confirmation of TCGplayer "(Prerelease)"/"(Staff)" product suffix or Cardmarket "<Set>: Promos"/"(V.2)" conventions; both searches failed to surface those pages. Tell the engineer to check by querying their own TCGplayer/Cardmarket dumps for those substrings.

## 3. Target-schema stamps vs. real printings in 2020-2026

### Takeaway
Nearly every stamp in the target list has at least one real printing 2020-2026 per TCGdex; weakest: `toys-r-us` (none in these eras in TCGdex, TRU closed 2018; stores briefly reopened 2021+ only as Macy's/Geoffrey shop-in-shops and no TRU stamped Pokémon TCG promos found), `build-a-bear` (none found), `pokemon-center` (rare: only ~28 cards: svp 19, mep 8, sv03.5 1), `professor-program` (small), and named-player stamps.

### Cited Findings (TCGdex presence 2020-2026, counts of cards)
- set-logo: yes, very common (swsh/sv/me) — [TCGdex](https://api.tcgdex.net/v2/en/cards/sv08.5-026)
- pre-release: only 3 cards in TCGdex (sv03 Obsidian Flames); all other prerelease promos are labeled set-logo (see section 1)
- pokemon-center: 28 (svp 19, mep 8, sv03.5 1). No Pokémon Center stamps found in swsh sets
- staff: swshp 45, svp 39, mep 21 plus main-set staff on swsh2/4/8, sv05, sv09, sv10, me01, me03
- snowflake: yes (swsh2, 6, 7, 8, 10, 11, 12; sv02, 03, 03.5, 04, 06, 07, 08, 08.5, 09)
- 30th-pokeday: 2 (sv08.5 Sylveon 040; me01 Bulbasaur 001). Also `30th-anniversary` (mee 8, 30th 158, 30th-c 30) which is a separate stamp from the Pokémon Day one
- pokemon-day: 3 (sv04.5 Ceruledge, sv05 Pikachu 051; sv08.5 per Bulbapedia snippet). Note: the schema list given does not contain 'pokemon-day' — add it if absent
- player-rewards-program / professor-program: yes (many, sve, sv05, sv08, sv09, me01, me03, ...)
- gamestop / eb-games: yes, 1 card per main set from swsh2 to me04 (gamestop missing for sv10); retail exclusive reverse/holo of one card
- worlds-2022 (swshp 8), worlds-2023 (svp 7), worlds-2024 (svp 8 + sv03 Town Store 196), worlds-2025 (svp 8): all exist
- poke-ball-league: 1 (swsh2); great-ball-league 1 (sv10.5b Air Balloon); ultra-ball-league 3 (sv09 149, sv10.5b 034, me01 132); master-ball-league 3 (sv05 144 x2, sv09 098): exist but tiny counts (these are Play! Pokémon League season stamps)
- toys-r-us, build-a-bear: 0 occurrences in any 2020-2026 set in TCGdex; I found no evidence of Pokémon TCG stamped printings for either in these eras
- Costco/Target/Walmart: stamped exclusives are generally not stamps but retail-exclusive box promos; TCGdex has no stamp for them (0 hits). No evidence found of stamps on those.

### Inferences
- `toys-r-us` and `build-a-bear` are likely schema stamps that "never existed in these eras" (flag as legacy/placeholder). Not verified from an official source, absence of evidence only.
- Stamps like horizons, rain-city, trick-or-trade, asia-promo, liao-fu-guan, fossil-museum, thank-you, gym-challenge etc. exist in TCGdex but are not in the user's listed schema; the user's schema may already include them (list ended with "...").

### Gaps
- No authoritative list of Toys R Us / Build-A-Bear Pokémon TCG stamp history found; confirm with an authoritative Bulbapedia read.
- Costco/Target/Walmart stamp claims not found in any source.

## 4. Rough magnitude of loss if a source lacks stamped printings

### Takeaway
Roughly 10 to 25 stamped variants per main set (about 5-10% of card count) and 60 to 150 per promo set; sets with the most are TCGdex-curated (sv08.5 ~18, sv05 ~60+ counting league/champion permutations, me01 ~50, svp ~230 stamped variants among 226 cards, mep ~70 among 112).

### Cited Findings
- Derived directly from the TCGdex scan in section 1 ([TCGdex](https://api.tcgdex.net/v2/en/sets/sv08.5)). Example: sv08.5 has 18 stamped variant rows on 16 cards; sv10 has 14 rows (7 set-logo + 4 staff + ...); sv09 has ~50 rows; mep 70+ rows on 112 cards.

### Inferences
- Any source that only models normal/holo/reverse loses all of the above; that is about 5% of rows in main sets and about 50% of rows in promo sets (SVP/MEP/SWSHP), where stamps are the dominant variation.

### Gaps
- TCGdex totals are a floor, not the true count: e.g. PRE stamped retail lot "set of 9" doesn't reconcile with 16 TCGdex cards; ME05/ME06 stamps absent; sv10 gamestop absent.

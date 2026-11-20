import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { ScrapedCard } from '../types/scraped.ts'
import { buildVariants, nameKey } from '../emit/variants.ts'
import { fetchCardExtras } from './tcgdex-cards.ts'
import { buildSetMeta } from './set-meta.ts'
import { defaultRepo, listSets, loadSchema } from '../util/experimental.ts'
import { fetchCards } from '../util/tcgtracking-open.ts'
import { cardKey, collectorKey, tcgdexLocalId } from '../emit/normalise.ts'
import { mergeTcgdexVariants, type ProductIds } from '../emit/tcgdex-variants.ts'
import { applyPrizePack, loadPrizePackIndex } from './tcgcsv.ts'

// curly and straight apostrophes/quotes and case differ between sources for the same card
import { sameCardName } from '../emit/names.ts'
const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-/g, ' ').replace(/ +/g, ' ').toLowerCase().trim()

export interface EnrichScrapedOptions {
	setId: string
	repo?: string
	/** TCGplayer group id; found from the set file, or by name, when omitted */
	tcgplayerSet?: number
	noVariants?: boolean
	noTcgdex?: boolean
	/** don't add the variants TCGdex lists that TCGTracking lacks */
	noTcgdexVariants?: boolean
	/** don't add the Prize Pack reprints' TCGplayer ids from TCGCSV */
	noTcgcsv?: boolean
	log?: (line: string) => void
}

/**
 * Adds the lookups that don't come from pokemon.com to each scraped card of a set, so that `emit-experimental` only has
 * to write files:
 *   - `variants`: one per finish/stamp TCGTracking lists, with Cardmarket, TCGplayer and CardTrader ids
 *   - `tcgdex`: flavor text per language and the regulation mark, from the TCGdex API (always fetched fresh)
 * Safe to run again later: TCGTracking and TCGdex fill in new sets over the first weeks.
 */
export async function enrichScrapedSet(opts: EnrichScrapedOptions): Promise<void> {
	const log = opts.log ?? console.log
	const warn = (m: string) => log(`[enrich] warning: ${m}`)
	const repo = opts.repo ?? defaultRepo

	const dir = join(config.cacheDir, 'pokemon-com', opts.setId)
	if (!existsSync(dir)) throw new Error(`No scrape at ${dir}. Run scrape set first.`)
	const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
	const cards = await Promise.all(files.map(async (f) => ({ file: join(dir, f), card: JSON.parse(await readFile(join(dir, f), 'utf8')) as ScrapedCard })))
	log(`[enrich] ${cards.length} scraped cards in ${opts.setId}`)

	// ---- TCGTracking: variants and provider ids -------------------------------------------------------------------
	let variants: Awaited<ReturnType<typeof buildVariants>> | undefined
	let matchByName = false
	let productIds: ProductIds | undefined
	// TCGTracking's name for each product, to catch an id another source gives a card that is really another card's product
	let productNames = new Map<number, string>()
	let productList: { id: number; name: string; number?: string | null; cardmarket_id?: number | null; cardtrader_id?: number | null }[] = []
	const setNames = new Set(cards.map(({ card }) => nameKey(card.locales.en?.name ?? '')))
	let cardNameKey: (card: ScrapedCard) => string = (card) => nameKey(card.locales.en?.name ?? '')
	let groupId = opts.tcgplayerSet
	if (!opts.noVariants) {
		if (!groupId) {
			try { groupId = (await listSets(repo)).find((s) => s.id === opts.setId)?.prices?.tcgplayer } catch {}
		}
		if (!groupId) {
			// no set file yet: the same name/abbreviation lookup `set-meta` does, as a dry run
			try {
				const meta = await buildSetMeta({ setId: opts.setId, repo, apply: false, log: () => {} })
				groupId = (meta.record.prices as { tcgplayer?: number } | undefined)?.tcgplayer
			} catch (err) {
				warn(`could not look up the TCGplayer group: ${(err as Error).message}`)
			}
		}
		if (!groupId) warn('no TCGplayer group found: variants and provider ids skipped (pass --tcgplayer-set <id>)')
		else {
			log(`[enrich] TCGTracking group ${groupId}`)
			const schema = await loadSchema(repo)
			// the names of the cards by collector number, so a product that only shares the number (a Basic Energy numbered "1") is not taken
			const cardNames = new Map<string, Set<string>>()
			for (const { card } of cards) {
				const k = cardKey(card)
				if (k !== undefined) cardNames.set(k, (cardNames.get(k) ?? new Set()).add(nameKey(card.locales.en?.name ?? '')))
			}
			variants = await buildVariants(groupId, schema, warn, undefined, cardNames)
			// A reprint set's products carry the printed numbers of the sets the cards come from (30th Classic Collection's Charizard
			// is "4/102"), so a number points at the wrong card. When the names behind the numbers don't match the cards' names,
			// every card is matched by name instead.
			const products = (await fetchCards(groupId)).products
			productIds = new Map(products.map((p) => [p.id, { cardmarket_id: p.cardmarket_id, cardtrader_id: p.cardtrader_id }]))
			productNames = new Map(products.map((p) => [p.id, nameKey(p.name)]))
			productList = products
			const namesAt = new Map<string, string[]>()
			for (const p of products) { const k = collectorKey(p.number); if (k !== undefined) namesAt.set(k, [...(namesAt.get(k) ?? []), nameKey(p.name)]) }
			let checked = 0, disagree = 0
			for (const { card } of cards) {
				const names = namesAt.get(cardKey(card) ?? '')
				if (!names) continue
				checked++
				if (!names.includes(nameKey(card.locales.en?.name ?? ''))) disagree++
			}
			if (checked && disagree / checked > 0.2) {
				warn(`${disagree} of ${checked} product numbers belong to a different card (a reprint set?): matching variants by card name instead`)
				// cards that share a name (the two halves of a LEGEND, "Top" and "Bottom") are told apart by order: when there are
				// as many products as cards, the n-th card by number takes the n-th product by printed number
				const byName = new Map<string, number[]>()
				for (const { card } of cards) { const k = nameKey(card.locales.en?.name ?? ''); byName.set(k, [...(byName.get(k) ?? []), card.structural.number ?? 0]) }
				const productsByName = new Map<string, typeof products>()
				for (const p of products) { const k = nameKey(p.name); productsByName.set(k, [...(productsByName.get(k) ?? []), p]) }
				const productKey = new Map<number, string>()
				for (const [k, list] of productsByName) {
					const sorted = [...list].sort((a, b) => (parseInt(a.number ?? '0', 10) || 0) - (parseInt(b.number ?? '0', 10) || 0) || a.id - b.id)
					const same = (byName.get(k)?.length ?? 0) === sorted.length && sorted.length > 1
					sorted.forEach((p, i) => productKey.set(p.id, same ? `${k}#${i}` : k))
				}
				cardNameKey = (card) => {
					const k = nameKey(card.locales.en?.name ?? '')
					const numbers = byName.get(k) ?? []
					const list = productsByName.get(k) ?? []
					if (numbers.length > 1 && numbers.length === list.length) return `${k}#${[...numbers].sort((a, b) => a - b).indexOf(card.structural.number ?? 0)}`
					return k
				}
				variants = await buildVariants(groupId, schema, warn, (p) => productKey.get(p.id) ?? nameKey(p.name))
				matchByName = true
			}
		}
	}

	// ---- TCGdex: flavor text and regulation marks -----------------------------------------------------------------
	const extras = opts.noTcgdex ? undefined : await fetchCardExtras(opts.setId, cards.map(({ card }) => tcgdexLocalId(card)), warn, true)

	// ---- store ----------------------------------------------------------------------------------------------------
	// TCGCSV: TCGplayer ids of the Play! Pokémon Prize Pack reprints of this set's cards (TCGdex has none for them)
	let prize: Awaited<ReturnType<typeof loadPrizePackIndex>> | undefined
	if (!opts.noTcgcsv) {
		try { prize = await loadPrizePackIndex(warn) } catch (err) { warn(`TCGCSV: ${(err as Error).message}; Prize Pack ids skipped`) }
	}

	let withVariants = 0, withText = 0, withMark = 0, fromTcgdex = 0, fromTcgcsv = 0, keptEarlier = 0
	const now = new Date().toISOString()
	const claimed = { tcgplayer: new Map<number, string>(), cardmarket: new Map<number, string>(), cardtrader: new Map<number, string>() }
	const schema = await loadSchema(repo)
	for (const { file, card } of cards) {
		let e = extras?.get(tcgdexLocalId(card))
		// TCGdex gave nothing for a card it had answered for before (a failed request): the earlier answer stays
		if (e && !e.name && card.tcgdex?.name) { e = card.tcgdex; keptEarlier++ }
		let list = variants?.get(matchByName ? cardNameKey(card) : cardKey(card) ?? '')
		if (variants) card.tcgplayerSet = groupId
		// variants TCGdex lists that TCGTracking has no product for (stamps, cosmos/gold patterns, jumbo), only for the same card
		const enName = card.locales.en?.name
		const sameCard = e && (!e.name || (enName && sameCardName(e.name, enName)))
		if (e && sameCard && e.variants?.length && !opts.noTcgdexVariants) {
			// cross-check against TCGTracking: a TCGdex variant whose TCGplayer product is named like ANOTHER card of this set carries
			// that card's ids by mistake (TCGdex gave My First Battle's Charmander the Bulbasaur product). The variant stays, its ids go.
			const mine = nameKey(enName ?? '')
			e.variants = e.variants.map((tv) => {
				// a product that isn't in this set's TCGTracking group is another set's (the Classic Collection's stamped Reshiram has the
				// Celebrations Reshiram's ids)
				if (tv.tcgplayer && productNames.size && !productNames.has(tv.tcgplayer)) {
					warn(`${opts.setId}-${tcgdexLocalId(card)}: TCGdex gives ${enName} TCGplayer product ${tv.tcgplayer}, which is not in TCGTracking's group ${groupId}: ids dropped`)
					return { ...tv, tcgplayer: undefined, cardmarket: undefined, cardtrader: undefined }
				}
				const owner = tv.tcgplayer ? productNames.get(tv.tcgplayer) : undefined
				if (owner && owner !== mine && setNames.has(owner)) {
					warn(`${opts.setId}-${tcgdexLocalId(card)}: TCGdex gives ${enName} TCGplayer product ${tv.tcgplayer}, which TCGTracking names "${owner}" (another card of the set): ids dropped`)
					return { ...tv, tcgplayer: undefined, cardmarket: undefined, cardtrader: undefined }
				}
				return tv
			})
			const merged = mergeTcgdexVariants(list, e.variants, schema, warn, `${opts.setId}-${tcgdexLocalId(card)}`, productIds)
			list = merged.list
			e.variantsAdded = merged.added
			fromTcgdex += merged.added
		}
		let csvChanged = 0
		if (prize) {
			const r = applyPrizePack(list ?? [], card, prize, schema, warn, `${opts.setId}-${tcgdexLocalId(card)}`)
			if (r.changed) { list = r.list; csvChanged = r.changed; fromTcgcsv += r.changed }
		}
		// a provider id belongs to one card: when two cards claim one (identical cards such as the two Fire Energy of SVE share a
		// Player Rewards product), the first keeps it and the later one is left without, so nothing is attributed by guesswork
		for (const v of list ?? []) {
			for (const key of ['tcgplayer', 'cardmarket', 'cardtrader'] as const) {
				const id = v.prices[key]
				if (!id) continue
				// a TCGplayer product numbered for another card of the set is that card's: this card doesn't claim it (not for sets
				// matched by name, whose products carry the numbers of other sets)
				if (key === 'tcgplayer' && !matchByName) {
					const num = collectorKey(productList.find((p) => p.id === id)?.number)
					if (num !== undefined && num !== cardKey(card)) { warn(`${opts.setId}-${tcgdexLocalId(card)}: tcgplayer ${id} is product ${num}'s, not this card's: left off its ${v.type} variant`); delete v.prices[key]; continue }
				}
				const owner = claimed[key].get(id)
				if (owner && owner !== file) { warn(`${opts.setId}-${tcgdexLocalId(card)}: ${key} ${id} is already used by another card of the set: left off this card's ${v.type} variant`); delete v.prices[key] }
				else claimed[key].set(id, file)
			}
		}
		// a variant left without a TCGplayer id (TCGdex's was another card's) takes the TCGTracking product of this card that no card
		// has claimed: the one whose tag in brackets is one of the variant's stamps ("Switch (Pikachu)" for the pikachu stamp), or the
		// only unclaimed product with the card's name ("Charmander (Blue Border)")
		if (productList.length) {
			const mine = nameKey(card.locales.en?.name ?? '')
			for (const v of list ?? []) {
				if (v.prices.tcgplayer) continue
				// a product numbered for another card is that card's ("Turbo Patch (Secret)" 200/189 is not card 172's); only products with
				// no number (My First Battle's) or this card's number can be taken
				const open = productList.filter((p) => nameKey(p.name) === mine && !claimed.tcgplayer.has(p.id)
					&& (collectorKey(p.number) === undefined || collectorKey(p.number) === cardKey(card)))
				const tagOf = (p: { name: string }) => nameKey(p.name.match(/\(([^)]*)\)/)?.[1] ?? '')
				const byStamp = open.filter((p) => tagOf(p) && v.stamps?.includes(tagOf(p)))
				const pick = byStamp.length === 1 ? byStamp[0] : open.length === 1 ? open[0] : undefined
				if (!pick) continue
				v.prices.tcgplayer = pick.id
				if (pick.cardmarket_id && !claimed.cardmarket.has(pick.cardmarket_id)) v.prices.cardmarket = pick.cardmarket_id
				if (pick.cardtrader_id && !claimed.cardtrader.has(pick.cardtrader_id)) v.prices.cardtrader = pick.cardtrader_id
				claimed.tcgplayer.set(pick.id, file)
				if (v.prices.cardmarket) claimed.cardmarket.set(v.prices.cardmarket, file)
				if (v.prices.cardtrader) claimed.cardtrader.set(v.prices.cardtrader, file)
				warn(`${opts.setId}-${tcgdexLocalId(card)}: ${v.type} variant (${(v.stamps ?? []).join('+') || 'no stamp'}) had no TCGplayer id; took TCGTracking product ${pick.id} "${pick.name}"`)
			}
		}
		if (csvChanged) card.tcgcsvVariants = csvChanged
		else delete card.tcgcsvVariants
		if (variants || (e?.variantsAdded ?? 0) > 0 || csvChanged > 0) {
			if (list?.length) { card.variants = list; withVariants++ } else delete card.variants
		}
		if (extras) {
			if (e) {
				card.tcgdex = e
				if (Object.keys(e.description).length) withText++
				if (e.regulationMark) withMark++
			}
		}
		// a card pokemon.com has no Pokédex link for (Terapagos) takes the dex number TCGdex has, for the same card only
		if (!card.structural.dexIds?.length && sameCard && e?.dexId?.length) card.structural.dexIds = [...e.dexId]
		card.enrichedAt = now
		await writeFile(file, JSON.stringify(card, null, 2))
	}
	if (keptEarlier) warn(`TCGdex gave nothing for ${keptEarlier} cards it had data for before (failed requests?): their earlier data was kept`)
	log(`[enrich] stored: ${variants ? `${withVariants}/${cards.length} cards with variants` : 'variants skipped'}; ${extras ? `${withText} with flavor text, ${withMark} with a regulation mark${fromTcgdex ? `; ${fromTcgdex} variants added from TCGdex (stamps, patterns, sizes)` : ''}${fromTcgcsv ? `; ${fromTcgcsv} Prize Pack ids from TCGCSV` : ''}` : 'TCGdex skipped'}`)
}

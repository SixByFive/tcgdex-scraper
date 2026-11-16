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
import { mergeTcgdexVariants } from '../emit/tcgdex-variants.ts'
import { applyPrizePack, loadPrizePackIndex } from './tcgcsv.ts'

// curly and straight apostrophes/quotes and case differ between sources for the same card
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
			variants = await buildVariants(groupId, schema, warn)
			// A reprint set's products carry the printed numbers of the sets the cards come from (30th Classic Collection's Charizard
			// is "4/102"), so a number points at the wrong card. When the names behind the numbers don't match the cards' names,
			// every card is matched by name instead.
			const products = (await fetchCards(groupId)).products
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

	let withVariants = 0, withText = 0, withMark = 0, fromTcgdex = 0, fromTcgcsv = 0
	const now = new Date().toISOString()
	const schema = await loadSchema(repo)
	for (const { file, card } of cards) {
		const e = extras?.get(tcgdexLocalId(card))
		let list = variants?.get(matchByName ? cardNameKey(card) : cardKey(card) ?? '')
		if (variants) card.tcgplayerSet = groupId
		// variants TCGdex lists that TCGTracking has no product for (stamps, cosmos/gold patterns, jumbo), only for the same card
		const enName = card.locales.en?.name
		const sameCard = e && (!e.name || (enName && plain(e.name) === plain(enName)))
		if (e && sameCard && e.variants?.length && !opts.noTcgdexVariants) {
			const merged = mergeTcgdexVariants(list, e.variants, schema, warn, `${opts.setId}-${tcgdexLocalId(card)}`)
			list = merged.list
			e.variantsAdded = merged.added
			fromTcgdex += merged.added
		}
		let csvChanged = 0
		if (prize) {
			const r = applyPrizePack(list ?? [], card, prize, schema, warn, `${opts.setId}-${tcgdexLocalId(card)}`)
			if (r.changed) { list = r.list; csvChanged = r.changed; fromTcgcsv += r.changed }
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
		card.enrichedAt = now
		await writeFile(file, JSON.stringify(card, null, 2))
	}
	log(`[enrich] stored: ${variants ? `${withVariants}/${cards.length} cards with variants` : 'variants skipped'}; ${extras ? `${withText} with flavor text, ${withMark} with a regulation mark${fromTcgdex ? `; ${fromTcgdex} variants added from TCGdex (stamps, patterns, sizes)` : ''}${fromTcgcsv ? `; ${fromTcgcsv} Prize Pack ids from TCGCSV` : ''}` : 'TCGdex skipped'}`)
}

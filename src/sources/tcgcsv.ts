import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import { resolveFromText } from '../pricing/variant-resolver.ts'
import type { VariantOut } from '../emit/variants.ts'
import type { SchemaModule } from '../util/experimental.ts'
import { idOf, sortVariants } from '../emit/variants.ts'
import type { ScrapedCard } from '../types/scraped.ts'

/**
 * TCGCSV (tcgcsv.com) is a free daily mirror of TCGplayer's catalogue. It asks for a custom User-Agent, about 100 ms between
 * requests and one sync a day; this keeps each group on disk for 24 hours.
 *
 * Its product list for a promo group is the same one TCGTracking has, so promo sets need nothing from here. What TCGplayer
 * keeps in one group but TCGdex gives no TCGplayer id for is the Play! Pokémon Prize Pack Series: reprints of main-set cards
 * ("Teal Mask Ogerpon ex - 025/167 (Prize Pack Series 6)") that carry the player-rewards-program stamp. Those products name
 * the set only by its printed total, so a card is matched by (printed total, number, name).
 */
const BASE = 'https://tcgcsv.com/tcgplayer/3'
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** TCGplayer's "Prize Pack Series Cards" group */
export const PRIZE_PACK_GROUP = 22880
const PRIZE_PACK_STAMP = 'player-rewards-program'

export interface CsvProduct {
	productId: number
	name: string
	extendedData?: { name: string; value: string }[]
}
interface CsvPrice { productId: number; subTypeName?: string }
export interface CsvGroup { products: CsvProduct[]; prices: CsvPrice[]; fetchedAt: string }

let lastCall = 0
async function get<T>(url: string): Promise<T> {
	const wait = lastCall + 150 - Date.now()
	if (wait > 0) await new Promise((r) => setTimeout(r, wait))
	lastCall = Date.now()
	const res = await fetch(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' } })
	if (!res.ok) throw new Error(`TCGCSV ${url} -> ${res.status}`)
	return ((await res.json()) as { results: T }).results
}

/** A group's products and prices (the prices say Normal / Holofoil / Reverse Holofoil per product). Cached for a day. */
export async function fetchGroup(groupId: number): Promise<CsvGroup> {
	const file = join(config.cacheDir, 'tcgcsv', `${groupId}.json`)
	if (existsSync(file) && Date.now() - (await stat(file)).mtimeMs < MAX_AGE_MS) return JSON.parse(await readFile(file, 'utf8'))
	const products = await get<CsvProduct[]>(`${BASE}/${groupId}/products`)
	const prices = await get<CsvPrice[]>(`${BASE}/${groupId}/prices`)
	const group: CsvGroup = { products, prices, fetchedAt: new Date().toISOString() }
	await mkdir(join(config.cacheDir, 'tcgcsv'), { recursive: true })
	await writeFile(file, JSON.stringify(group))
	return group
}

export interface ParsedName {
	/** the card's name without number or tags: "Teal Mask Ogerpon ex" */
	base: string
	number?: number
	total?: number
	/** what is in parentheses and square brackets: ["Prize Pack Series 6"], ["Prerelease", "Staff"] */
	tags: string[]
}

/**
 * `{Name} - {number}[/{total}] ({tag}) [{tag}]`. The number is absent from some names (then `extendedData.Number` has it).
 * Spelling drifts ("Cosmo Holo", "[STAFF]"), so tags are kept as written and read by the matcher, which lowercases.
 */
export function parseProductName(name: string, extendedNumber?: string): ParsedName {
	const tags = [...name.matchAll(/[(\[]([^)\]]+)[)\]]/g)].map((m) => m[1]!.trim())
	const head = name.replace(/\s*[(\[][^)\]]*[)\]]/g, '').trim()
	const m = head.match(/^(.*?)\s+-\s+([A-Za-z]*\d+)(?:\/(\d+))?$/)
	const numText = m?.[2] ?? extendedNumber?.split('/')[0]
	const totalText = m?.[3] ?? extendedNumber?.split('/')[1]
	return {
		base: (m?.[1] ?? head).trim(),
		number: numText && /^\d+$/.test(numText) ? Number(numText) : undefined,
		total: totalText && /^\d+$/.test(totalText) ? Number(totalText) : undefined,
		tags
	}
}

const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase().trim()
const TYPE_OF: Record<string, string> = { Normal: 'normal', Holofoil: 'holo', 'Reverse Holofoil': 'reverse' }

export interface PrizePackProduct {
	productId: number
	name: string
	variant: Omit<VariantOut, 'prices'>
}

/** The card a Prize Pack product is: its number and name, from the key it is indexed under (`total|number|name`). */
export function prizeProductOwner(index: PrizePackIndex, productId: number): { number: number; name: string } | undefined {
	const find = (key: string) => { const [, number, ...name] = key.split('|'); return { number: Number(number), name: name.join('|') } }
	for (const [key, list] of index) if (list.some((p) => p.productId === productId)) return find(key)
	for (const [key, list] of index.ambiguous ?? []) if (list.some((p) => p.productId === productId)) return find(key)
	return undefined
}

/** Prize Pack products by `total|number|name`. */
export type PrizePackIndex = Map<string, PrizePackProduct[]> & { ambiguous?: Map<string, AmbiguousProduct[]> }

/** A Prize Pack product TCGplayer lists under several finishes (or none): which one the card has is for the card's own variants to say. */
export interface AmbiguousProduct { productId: number; name: string; types: string[]; foil?: string; stamps: string[] }

export async function loadPrizePackIndex(warn: (m: string) => void): Promise<PrizePackIndex> {
	const group = await fetchGroup(PRIZE_PACK_GROUP)
	const subtypes = new Map<number, string[]>()
	for (const p of group.prices) if (p.subTypeName) subtypes.set(p.productId, [...(subtypes.get(p.productId) ?? []), p.subTypeName])

	const index: PrizePackIndex = new Map()
	const ambiguous = new Map<string, AmbiguousProduct[]>()
	index.ambiguous = ambiguous
	let unclear = 0
	for (const p of group.products) {
		const parsed = parseProductName(p.name, p.extendedData?.find((e) => e.name === 'Number')?.value)
		// sealed product, energy cards and the like have no number/total: only numbered cards are reprints of a set's card
		if (parsed.number == null || parsed.total == null) continue
		const kinds = subtypes.get(p.productId) ?? []
		const type = kinds.length === 1 ? TYPE_OF[kinds[0]!] : undefined
		// finish and stamps come from the tags with the same reading the TCGTracking path uses (Cosmos Holo -> cosmos foil)
		const read = resolveFromText(parsed.tags)
		const key = `${parsed.total}|${parsed.number}|${plain(parsed.base)}`
		if (!type) {
			unclear++
			const types = [...new Set(kinds.map((k) => TYPE_OF[k]).filter((x): x is string => Boolean(x)))]
			ambiguous.set(key, [...(ambiguous.get(key) ?? []), { productId: p.productId, name: p.name, types, foil: read?.foil || undefined, stamps: [PRIZE_PACK_STAMP, ...(read?.stamp ?? []).filter((s) => s !== PRIZE_PACK_STAMP)].sort() }])
			continue
		}
		const list = index.get(key) ?? []
		list.push({ productId: p.productId, name: p.name, variant: { type, foil: read?.foil || undefined, size: undefined, stamps: [PRIZE_PACK_STAMP, ...(read?.stamp ?? []).filter((s) => s !== PRIZE_PACK_STAMP)].sort() } })
		index.set(key, list)
	}
	if (unclear) warn(`TCGCSV: ${unclear} Prize Pack products list more than one printing (or none): used only where a card's own Prize Pack variant says which`)
	return index
}

/**
 * Adds the TCGplayer ids of a card's Prize Pack reprints to its variants. A variant TCGdex already lists (same type, foil,
 * size and stamps) gets the id when it has none; one it lacks is added. When two products fit one variant (the same card in
 * Prize Pack Series 6 and 7) nothing is guessed: the variant is left as it is and reported.
 * Returns the merged list and how many variants were filled or added.
 */
export function applyPrizePack(list: VariantOut[], card: ScrapedCard, index: PrizePackIndex, schema: SchemaModule, warn: (m: string) => void, label: string, officialTotal?: number): { list: VariantOut[]; changed: number } {
	const s = card.structural
	const name = card.locales.en?.name
	if (!name || s.total == null || s.number == null) return { list, changed: 0 }
	// the total on the card is the set's official count ("095/197"); the scrape may hold the count with secret rares (227) instead
	const keys = [...new Set([s.total, officialTotal].filter((x): x is number => x != null))].map((t) => `${t}|${s.number}|${plain(name)}`)
	const key = keys.find((k) => index.has(k) || index.ambiguous?.has(k)) ?? keys[0]!
	const found = index.get(key) ?? []
	const maybe = index.ambiguous?.get(key) ?? []
	if (!found.length && !maybe.length) return { list, changed: 0 }

	const stamps = new Set<string>(schema.stamps)
	const foils = new Set<string>(schema.foils)
	const out = list.map((v) => ({ ...v, prices: { ...v.prices } }))
	const byId = new Map<string, PrizePackProduct[]>()
	for (const p of found) byId.set(idOf(p.variant), [...(byId.get(idOf(p.variant)) ?? []), p])

	let changed = 0
	for (const [id, products] of byId) {
		const v = products[0]!.variant
		if (v.stamps?.some((x) => !stamps.has(x)) || (v.foil && !foils.has(v.foil))) { warn(`${label}: Prize Pack variant ${id} is not in the schema, skipped`); continue }
		if (products.length > 1) { warn(`${label}: ${products.length} Prize Pack products fit one variant (${products.map((p) => p.productId).join(', ')}), none used`); continue }
		const have = out.find((x) => idOf(x) === id)
		if (have) {
			if (have.prices.tcgplayer == null) { have.prices.tcgplayer = products[0]!.productId; changed++ }
		} else {
			// the product is already on another variant of this card (TCGdex's, under another finish): TCGplayer knows the product's finish
			// (Toedscruel ex's Prize Pack card is a Holofoil one, TCGdex lists it as normal), so that variant is the same one, relabelled
			const held = out.find((x) => x.prices.tcgplayer === products[0]!.productId)
			if (held) {
				warn(`${label}: Prize Pack product ${products[0]!.productId} is a ${v.type}${v.foil ? ':' + v.foil : ''} product at TCGplayer; the ${idOf(held)} variant that has it is relabelled`)
				held.type = v.type; held.foil = v.foil; held.size = v.size; held.stamps = v.stamps
			} else {
				// the card's only Prize Pack variant has no TCGplayer id yet and TCGplayer has only this one Prize Pack product for the card: they
				// are one printing, with the finish TCGplayer gives (TCGdex lists Tyranitar ex's as normal, TCGplayer sells it as Holofoil)
				const lone = out.filter((x) => x.stamps?.includes(PRIZE_PACK_STAMP) && x.prices.tcgplayer == null && (x.foil ?? undefined) === (v.foil ?? undefined) && [...(x.stamps ?? [])].sort().join() === [...(v.stamps ?? [])].sort().join())
				if (lone.length === 1 && byId.size === 1) {
					warn(`${label}: the ${idOf(lone[0]!)} Prize Pack variant has no TCGplayer id and TCGplayer's only Prize Pack product for the card (${products[0]!.productId}) is a ${v.type} one: one variant, relabelled ${v.type}`)
					lone[0]!.type = v.type; lone[0]!.size = v.size; lone[0]!.prices.tcgplayer = products[0]!.productId
				} else out.push({ ...v, prices: { tcgplayer: products[0]!.productId } })
			}
			changed++
		}
	}
	// A product listed under several finishes ("Normal + Holofoil") can't say which variant it is, but a Prize Pack variant the card
	// already has (from TCGdex) can: it takes the one product that could be it, when there is exactly one.
	const taken = new Set(out.flatMap((v) => (v.prices.tcgplayer ? [v.prices.tcgplayer] : [])))
	for (const v of out) {
		if (v.prices.tcgplayer != null || !v.stamps?.includes(PRIZE_PACK_STAMP)) continue
		const fits = maybe.filter((m) => !taken.has(m.productId) && (m.types.length === 0 || m.types.includes(v.type)) && (m.foil ?? undefined) === (v.foil ?? undefined) && m.stamps.join() === [...(v.stamps ?? [])].sort().join())
		if (fits.length !== 1) { if (fits.length > 1) warn(`${label}: ${fits.length} Prize Pack products could be the ${idOf(v)} variant (${fits.map((m) => m.productId).join(', ')}), none used`); continue }
		v.prices.tcgplayer = fits[0]!.productId
		taken.add(fits[0]!.productId)
		changed++
	}
	return { list: changed ? sortVariants(out) : list, changed }
}

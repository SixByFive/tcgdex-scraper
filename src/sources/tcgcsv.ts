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

/** Prize Pack products by `total|number|name`. */
export type PrizePackIndex = Map<string, PrizePackProduct[]>

export async function loadPrizePackIndex(warn: (m: string) => void): Promise<PrizePackIndex> {
	const group = await fetchGroup(PRIZE_PACK_GROUP)
	const subtypes = new Map<number, string[]>()
	for (const p of group.prices) if (p.subTypeName) subtypes.set(p.productId, [...(subtypes.get(p.productId) ?? []), p.subTypeName])

	const index: PrizePackIndex = new Map()
	let unclear = 0
	for (const p of group.products) {
		const parsed = parseProductName(p.name, p.extendedData?.find((e) => e.name === 'Number')?.value)
		// sealed product, energy cards and the like have no number/total: only numbered cards are reprints of a set's card
		if (parsed.number == null || parsed.total == null) continue
		const kinds = subtypes.get(p.productId) ?? []
		const type = kinds.length === 1 ? TYPE_OF[kinds[0]!] : undefined
		if (!type) { unclear++; continue }
		// finish and stamps come from the tags with the same reading the TCGTracking path uses (Cosmos Holo -> cosmos foil)
		const read = resolveFromText(parsed.tags)
		const key = `${parsed.total}|${parsed.number}|${plain(parsed.base)}`
		const list = index.get(key) ?? []
		list.push({ productId: p.productId, name: p.name, variant: { type, foil: read?.foil || undefined, size: undefined, stamps: [PRIZE_PACK_STAMP, ...(read?.stamp ?? []).filter((s) => s !== PRIZE_PACK_STAMP)].sort() } })
		index.set(key, list)
	}
	if (unclear) warn(`TCGCSV: ${unclear} Prize Pack products list more than one printing (or none), so which one they are is unclear: skipped`)
	return index
}

/**
 * Adds the TCGplayer ids of a card's Prize Pack reprints to its variants. A variant TCGdex already lists (same type, foil,
 * size and stamps) gets the id when it has none; one it lacks is added. When two products fit one variant (the same card in
 * Prize Pack Series 6 and 7) nothing is guessed: the variant is left as it is and reported.
 * Returns the merged list and how many variants were filled or added.
 */
export function applyPrizePack(list: VariantOut[], card: ScrapedCard, index: PrizePackIndex, schema: SchemaModule, warn: (m: string) => void, label: string): { list: VariantOut[]; changed: number } {
	const s = card.structural
	const name = card.locales.en?.name
	if (!name || s.total == null || s.number == null) return { list, changed: 0 }
	const found = index.get(`${s.total}|${s.number}|${plain(name)}`)
	if (!found?.length) return { list, changed: 0 }

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
			out.push({ ...v, prices: { tcgplayer: products[0]!.productId } })
			changed++
		}
	}
	return { list: changed ? sortVariants(out) : list, changed }
}

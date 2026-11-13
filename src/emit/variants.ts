import { resolveFromText, resolveProductVariants } from '../pricing/variant-resolver.ts'
import { fetchCards, fetchSkus } from '../util/tcgtracking-open.ts'
import type { SchemaModule } from '../util/experimental.ts'
import { collectorKey } from './normalise.ts'

/** One variant as the Experimental schema wants it: its attributes (which identify it) and its provider ids. */
export interface VariantOut {
	type: string
	foil?: string
	size?: string
	stamps?: string[]
	prices: { cardmarket?: number; tcgplayer: number; cardtrader?: number }
}

const TYPE_ORDER = ['normal', 'holo', 'reverse', 'lenticular', 'metal']
const TYPES = new Set(TYPE_ORDER)

/**
 * The Poké Ball / Master Ball ... patterns are reverse-holo patterns. TCGplayer sells each as its own product and lists
 * it as plain "Holofoil", so neither the pattern nor the reverse type is in the SKU: both come from the product name.
 */
const BALL_PATTERNS = new Set(['pokeball', 'greatball', 'ultraball', 'masterball', 'loveball', 'friendball', 'quickball', 'duskball'])

const idOf = (v: VariantOut) => [v.type, v.foil, v.size, v.stamps?.join('+')].filter(Boolean).join('-')


/**
 * The variants of every card of a TCGplayer group, keyed by collector number.
 * Each TCGTracking product is one TCGplayer product; its SKU matrix says which finishes it has. Products that differ
 * by stamp (pre-release, staff, ...) are separate products of the same number, so they become variants of the one card.
 * A variant whose finish, foil or stamp isn't in the schema is left out and reported, not approximated.
 */
export async function buildVariants(groupId: number, schema: SchemaModule, warn: (msg: string) => void): Promise<Map<string, VariantOut[]>> {
	const [set, skus] = await Promise.all([fetchCards(groupId), fetchSkus(groupId)])
	if (!skus) warn(`TCGTracking has no SKU data for group ${groupId}: variants come from CardTrader finishes and product names, so check them`)

	const stamps = new Set(schema.stamps)
	const foils = new Set(schema.foils)
	// keyed by collector key: "5" for "005/197", "TG01" for "TG01/TG30" (see collectorKey)
	const byNumber = new Map<string, VariantOut[]>()

	for (const product of set.products) {
		const n = collectorKey(product.number)
		if (n === undefined) continue
		product.skus = skus?.[String(product.id)]
		product.cardtrader ??= []

		const list = byNumber.get(n) ?? []
		for (const match of resolveProductVariants(product)) {
			let { type, foil } = match.identity
			const { size, stamp } = match.identity
			const named = resolveFromText([product.name, product.clean_name])?.foil
			if (!foil && named && BALL_PATTERNS.has(named)) foil = named
			if (foil && BALL_PATTERNS.has(foil)) type = 'reverse'
			const label = `${product.name} (#${n}, ${match.key})`
			if (!TYPES.has(type)) { warn(`variant skipped, unknown type: ${label}`); continue }
			if (foil && !foils.has(foil)) { warn(`variant skipped, foil "${foil}" is not in the schema: ${label}`); continue }
			const unknownStamp = stamp?.find((s) => !stamps.has(s))
			if (unknownStamp) { warn(`variant skipped, stamp "${unknownStamp}" is not in the schema: ${label}`); continue }
			if (size && size !== 'standard' && size !== 'jumbo') { warn(`variant skipped, unknown size "${size}": ${label}`); continue }

			const variant: VariantOut = {
				type,
				foil: foil || undefined,
				size: size === 'jumbo' ? 'jumbo' : undefined,
				stamps: stamp?.length ? [...stamp].sort() : undefined,
				prices: {
					cardmarket: product.cardmarket_id ?? undefined,
					tcgplayer: product.id,
					cardtrader: product.cardtrader_id ?? undefined
				}
			}
			const existing = list.find((v) => idOf(v) === idOf(variant))
			if (existing) {
				if (existing.prices.tcgplayer !== variant.prices.tcgplayer) warn(`two TCGplayer products for one variant, kept ${existing.prices.tcgplayer}, ignored ${variant.prices.tcgplayer}: ${label}`)
				continue
			}
			list.push(variant)
		}
		byNumber.set(n, list)
	}

	for (const list of byNumber.values()) sortVariants(list)
	return byNumber
}

// the ball patterns in the order the balls are numbered: Poké, Great, Ultra, Master (then the rest of the patterns)
const FOIL_ORDER = ['pokeball', 'greatball', 'ultraball', 'masterball', 'loveball', 'friendball', 'quickball', 'duskball']

/**
 * The first variant is the card's default, so: plain before foiled/stamped, normal before holo before reverse, and
 * among patterns Poké Ball before Master Ball. Sorts in place and returns the list.
 * (Also used by the emitter, so variants stored by an older enrich come out in this order too.)
 */
export function sortVariants<T extends Pick<VariantOut, 'type' | 'foil' | 'size' | 'stamps'>>(list: T[]): T[] {
	const special = (v: T) => (v.stamps?.length || v.foil || v.size ? 1 : 0)
	const foilRank = (v: T) => { const i = FOIL_ORDER.indexOf(v.foil ?? ''); return v.foil ? (i < 0 ? FOIL_ORDER.length : i) : -1 }
	return list.sort((a, b) =>
		special(a) - special(b)
		|| TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
		|| foilRank(a) - foilRank(b)
		|| (a.foil ?? '').localeCompare(b.foil ?? '')
		|| (a.stamps ?? []).join('+').localeCompare((b.stamps ?? []).join('+')))
}

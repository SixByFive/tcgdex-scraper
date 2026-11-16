import type { TcgdexVariant } from '../sources/tcgdex-cards.ts'
import type { SchemaModule } from '../util/experimental.ts'
import { idOf, sortVariants, type VariantOut } from './variants.ts'

const TYPES = new Set(['normal', 'holo', 'reverse', 'lenticular', 'metal'])

/**
 * Adds the variants TCGdex lists that the other source (TCGTracking) has no product for: stamped printings, cosmos and gold
 * patterns, jumbo cards. A variant both have stays as TCGTracking has it (its ids are the ones prices are fetched with), but
 * takes TCGdex's Cardmarket / TCGplayer id when TCGTracking has none. A variant whose type, foil or stamp isn't in the schema
 * is left out and reported, never approximated.
 * Returns the merged list (sorted) and how many variants came from TCGdex alone.
 */
export function mergeTcgdexVariants(existing: VariantOut[] | undefined, fromTcgdex: TcgdexVariant[] | undefined, schema: SchemaModule, warn: (m: string) => void, label: string): { list: VariantOut[]; added: number } {
	const list = (existing ?? []).map((v) => ({ ...v, prices: { ...v.prices } }))
	if (!fromTcgdex?.length) return { list, added: 0 }
	const foils = new Set<string>(schema.foils)
	const stamps = new Set<string>(schema.stamps)
	let added = 0
	const theirs = new Set(fromTcgdex.map((t) => idOf({ type: t.type, foil: t.foil, size: t.size, stamps: t.stamps })))

	for (const td of fromTcgdex) {
		const v: VariantOut = { type: td.type, foil: td.foil, size: td.size, stamps: td.stamps, prices: {} }
		const name = idOf(v) || td.type
		if (!TYPES.has(v.type)) { warn(`${label}: TCGdex variant skipped, unknown type "${v.type}"`); continue }
		if (v.foil && !foils.has(v.foil)) { warn(`${label}: TCGdex variant skipped, foil "${v.foil}" is not in the schema (${name})`); continue }
		const bad = v.stamps?.find((s) => !stamps.has(s))
		if (bad) { warn(`${label}: TCGdex variant skipped, stamp "${bad}" is not in the schema (${name})`); continue }
		if (v.size && v.size !== 'jumbo') { warn(`${label}: TCGdex variant skipped, unknown size "${v.size}" (${name})`); continue }

		const have = list.find((x) => idOf(x) === idOf(v))
		if (have) {
			have.prices.cardmarket ??= td.cardmarket
			have.prices.tcgplayer ??= td.tcgplayer
			continue
		}
		// the same product under another label: TCGTracking calls it plain holo, TCGdex knows it is the gold (or cosmos, ...)
		// printing and lists no plain one. It is one variant, with TCGdex's attributes and the ids both agree on.
		const relabel = (td.tcgplayer || td.cardmarket) && list.find((x) =>
			!theirs.has(idOf(x)) && ((td.tcgplayer && x.prices.tcgplayer === td.tcgplayer) || (!td.tcgplayer && td.cardmarket && x.prices.cardmarket === td.cardmarket)))
		if (relabel) {
			relabel.type = v.type; relabel.foil = v.foil; relabel.size = v.size; relabel.stamps = v.stamps
			continue
		}
		v.prices = { cardmarket: td.cardmarket, tcgplayer: td.tcgplayer }
		list.push(v)
		added++
	}
	return { list: sortVariants(list), added }
}

import { describe, expect, test } from 'bun:test'
import { mergeTcgdexVariants } from '../src/emit/tcgdex-variants.ts'
import type { VariantOut } from '../src/emit/variants.ts'
import type { SchemaModule } from '../src/util/experimental.ts'

const schema = {
	rarities: [], subtypes: [], regulationMarks: [],
	foils: ['cosmos', 'pokeball', 'tinsel'],
	stamps: ['30th-anniversary', 'player-rewards-program', 'staff', 'set-logo', 'asia-promo']
} as SchemaModule
const quiet = () => {}

describe('mergeTcgdexVariants', () => {
	test('a variant both list takes the ids TCGTracking lacks', () => {
		const existing: VariantOut[] = [{ type: 'holo', prices: { tcgplayer: 1 } }]
		const { list, added } = mergeTcgdexVariants(existing, [{ type: 'holo', cardmarket: 9, tcgplayer: 1 }], schema, quiet, 'x')
		expect(added).toBe(0)
		expect(list[0]!.prices).toEqual({ tcgplayer: 1, cardmarket: 9 })
	})

	// mep-100: TCGTracking called the product "holo, 30th anniversary", TCGdex lists plain holo. It is one variant, and the
	// relabel used to drop TCGdex's Cardmarket id (32 ids were lost this way in mep and svp).
	test('a relabelled variant keeps TCGdex’s ids too (the mep Cardmarket bug)', () => {
		const existing: VariantOut[] = [{ type: 'holo', stamps: ['30th-anniversary'], prices: { tcgplayer: 713267 } }]
		const { list, added } = mergeTcgdexVariants(existing, [{ type: 'holo', cardmarket: 895612, tcgplayer: 713267 }], schema, quiet, 'mep-100')
		expect(added).toBe(0)
		expect(list).toHaveLength(1)
		expect(list[0]!.stamps).toBeUndefined()
		expect(list[0]!.prices).toEqual({ tcgplayer: 713267, cardmarket: 895612 })
	})

	test('a variant TCGTracking has no product for is added', () => {
		const existing: VariantOut[] = [{ type: 'holo', prices: { tcgplayer: 1, cardmarket: 2 } }]
		const { list, added } = mergeTcgdexVariants(existing, [{ type: 'holo', stamps: ['staff'], cardmarket: 7, tcgplayer: 8 }], schema, quiet, 'x')
		expect(added).toBe(1)
		expect(list.find((v) => v.stamps?.[0] === 'staff')!.prices).toEqual({ cardmarket: 7, tcgplayer: 8, cardtrader: undefined })
	})

	test('a stamp the schema lacks is skipped and reported, never approximated', () => {
		const warned: string[] = []
		const { list } = mergeTcgdexVariants([], [{ type: 'holo', stamps: ['not-a-stamp'], tcgplayer: 5 }], schema, (m) => warned.push(m), 'x')
		expect(list).toHaveLength(0)
		expect(warned.join()).toContain('not-a-stamp')
	})

	test('an existing id is never overwritten by TCGdex’s', () => {
		const existing: VariantOut[] = [{ type: 'normal', prices: { cardmarket: 100, tcgplayer: 1 } }]
		const { list } = mergeTcgdexVariants(existing, [{ type: 'normal', cardmarket: 999, tcgplayer: 1 }], schema, quiet, 'x')
		expect(list[0]!.prices.cardmarket).toBe(100)
	})
})

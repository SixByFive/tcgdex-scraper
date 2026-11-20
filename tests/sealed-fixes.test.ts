import { describe, expect, test } from 'bun:test'
import { applyFixes, sameFix, type ProductFix } from '../src/sources/sealed-set.ts'
import type { ProductFile } from '../src/sources/sealed.ts'

const product = (over: Partial<ProductFile> = {}): ProductFile => ({
	id: 'x-box', type: 'booster-box', name: { en: 'X Box' }, set: 'x',
	contents: { boosterPacks: { 'x-pack': { quantity: 36 } } },
	variants: [{ prices: { tcgplayer: 1, cardmarket: 2 } }, { exclusive: 'pokemon-center', prices: { tcgplayer: 3 }, contents: { boosterPacks: { 'x-pack': { quantity: 40 } }, items: [{ item: { en: 'Dice' }, quantity: 1 }] } }],
	provenance: { source: 'tcgtracking', validation: 'unverified' },
	...over
})
const pack = product({ id: 'x-pack', type: 'booster-pack', contents: undefined })
const base = { set: 'x', product: 'x-box' }

describe('product fixes', () => {
	test('type, name and contents replace what was built; the input is not changed', () => {
		const built = [product()]
		const { files, applied } = applyFixes(built, [
			{ ...base, op: 'type', value: 'case' }, { ...base, op: 'name', value: 'Corrected' }, { ...base, op: 'contents', value: { items: [{ item: { en: 'Dice' }, quantity: 6 }] } }
		])
		expect(files[0]).toMatchObject({ type: 'case', name: { en: 'Corrected' }, contents: { items: [{ item: { en: 'Dice' }, quantity: 6 }] } })
		expect(built[0]!.type).toBe('booster-box')
		expect(applied['x-box']).toHaveLength(3)
	})

	test('a price fix sets or removes the id of one variant', () => {
		const { files } = applyFixes([product()], [
			{ ...base, op: 'price', variant: 'standard', provider: 'cardmarket', value: null },
			{ ...base, op: 'price', variant: 'pokemon-center', provider: 'cardmarket', value: 9 }
		])
		expect((files[0]!.variants[0] as any).prices).toEqual({ tcgplayer: 1 })
		expect((files[0]!.variants[1] as any).prices).toEqual({ tcgplayer: 3, cardmarket: 9 })
	})

	test('a product that is left out is dropped, and so are the contents entries that name it, in the product and its variants', () => {
		const { files, applied } = applyFixes([product(), pack], [{ set: 'x', product: 'x-pack', op: 'exclude' }])
		expect(files.map((f) => f.id)).toEqual(['x-box'])
		expect(files[0]!.contents).toBeUndefined()
		expect((files[0]!.variants[1] as any).contents).toEqual({ items: [{ item: { en: 'Dice' }, quantity: 1 }] })
		expect(applied['x-box']![0]).toContain('left out')
	})

	test('a fix for a product that is not there is ignored', () => {
		expect(applyFixes([product()], [{ set: 'x', product: 'ghost', op: 'type', value: 'tin' }]).files[0]!.type).toBe('booster-box')
	})

	test('the same correction replaces the earlier one; price fixes are told apart by variant and provider', () => {
		const a: ProductFix = { ...base, op: 'type', value: 'tin' }
		expect(sameFix(a, { ...base, op: 'type', value: 'case' })).toBe(true)
		expect(sameFix(a, { ...base, op: 'name', value: 'n' })).toBe(false)
		const p: ProductFix = { ...base, op: 'price', variant: 'standard', provider: 'cardmarket', value: 1 }
		expect(sameFix(p, { ...p, value: 2 })).toBe(true)
		expect(sameFix(p, { ...p, provider: 'tcgplayer' })).toBe(false)
		expect(sameFix(p, { ...p, variant: 'pokemon-center' })).toBe(false)
	})
})

describe('a correction to one version', () => {
	const blister = (): ProductFile => ({
		id: 'x-blister', type: 'blister', name: { en: 'X Blister' }, set: 'x',
		variants: [
			{ prices: { tcgplayer: 1 }, contents: { promos: [{ name: 'Gengar Line' }] } },
			{ prices: { tcgplayer: 2 }, contents: { promos: [{ name: 'Luxray Line' }] } }
		],
		provenance: { source: 'tcgtracking', validation: 'unverified' }
	})
	const fix = (over: object): ProductFix => ({ set: 'x', product: 'x-blister', op: 'variantContents', variant: 'gengar-line', value: { promos: ['y-048', 'y-050'] }, ...over } as ProductFix)

	test("a version's contents are replaced, found by the id the scraper built it with", () => {
		const { files } = applyFixes([blister()], [fix({})])
		expect((files[0]!.variants[0] as any).contents).toEqual({ promos: ['y-048', 'y-050'] })
		expect((files[0]!.variants[1] as any).contents).toEqual({ promos: [{ name: 'Luxray Line' }] })
	})

	test('a price fix still finds the version after its promos changed what its id is made of', () => {
		const { files } = applyFixes([blister()], [fix({}), { set: 'x', product: 'x-blister', op: 'price', variant: 'gengar-line', provider: 'cardmarket', value: 9 }])
		expect((files[0]!.variants[0] as any).prices).toEqual({ tcgplayer: 1, cardmarket: 9 })
	})

	test('empty contents remove the version\'s own', () => {
		expect((applyFixes([blister()], [fix({ value: {} })]).files[0]!.variants[0] as any).contents).toBeUndefined()
	})

	test('corrections to different versions are kept apart', () => {
		expect(sameFix(fix({}), fix({ value: { promos: [] } }))).toBe(true)
		expect(sameFix(fix({}), fix({ variant: 'luxray-line' }))).toBe(false)
	})
})

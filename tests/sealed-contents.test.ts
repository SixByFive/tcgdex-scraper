import { describe, expect, test } from 'bun:test'
import { buildProducts, promoKey, toContents, variantKeyOf, type Tracked } from '../src/sources/sealed.ts'

const tracked = (id: number, name: string, text?: string): Tracked => ({ id, name, ext_data: text ? { CardText: text } : undefined })

describe('contents by kind', () => {
	test('lines are sorted into packs, products, promos and items', () => {
		expect(toContents([
			{ product: 'x-booster-pack', quantity: 3 }, { product: 'x-box', quantity: 2 },
			{ card: 'svp-001', quantity: 1 }, { card: 'svp-002', quantity: 2 }, { oneOf: ['a', 'b'], quantity: 1 }, { item: { en: 'Dice' }, quantity: 6 }
		], 'x-booster-pack')).toEqual({
			boosterPacks: { 'x-booster-pack': { quantity: 3 } }, products: { 'x-box': { quantity: 2 } },
			promos: ['svp-001', 'svp-002', 'svp-002', { oneOf: ['a', 'b'] }], items: [{ item: { en: 'Dice' }, quantity: 6 }]
		})
		expect(toContents([], 'x')).toBeUndefined()
	})
})

describe('a version is told apart by its promos', () => {
	test('promoKey and variantKeyOf follow the Experimental repo: attributes, then promos', () => {
		expect(promoKey(['b-2', 'a-1'])).toBe('a-1+b-2')
		expect(promoKey([{ oneOf: ['z-2', 'z-1'] }, { name: 'Mr. Mime' }])).toBe('mr-mime+z-1+z-2')
		expect(variantKeyOf({ exclusive: 'target', contents: { promos: ['a-1'] } })).toBe('target-a-1')
		expect(variantKeyOf({ prices: {} })).toBe('standard')
	})

	const blisters = [
		tracked(1, 'Pitch Black 3-Pack Blister [Binacle]', 'Each blister comes with 3 booster packs and a promotional card of Binacle.'),
		tracked(2, 'Pitch Black 3-Pack Blister [Seel]', 'Each blister comes with 3 booster packs and a promotional card of Seel.'),
		tracked(3, 'Pitch Black Booster Pack')
	]
	const promoCards = [{ id: 'mep-087', name: 'Binacle' }]

	test('each blister is a variant holding its own promo, and the product lists no generic one', () => {
		const { files, promos } = buildProducts('me05', 'Pitch Black', undefined, blisters, [], promoCards)
		const blister = files.find((f) => f.id === 'me05-3-pack-blister')!
		expect(blister.contents).toEqual({ boosterPacks: { 'me05-booster-pack': { quantity: 3 } } })
		expect(blister.variants.map((v) => variantKeyOf(v))).toEqual(['mep-087', 'seel'])
		expect(blister.variants.map((v) => (v.contents as { promos: unknown[] }).promos)).toEqual([['mep-087'], [{ name: 'Seel' }]])
		expect(blister.variants.every((v) => !('promo' in v) && !('artwork' in v))).toBe(true)
		expect(promos.unlinked.some((u) => u.includes('Seel'))).toBe(true)
	})

	test('without a promo set to look in, the version still keeps its promo by name', () => {
		const { files } = buildProducts('me05', 'Pitch Black', undefined, blisters, [], [])
		expect(files.find((f) => f.id === 'me05-3-pack-blister')!.variants.map((v) => variantKeyOf(v))).toEqual(['binacle', 'seel'])
	})

	test('the art bundle says how many pack artworks there are', () => {
		const { files } = buildProducts('me05', 'Pitch Black', undefined, [tracked(3, 'Pitch Black Booster Pack'), tracked(4, 'Pitch Black Booster Pack Art Bundle [Set of 4]')], [], [])
		const pack = files.find((f) => f.id === 'me05-booster-pack')!
		expect(pack.variants.map((v) => variantKeyOf(v))).toEqual(['standard', 'a', 'b', 'c', 'd'])
		expect((pack.variants[0] as { prices: { tcgplayer: number } }).prices.tcgplayer).toBe(3)
	})
})

describe("pokemon.com's own page is preferred to the retailers' text", () => {
	const page = (slug: string, title: string, items: string[]) => ({ slug, url: '', year: 2026, title, text: [], sections: [{ heading: `The ${title} includes:`, items }], images: [], scrapedAt: '' })
	const etb = () => tracked(10, 'Pitch Black Elite Trainer Box', '<br>• 9 Pitch Black booster packs<br>• 45 Pokémon TCG Energy cards')
	const pack = tracked(3, 'Pitch Black Booster Pack')
	const pages = [
		page('etb', 'Pokémon TCG: Mega Evolution—Pitch Black Elite Trainer Box', ['9 Pokémon TCG: Mega Evolution—Pitch Black booster packs', '40 Pokémon TCG Energy cards']),
		page('pc-etb', 'Pokémon TCG: Mega Evolution—Pitch Black Pokémon Center Elite Trainer Box', ['9 booster packs', '99 Energy']),
		page('other', 'Pokémon TCG: Mega Evolution—Perfect Order Elite Trainer Box', ['9 booster packs', '1 Energy'])
	]

	test('the matching page replaces the retailer text: the quantity it gives wins', () => {
		const { files, galleryFor } = buildProducts('me05', 'Pitch Black', undefined, [etb(), pack], [], [], pages)
		const box = files.find((f) => f.id === 'me05-elite-trainer-box')!
		expect(box.contents).toEqual({ boosterPacks: { 'me05-booster-pack': { quantity: 9 } }, items: [{ item: { en: 'Pokémon TCG Energy cards' }, quantity: 40 }] })
		expect(galleryFor).toEqual({ 'me05-elite-trainer-box': 'etb' })
	})

	test('without a page the retailer text is used', () => {
		const { files, galleryFor } = buildProducts('me05', 'Pitch Black', undefined, [etb(), pack], [], [], [])
		expect((files.find((f) => f.id === 'me05-elite-trainer-box')!.contents!.items![0]!.quantity)).toBe(45)
		expect(galleryFor).toEqual({})
	})
})

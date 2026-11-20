import { describe, expect, test } from 'bun:test'
import { applyJumbo, jumboCardKeys, jumboProductKey, type JumboIndex } from '../src/sources/tcgcsv.ts'
import { cleanProductName, parseAttack, parseCost, productToCard } from '../src/sources/tcgcsv-cards.ts'
import type { ScrapedCard } from '../src/types/scraped.ts'

const product = (name: string, data: Record<string, string>) => ({ productId: 1, name, extendedData: Object.entries(data).map(([name, value]) => ({ name, value })) })

describe('attack costs', () => {
	test('digits are Colorless, letters are the energy types', () => {
		expect(parseCost('1R')).toEqual(['Colorless', 'Fire'])
		expect(parseCost('GGL')).toEqual(['Grass', 'Grass', 'Lightning'])
		expect(parseCost('3')).toEqual(['Colorless', 'Colorless', 'Colorless'])
		expect(parseCost('')).toEqual([])
	})
})

describe('attack text', () => {
	test('effect on the next line, damage in parentheses', () => {
		expect(parseAttack('[3R] Brave Fire (120)\r\n<br>This Pokémon does 30 damage to itself.')).toMatchObject({ name: 'Brave Fire', damage: '120', effect: 'This Pokémon does 30 damage to itself.' })
	})
	test('everything on one line', () => {
		expect(parseAttack('[3] Relaxed Roll (30x) Flip a coin until you get tails.  This attack does 30 damage times the number of heads.')).toMatchObject({ name: 'Relaxed Roll', damage: '30x' })
	})
	test('no damage: the effect follows the name after " - "', () => {
		expect(parseAttack('[1] Growth - Attach a G Energy card from your hand to this Pokemon.')).toMatchObject({ name: 'Growth', damage: null, effect: 'Attach a G Energy card from your hand to this Pokemon.' })
	})
	test('no effect', () => {
		expect(parseAttack('[2] Gnaw (20)')).toMatchObject({ name: 'Gnaw', damage: '20', effect: null })
	})
})

describe('a TCGplayer product as a scraped card', () => {
	test('a Radiant Collection Pokémon: lettered number, weakness, no type', () => {
		const c = productToCard(product('Audino', { Number: 'RC17/RC25', Rarity: 'Common', HP: '80', Stage: 'Basic', Weakness: 'Fx2', RetreatCost: '2', 'Attack 1': '[3] Relaxed Roll (30x) Flip a coin.' }), 25)!
		expect(c.structural).toMatchObject({ localId: 'RC17', number: 17, printedNumber: 'RC17', total: 25, hp: 80, stage: 'Basic', category: 'Pokemon', retreat: 2, rarity: 'Common' })
		expect(c.structural.weaknesses).toEqual([{ type: 'Fighting', value: '×2' }])
		expect(c.structural.types).toEqual([])
		expect(c.locales.en?.name).toBe('Audino')
	})
	test('a plain number is a plain local id; a Stage 1 loses its space', () => {
		const c = productToCard(product('Cinccino', { Number: '19/25', HP: '90', Stage: 'Stage 1' }), 25)!
		expect(c.structural).toMatchObject({ localId: '19', printedNumber: null, stage: 'Stage1' })
	})
	test('HP "0" is a Trainer', () => {
		const c = productToCard(product('Elesa', { Number: 'RC20/RC25', HP: '0', CardText: 'You may play only 1 Supporter card during your turn.' }), 25)!
		expect(c.structural.category).toBe('Trainer')
		expect(c.structural.hp).toBeNull()
		expect(c.locales.en?.abilities[0]).toMatchObject({ kind: 'rule' })
	})
	test('a basic Energy of a trainer kit; the number in its name is dropped', () => {
		const c = productToCard(product('Fighting Energy (#2)', { Number: '2/30', Rarity: 'Common', 'Card Type': 'Basic Fighting Energy' }), 30)!
		expect(c.structural).toMatchObject({ localId: '2', category: 'Energy', trainerSubtype: 'Basic', total: 30 })
		expect(c.locales.en?.name).toBe('Fighting Energy')
	})
	test('sealed products are not cards', () => {
		expect(productToCard(product('Sun & Moon Trainer Kit: Lycanroc & Alolan Raichu', {}), 30)).toBeUndefined()
	})
	test('names lose their tags', () => {
		expect(cleanProductName('Hau (#19) (Lycanroc Half-Deck)')).toBe('Hau')
		expect(cleanProductName('Charizard EX - XY17 (XY Black Star Promos)')).toBe('Charizard EX')
	})
})

describe('jumbo printings are variants of their parent card', () => {
	const card = (set: string, localId: string, name: string, total: number, printed?: string): ScrapedCard => ({
		scrapedAt: '', sourceSlug: 'pokemon.com',
		structural: { localId, number: Number(localId.replace(/\D/g, '')), printedNumber: printed ?? null, total, rarity: null, hp: null, types: [], stage: null, category: 'Pokemon', trainerSubtype: null, evolvesFromKey: null, pokedexSlug: null, dexIds: [], retreat: null, weaknesses: [], resistances: [], illustrator: null, expansionSetCode: null, imageUrls: {} },
		locales: { en: { name, evolvesFromName: null, abilities: [] } }
	})
	const index = (...products: [string, number, string][]): JumboIndex => {
		const idx: JumboIndex = new Map()
		for (const [name, productId, type] of products) {
			const key = jumboProductKey(name)!
			idx.set(key, [...(idx.get(key) ?? []), { productId, name, variant: { type, size: 'jumbo' } }])
		}
		return idx
	}
	const warns: string[] = []
	const warn = (m: string) => warns.push(m)

	test('a set card is found by name, number and the set total; the name spelling does not matter', () => {
		expect(jumboProductKey('Dragonite EX - 74/111')).toBe(jumboCardKeys(card('xy3', '74', 'Dragonite-EX', 111))[0])
	})
	test('a promo is found by its printed number', () => {
		expect(jumboProductKey('Charizard EX - XY17 (XY Black Star Promos)')).toBe(jumboCardKeys(card('xyp', 'XY17', 'Charizard-EX', 0, 'XY17'))[0])
		expect(jumboProductKey('Snorlax GX - SM05')).toBe(jumboCardKeys(card('smp', 'SM05', 'Snorlax-GX', 0, 'SM05'))[0])
	})
	test('a product with no set total or promo prefix says nothing about its parent', () => {
		expect(jumboProductKey('Marshtomp - 011 (e-League) [Winner]')).toBeUndefined()
		expect(jumboProductKey('Primarina GX')).toBeUndefined()
	})
	test('the jumbo printing is added as a size:jumbo variant', () => {
		const r = applyJumbo([{ type: 'normal', prices: { tcgplayer: 5 } }], card('xy3', '74', 'Dragonite EX', 111), index(['Dragonite EX - 74/111', 99, 'holo']), warn, 'test')
		expect(r.changed).toBe(1)
		expect(r.list).toContainEqual({ type: 'holo', size: 'jumbo', prices: { tcgplayer: 99 } })
		expect(r.list.find((v) => v.size === undefined)).toBeDefined()
	})
	test('a jumbo variant TCGdex already lists takes the TCGplayer id', () => {
		const r = applyJumbo([{ type: 'holo', prices: {} }, { type: 'holo', size: 'jumbo', prices: { cardmarket: 7 } }], card('xy3', '74', 'Dragonite EX', 111), index(['Dragonite EX - 74/111', 99, 'holo']), warn, 'test')
		expect(r.list.filter((v) => v.size === 'jumbo')).toEqual([{ type: 'holo', size: 'jumbo', prices: { cardmarket: 7, tcgplayer: 99 } }])
	})
	test('two products for one variant are not guessed between', () => {
		const r = applyJumbo([], card('xy3', '74', 'Dragonite EX', 111), index(['Dragonite EX - 74/111', 99, 'holo'], ['Dragonite EX - 74/111 (Box Topper)', 100, 'holo']), warn, 'test')
		expect(r.changed).toBe(0)
	})
	test('another card is left alone', () => {
		const r = applyJumbo([], card('xy3', '75', 'Dragonite EX', 111), index(['Dragonite EX - 74/111', 99, 'holo']), warn, 'test')
		expect(r.changed).toBe(0)
	})
})

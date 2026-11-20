import { describe, expect, test } from 'bun:test'
import { cardKey, cardLocalId, collectorKey, tcgdexLocalId } from '../src/emit/normalise.ts'
import { blockingProblems } from '../src/sources/enrich-scraped.ts'
import type { ScrapedCard } from '../src/types/scraped.ts'

/** Only the fields these functions read. */
const card = (o: { slug?: string; localId: string; printed?: string | null; number?: number }): ScrapedCard =>
	({ sourceSlug: o.slug ?? 'sv01', structural: { localId: o.localId, printedNumber: o.printed ?? null, number: o.number ?? 1 } }) as unknown as ScrapedCard

describe('card ids', () => {
	test('a numbered card is padded: "5" -> 005', () => expect(cardLocalId(card({ localId: '5', number: 5 }))).toBe('005'))
	test('a gallery card keeps its letters', () => expect(cardLocalId(card({ localId: '24', printed: 'TG24', number: 24 }))).toBe('TG24'))
	test('promo ids keep their prefix', () => expect(cardLocalId(card({ localId: '61', printed: 'SWSH061', number: 61 }))).toBe('SWSH061'))
	test('a TCGdex-built card keeps TCGdex’s id (My First Battle is "1")', () => expect(cardLocalId(card({ slug: 'tcgdex', localId: '1' }))).toBe('1'))
	test('a Classic Collection card is CC001, not 001', () => expect(cardLocalId(card({ localId: 'CC001', number: 1 }))).toBe('CC001'))
	test('an id of only letters is kept (mep "Museum")', () => expect(cardLocalId(card({ slug: 'tcgdex', localId: 'Museum', number: 0 }))).toBe('Museum'))
	test('TCGdex is asked for the unpadded number', () => expect(tcgdexLocalId(card({ localId: '5', number: 5 }))).toBe('5'))
})

describe('collector keys pair a card with its TCGTracking product', () => {
	test('"005/197" and "5" are the same key', () => { expect(collectorKey('005/197')).toBe('5'); expect(collectorKey(5)).toBe('5') })
	test('a gallery number is its letters', () => expect(collectorKey('tg01/30')).toBe('TG01'))
	test('the card key is the printed alpha number first', () => expect(cardKey(card({ localId: '24', printed: 'TG24', number: 24 }))).toBe('TG24'))
	test('an id of only letters keys on itself', () => expect(cardKey(card({ slug: 'tcgdex', localId: 'Museum', number: 0 }))).toBe('MUSEUM'))
	test('four cards numbered 15 share one collector key (they are told apart by id)', () => {
		const keys = ['CC003', 'CC006', 'CC007', 'CC016'].map((id) => cardKey(card({ localId: id, number: 15 })))
		expect(new Set(keys).size).toBe(1)
		expect(new Set(['CC003', 'CC006'].map((id) => cardLocalId(card({ localId: id, number: 15 })))).size).toBe(2)
	})
})

describe('what stops a set being written', () => {
	test('a failed source blocks', () => expect(blockingProblems(['TCGCSV failed (503): no Prize Pack ids'], true).length).toBe(1))
	test('TCGdex failures block', () => expect(blockingProblems(['3 TCGdex requests failed'], true).length).toBe(1))
	test('no TCGplayer group blocks when the registry has one', () => expect(blockingProblems(['no TCGplayer group found: no variants or provider ids'], true).length).toBe(1))
	test('no TCGplayer group does not block a set the registry has none for', () => expect(blockingProblems(['no TCGplayer group found: no variants or provider ids'], false)).toEqual([]))
	test('nothing wrong blocks nothing', () => expect(blockingProblems([], true)).toEqual([]))
})

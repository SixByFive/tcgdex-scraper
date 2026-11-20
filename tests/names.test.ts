import { describe, expect, test } from 'bun:test'
import { looseName, sameCardName } from '../src/emit/names.ts'
import { nameKey } from '../src/emit/variants.ts'

/** Each pair is the same card, worded differently by two sources (all seen in real emits). */
describe('sameCardName: the same card', () => {
	const same: [string, string][] = [
		['Thievul', '​Thievul'], // pokemon.com puts a zero-width space in some names
		['Professor’s Research', "Professor's Research"],
		['Grass Energy', 'Basic Grass Energy'],
		['Professor’s Research (Professor Rowan)', 'Professor’s Research'],
		['Claydol', 'Claydol LV. 45'],
		['Umbreon ☆', 'Umbreon'],
		['Luxray GL LV.X', 'Luxray  LV. X'],
		['Garchomp C LV.X', 'Garchomp  LV. X'],
		['Pikachu V-UNION', 'Pikachu V-UNION Top Left'],
		['Zacian V-UNION', 'Zacian V-UNION Bottom Right'],
		['Genesect-EX', 'Genesect EX']
	]
	for (const [a, b] of same) test(`${a} = ${b}`, () => expect(sameCardName(a, b)).toBe(true))
})

describe('sameCardName: different cards stay different', () => {
	const different: [string, string][] = [
		['Pikachu', 'Pikachu V'],
		['Pikachu V-UNION', 'Greninja V-UNION'],
		['Charizard', 'Charizard ex'],
		['Fire Energy', 'Water Energy'],
		['Mewtwo EX', 'Mewtwo']
	]
	for (const [a, b] of different) test(`${a} != ${b}`, () => expect(sameCardName(a, b)).toBe(false))
})

test('looseName is stable', () => {
	expect(looseName(looseName('Basic Fire Energy'))).toBe(looseName('Basic Fire Energy'))
})

describe('nameKey (TCGTracking product names)', () => {
	test('drops the number and tags', () => {
		expect(nameKey('Palafin - 062/197 (Cosmos Holo)')).toBe('palafin')
		expect(nameKey('Gardevoir ex (Delta Species)')).toBe('gardevoir ex')
	})
	test('Claydol LV. 45 is Claydol', () => expect(nameKey('Claydol LV. 45')).toBe(nameKey('Claydol')))
})

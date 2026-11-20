/**
 * Whether two sources' English names are the same card. Sources word a name differently without it being another card:
 * curly and straight apostrophes, hyphens, case; "Basic Grass Energy" vs "Grass Energy"; a tag in brackets ("Professor's Research
 * (Professor Rowan)" is a Professor's Research). Used only to check that a source's card at a number is the scraped card.
 */
const plain = (s: unknown) => String(s ?? '').replace(/[​-‍﻿­]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()

export const looseName = (s: unknown): string =>
	plain(s).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^basic /, '').replace(/\s+lv\.?\s*\d+$/, '')
		// "Luxray GL LV.X": pokemon.com prints the GL / C symbol as an image and spaces "LV. X" differently; "Umbreon ☆" is "Umbreon" there
		.replace(/\s+(?:[a-z]{1,2}\s+)?lv\.?\s*x$/, ' lv x').replace(/\s*[☆★]$/, '')
		// a V-UNION is four cards: pokemon.com names each by its position ("Pikachu V-UNION Top Left"), TCGdex doesn't
		.replace(/(v union) (?:top|bottom) (?:left|right)$/, '$1').replace(/\s+/g, ' ').trim()

export const sameCardName = (a: unknown, b: unknown): boolean => looseName(a) === looseName(b)

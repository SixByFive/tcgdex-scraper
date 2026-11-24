/**
 * Whether two sources' English names are the same card. Sources word a name differently without it being another card:
 * curly and straight apostrophes, hyphens, case; "Basic Grass Energy" vs "Grass Energy"; a tag in brackets ("Professor's Research
 * (Professor Rowan)" is a Professor's Research); a space before a number ("Pokégear 3.0" is "Pokégear3.0" on pokemon.com). Used only to check that a source's card at a number is the scraped card.
 */
const plain = (s: unknown) => String(s ?? '').replace(/[​-‍﻿­]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()

export const looseName = (s: unknown): string =>
	plain(s).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^basic /, '').replace(/\s+lv\.?\s*\d+$/, '')
		// "Luxray GL LV.X": pokemon.com prints the GL / C symbol as an image and spaces "LV. X" differently; "Umbreon ☆" is "Umbreon" there
		.replace(/\s+(?:[a-z0-9]{1,2}\s+)?lv\.?\s*x$/, ' lv x').replace(/\s*[☆★◇◆]$/, '')
		// a Platinum Pokémon SP's "G" (Galactic) is an image on pokemon.com ("Zapdos  LV. 60") and a letter at TCGdex ("Zapdos G"; also GL, C, FB, E4, 4)
		.replace(/\s+(?:g|gl|c|fb|e4|4)$/, '')
		// a V-UNION is four cards: pokemon.com names each by its position ("Pikachu V-UNION Top Left"), TCGdex doesn't
		.replace(/(v union) (?:top|bottom) (?:left|right)$/, '$1').replace(/\s+/g, ' ').replace(/(\p{L})\s+(?=\d)/gu, '$1').trim()

// spaces are ignored too: pokemon.com runs words together ("Blend Energy GrassFirePsychicDarkness" vs "Grass Fire Psychic Darkness")
const squash = (s: unknown) => looseName(s).replace(/\s+/g, '')
export const sameCardName = (a: unknown, b: unknown): boolean => squash(a) === squash(b)

// At the same number, "Empoleon" (TCGdex) and "Empoleon LV. X" (pokemon.com) are one card: TCGdex drops the LV.X from the name
const noLvX = (s: unknown) => looseName(s).replace(/\s+lv x$/, '').replace(/\s+/g, '')
export const sameCardAtNumber = (a: unknown, b: unknown): boolean => sameCardName(a, b) || noLvX(a) === noLvX(b)

/**
 * Whether two sources' English names are the same card. Sources word a name differently without it being another card:
 * curly and straight apostrophes, hyphens, case; "Basic Grass Energy" vs "Grass Energy"; a tag in brackets ("Professor's Research
 * (Professor Rowan)" is a Professor's Research). Used only to check that a source's card at a number is the scraped card.
 */
const plain = (s: unknown) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()

export const looseName = (s: unknown): string =>
	plain(s).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^basic /, '').replace(/\s+/g, ' ').trim()

export const sameCardName = (a: unknown, b: unknown): boolean => looseName(a) === looseName(b)

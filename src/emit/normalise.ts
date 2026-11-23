import type { EnergyTypes, Lang, ScrapedCard } from '../types/scraped.ts'

/**
 * Turns what pokemon.com shows into the values the Experimental schema allows (schemas/pokemon.ts).
 * A value that can't be mapped is left out and reported in `warnings`: never guessed.
 */

// these are TypeScript unions in the schema, not runtime lists; keep in sync with schemas/pokemon.ts
const STAGES = ['Basic', 'BREAK', 'LEVEL-UP', 'MEGA', 'RESTORED', 'Stage1', 'Stage2', 'VMAX', 'V-UNION', 'Baby', 'VSTAR'] as const
const SUFFIXES = ['EX', 'GX', 'V', 'Legend', 'Prime', 'SP', 'TAG TEAM-GX', 'ex'] as const
const TRAINER_TYPES = ['Supporter', 'Item', 'Stadium', 'Tool', 'Ace Spec', 'Technical Machine', 'Goldenrod Game Corner', "Rocket's Secret Machine"] as const
const TYPES = ['Colorless', 'Darkness', 'Dragon', 'Fairy', 'Fighting', 'Fire', 'Grass', 'Lightning', 'Metal', 'Psychic', 'Water'] as const

type Stage = typeof STAGES[number]
type Suffix = typeof SUFFIXES[number]
type TrainerType = typeof TRAINER_TYPES[number]
type PokemonType = typeof TYPES[number]

const ci = <T extends string>(list: readonly T[], value: string | null | undefined): T | undefined =>
	// exact match first: 'ex' (current) and 'EX' (old) differ only by case
	value ? (list.find((x) => x === value.trim()) ?? list.find((x) => x.toLowerCase() === value.trim().toLowerCase())) : undefined

/** A stage as the schema spells it, from another source's spelling ("Stage1", "stage 2", "Restored"...). */
export const toStage = (raw: string | null | undefined): Stage | undefined =>
	ci(STAGES, raw) ?? ci(STAGES, raw?.replace(/\s+/g, ''))

/** "TG01", "GG01", "SV001": a number with a letter prefix, kept as printed (upper case, no spaces). Plain numbers return undefined. */
const alphaNumber = (printed: string | null | undefined): string | undefined => {
	const p = printed?.replace(/\s+/g, '')
	return p && /^[A-Za-z]+\d+[A-Za-z]?$/.test(p) ? p.toUpperCase() : undefined
}

/** The card's id inside its set, as TCGdex and the repo write it: "TG01" for a Trainer Gallery card, "005" for card 5. */
export const cardLocalId = (card: ScrapedCard, keepTcgdexId = false, plainNumber = false): string =>
	// A card built from TCGdex keeps an id that is not a plain number ("Museum", "TG01"), and so does one whose pages aren't numbered
	// 1..n (the Classic Collection's "CC001"). A plain number is padded to three digits like every other set's, except in a set the
	// registry marks `keepTcgdexIds` (My First Battle is "1", not "001"). `plainNumber` (registry `plainCardIds`) drops the printed prefix too:
	// the Hidden Fates Shiny Vault's "SV1" is "001".
	plainNumber ? String(card.structural.number ?? card.structural.localId).padStart(3, '0') :
	(/^[A-Za-z]/.test(String(card.structural.localId)) || (card.sourceSlug === 'tcgdex' && (keepTcgdexId || !/^\d+$/.test(String(card.structural.localId)))) ? card.structural.localId : undefined) ?? alphaNumber(card.structural.printedNumber) ?? String(card.structural.localId).padStart(3, '0')

/** The same id without the zero padding of plain numbers, the way the TCGdex API is asked for it. */
export const tcgdexLocalId = (card: ScrapedCard): string =>
	alphaNumber(card.structural.printedNumber) ?? String(card.structural.localId)

/** What pairs a scraped card with its TCGTracking product: "5" for card 5 (also "005/197"), "TG01" for a gallery card. */
export const collectorKey = (printed: string | number | null | undefined): string | undefined => {
	const head = String(printed ?? '').split('/')[0]?.replace(/\s+/g, '')
	if (!head) return undefined
	// "055a/111" is the alternate art of card 55: key "55a"
	const suffixed = head.match(/^(\d+)([A-Za-z])$/)
	if (suffixed) return `${Number(suffixed[1])}${suffixed[2]!.toLowerCase()}`
	return /^\d+$/.test(head) ? String(Number(head)) : alphaNumber(head)
}
export const cardKey = (card: ScrapedCard): string | undefined =>
	alphaNumber(card.structural.printedNumber)
		?? (card.sourceSlug === 'tcgdex' && /^\d+[A-Za-z]$/.test(String(card.structural.localId)) ? collectorKey(card.structural.localId) : undefined)
		?? (card.sourceSlug === 'tcgdex' && /^[A-Za-z]+$/.test(String(card.structural.localId)) ? String(card.structural.localId).toUpperCase() : collectorKey(card.structural.number))

export const toType = (t: EnergyTypes | string): PokemonType | undefined => ci(TYPES, t)

export interface Normalised {
	category: 'Pokemon' | 'Trainer' | 'Energy'
	stage?: Stage
	suffix?: Suffix
	trainerType?: TrainerType
	energyType?: 'Normal' | 'Special'
	warnings: string[]
}

export function normaliseKind(card: ScrapedCard): Normalised {
	const s = card.structural
	const en = card.locales.en
	const warnings: string[] = []
	let category = s.category
	let stage: Stage | undefined
	let suffix: Suffix | undefined
	let trainerType: TrainerType | undefined
	let energyType: 'Normal' | 'Special' | undefined

	const raw = s.stage ?? ''
	const sub = s.trainerSubtype ?? ''

	// pokemon.com titles Mega ex cards "Mega Evolution ex", which the scrape stored as a Trainer subtype
	if (/^mega evolution/i.test(sub) || /^mega evolution/i.test(raw)) {
		category = 'Pokemon'
		stage = 'MEGA'
		suffix = 'ex'
	} else if (category === 'Pokemon') {
		// "Tera" is a card label (Tera Pokémon ex), not a stage: like a bare "ex" it says nothing about the stage
		// older cards hyphenate it ("Genesect-EX" is titled "-EX", "Pikachu & Zekrom GX" is "TAG TEAM")
		const bare = raw.replace(/^-/, '')
		const asSuffix = ci(SUFFIXES, bare) ?? (/^tera$/i.test(bare) ? 'ex' as const : /^tag team$/i.test(bare) ? 'TAG TEAM-GX' as const : undefined)
		if (asSuffix) {
			// the page titles these just "<suffix>" and gives no stage; a Pokémon that evolves from nothing is Basic
			suffix = asSuffix
			if (!en?.evolvesFromName) stage = 'Basic'
			else warnings.push(`stage unknown: "${en.name}" is an evolving ${asSuffix} (pokemon.com gives no stage)`)
		} else if (raw === 'Mega') stage = 'MEGA'
		else if (/^lv\.?\s?x$/i.test(raw)) stage = 'LEVEL-UP'
		else if (raw) {
			stage = ci(STAGES, raw)
			if (!stage) warnings.push(`unmapped stage "${raw}"`)
		}
	} else if (category === 'Trainer' && /^(special|basic)$/i.test(sub) && /\benergy\b/i.test(en?.name ?? '')) {
		// pokemon.com files some Energy cards under Trainer: Special Energy (Ignition Energy) as "Special", Basic Energy as "Basic"
		category = 'Energy'
		energyType = /^special$/i.test(sub) ? 'Special' : 'Normal'
	} else if (category === 'Trainer') {
		trainerType = ci(TRAINER_TYPES, sub) ?? (/tool/i.test(sub) ? 'Tool' : undefined)
		if (!trainerType && sub) warnings.push(`unmapped trainer type "${sub}"`)
	} else if (category === 'Energy') {
		energyType = sub === 'Special' ? 'Special' : sub === 'Normal' || sub === 'Basic' ? 'Normal' : undefined
		// trainer-kit Energy cards carry no subtype at all; a plain "<Type> Energy" is a Basic Energy
		if (!energyType && !sub && /^(basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy|dragon|colorless) energy$/i.test(en?.name?.trim() ?? '')) energyType = 'Normal'
		if (!energyType) warnings.push(`unmapped energy type "${sub}"`)
	}

	if (category === 'Pokemon' && !suffix && en?.name) {
		const m = en.name.match(/\s(ex|EX|GX|V|TAG TEAM-GX)$/)
		if (m) suffix = ci(SUFFIXES, m[1]) ?? undefined
	}
	return { category, stage, suffix, trainerType, energyType, warnings }
}

/** What pokemon.com prints for the rarity of a GX, EX or V card, and the schema's name for it (TCGdex and cards-database call a GX "Ultra Rare"). */
const RARITY_ALIASES: Record<string, string> = {
	'rare holo gx': 'Ultra Rare', 'rare holo ex': 'Ultra Rare', 'rare ultra': 'Ultra Rare', 'rare break': 'Ultra Rare',
	'rare holo v': 'Holo Rare V', 'rare holo vmax': 'Holo Rare VMAX', 'rare holo vstar': 'Holo Rare VSTAR'
}

export function mapRarity(raw: string | null, rarities: readonly string[]): { rarity?: string; warning?: string } {
	if (!raw) return {}
	const alias = RARITY_ALIASES[raw.trim().toLowerCase()]
	if (alias && rarities.includes(alias)) return { rarity: alias }
	// gallery and vault cards print "Trainer Gallery Holo Rare", "Shiny Vault Rare Holo": the rarity is what follows
	const bare = raw.trim().replace(/^(trainer gallery|galarian gallery|shiny vault|classic collection)\s+/i, '')
	// pokemon.com prints "Amazing" / "Radiant" for what the schema calls "Amazing Rare" / "Radiant Rare"
	const want = [bare, `${bare} Rare`].map((s) => s.toLowerCase())
	const hit = want.map((w) => rarities.find((r) => r.toLowerCase() === w)).find(Boolean)
	return hit ? { rarity: hit } : { warning: `unmapped rarity "${raw}"` }
}

export const damageValue = (d: string | null): number | string | undefined =>
	d ? (/^\d+$/.test(d) ? Number(d) : d) : undefined

export const typeList = (types: (EnergyTypes | string)[]): PokemonType[] =>
	types.flatMap((t) => { const m = toType(t); return m ? [m] : [] })

export const typeValues = (list: { type: EnergyTypes; value: string }[]) =>
	list.flatMap((w) => { const type = toType(w.type); return type ? [{ type, value: w.value }] : [] })

/** Per-language map of a field of the locale block, skipping languages that have none. */
export function perLang(card: ScrapedCard, pick: (block: NonNullable<ScrapedCard['locales'][Lang]>) => string | null | undefined): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [lang, block] of Object.entries(card.locales)) {
		const v = block ? pick(block) : null
		if (v) out[lang] = v
	}
	return out
}

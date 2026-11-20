import pLimit from 'p-limit'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }

const TCGDEX = 'https://api.tcgdex.net/v2'
const LANGS = ['en', 'fr', 'de', 'es', 'it', 'pt'] as const

export interface CardExtras {
	/** the English name TCGdex has for the card, to check it is the same card as the scraped one */
	name?: string
	regulationMark?: string
	/** national Pokédex number(s), for a card pokemon.com gives no Pokédex link for */
	dexId?: number[]
	/** the evolutionary stage, which pokemon.com leaves off ex/V cards: "Stage1", "Stage2", ... */
	stage?: string
	description: Record<string, string>
	/** the variants TCGdex lists for the card (finish, foil, size, stamps) with the provider ids it knows */
	variants?: TcgdexVariant[]
	/** set by `enrich-scraped`: how many of the card's variants were added from `variants` because TCGTracking has none like them */
	variantsAdded?: number
}

export interface TcgdexVariant {
	type: string
	foil?: string
	size?: string
	stamps?: string[]
	cardmarket?: number
	tcgplayer?: number
	cardtrader?: number
}

export interface TcgdexCard {
	name?: string; description?: string | null; regulationMark?: string | null; stage?: string | null; dexId?: number[] | null
	variants_detailed?: { type?: string; foil?: string; size?: string; stamp?: string[]; thirdParty?: { cardmarket?: number; tcgplayer?: number; cardtrader?: number } }[]
	// what a card page carries beyond the extras above (used to build a card TCGdex has and pokemon.com lacks)
	category?: string; rarity?: string | null; hp?: number | null; types?: string[] | null; image?: string | null; illustrator?: string | null
	evolveFrom?: string | null; retreat?: number | null; trainerType?: string | null; energyType?: string | null; effect?: string | null
	attacks?: { cost?: string[]; name?: string; effect?: string | null; damage?: string | number | null }[] | null
	abilities?: { type?: string; name?: string; effect?: string | null }[] | null
	weaknesses?: { type: string; value?: string }[] | null; resistances?: { type: string; value?: string }[] | null
}

/** One card in one language; null when TCGdex doesn't have it. Responses are cached on disk so a re-run costs nothing. */
export async function fetchCard(setId: string, localId: string, lang: string, fresh: boolean): Promise<TcgdexCard | null> {
	const file = join(config.cacheDir, 'tcgdex', setId, lang, `${localId}.json`)
	const cached = existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as TcgdexCard) : null
	if (!fresh && cached) return cached
	// A failed request is tried again; if the API still doesn't answer, the last good answer on disk is used rather than nothing:
	// an empty result would blank the card's regulation mark, stage and text.
	let lastError: unknown
	for (let attempt = 0; attempt < 4; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt))
		try {
			const res = await fetch(`${TCGDEX}/${lang}/cards/${setId}-${localId}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(20000) })
			if (res.status === 404) return null
			if (!res.ok) throw new Error(`TCGdex ${lang}/cards/${setId}-${localId} -> ${res.status}`)
			const body = await res.json().catch(() => null)
			if (!body || typeof body !== 'object') return null
			await mkdir(join(config.cacheDir, 'tcgdex', setId, lang), { recursive: true })
			await writeFile(file, JSON.stringify(body))
			return body as TcgdexCard
		} catch (err) {
			lastError = err
		}
	}
	if (cached) return cached
	throw lastError
}

/**
 * Flavor text per language and the printed regulation mark of each card of a set, from the TCGdex API.
 * Keyed by the scraped localId (as a string, e.g. "5"). A card or language TCGdex lacks is simply absent.
 * `fresh` ignores the on-disk cache, so a card TCGdex has since filled in is picked up.
 */
export async function fetchCardExtras(setId: string, localIds: string[], warn: (m: string) => void, fresh = false, stats?: { failures: number }): Promise<Map<string, CardExtras>> {
	const limit = pLimit(6)
	const out = new Map<string, CardExtras>()
	let failures = 0

	await Promise.all(localIds.map((raw) => limit(async () => {
		const extras: CardExtras = { description: {} }
		// TCGdex pads most ids to 3 digits, but not all sets: try the padded form, then the raw one
		const forms = [...new Set([raw.padStart(3, '0'), raw])]
		for (const lang of LANGS) {
			let card: TcgdexCard | null = null
			try {
				for (const form of forms) { card = await fetchCard(setId, form, lang, fresh); if (card) break }
			} catch (err) {
				if (failures++ < 3) warn(`TCGdex: ${(err as Error).message}`)
				continue
			}
			if (!card) continue
			if (lang === 'en') { extras.name = card.name?.trim(); if (card.regulationMark) extras.regulationMark = card.regulationMark; if (card.stage) extras.stage = card.stage
				if (card.dexId?.length) extras.dexId = card.dexId
				if (card.variants_detailed?.length) extras.variants = card.variants_detailed.filter((v) => v.type).map((v) => ({
					type: v.type!, foil: v.foil || undefined, size: v.size && v.size !== 'standard' ? v.size : undefined,
					stamps: v.stamp?.length ? [...v.stamp].sort() : undefined,
					cardmarket: v.thirdParty?.cardmarket || undefined, tcgplayer: v.thirdParty?.tcgplayer || undefined, cardtrader: v.thirdParty?.cardtrader || undefined
				})) }
			const text = card.description?.trim()
			if (text) extras.description[lang] = text
		}
		out.set(raw, extras)
	})))
	if (stats) stats.failures = failures
	if (failures > 3) warn(`TCGdex: ${failures} requests failed in total; those languages are missing`)
	return out
}

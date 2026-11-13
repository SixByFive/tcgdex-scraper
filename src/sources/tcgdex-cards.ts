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
	/** the evolutionary stage, which pokemon.com leaves off ex/V cards: "Stage1", "Stage2", ... */
	stage?: string
	description: Record<string, string>
}

interface TcgdexCard { name?: string; description?: string | null; regulationMark?: string | null; stage?: string | null }

/** One card in one language; null when TCGdex doesn't have it. Responses are cached on disk so a re-run costs nothing. */
async function fetchCard(setId: string, localId: string, lang: string, fresh: boolean): Promise<TcgdexCard | null> {
	const file = join(config.cacheDir, 'tcgdex', setId, lang, `${localId}.json`)
	if (!fresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'))
	const res = await fetch(`${TCGDEX}/${lang}/cards/${setId}-${localId}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent } })
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`TCGdex ${lang}/cards/${setId}-${localId} -> ${res.status}`)
	const body = await res.json().catch(() => null)
	if (!body || typeof body !== 'object') return null
	await mkdir(join(config.cacheDir, 'tcgdex', setId, lang), { recursive: true })
	await writeFile(file, JSON.stringify(body))
	return body as TcgdexCard
}

/**
 * Flavor text per language and the printed regulation mark of each card of a set, from the TCGdex API.
 * Keyed by the scraped localId (as a string, e.g. "5"). A card or language TCGdex lacks is simply absent.
 * `fresh` ignores the on-disk cache, so a card TCGdex has since filled in is picked up.
 */
export async function fetchCardExtras(setId: string, localIds: string[], warn: (m: string) => void, fresh = false): Promise<Map<string, CardExtras>> {
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
			if (lang === 'en') { extras.name = card.name?.trim(); if (card.regulationMark) extras.regulationMark = card.regulationMark; if (card.stage) extras.stage = card.stage }
			const text = card.description?.trim()
			if (text) extras.description[lang] = text
		}
		out.set(raw, extras)
	})))
	if (failures > 3) warn(`TCGdex: ${failures} requests failed in total; those languages are missing`)
	return out
}

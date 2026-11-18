import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }

/**
 * PokeData (pokedata.io): a free JSON API with no login, whose robots file allows crawling. It is used only to cross-check
 * what the other sources say (names, numbers, TCGplayer ids); nothing in the repo is written from it. Responses are cached
 * on disk for a day and requests are spaced out.
 */
const BASE = 'https://www.pokedata.io/api'

export interface PokedataSet { id: number; code: string; name: string; language: string; series: string }
export interface PokedataCard { id: number; name: string; num: string; secret: boolean; tcgplayer_id?: string | null; set_id: number; img_url?: string }

/** Sets PokeData names differently from the registry. */
const SET_ALIASES: Record<string, number> = { svp: 515, mep: 575, sv01: 510 }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
let lastCall = 0

async function getJson<T>(path: string, cacheKey: string): Promise<T> {
	const file = join(config.cacheDir, 'pokedata', `${cacheKey}.json`)
	if (existsSync(file)) {
		const raw = JSON.parse(await readFile(file, 'utf8')) as { at: number; data: T }
		if (Date.now() - raw.at < 24 * 3600 * 1000) return raw.data
	}
	const wait = lastCall + 1000 - Date.now()
	if (wait > 0) await new Promise((r) => setTimeout(r, wait))
	lastCall = Date.now()
	let data: T | undefined
	let lastErr: unknown
	for (let attempt = 0; attempt < 4 && data === undefined; attempt++) {
		if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt))
		try {
			const res = await fetch(`${BASE}/${path}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(30000) })
			if (!res.ok) throw new Error(`PokeData ${path} -> ${res.status}`)
			data = (await res.json()) as T
		} catch (err) { lastErr = err }
	}
	if (data === undefined) throw lastErr
	// (the response is cached below)
	await mkdir(join(config.cacheDir, 'pokedata'), { recursive: true })
	await writeFile(file, JSON.stringify({ at: Date.now(), data }))
	return data
}

/** PokeData's id for one of our sets: an alias, else the English set with the same name; undefined when it has none. */
export async function pokedataSetId(setId: string, name: string): Promise<number | undefined> {
	if (SET_ALIASES[setId]) return SET_ALIASES[setId]
	const sets = (await getJson<PokedataSet[]>('sets', 'sets')).filter((s) => s.language === 'ENGLISH')
	const hits = sets.filter((s) => norm(s.name) === norm(name))
	return hits.length === 1 ? hits[0]!.id : undefined
}

export const pokedataCards = (pokedataSet: number) => getJson<PokedataCard[]>(`cards?set_id=${pokedataSet}`, `cards-${pokedataSet}`)

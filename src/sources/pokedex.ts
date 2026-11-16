import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { ScrapedCard } from '../types/scraped.ts'

const CACHE_PATH = join(config.cacheDir, 'pokeapi-species.json')

const SLUG_ALIASES: Record<string, string> = {
    'nidoran-female': 'nidoran-f',
    'nidoran-male': 'nidoran-m'
}
 
async function loadCache(): Promise<Record<string, number | null>> {
	try {
		return JSON.parse(await readFile(CACHE_PATH, 'utf8'))
	} catch {
		return {}
	}
}

async function saveCache(c: Record<string, number | null>): Promise<void> {
	await mkdir(dirname(CACHE_PATH), { recursive: true })
	await writeFile(CACHE_PATH, JSON.stringify(c, null, 2))
}

/** null: PokeAPI answered and has no such species. Throws when it can't be reached (after a few tries). */
async function fetchDexId(slug: string): Promise<number | null> {
	const resolved = SLUG_ALIASES[slug] ?? slug
	let lastError: unknown
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const r = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${resolved}`, { signal: AbortSignal.timeout(15000) })
			if (!r.ok) return null
			const data = await r.json() as { id: number }
			return data.id ?? null
		} catch (err) {
			lastError = err
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
		}
	}
	throw lastError
}

export async function resolvePokedex(setId: string): Promise<void> {
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
	const cache = await loadCache()

	// 1. Load all cards, collect unique slugs
	const loaded: { file: string; card: ScrapedCard }[] = []
	const slugs = new Set<string>()
	for (const f of files) {
		const card = JSON.parse(await readFile(join(dir, f), 'utf8')) as ScrapedCard
		loaded.push({ file: f, card })
		if (card.structural.pokedexSlug) slugs.add(card.structural.pokedexSlug)
	}
	console.log(`[pokedex] ${slugs.size} unique slugs across ${loaded.length} cards`)

	// 2. Resolve slug → dex id (cached, polite)
	let resolved = 0
	let missed = 0
	const unreachable = new Set<string>()
	let inARow = 0
	for (const slug of slugs) {
		if (slug in cache && cache[slug] !== null) continue
		// PokeAPI being down is not "no such species": nothing is cached for it, and after three slugs in a row it is given up on
		if (inARow >= 3) { unreachable.add(slug); continue }
		try {
			const id = await fetchDexId(slug)
			inARow = 0
			cache[slug] = id
			if (id) resolved++
			else { missed++; console.warn(`[pokedex] no match for "${slug}"`) }
		} catch {
			inARow++
			unreachable.add(slug)
		}
		await new Promise((r) => setTimeout(r, 150))
	}
	await saveCache(cache)
	console.log(`[pokedex] resolved ${resolved} new, ${missed} unresolved${unreachable.size ? `, ${unreachable.size} not looked up (pokeapi.co unreachable): run \`pokedex <setId>\` again later` : ''}`)

	// 3. Write dexIds back into each card JSON
	for (const { file, card } of loaded) {
		const slug = card.structural.pokedexSlug
		const id = slug ? cache[slug] : null
		// a slug that could not be looked up keeps the dex ids the card already has
		if (slug && unreachable.has(slug)) continue
		card.structural.dexIds = id ? [id] : []
		await writeFile(join(dir, file), JSON.stringify(card, null, 2))
	}
	console.log(`[pokedex] done → ${dir}`)
}
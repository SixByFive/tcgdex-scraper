import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import { intlDir, listSets as listExperimentalSets } from '../util/experimental.ts'

/**
 * What the Catalog page shows: every set the scraper knows (registry/pokemon-intl.json), joined with what is already scraped
 * (cache/pokemon-com/<set id>) and what is already in the Experimental repo. Read-only; nothing here writes anything.
 */

const REGISTRY_FILE = join(process.cwd(), 'registry', 'pokemon-intl.json')

interface RegistryFile {
	generatedAt?: string
	sets: { id: string; series: string; name: string; releaseDate: string | null; official: number | null; total: number | null; slug: string | null; tcgplayerGroup: number | null; skip?: string; notes?: string[] }[]
}

export type SetState = 'in-experimental' | 'scraped' | 'ready' | 'skipped'

export interface CatalogSet {
	id: string
	name: string
	releaseDate: string | null
	official: number | null
	total: number | null
	/** pokemon.com's expansion slug, which is what is scraped */
	slug: string | null
	tcgplayerGroup: number | null
	/** why the set cannot be scraped */
	skip?: string
	notes: string[]
	/** cards in cache/pokemon-com/<id>, or null when it is not scraped */
	scraped: number | null
	/** card files in the Experimental repo, or null when the set is not there */
	experimental: number | null
	/** false for a set that is in the Experimental repo but not in the registry */
	known: boolean
	state: SetState
}

export interface CatalogSeries { id: string; name: string; sets: CatalogSet[] }

export interface Catalog {
	generatedAt: string
	registryGeneratedAt?: string
	repo: string
	repoValid: boolean
	series: CatalogSeries[]
}

async function jsonCount(dir: string): Promise<number | null> {
	try { return (await readdir(dir)).filter((f) => f.endsWith('.json')).length } catch { return null }
}

async function tsCount(dir: string): Promise<number> {
	try { return (await readdir(dir)).filter((f) => f.endsWith('.ts')).length } catch { return 0 }
}

const stateOf = (s: Pick<CatalogSet, 'experimental' | 'scraped' | 'slug' | 'skip'>): SetState =>
	s.experimental !== null ? 'in-experimental' : s.scraped ? 'scraped' : s.skip || !s.slug ? 'skipped' : 'ready'

export async function buildCatalog(repo: string): Promise<Catalog> {
	let registry: RegistryFile = { sets: [] }
	try { registry = JSON.parse(await readFile(REGISTRY_FILE, 'utf8')) as RegistryFile } catch { /* no registry yet: only the repo's sets are listed */ }

	const repoValid = existsSync(intlDir(repo))
	const inRepo = new Map<string, { name: string; series: string; seriesName: string; cards: number }>()
	if (repoValid) {
		try {
			for (const s of await listExperimentalSets(repo)) inRepo.set(s.id, { name: s.name.en ?? s.id, series: s.series.id, seriesName: s.series.name.en ?? s.series.id, cards: await tsCount(s.dir) })
		} catch { /* a data file that does not load: show what is known */ }
	}

	const seriesNames = new Map<string, string>()
	const bySeries = new Map<string, CatalogSet[]>()
	const add = (series: string, set: CatalogSet) => { bySeries.set(series, [...(bySeries.get(series) ?? []), set]) }
	const seen = new Set<string>()

	for (const r of registry.sets) {
		seen.add(r.id)
		const there = inRepo.get(r.id)
		if (there) seriesNames.set(there.series, there.seriesName)
		const set: CatalogSet = {
			id: r.id, name: r.name, releaseDate: r.releaseDate, official: r.official, total: r.total, slug: r.slug, tcgplayerGroup: r.tcgplayerGroup,
			skip: r.skip, notes: r.notes ?? [], scraped: await jsonCount(join(config.cacheDir, 'pokemon-com', r.id)),
			experimental: there ? there.cards : null, known: true, state: 'ready'
		}
		set.state = stateOf(set)
		add(r.series, set)
	}
	// in the repo but not in the registry (promos, older eras): listed too, so the repo's list is complete
	for (const [id, there] of inRepo) {
		if (seen.has(id)) continue
		seriesNames.set(there.series, there.seriesName)
		add(there.series, { id, name: there.name, releaseDate: null, official: null, total: null, slug: null, tcgplayerGroup: null, notes: [], scraped: await jsonCount(join(config.cacheDir, 'pokemon-com', id)), experimental: there.cards, known: false, state: 'in-experimental' })
	}

	const series: CatalogSeries[] = [...bySeries].map(([id, sets]) => ({
		id, name: seriesNames.get(id) ?? id,
		sets: sets.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.name.localeCompare(b.name))
	}))
	series.sort((a, b) => (b.sets.find((s) => s.releaseDate)?.releaseDate ?? '').localeCompare(a.sets.find((s) => s.releaseDate)?.releaseDate ?? '') || a.name.localeCompare(b.name))
	return { generatedAt: new Date().toISOString(), registryGeneratedAt: registry.generatedAt, repo, repoValid, series }
}

/** A registry set by id: the slug and series a scrape needs, taken from the registry so the page cannot make them up. */
export async function registrySet(id: string): Promise<{ slug: string; series: string; tcgplayerGroup: number | null } | undefined> {
	try {
		const found = (JSON.parse(await readFile(REGISTRY_FILE, 'utf8')) as RegistryFile).sets.find((s) => s.id === id)
		return found?.slug && !found.skip ? { slug: found.slug, series: found.series, tcgplayerGroup: found.tcgplayerGroup } : undefined
	} catch { return undefined }
}

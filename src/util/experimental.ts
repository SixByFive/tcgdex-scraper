import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import config from '../../config.json' with { type: 'json' }

/**
 * Helpers for writing into the TCGdex Experimental repo (the game-independent one with `data/<game>/<dataset>/...`).
 * The layout (`renderCard`, `renderRecord`) and the vocabularies (rarities, stamps, foils) are loaded from that repo
 * itself, so this tool never keeps its own copy of them.
 */

export const defaultRepo: string = (config as Record<string, unknown>).experimentalRepo as string ?? 'H:/TCGDex Experimental'

export const intlDir = (repo: string) => join(repo, 'data', 'pokemon', 'intl')

export interface FormatModule {
	renderCard(card: Record<string, unknown>, previous?: string): string
	renderRecord(type: 'CardSet' | 'Series', record: Record<string, unknown>): string
}

export interface SchemaModule {
	rarities: readonly string[]
	stamps: readonly string[]
	foils: readonly string[]
	subtypes: readonly string[]
	regulationMarks: readonly string[]
}

const load = async <T>(repo: string, rel: string): Promise<T> => import(pathToFileURL(join(repo, rel)).href) as Promise<T>

export const loadFormat = (repo: string) => load<FormatModule>(repo, 'scripts/data/format.ts')
export const loadSchema = (repo: string) => load<SchemaModule>(repo, 'schemas/pokemon.ts')

/** provider -> { subtypes }: which variant types (price groups) each provider can price. `subtypes: {}` means ids only. */
export type PriceProviderRules = Record<string, { subtypes: Record<string, string> }>
export const loadPriceProviders = async (repo: string): Promise<PriceProviderRules> =>
	(await load<{ default: PriceProviderRules }>(repo, 'data/price-providers.ts')).default

export interface SeriesEntry { id: string; name: Record<string, string>; file: string; folder: string }
export interface SetEntry {
	id: string
	name: Record<string, string>
	prices?: Record<string, number>
	file: string
	/** the folder holding the set's card files */
	dir: string
	series: SeriesEntry
}

const defaultOf = async (file: string) => (await import(pathToFileURL(file).href + `?t=${Date.now()}`)).default

/** Every series of the dataset (a `<Series>.ts` file next to its folder). */
export async function listSeries(repo: string): Promise<SeriesEntry[]> {
	const dir = intlDir(repo)
	const out: SeriesEntry[] = []
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
		const file = join(dir, entry.name)
		const data = await defaultOf(file)
		out.push({ id: data.id, name: data.name, file, folder: join(dir, entry.name.slice(0, -3)) })
	}
	return out
}

/** Every set of every series. */
export async function listSets(repo: string): Promise<SetEntry[]> {
	const out: SetEntry[] = []
	for (const series of await listSeries(repo)) {
		let entries
		try { entries = await readdir(series.folder, { withFileTypes: true }) } catch { continue }
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
			const file = join(series.folder, entry.name)
			const data = await defaultOf(file)
			out.push({ id: data.id, name: data.name, prices: data.prices, file, dir: join(series.folder, entry.name.slice(0, -3)), series })
		}
	}
	return out
}

/** File and folder names are the English name; characters Windows can't hold in a name are dropped. */
export const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()

export const today = () => new Date().toISOString().slice(0, 10)

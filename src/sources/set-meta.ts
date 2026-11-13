import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import { fetchSetInfo, fetchCards, listPokemonSets } from '../util/tcgtracking-open.ts'
import { defaultRepo, fileSafe, intlDir, listSeries, listSets, loadFormat, today, type SeriesEntry } from '../util/experimental.ts'

/**
 * Builds the set file (and the series file, when the series is new) for a set in the Experimental repo.
 *
 * Sources, in order of trust, each filling only what the one before left empty:
 *   1. command line overrides
 *   2. the TCGdex API: localized names, official/total counts, release date, abbreviation, series
 *   3. TCGTracking: the TCGplayer group id, abbreviation, release date, English name
 *   4. the pokemon.com scrape: the official card count
 * Nothing is estimated: a value no source has is left out.
 */

const LANGS = ['en', 'fr', 'de', 'es', 'it', 'pt'] as const
const TCGDEX = 'https://api.tcgdex.net/v2'

export interface SetMetaOptions {
	setId: string
	repo?: string
	/** series id (e.g. "sv"); needed only when TCGdex doesn't know the set yet */
	series?: string
	/** English series name, for a series that has no file yet and TCGdex doesn't know */
	seriesName?: string
	/** English set name override */
	name?: string
	/** TCGplayer group id; found by name/abbreviation when omitted */
	tcgplayerSet?: number
	releaseDate?: string
	abbreviation?: string
	apply?: boolean
	overwrite?: boolean
	log?: (line: string) => void
}

export interface SetMetaResult {
	setFile: string
	seriesFile: string | null
	record: Record<string, unknown>
	seriesRecord: Record<string, unknown> | null
	written: string[]
	notes: string[]
}

interface TcgdexSet {
	name?: string
	releaseDate?: string
	cardCount?: { official?: number; total?: number }
	abbreviation?: { official?: string }
	serie?: { id: string; name: string }
}

async function tcgdex<T>(path: string): Promise<T | null> {
	const res = await fetch(`${TCGDEX}/${path}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent } })
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`TCGdex ${path} -> ${res.status}`)
	// a missing set can come back as 200 with a non-object body; treat that as not found
	const body = await res.json().catch(() => null)
	return body && typeof body === 'object' ? body as T : null
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

async function scrapedOfficialCount(setId: string): Promise<number | undefined> {
	try {
		const raw = await readFile(join(config.cacheDir, 'pokemon-com', setId, '001.json'), 'utf8')
		const total = JSON.parse(raw)?.structural?.total
		return Number.isFinite(total) ? total : undefined
	} catch {
		return undefined
	}
}

export async function buildSetMeta(opts: SetMetaOptions): Promise<SetMetaResult> {
	const log = opts.log ?? console.log
	const repo = opts.repo ?? defaultRepo
	const notes: string[] = []
	const sources = new Set<string>()

	// ---- 1. TCGdex -------------------------------------------------------------------------------------------------
	const byLang: Partial<Record<(typeof LANGS)[number], TcgdexSet>> = {}
	for (const lang of LANGS) {
		const s = await tcgdex<TcgdexSet>(`${lang}/sets/${opts.setId}`)
		if (s?.name) byLang[lang] = { ...s, name: s.name.trim() }
	}
	const dex = byLang.en
	if (dex) sources.add('tcgdex-api')
	else notes.push(`TCGdex has no set "${opts.setId}" yet; using TCGTracking and the scrape`)

	// ---- 2. TCGTracking --------------------------------------------------------------------------------------------
	let groupId = opts.tcgplayerSet
	const englishGuess = opts.name ?? dex?.name
	if (!groupId) {
		const sets = await listPokemonSets()
		const abbr = (opts.abbreviation ?? dex?.abbreviation?.official)?.toLowerCase()
		const matches = sets.filter((s) => {
			const bare = s.name.includes(':') ? s.name.slice(s.name.indexOf(':') + 1) : s.name
			return (englishGuess && norm(bare) === norm(englishGuess)) || (abbr && s.abbreviation?.toLowerCase() === abbr)
		})
		if (matches.length === 1) groupId = matches[0]!.id
		else if (matches.length > 1) notes.push(`TCGTracking: several sets match (${matches.map((m) => `${m.id} ${m.name}`).join('; ')}); pass --tcgplayer-set`)
		else notes.push('TCGTracking: no matching set found; pass --tcgplayer-set to link one')
	}
	let tracked: Awaited<ReturnType<typeof fetchSetInfo>> | undefined
	let trackedNumbered: number | undefined
	if (groupId) {
		tracked = await fetchSetInfo(groupId)
		sources.add('tcgtracking')
		// the number of numbered singles is the set's total (with secret rares); only trusted when TCGdex lacks it
		const cards = await fetchCards(groupId)
		trackedNumbered = cards.products.filter((p) => p.number).length || undefined
	}

	// ---- 3. fields -------------------------------------------------------------------------------------------------
	const trackedName = tracked?.set_name?.includes(':') ? tracked.set_name.slice(tracked.set_name.indexOf(':') + 1).trim() : tracked?.set_name
	const name: Record<string, string> = {}
	for (const lang of LANGS) if (byLang[lang]?.name) name[lang] = byLang[lang]!.name!
	if (opts.name) name.en = opts.name
	if (!name.en && trackedName) name.en = trackedName
	if (!name.en) throw new Error(`No English name for ${opts.setId}: pass --name`)

	const official = dex?.cardCount?.official ?? await scrapedOfficialCount(opts.setId)
	if (official != null && dex?.cardCount?.official == null) sources.add('pokemon.com')
	let total = dex?.cardCount?.total
	if (total == null && trackedNumbered != null) { total = trackedNumbered; notes.push(`cardCount.total (${total}) counted from TCGTracking's numbered singles; check it`) }

	const releaseDate = opts.releaseDate ?? dex?.releaseDate ?? tracked?.set_released ?? undefined
	if (!releaseDate) notes.push('no release date found; left out')
	const abbreviation = opts.abbreviation ?? dex?.abbreviation?.official ?? tracked?.set_abbr ?? undefined

	const record: Record<string, unknown> = {
		id: opts.setId,
		name,
		abbreviation,
		releaseDate,
		cardCount: official != null || total != null ? { official, total } : undefined,
		prices: groupId ? { tcgplayer: groupId } : undefined,
		provenance: { source: [...sources].join(' + ') || 'manual', importedAt: today(), validation: 'inferred' }
	}
	notes.push('prices.cardmarket (expansion id) is not available from any source here; add it by hand if wanted')

	// ---- 4. series -------------------------------------------------------------------------------------------------
	const allSeries = await listSeries(repo)
	const seriesId = opts.series ?? dex?.serie?.id
	if (!seriesId) throw new Error(`Unknown series for ${opts.setId}: pass --series <id>`)
	let series: SeriesEntry | undefined = allSeries.find((s) => s.id === seriesId)
	let seriesRecord: Record<string, unknown> | null = null
	let seriesFile: string | null = null

	if (!series) {
		const seriesNames: Record<string, string> = {}
		for (const lang of LANGS) {
			const s = await tcgdex<{ name?: string }>(`${lang}/series/${seriesId}`)
			if (s?.name) seriesNames[lang] = s.name
		}
		if (opts.seriesName) seriesNames.en = opts.seriesName
		if (!seriesNames.en) throw new Error(`Series "${seriesId}" has no file and no known name: pass --series-name`)
		seriesRecord = { id: seriesId, name: seriesNames, provenance: { source: Object.keys(seriesNames).length > 1 ? 'tcgdex-api' : 'manual', importedAt: today(), validation: 'inferred' } }
		seriesFile = join(intlDir(repo), `${fileSafe(seriesNames.en)}.ts`)
		series = { id: seriesId, name: seriesNames, file: seriesFile, folder: join(intlDir(repo), fileSafe(seriesNames.en)) }
		notes.push(`new series "${seriesNames.en}" (${seriesId})`)
	}

	const setFile = join(series.folder, `${fileSafe(name.en)}.ts`)

	// ---- 5. write --------------------------------------------------------------------------------------------------
	const written: string[] = []
	if (opts.apply) {
		const { renderRecord } = await loadFormat(repo)
		const existing = (await listSets(repo)).find((s) => s.id === opts.setId)
		if (existing && !opts.overwrite) {
			notes.push(`set ${opts.setId} already exists at ${existing.file}; not changed (pass --overwrite)`)
		} else {
			if (existing && existing.file !== setFile) notes.push(`existing file is ${existing.file}; writing ${setFile} too, remove the old one by hand`)
			if (seriesRecord && seriesFile && !existsSync(seriesFile)) {
				await writeFile(seriesFile, renderRecord('Series', seriesRecord), 'utf8')
				written.push(seriesFile)
			}
			await mkdir(series.folder, { recursive: true })
			await writeFile(setFile, renderRecord('CardSet', record), 'utf8')
			written.push(setFile)
		}
	}

	log(`[set-meta] ${opts.setId}: ${name.en} (${Object.keys(name).length} languages) -> ${setFile}`)
	return { setFile, seriesFile, record, seriesRecord, written, notes }
}

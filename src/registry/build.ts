/// <reference lib="dom" />
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import config from '../../config.json' with { type: 'json' }
import { listPokemonSets, type TrackedSetSummary } from '../util/tcgtracking-open.ts'

/**
 * The registry: for every set of the eras we build, the three things a run needs to find it in each source.
 *   id            TCGdex's set id, also the id used in the Experimental repo ("sv08.5")
 *   slug          pokemon.com's expansion slug ("sv8pt5"), read from its card-search page
 *   tcgplayerGroup  TCGTracking's group id for the set
 * Everything is matched by name and then corrected by hand in `registry/overrides.json`, so a set the names don't pair up
 * (promos, energy sets) is stated once and kept.
 */

export const REGISTRY_FILE = 'registry/pokemon-intl.json'
export const OVERRIDES_FILE = 'registry/overrides.json'
const EXPANSIONS_CACHE = join(config.cacheDir, 'pokemon-expansions.json')
const TCGDEX = 'https://api.tcgdex.net/v2'

export interface RegistrySet {
	id: string
	series: string
	name: string
	releaseDate: string | null
	official: number | null
	total: number | null
	slug: string | null
	tcgplayerGroup: number | null
	/** why the set can't be built, when it can't (no pokemon.com source, ...) */
	skip?: string
	/** "tcgdex": pokemon.com doesn't have the set, so its cards are built from the TCGdex API */
	source?: 'tcgdex' | 'tcgcsv'
	/** pokemon.com's page key for card 1, 2, 3...: for a set whose pages aren't numbered 1..n (Classic Collection: "2_A", "15_A1") */
	cardKeys?: string[]
	/** with cardKeys: the id prefix TCGdex gives the cards ("CC" makes card 1 "CC001") */
	idPrefix?: string
	/** TCGdex's id for the set, when the repo's differs ("sma" is "sm11.5sv" here) */
	tcgdexId?: string
	/** the card files are the plain three-digit number ("001.ts"), without the printed prefix ("SV1") */
	plainCardIds?: boolean
	/** a TCGdex-built set whose card files keep TCGdex's unpadded ids ("1.ts"), instead of the repo's three digits ("001.ts") */
	keepTcgdexIds?: boolean
	/** a set that carries a prefixed subset inside it on TCGdex (Generations' "RC1".."RC32"): those cards are kept under their own ids, not mistaken for plain numbers */
	letteredIds?: boolean
	/** further TCGplayer groups holding cards of this set (Generations' Radiant Collection is group 1729, the set itself 1728) */
	extraTcgplayerGroups?: number[]
	/** a TCGdex set that lacks cards TCGplayer has: the names of the products to take from the set's TCGplayer group */
	tcgcsvNames?: string[]
	/** a set of reprints (W Promotional): card n is `reprints[n-1]`, a card of another set, under the promo's stamp */
	reprints?: { set: string; localId: string; stamps?: string[] }[]
	notes: string[]
}

export interface Registry { generatedAt: string; sets: RegistrySet[] }

interface Override { id?: string; plainCardIds?: boolean; slug?: string | null; tcgplayerGroup?: number | null; skip?: string; source?: 'tcgdex' | 'tcgcsv'; official?: number; total?: number; cardKeys?: string[]; idPrefix?: string; keepTcgdexIds?: boolean; letteredIds?: boolean; extraTcgplayerGroups?: number[]; tcgcsvNames?: string[]; reprints?: { set: string; localId: string; stamps?: string[] }[] }

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent } })
	if (!res.ok) throw new Error(`${url} -> ${res.status}`)
	return res.json() as Promise<T>
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/�/g, 'e').replace(/[^a-z0-9]+/g, ' ').trim()

/** pokemon.com's expansions (slug + name), read once from its card-search page and cached. */
async function loadExpansions(refresh: boolean, log: (l: string) => void): Promise<{ slug: string; label: string }[]> {
	if (!refresh && existsSync(EXPANSIONS_CACHE)) return JSON.parse(await readFile(EXPANSIONS_CACHE, 'utf8'))
	log('[registry] reading pokemon.com\'s expansion list (opens a browser window)')
	const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] })
	try {
		const ctx = await browser.newContext({
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
			locale: 'en-GB', viewport: { width: 1280, height: 800 }
		})
		const page = await ctx.newPage()
		await page.goto('https://www.pokemon.com/uk/pokemon-tcg/pokemon-cards/', { waitUntil: 'domcontentloaded', timeout: 60000 })
		await page.waitForSelector('input[type=checkbox]', { timeout: 30000 })
		await page.waitForTimeout(3000)
		const all = await page.evaluate(() => Array.from(document.querySelectorAll('input[type=checkbox]')).map((el) => {
			const input = el as HTMLInputElement
			const label = (document.querySelector(`label[for="${input.id}"]`) as HTMLElement | null)?.innerText?.trim() ?? input.closest('label')?.innerText?.trim() ?? ''
			return { slug: input.id || input.name, label }
		}))
		// expansion filters have lower-case slugs; rarities, types and the like are capitalised or prefixed
		const expansions = all.filter((x) => /^[a-z0-9][a-z0-9-]*$/.test(x.slug) && !/^(card-|ct-|weakness|resistance|attack|select|retreat)/.test(x.slug))
		if (expansions.length < 50) throw new Error(`only ${expansions.length} expansions found: pokemon.com's page may have changed or the bot wall interrupted`)
		await mkdir(dirname(EXPANSIONS_CACHE), { recursive: true })
		await writeFile(EXPANSIONS_CACHE, JSON.stringify(expansions, null, 1))
		return expansions
	} finally {
		await browser.close().catch(() => {})
	}
}

/** TCGTracking names its sets "SV03: Obsidian Flames", "SWSH: Crown Zenith: Galarian Gallery" or just "Celebrations". */
function trackedNames(s: TrackedSetSummary): string[] {
	const names = [groupKey(s.name)]
	// "SV03: Obsidian Flames"; older eras "SM - Forbidden Light", "XY - Steam Siege", "EX Dragon Frontiers"
	const stripped = s.name.replace(/^[A-Z][A-Z0-9]*\d*:\s*/, '').replace(/^(SM|XY|BW|HS|DP|EX)\s+-\s+/, '').replace(/^EX\s+(?=[A-Z])/, '')
	if (stripped !== s.name) names.push(groupKey(stripped))
	return names
}

/** "Black and White" (TCGplayer) and "Black & White" (TCGdex) are the same name. */
const groupKey = (s: string) => norm(s.replace(/&/g, ' and '))

export async function buildRegistry(opts: { series: string[]; refreshExpansions?: boolean; log?: (l: string) => void }): Promise<Registry> {
	const log = opts.log ?? console.log
	const overrides: Record<string, Override> = existsSync(OVERRIDES_FILE) ? JSON.parse(await readFile(OVERRIDES_FILE, 'utf8')) : {}
	const expansions = await loadExpansions(Boolean(opts.refreshExpansions), log)
	const tracked = await listPokemonSets()
	const slugsByName = new Map<string, string[]>()
	// older expansions are labelled "XY—Steam Siege", "BW-Plasma Blast": registered under the bare name too
	for (const e of expansions) {
		for (const key of new Set([norm(e.label), norm(e.label.replace(/^[A-Za-z]{2,4}\s*[—–-]\s*/, ''))])) {
			if (!(slugsByName.get(key) ?? []).includes(e.slug)) slugsByName.set(key, [...(slugsByName.get(key) ?? []), e.slug])
		}
	}

	const sets: RegistrySet[] = []
	for (const seriesId of opts.series) {
		const series = await getJson<{ name: string; sets: { id: string; name: string }[] }>(`${TCGDEX}/en/series/${seriesId}`)
		for (const brief of series.sets) {
			const detail = await getJson<{ name: string; releaseDate?: string; cardCount?: { official?: number; total?: number } }>(`${TCGDEX}/en/sets/${brief.id}`)
			const entry: RegistrySet = {
				id: brief.id, series: seriesId, name: detail.name.trim(),
				releaseDate: detail.releaseDate ?? null,
				official: detail.cardCount?.official || null, total: detail.cardCount?.total || null,
				slug: null, tcgplayerGroup: null, notes: []
			}
			const wanted = norm(entry.name)
			const wantedGroup = groupKey(entry.name)

			// pokemon.com slug
			const slugs = slugsByName.get(wanted) ?? []
			if (slugs.length === 1) entry.slug = slugs[0]!
			else if (slugs.length > 1) entry.notes.push(`pokemon.com: several expansions named like this (${slugs.join(', ')}): set it in overrides`)

			// TCGTracking group, the one released the same day when several share the name
			const groups = tracked.filter((t) => trackedNames(t).includes(wantedGroup))
			const sameDay = groups.filter((g) => g.published_on?.slice(0, 10) === entry.releaseDate)
			const pick = groups.length === 1 ? groups[0] : sameDay.length === 1 ? sameDay[0] : undefined
			if (pick) entry.tcgplayerGroup = pick.id
			else if (groups.length > 1) entry.notes.push(`TCGTracking: several sets match (${groups.map((g) => `${g.id} ${g.name}`).join('; ')}): set it in overrides`)

			// hand-written corrections win
			const o = overrides[entry.id]
			if (o) {
				if ('slug' in o) entry.slug = o.slug ?? null
				if ('tcgplayerGroup' in o) entry.tcgplayerGroup = o.tcgplayerGroup ?? null
				if (o.skip) entry.skip = o.skip
				if (o.source) entry.source = o.source
				if (o.cardKeys) entry.cardKeys = o.cardKeys
				if (o.idPrefix) entry.idPrefix = o.idPrefix
				if (o.keepTcgdexIds) entry.keepTcgdexIds = true
				if (o.letteredIds) entry.letteredIds = true
				if (o.extraTcgplayerGroups) entry.extraTcgplayerGroups = o.extraTcgplayerGroups
				if (o.plainCardIds) entry.plainCardIds = true
				// the repo's id for the set, when it is not TCGdex's
				if (o.id && o.id !== entry.id) { entry.tcgdexId = entry.id; entry.id = o.id }
				if (o.tcgcsvNames) entry.tcgcsvNames = o.tcgcsvNames
				if (o.reprints) entry.reprints = o.reprints
				// TCGdex counts products, not cards, for some sets (My First Battle: 48 products are 34 cards in several printings)
				if (o.official) entry.official = o.official
				if (o.total) entry.total = o.total
			}
			if (!entry.slug && !entry.skip && !entry.source) entry.skip = 'no pokemon.com expansion found'
			sets.push(entry)
		}
	}

	// series not rebuilt this time stay as they were, so adding an older era does not drop the newer ones
	if (existsSync(REGISTRY_FILE)) {
		const kept = (JSON.parse(await readFile(REGISTRY_FILE, 'utf8')) as Registry).sets.filter((s) => !opts.series.includes(s.series))
		sets.push(...kept)
	}

	// newest first: the order the eras are built in
	sets.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || b.id.localeCompare(a.id))
	const registry: Registry = { generatedAt: new Date().toISOString(), sets }
	await mkdir(dirname(REGISTRY_FILE), { recursive: true })
	await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 1) + '\n')
	return registry
}

export async function loadRegistry(): Promise<Registry> {
	if (!existsSync(REGISTRY_FILE)) throw new Error(`No registry at ${REGISTRY_FILE}. Run \`registry build\` first.`)
	return JSON.parse(await readFile(REGISTRY_FILE, 'utf8'))
}

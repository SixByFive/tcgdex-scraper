import type { IncomingMessage, ServerResponse } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, normalize, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import config from '../../config.json' with { type: 'json' }
import { REGION_LANGUAGE, readCards, readExpansions } from '../sources/asia-portal.ts'
import { SCRAPABLE, isScrapable } from '../sources/asia-sources.ts'
import type { AsiaRegion } from '../types/asia.ts'

/** The UI's Asia side: the games/datasets/languages the Experimental repo defines, the Asia portal's cache, and scrape jobs. */

const asiaRoot = join(config.cacheDir, 'asia')
const json = (res: ServerResponse, body: unknown, status = 200) =>
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body))

const isRegion = (v: string | null): v is AsiaRegion => !!v && isScrapable(v)
const isCode = (v: string | null): v is string => !!v && /^[A-Za-z0-9._-]{1,24}$/.test(v)

/** Each game the Experimental repo has (`data/<game>/game.ts`), with its datasets and their languages. */
export async function listGames(repo: string): Promise<{ id: string; name: string; datasets: { id: string; languages: string[] }[] }[]> {
	const out: { id: string; name: string; datasets: { id: string; languages: string[] }[] }[] = []
	try {
		for (const e of await readdir(join(repo, 'data'), { withFileTypes: true })) {
			if (!e.isDirectory()) continue
			try {
				const def = (await import(pathToFileURL(join(repo, 'data', e.name, 'game.ts')).href + `?t=${Date.now()}`)).default
				out.push({ id: def.id, name: def.name, datasets: def.datasets.map((d: { id: string; languages: string[] }) => ({ id: d.id, languages: d.languages })) })
			} catch { /* a data folder without a game file is not a game */ }
		}
	} catch { /* no repo */ }
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

const jobs = new Map<string, true>()
const jobKey = (region: string, kind: string) => `${region}:${kind}`

type Kind = 'expansions' | 'scrape' | 'enrich' | 'images' | 'build' | 'write'
const KINDS: readonly string[] = ['expansions', 'scrape', 'enrich', 'images', 'build', 'write']

/** The steps run under Bun (the Experimental repo's formatter needs it; no Asia source needs a browser). "build" is the whole flow (scrape, enrich, emit) as a dry run; "write" is the same with --apply. */
function runJob(region: AsiaRegion, kind: Kind, codes: string[]): boolean {
	const key = jobKey(region, kind)
	if (jobs.has(key)) return false
	const step = kind === 'write' ? 'build' : kind
	const args = ['run', 'src/cli.ts', 'asia', step, region, ...(kind === 'expansions' ? [] : codes), ...(kind === 'write' ? ['--apply'] : [])]
	const child = spawn('bun', args, { cwd: process.cwd(), shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
	jobs.set(key, true)
	child.stdout?.on('data', (d) => process.stdout.write(`[asia:${region}] ${d}`))
	child.stderr?.on('data', (d) => process.stderr.write(`[asia:${region}] ${d}`))
	child.on('close', () => jobs.delete(key))
	return true
}

/** Where Asia's cards come from. Korea is listed so the UI shows what is missing: its card list refuses automated requests. */
const SITES: Record<string, { name: string; site: string }> = {
	tw: { name: 'Taiwan', site: 'asia.pokemon-card.com' }, hk: { name: 'Hong Kong', site: 'asia.pokemon-card.com' },
	th: { name: 'Thailand', site: 'asia.pokemon-card.com' }, id: { name: 'Indonesia', site: 'asia.pokemon-card.com' },
	ja: { name: 'Japan', site: 'pokemon-card.com' }, ko: { name: 'Korea', site: 'pokemoncard.co.kr (card pages only; the list must be supplied)' }, 'zh-cn': { name: 'Mainland China', site: 'TCGdex (sets) + Bulbapedia (cards, English names, no images)' }
}
const BLOCKED = [{ id: 'ko', name: 'Korea', language: 'ko', site: 'pokemoncard.co.kr (skipped: its card list is not available to scripts)' }]

async function overview() {
	const regions: Record<string, unknown>[] = []
	for (const region of SCRAPABLE) {
		const expansions = await readExpansions(region)
		const scraped = new Map<string, number>()
		const english = new Map<string, string>()
		try {
			for (const e of await readdir(join(asiaRoot, region), { withFileTypes: true })) {
				if (!e.isDirectory() || e.name === 'html') continue
				const files = (await readdir(join(asiaRoot, region, e.name))).filter((f) => f.endsWith('.json'))
				scraped.set(e.name, files.length)
				// the set's English name is on its enriched cards (every card of the set has the same one)
				for (const f of files.slice(0, 3)) {
					try { const card = JSON.parse(await readFile(join(asiaRoot, region, e.name, f), 'utf8')), n = card.collector?.name ?? card.tcgplayerSetName; if (n) { english.set(e.name, n); break } } catch { /* being written */ }
				}
			}
		} catch { /* not scraped yet */ }
		regions.push({
			id: region,
			name: SITES[region]!.name,
			scraper: true,
			site: SITES[region]!.site,
			language: REGION_LANGUAGE[region],
			running: [...jobs.keys()].filter((k) => k.startsWith(region + ':')).map((k) => k.split(':')[1]),
			expansions: expansions.map((e) => ({ ...e, scraped: scraped.get(e.code) ?? 0, englishName: english.get(e.code) ?? null })),
			// products on disk that the product list does not (yet) know
			orphans: [...scraped].filter(([code]) => !expansions.some((e) => e.code === code)).map(([code, cards]) => ({ code, cards }))
		})
	}
	for (const p of BLOCKED) regions.push({ ...p, scraper: false, running: [], expansions: [], orphans: [] })
	return regions
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

/** Handles the Asia routes; returns false when the request is none of them. */
export async function handleAsia(req: IncomingMessage, res: ServerResponse, url: URL, repo: string): Promise<boolean> {
	const path = url.pathname

	if (path === '/api/games') { json(res, await listGames(repo)); return true }
	if (path === '/api/asia/overview') { json(res, await overview()); return true }

	if (path === '/api/asia/cards') {
		const region = url.searchParams.get('region'), code = url.searchParams.get('code')
		if (!isRegion(region) || !isCode(code)) { json(res, { error: 'bad region or code' }, 400); return true }
		const expansion = (await readExpansions(region)).find((e) => e.code === code) ?? null
		json(res, { region, code, language: REGION_LANGUAGE[region], expansion, cards: await readCards(region, code) })
		return true
	}

	if (path === '/api/asia/run' && req.method === 'POST') {
		const region = url.searchParams.get('region'), kind = url.searchParams.get('kind')
		const codes = (url.searchParams.get('codes') ?? '').split(',').filter(Boolean)
		if (!isRegion(region) || !KINDS.includes(kind ?? '')) { json(res, { error: 'bad region or kind' }, 400); return true }
		if (kind !== 'expansions' && (!codes.length || !codes.every(isCode))) { json(res, { error: 'bad codes' }, 400); return true }
		json(res, { started: runJob(region, kind as Kind, codes) })
		return true
	}

	// the downloaded images: /asia-img/<region>/<code>/img/<file>
	if (path.startsWith('/asia-img/')) {
		const rel = normalize(decodeURIComponent(path.slice('/asia-img/'.length)))
		const parts = rel.split(/[\\/]/)
		if (parts.length !== 4 || parts[2] !== 'img' || !isRegion(parts[0]!) || !isCode(parts[1]!) || !MIME[extname(rel).toLowerCase()]) { res.writeHead(400).end('bad path'); return true }
		try {
			const data = await readFile(join(asiaRoot, ...parts))
			res.writeHead(200, { 'content-type': MIME[extname(rel).toLowerCase()]!, 'cache-control': 'public, max-age=86400' }).end(data)
		} catch { res.writeHead(404).end('not found') }
		return true
	}
	return false
}

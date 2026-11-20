import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { watch, type Dirent } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScrapedCard } from '../types/scraped.ts'
import config from '../../config.json' with { type: 'json' }
// pricing is switched off for now (enrichment + CardMarket mapping); uncomment these, the /api/enrich/* routes below,
// and the enrich entry points in public/app.js to bring it back
// import { runEnrichment } from '../pricing/enrichment.ts'
import { emitSet } from '../emit/card.ts'
// import {
// 	clearCardmarketBaseOverride,
// 	clearCardmarketIgnored,
// 	loadCardmarketMergeContext,
// 	removeCardmarketManualMapping,
// 	saveCardmarketManualMap,
// 	setCardmarketBaseOverride,
// 	setCardmarketIgnored,
// 	setCardmarketManualMapping,
// 	type CardmarketManualVariant
// } from '../pricing/cardmarket-merge.ts'

import { existsSync } from 'node:fs'
import { buildSetMeta } from '../sources/set-meta.ts'
import { emitExperimental } from '../emit/experimental.ts'
import { defaultRepo, intlDir, listSets as listExperimentalSets } from '../util/experimental.ts'
import { buildCatalog, registrySet } from './catalog.ts'
import { applyFixes, buildSet, galleryCount, loadFixes, registrySets, sameFix, saveFixes, writeSet, type ProductFix } from '../sources/sealed-set.ts'
import { fileSafe } from '../util/experimental.ts'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public')
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml'
}

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
	try {
		const data = await readFile(path)
		const mime = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
		res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }).end(data)
	} catch {
		res.writeHead(404).end('not found')
	}
}

async function listSets(): Promise<string[]> {
	const dir = join(config.cacheDir, 'pokemon-com')
	try {
		const entries = await readdir(dir, { withFileTypes: true })
		return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
	} catch { return [] }
}

async function listCards(setId: string): Promise<ScrapedCard[]> {
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	try {
		const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
		const cards: ScrapedCard[] = []
		for (const f of files) {
			try { cards.push(JSON.parse(await readFile(join(dir, f), 'utf8'))) } catch {}
		}
		return cards
	} catch { return [] }
}

async function readCard(setId: string, filename: string): Promise<ScrapedCard | null> {
	try {
		return JSON.parse(await readFile(join(config.cacheDir, 'pokemon-com', setId, filename), 'utf8'))
	} catch { return null }
}

type DbSet = {
	serie: string
	setName: string
	id: string | null
	nameEn: string
	cardCount: number | null
	releaseDate: string | null
	tcgplayer: number | null
	cardmarket: number | null
}

async function listDbSets(): Promise<DbSet[]> {
	const dataDir = join((config as { cardsDatabaseDir?: string }).cardsDatabaseDir ?? 'H:/cards-database', 'data')
	const out: DbSet[] = []
	let serieEntries: Dirent[]
	try { serieEntries = await readdir(dataDir, { withFileTypes: true }) }
	catch { return out }
	for (const se of serieEntries) {
		if (!se.isDirectory()) continue
		const serie = se.name
		const serieDir = join(dataDir, serie)
		let setEntries: Dirent[]
		try { setEntries = await readdir(serieDir, { withFileTypes: true }) }
		catch { continue }
		for (const ste of setEntries) {
			if (!ste.isFile() || !ste.name.endsWith('.ts')) continue
			const setName = ste.name.slice(0, -3)
			let text = ''
			try { text = await readFile(join(serieDir, ste.name), 'utf8') } catch { continue }
			const id = text.match(/\bid:\s*["']([^"']+)["']/)?.[1] ?? null
			const nameEn = text.match(/name:\s*\{[\s\S]*?\ben:\s*["']([^"']+)["']/)?.[1] ?? setName
			const cardCount = Number(text.match(/\bofficial:\s*(\d+)/)?.[1]) || null
			const releaseDate = text.match(/\breleaseDate:\s*["']([^"']+)["']/)?.[1] ?? null
			const tcgplayer = Number(text.match(/\btcgplayer:\s*(\d+)/)?.[1]) || null
			const cardmarket = Number(text.match(/\bcardmarket:\s*(\d+)/)?.[1]) || null
			out.push({ serie, setName, id, nameEn, cardCount, releaseDate, tcgplayer, cardmarket })
		}
	}
	return out
}


// ---- Experimental repo: which repo to write to (kept in var/ui-settings.json) and what is in it ------------------------

const SETTINGS_FILE = join(process.cwd(), 'var', 'ui-settings.json')
async function loadSettings(): Promise<{ experimentalRepo?: string }> {
	try { return JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) } catch { return {} }
}
async function currentRepo(): Promise<string> { return (await loadSettings()).experimentalRepo?.trim() || defaultRepo }

async function experimentalState(repo: string) {
	const valid = existsSync(intlDir(repo))
	const sets: { id: string; name: string; series: string; cards: number }[] = []
	if (valid) {
		try {
			for (const s of await listExperimentalSets(repo)) {
				let cards = 0
				try { cards = (await readdir(s.dir)).filter((f) => f.endsWith('.ts')).length } catch {}
				sets.push({ id: s.id, name: s.name.en ?? s.id, series: s.series.name.en ?? s.series.id, cards })
			}
		} catch (err) {
			return { repo, valid, sets, error: err instanceof Error ? err.message : String(err) }
		}
	}
	return { repo, valid, sets }
}

interface ExperimentalRun {
	setId?: string
	action?: 'set-meta' | 'emit' | 'both'
	apply?: boolean
	overwrite?: boolean
	noTcgdex?: boolean
	noVariants?: boolean
	tcgplayerSet?: number
	series?: string
	seriesName?: string
	name?: string
	abbreviation?: string
	releaseDate?: string
}

type SSEClient = { setId: string; res: ServerResponse }
const sseClients = new Set<SSEClient>()
const watchers = new Map<string, ReturnType<typeof watch>>()
const runningJobs = new Map<string, ChildProcess>() // key: `${setId}:${kind}`

function broadcast(setId: string, event: string, data: unknown): void {
	for (const c of sseClients) {
		if (c.setId !== setId) continue
		try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch {}
	}
}

function spawnJob(setId: string, kind: string, args: string[]): { running: boolean; started: boolean } {
	const key = `${setId}:${kind}`
	if (runningJobs.has(key)) return { running: true, started: false }

	const child = spawn('bunx', ['tsx', 'src/cli.ts', ...args], {
		cwd: process.cwd(),
		shell: true,
		stdio: ['ignore', 'pipe', 'pipe']
	})
	runningJobs.set(key, child)
	broadcast(setId, 'job-started', { kind })

	// a cross-check's result is its output: sent to the page when the job ends, besides the server's own log
	let output = ''
	child.stdout?.on('data', (d) => { if (kind === 'crosscheck') output += d; process.stdout.write(`[${kind}:${setId}] ${d}`) })
	child.stderr?.on('data', (d) => process.stderr.write(`[${kind}:${setId}] ${d}`))
	child.on('close', (code) => {
		runningJobs.delete(key)
		if (kind === 'crosscheck') broadcast(setId, 'job-output', { kind, code, text: output })
		broadcast(setId, 'job-done', { kind, code })
	})

	return { running: false, started: true }
}

async function handleAction(res: ServerResponse, req: IncomingMessage, setId: string, kind: 'scrape' | 'pokedex' | 'emit' | 'enrich' | 'crosscheck'): Promise<void> {
	if (req.method !== 'POST') { res.writeHead(405).end('method not allowed'); return }
	let args: string[]
	if (kind === 'scrape') {
		const cards = await listCards(setId)
		// series, slug and TCGplayer group come from the registry; a set it does not list falls back to the cached slug and the id's letters (sv11 -> sv)
		const reg = await registrySet(setId)
		const slug = reg?.slug ?? cards[0]?.sourceSlug ?? setId
		const serie = reg?.series ?? (/^[a-z]+/i.exec(setId)?.[0].toLowerCase() ?? 'sv')
		args = ['scrape', 'set', slug, '--serie', serie, '--set', setId, ...(reg?.tcgplayerGroup ? ['--tcgplayer-set', String(reg.tcgplayerGroup)] : [])]
	} else if (kind === 'pokedex') {
		args = ['pokedex', setId]
	} else if (kind === 'crosscheck') {
		args = ['crosscheck', setId]
	} else if (kind === 'enrich') {
		// variants + provider ids (TCGTracking) and flavor text + regulation marks (TCGdex), stored in the scraped cards
		args = ['enrich-scraped', setId]
	} else {
		args = ['emit', setId]
	}
	const result = spawnJob(setId, kind, args)
	jsonRes(res, result, result.running ? 409 : 200)
}

function ensureWatcher(setId: string): void {
	if (watchers.has(setId)) return
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	try {
		const w = watch(dir, { persistent: true }, (_evt, filename) => {
			if (!filename || !String(filename).endsWith('.json')) return
			setTimeout(async () => {
				const card = await readCard(setId, String(filename))
				if (!card) return
				for (const c of sseClients) {
					if (c.setId !== setId) continue
					try { c.res.write(`event: card-added\ndata: ${JSON.stringify(card)}\n\n`) } catch {}
				}
			}, 60)
		})
		watchers.set(setId, w)
	} catch {}
}

function jsonRes(res: ServerResponse, body: unknown, status = 200): void {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
}

async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let data = ''
		req.on('data', (chunk) => { data += chunk })
		req.on('end', () => {
			try { resolve(data ? JSON.parse(data) : {} as T) } catch (err) { reject(err) }
		})
		req.on('error', reject)
	})
}

function sseHeaders(res: ServerResponse): void {
	res.writeHead(200, {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		'connection': 'keep-alive',
		'x-accel-buffering': 'no'
	})
}

function sseSend(res: ServerResponse, payload: unknown): void {
	try { res.write(`data: ${JSON.stringify(payload)}\n\n`) } catch {}
}

export async function startUi(port = 5173): Promise<void> {
	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://localhost:${port}`)
		const path = url.pathname

		const sseMatch = path.match(/^\/api\/sets\/([^/]+)\/events$/)
		if (sseMatch) {
			const setId = decodeURIComponent(sseMatch[1]!)
			res.writeHead(200, {
				'content-type': 'text/event-stream; charset=utf-8',
				'cache-control': 'no-cache, no-transform',
				'connection': 'keep-alive',
				'x-accel-buffering': 'no'
			})
			res.write(': welcome\n\n')
			const client: SSEClient = { setId, res }
			sseClients.add(client)
			ensureWatcher(setId)
			req.on('close', () => sseClients.delete(client))
			return
		}

		if (path === '/img') {
			const target = url.searchParams.get('url')
			if (!target || !/^https:\/\/assets\.pokemon\.com\//.test(target)) {
				res.writeHead(400).end('bad url')
				return
			}
			try {
				const r = await fetch(target, { headers: { 'user-agent': 'Mozilla/5.0' } })
				if (!r.ok) { res.writeHead(r.status).end(); return }
				const buf = Buffer.from(await r.arrayBuffer())
				res.writeHead(200, {
					'content-type': r.headers.get('content-type') ?? 'image/png',
					'cache-control': 'public, max-age=86400'
				}).end(buf)
			} catch (err) {
				res.writeHead(502).end(String(err))
			}
			return
		}

		if (path === '/api/sets') return jsonRes(res, await listSets())
		if (path === '/api/catalog') return jsonRes(res, await buildCatalog(await currentRepo()))
		if (path === '/api/db/sets') return jsonRes(res, await listDbSets())

		// File upload: raw bytes in body, filename in ?name= query — client picks a file,
		// we save to var/uploads/, and return the absolute path for the enrich form.
		if (path === '/api/upload' && req.method === 'POST') {
			const nameRaw = url.searchParams.get('name') ?? ''
			const name = nameRaw.replace(/[\/\\]/g, '').replace(/^\.+/, '').slice(0, 200)
			if (!name) { res.writeHead(400).end('name required'); return }
			const chunks: Buffer[] = []
			req.on('data', (c) => chunks.push(c as Buffer))
			req.on('end', async () => {
				try {
					const buf = Buffer.concat(chunks)
					const uploadsDir = join(process.cwd(), 'var', 'uploads')
					await mkdir(uploadsDir, { recursive: true })
					const dest = join(uploadsDir, name)
					await writeFile(dest, buf)
					jsonRes(res, { path: dest, size: buf.length })
				} catch (err) {
					jsonRes(res, { error: err instanceof Error ? err.message : String(err) }, 500)
				}
			})
			req.on('error', () => { res.writeHead(500).end('upload failed') })
			return
		}

		// ---- Experimental repo -------------------------------------------------------------------------------------
		if (path === '/api/exp/state' && req.method === 'GET') return jsonRes(res, await experimentalState(await currentRepo()))

		if (path === '/api/exp/repo' && req.method === 'POST') {
			let body: { repo?: string } = {}
			try { body = await readJsonBody(req) } catch { res.writeHead(400).end('bad json'); return }
			const repo = (body.repo ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
			if (!repo) return jsonRes(res, { error: 'repo required' }, 400)
			if (!existsSync(intlDir(repo))) return jsonRes(res, { error: `${intlDir(repo)} does not exist: not an Experimental repo` }, 400)
			await mkdir(dirname(SETTINGS_FILE), { recursive: true })
			await writeFile(SETTINGS_FILE, JSON.stringify({ ...(await loadSettings()), experimentalRepo: repo }, null, 2))
			return jsonRes(res, await experimentalState(repo))
		}

		if (path === '/api/exp/run' && req.method === 'POST') {
			let body: ExperimentalRun = {}
			try { body = await readJsonBody(req) } catch { res.writeHead(400).end('bad json'); return }
			const setId = (body.setId ?? '').trim()
			if (!setId) { res.writeHead(400).end('setId required'); return }
			const repo = await currentRepo()
			const apply = Boolean(body.apply)
			const action = body.action ?? 'both'
			const log = (line: string) => sseSend(res, { type: 'log', line })
			const opt = (v?: string) => v?.trim() || undefined
			sseHeaders(res)
			log(`${apply ? 'APPLY' : 'Dry run'}: ${action} ${setId} -> ${repo}`)
			try {
				if (action === 'set-meta' || action === 'both') {
					const r = await buildSetMeta({
						setId, repo, apply, overwrite: Boolean(body.overwrite), log,
						series: opt(body.series), seriesName: opt(body.seriesName), name: opt(body.name),
						abbreviation: opt(body.abbreviation), releaseDate: opt(body.releaseDate),
						tcgplayerSet: body.tcgplayerSet || undefined
					})
					if (r.seriesRecord) log(`series: ${JSON.stringify(r.seriesRecord)}`)
					log(`set: ${JSON.stringify(r.record)}`)
					r.notes.forEach((n) => log(`note: ${n}`))
					r.written.forEach((f) => log(`wrote ${f}`))
				}
				if (action === 'emit' || action === 'both') {
					try {
						const r = await emitExperimental({ setId, repo, apply, overwrite: Boolean(body.overwrite), noTcgdex: Boolean(body.noTcgdex), noVariants: Boolean(body.noVariants), tcgplayerSet: body.tcgplayerSet || undefined, log })
						r.written.length && !apply && log(`would write: ${r.written.slice(0, 3).map((f) => f.split(/[\\/]/).pop()).join(', ')}${r.written.length > 3 ? ', ...' : ''}`)
					} catch (err) {
						// a dry run of "both" has no set file yet: that is expected until set-meta is applied
						if (!apply && action === 'both' && /No set "/.test(String(err))) log('emit skipped in this dry run: the set file does not exist yet (apply set-meta first)')
						else throw err
					}
				}
				sseSend(res, { type: 'done', state: await experimentalState(repo) })
			} catch (err) {
				sseSend(res, { type: 'error', message: err instanceof Error ? err.message : String(err) })
			} finally {
				try { res.end() } catch {}
			}
			return
		}

		/* pricing off for now: /api/enrich/run
		// Enrichment: live SSE run
		if (path === '/api/enrich/run' && req.method === 'POST') {
			let body: {
				set?: string
				repo?: string
				apply?: boolean
				fillMissingCardtrader?: boolean
				cardmarketJson?: string
				cardmarketMap?: string
				tcgplayerSetId?: number
				tcgplayerJson?: string
				tcgplayerIdMap?: string
			} = {}
			try { body = await readJsonBody(req) } catch { res.writeHead(400).end('bad json'); return }
			const repo = (body.repo ?? (config as { cardsDatabaseDir?: string }).cardsDatabaseDir ?? 'H:/cards-database').trim()
			const set = (body.set ?? '').trim()
			if (!set) { res.writeHead(400).end('set required'); return }
			sseHeaders(res)
			sseSend(res, { type: 'log', line: `Starting ${body.apply ? 'apply' : 'dry-run'}…` })
			try {
				const report = await runEnrichment({
					repo,
					set,
					apply: Boolean(body.apply),
					fillMissingCardtrader: Boolean(body.fillMissingCardtrader),
					cardmarketJson: body.cardmarketJson || undefined,
					cardmarketMap: body.cardmarketMap || undefined,
					tcgplayerSetId: typeof body.tcgplayerSetId === 'number' ? body.tcgplayerSetId : undefined,
					tcgplayerJson: body.tcgplayerJson || undefined,
					tcgplayerIdMap: body.tcgplayerIdMap || undefined,
					log: (line) => sseSend(res, { type: 'log', line })
				})
				sseSend(res, { type: 'done', report })
			} catch (err) {
				sseSend(res, { type: 'error', message: err instanceof Error ? err.message : String(err) })
			} finally {
				try { res.end() } catch {}
			}
			return
		}

		*/

		// Emit scraped data to cards-database (SSE)
		if (path === '/api/emit' && req.method === 'POST') {
			let body: {
				scrapedSetId?: string
				repo?: string
				serie?: string
				setName?: string
				setId?: string
				overwrite?: boolean
			} = {}
			try { body = await readJsonBody(req) } catch { res.writeHead(400).end('bad json'); return }
			const scrapedSetId = (body.scrapedSetId ?? '').trim()
			const serie = (body.serie ?? '').trim()
			const setName = (body.setName ?? '').trim()
			const setId = (body.setId ?? '').trim()
			const repo = (body.repo ?? (config as { cardsDatabaseDir?: string }).cardsDatabaseDir ?? 'H:/cards-database').trim()
			if (!scrapedSetId || !serie || !setName || !setId) {
				res.writeHead(400).end('scrapedSetId, serie, setName, setId all required')
				return
			}
			sseHeaders(res)
			sseSend(res, { type: 'log', line: `Emitting ${scrapedSetId} → ${repo}/data/${serie}/${setName}` })
			try {
				const result = await emitSet({
					scrapedSetId, repo, serie, setName, setId,
					overwrite: Boolean(body.overwrite),
					log: (line) => sseSend(res, { type: 'log', line })
				})
				sseSend(res, { type: 'done', result })
			} catch (err) {
				sseSend(res, { type: 'error', message: err instanceof Error ? err.message : String(err) })
			} finally {
				try { res.end() } catch {}
			}
			return
		}

		/* pricing off for now: /api/enrich/report and /api/enrich/cardmarket-map
		// Enrichment: last report for a set
		if (path === '/api/enrich/report' && req.method === 'GET') {
			const set = url.searchParams.get('set')?.trim() ?? ''
			if (!set) return jsonRes(res, { error: 'set required' }, 400)
			const slug = set.replace(/[/\\]/g, '-')
			const reportFile = join(process.cwd(), 'var', 'reports', `enrichment-${slug}.json`)
			try {
				const raw = await readFile(reportFile, 'utf8')
				res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(raw)
			} catch {
				return jsonRes(res, { error: 'no report found' }, 404)
			}
			return
		}

		// Enrichment: save/remove CardMarket manual mapping
		if (path === '/api/enrich/cardmarket-map' && req.method === 'POST') {
			let body: {
				cardmarketJson?: string
				cardmarketMap?: string
				cardId?: string
				productId?: number
				variant?: CardmarketManualVariant | null
				setBase?: boolean
				clearBase?: boolean
				dismiss?: boolean
				undismiss?: boolean
			} = {}
			try { body = await readJsonBody(req) } catch { res.writeHead(400).end('bad json'); return }
			const cardmarketJson = (body.cardmarketJson ?? '').trim()
			const cardId = (body.cardId ?? '').trim()
			if (!cardmarketJson || !cardId) return jsonRes(res, { error: 'cardmarketJson and cardId are required' }, 400)
			const context = await loadCardmarketMergeContext(cardmarketJson, body.cardmarketMap?.trim() || undefined)
			if (!context) return jsonRes(res, { error: 'could not load CardMarket merge context' }, 400)

			let next = context.mapping
			const pid = body.productId
			if (body.clearBase) next = clearCardmarketBaseOverride(next, cardId)
			else if (body.setBase && typeof pid === 'number') next = setCardmarketBaseOverride(next, cardId, pid)
			else if (body.dismiss && typeof pid === 'number') next = setCardmarketIgnored(next, cardId, pid)
			else if (body.undismiss && typeof pid === 'number') next = clearCardmarketIgnored(next, cardId, pid)
			else if (body.variant && typeof pid === 'number') next = setCardmarketManualMapping(next, cardId, pid, body.variant)
			else if (typeof pid === 'number') next = removeCardmarketManualMapping(next, cardId, pid)
			else return jsonRes(res, { error: 'no action specified' }, 400)

			await saveCardmarketManualMap(context.mappingPath, next)
			return jsonRes(res, { ok: true, mappingPath: context.mappingPath, mapping: next })
		}
		*/
		// Catalog: scrape a registry set, optionally ignoring the cache (every page is downloaded again). The slug and series come from the registry.
		if (path === '/api/catalog/scrape' && req.method === 'POST') {
			let body: { setId?: string; fresh?: boolean } = {}
			try { body = await readJsonBody(req) } catch { res.writeHead(400).end('bad json'); return }
			const setId = (body.setId ?? '').trim()
			const set = setId ? await registrySet(setId) : undefined
			if (!set) return jsonRes(res, { error: `${setId || 'no set'} is not a scrapable set in the registry` }, 400)
			const args = set.source === 'tcgdex' || set.source === 'tcgcsv' || !set.slug
				? ['scrape', set.source === 'tcgcsv' ? 'tcgcsv' : 'tcgdex', setId, ...(set.tcgplayerGroup ? ['--tcgplayer-set', String(set.tcgplayerGroup)] : [])]
				: ['scrape', 'set', set.slug, '--serie', set.series, '--set', setId, ...(body.fresh ? ['--fresh'] : []), ...(set.tcgplayerGroup ? ['--tcgplayer-set', String(set.tcgplayerGroup)] : [])]
			const result = spawnJob(setId, 'scrape', args)
			return jsonRes(res, result, result.running ? 409 : 200)
		}

		const actionMatch = path.match(/^\/api\/sets\/([^/]+)\/(scrape|pokedex|emit|enrich|crosscheck)$/)
		if (actionMatch) {
			const setId = decodeURIComponent(actionMatch[1]!)
			return handleAction(res, req, setId, actionMatch[2] as 'scrape' | 'pokedex' | 'emit' | 'enrich' | 'crosscheck')
		}
		const statusMatch = path.match(/^\/api\/sets\/([^/]+)\/status$/)
		if (statusMatch) {
			const setId = decodeURIComponent(statusMatch[1]!)
			const running = [...runningJobs.keys()].filter((k) => k.startsWith(setId + ':')).map((k) => k.split(':')[1])
			return jsonRes(res, { running })
		}
		const cardsMatch = path.match(/^\/api\/sets\/([^/]+)\/cards$/)
		if (cardsMatch) return jsonRes(res, await listCards(decodeURIComponent(cardsMatch[1]!)))
		const cardMatch = path.match(/^\/api\/sets\/([^/]+)\/cards\/([^/]+)$/)
		if (cardMatch) {
			const setId = decodeURIComponent(cardMatch[1]!)
			const localId = decodeURIComponent(cardMatch[2]!)
			const cards = await listCards(setId)
			const found = cards.find((c) => c.structural.localId === localId)
			return jsonRes(res, found ?? null, found ? 200 : 404)
		}

		// ---- Sealed products: build a set's products, look at where each line came from, correct them, write them ---------------------
		if (path === '/api/products/sets' && req.method === 'GET') {
			const repo = await currentRepo()
			const fixes = await loadFixes()
			const sets = await Promise.all((await registrySets()).filter((x) => x.tcgplayerGroup).map(async (x) => {
				let written = 0
				try { written = (await readdir(join(intlDir(repo), 'products', fileSafe(x.name)))).filter((f) => f.endsWith('.ts')).length } catch {}
				return { id: x.id, name: x.name, series: x.series, releaseDate: x.releaseDate ?? null, written, fixes: fixes.filter((f) => f.set === x.id).length }
			}))
			return jsonRes(res, { repo, sets, gallery: { count: await galleryCount(), running: runningJobs.has('_gallery:gallery') } })
		}
		// the official gallery: a visible browser opens and downloads the product pages (the same way the card scrape does)
		if (path === '/api/gallery/scrape' && req.method === 'POST') {
			let body: { years?: number[]; refresh?: boolean } = {}
			try { body = await readJsonBody(req) } catch { /* no body: every year */ }
			const args = ['gallery', 'scrape', ...(body.years?.length ? ['--years', body.years.join(',')] : []), ...(body.refresh ? ['--refresh'] : [])]
			return jsonRes(res, spawnJob('_gallery', 'gallery', args))
		}
		const productsSet = path.match(/^\/api\/products\/set\/([^/]+)(\/write)?$/)
		if (productsSet) {
			const setId = decodeURIComponent(productsSet[1]!)
			try {
				const built = await buildSet(setId, { repo: await currentRepo(), refresh: url.searchParams.get('refresh') === '1' })
				if (productsSet[2]) {
					if (req.method !== 'POST') { res.writeHead(405).end(); return }
					return jsonRes(res, { written: await writeSet(built), folder: built.folder })
				}
				return jsonRes(res, built)
			} catch (err) {
				return jsonRes(res, { error: err instanceof Error ? err.message : String(err) }, 500)
			}
		}
		if (path === '/api/products/fix' && req.method === 'POST') {
			let fix: ProductFix
			try { fix = await readJsonBody<ProductFix>(req) } catch { res.writeHead(400).end('bad json'); return }
			if (!fix?.set || !fix.product || !['exclude', 'type', 'name', 'contents', 'variantContents', 'price'].includes(fix.op)) return jsonRes(res, { error: 'set, product and a known op are required' }, 400)
			const all = (await loadFixes()).filter((f) => !sameFix(f, fix))
			all.push(fix)
			await saveFixes(all)
			return jsonRes(res, { fixes: all.filter((f) => f.set === fix.set) })
		}
		if (path === '/api/products/unfix' && req.method === 'POST') {
			let fix: ProductFix
			try { fix = await readJsonBody<ProductFix>(req) } catch { res.writeHead(400).end('bad json'); return }
			const all = (await loadFixes()).filter((f) => !sameFix(f, fix))
			await saveFixes(all)
			return jsonRes(res, { fixes: all.filter((f) => f.set === fix.set) })
		}

		if (path === '/' || path === '') return serveStatic(res, join(PUBLIC_DIR, 'index.html'))
		return serveStatic(res, join(PUBLIC_DIR, path.replace(/^\//, '')))
	})

	server.listen(port, () => {
		console.log(`[ui] http://localhost:${port}`)
	})
}
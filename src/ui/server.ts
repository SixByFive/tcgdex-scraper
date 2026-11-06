import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { watch } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScrapedCard } from '../types/scraped.ts'
import config from '../../config.json' with { type: 'json' }

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
	let serieEntries: Awaited<ReturnType<typeof readdir>>
	try { serieEntries = await readdir(dataDir, { withFileTypes: true } as never) }
	catch { return out }
	for (const se of serieEntries as unknown as { name: string; isDirectory(): boolean }[]) {
		if (!se.isDirectory()) continue
		const serie = se.name
		const serieDir = join(dataDir, serie)
		let setEntries: unknown[]
		try { setEntries = await readdir(serieDir, { withFileTypes: true } as never) as unknown as unknown[] }
		catch { continue }
		for (const ste of setEntries as { name: string; isFile(): boolean }[]) {
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

	child.stdout?.on('data', (d) => process.stdout.write(`[${kind}:${setId}] ${d}`))
	child.stderr?.on('data', (d) => process.stderr.write(`[${kind}:${setId}] ${d}`))
	child.on('close', (code) => {
		runningJobs.delete(key)
		broadcast(setId, 'job-done', { kind, code })
	})

	return { running: false, started: true }
}

async function handleAction(res: ServerResponse, req: IncomingMessage, setId: string, kind: 'scrape' | 'pokedex' | 'emit'): Promise<void> {
	if (req.method !== 'POST') { res.writeHead(405).end('method not allowed'); return }
	let args: string[]
	if (kind === 'scrape') {
		const cards = await listCards(setId)
		const slug = cards[0]?.sourceSlug ?? setId
		args = ['scrape', 'set', slug, '--serie', 'sv', '--set', setId]
	} else if (kind === 'pokedex') {
		args = ['pokedex', setId]
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
		if (path === '/api/db/sets') return jsonRes(res, await listDbSets())
		const actionMatch = path.match(/^\/api\/sets\/([^/]+)\/(scrape|pokedex|emit)$/)
		if (actionMatch) {
			const setId = decodeURIComponent(actionMatch[1]!)
			return handleAction(res, req, setId, actionMatch[2] as 'scrape' | 'pokedex' | 'emit')
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

		if (path === '/' || path === '') return serveStatic(res, join(PUBLIC_DIR, 'index.html'))
		return serveStatic(res, join(PUBLIC_DIR, path.replace(/^\//, '')))
	})

	server.listen(port, () => {
		console.log(`[ui] http://localhost:${port}`)
	})
}
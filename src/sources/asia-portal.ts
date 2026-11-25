import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { defaultRepo } from '../util/experimental.ts'
import { dirname, join } from 'node:path'
import * as cheerio from 'cheerio'
import pLimit from 'p-limit'
import config from '../../config.json' with { type: 'json' }
import type { AsiaCard, AsiaExpansion, AsiaRegion, AsiaSkill } from '../types/asia.ts'

/**
 * Asia portal scraper (asia.pokemon-card.com). The pages are server-rendered and there is no bot wall, so this uses plain
 * HTTP (no browser) and the pages are kept on disk like the pokemon.com ones. Layout under `cache/asia/<region>/`:
 *   html/<sha>.html           every page fetched
 *   expansions.json           the product list
 *   <CODE>/<cardId>.json      one parsed card
 *   <CODE>/img/<cardId>.png   its image (`images`)
 */

const HOST = 'https://asia.pokemon-card.com'
export const ASIA_REGIONS = ['tw', 'hk', 'th', 'id'] as const
/** the TCGdex language each region's text is in; hk is Traditional Chinese too, but its own site and wording */
export const REGION_LANGUAGE: Record<AsiaRegion, string> = { tw: 'zh-tw', hk: 'zh-hk', th: 'th', id: 'id', ja: 'ja', ko: 'ko', 'zh-cn': 'zh-cn' }

export const root = (region: AsiaRegion) => join(config.cacheDir, 'asia', region)
export const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)
const UA = (config as { asia?: { userAgent?: string } }).asia?.userAgent ?? (config as { userAgent: string }).userAgent
const [DELAY_MIN, DELAY_MAX] = (config as { asia?: { requestDelayMs?: [number, number] } }).asia?.requestDelayMs ?? [800, 1800]

let fresh = false
export const setAsiaFresh = (on: boolean) => { fresh = on }

let nextSlot = 0
async function pace(): Promise<void> {
	const gap = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)
	const slot = Math.max(Date.now(), nextSlot)
	nextSlot = slot + gap
	const wait = slot - Date.now()
	if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

export async function request(url: string): Promise<Response> {
	let last = ''
	for (let attempt = 0; attempt < 4; attempt++) {
		await pace()
		try {
			const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(45_000) })
			if (res.status === 404) throw new Error(`404 ${url}`)
			if (res.status === 429 || res.status === 403 || res.status >= 500) {
				last = `${res.status}`
				const wait = 15_000 * (attempt + 1)
				console.warn(`[asia] ${res.status} at ${url}: backing off ${wait / 1000}s`)
				await new Promise((r) => setTimeout(r, wait))
				continue
			}
			if (!res.ok) throw new Error(`${res.status} ${url}`)
			return res
		} catch (err) {
			if ((err as Error).message.startsWith('404 ')) throw err
			last = (err as Error).message
			await new Promise((r) => setTimeout(r, 2000))
		}
	}
	throw new Error(`gave up on ${url}: ${last}`)
}

/** A page of the portal, cached on disk. */
async function getPage(region: AsiaRegion, path: string): Promise<string> { return getUrl(region, HOST + path) }

/** Any page, cached on disk under the region (the Japan, China and Korea sources use this too). */
export async function getUrl(region: AsiaRegion, url: string): Promise<string> {
	const file = join(root(region), 'html', `${sha(url)}.html`)
	if (!fresh) { try { return await readFile(file, 'utf8') } catch {} }
	console.log(`[asia] ${url}`)
	const html = await (await request(url)).text()
	await mkdir(dirname(file), { recursive: true })
	await writeFile(file, html)
	return html
}

export const text = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim()
const energyOf = (src: string | undefined) => /\/energy\/([A-Za-z]+)\.png/.exec(src ?? '')?.[1] ?? null
const abs = (u: string | undefined) => (u ? new URL(u, HOST).href : null)

// ---- expansions -------------------------------------------------------------------------------------------------

export function parseExpansions(html: string, region: AsiaRegion): { items: AsiaExpansion[]; pages: number } {
	const $ = cheerio.load(html)
	const items: AsiaExpansion[] = []
	$('li.expansion').each((_, li) => {
		const a = $(li).find('a.expansionLink')
		const code = /expansionCodes=([^&"]+)/.exec(a.attr('href') ?? '')?.[1]
		if (!code) return
		const date = /(\d{2})-(\d{2})-(\d{4})/.exec($(li).find('time').attr('datetime') ?? '')
		items.push({
			region,
			code: decodeURIComponent(code),
			title: text($(li).find('.expansionTitle').text()),
			series: text($(li).find('.series').text()) || null,
			releaseDate: date ? `${date[3]}-${date[1]}-${date[2]}` : null,
			productImage: abs($(li).find('.imageContainer img').attr('src')),
			cards: null
		})
	})
	const pages = Math.max(1, ...$('a[href*="pageNo="]').map((_, a) => Number(/pageNo=(\d+)/.exec($(a).attr('href') ?? '')?.[1] ?? 1)).get())
	return { items, pages }
}

/** Every product the region's site lists (the listing is paged, 20 to a page). */
export async function listExpansions(region: AsiaRegion): Promise<AsiaExpansion[]> {
	const first = parseExpansions(await getPage(region, `/${region}/card-search/`), region)
	const all = [...first.items]
	for (let p = 2; p <= first.pages; p++) all.push(...parseExpansions(await getPage(region, `/${region}/card-search/?pageNo=${p}`), region).items)
	const unique = [...new Map(all.map((e) => [e.code, e])).values()]
	await mkdir(root(region), { recursive: true })
	await writeFile(join(root(region), 'expansions.json'), JSON.stringify(unique, null, '\t'))
	return unique
}

export async function readExpansions(region: AsiaRegion): Promise<AsiaExpansion[]> {
	try { return JSON.parse(await readFile(join(root(region), 'expansions.json'), 'utf8')) } catch { return [] }
}

// ---- card lists -------------------------------------------------------------------------------------------------

export function parseList(html: string): { ids: string[]; total: number; pages: number; rarities: Record<string, string> } {
	const $ = cheerio.load(html)
	const ids = [...new Set($('a[href*="/card-search/detail/"]').map((_, a) => /\/detail\/(\d+)/.exec($(a).attr('href') ?? '')?.[1] ?? '').get().filter(Boolean))]
	const total = Number($('.resultNumber').first().text().replace(/\D/g, '')) || 0
	const pages = Number(/(\d+)/.exec($('.resultTotalPages').first().text())?.[1] ?? 1)
	// the rarity filter: its checkbox value -> the label (C, U, R, RR, SAR, ...)
	const rarities: Record<string, string> = {}
	$('.rarityOption input[name="rarity[]"]').each((_, i) => {
		const label = text($(`label[for="${$(i).attr('id')}"]`).text())
		if (label) rarities[$(i).attr('value') ?? ''] = label
	})
	return { ids, total, pages, rarities }
}

const listPath = (region: AsiaRegion, code: string, page: number, rarity?: string) =>
	`/${region}/card-search/list/?expansionCodes=${encodeURIComponent(code)}${rarity ? `&rarity%5B%5D=${rarity}` : ''}${page > 1 ? `&pageNo=${page}` : ''}`

async function listAllIds(region: AsiaRegion, code: string, rarity?: string): Promise<{ ids: string[]; rarities: Record<string, string>; total: number }> {
	const first = parseList(await getPage(region, listPath(region, code, 1, rarity)))
	const ids = [...first.ids]
	for (let p = 2; p <= first.pages; p++) ids.push(...parseList(await getPage(region, listPath(region, code, p, rarity))).ids)
	return { ids: [...new Set(ids)], rarities: first.rarities, total: first.total }
}

// ---- card pages -------------------------------------------------------------------------------------------------

export function parseCard(html: string, ctx: { region: AsiaRegion; expansionCode: string; cardId: string }): AsiaCard {
	const $ = cheerio.load(html)
	const h1 = $('h1.pageHeader')
	const stageLabel = text(h1.find('.evolveMarker').text()) || null
	const name = text(h1.clone().children('.evolveMarker').remove().end().text())
	const energies = (el: cheerio.Cheerio<any>) => el.find('img').map((_, i) => energyOf($(i).attr('src'))).get().filter((x): x is string => !!x)
	const modifier = (td: cheerio.Cheerio<any>) => {
		const types = energies(td)
		const value = text(td.text()).replace(/^--$/, '') || null
		return types.map((type) => ({ type, value }))
	}
	const skills: AsiaSkill[] = $('.skillInformation').toArray().flatMap((block) => {
		const section = text($(block).children('.commonHeader').first().text()) || null
		return $(block).find('.skill').toArray().map((s) => ({
			section,
			name: text($(s).find('.skillName').text()) || null,
			cost: energies($(s).find('.skillCost')),
			damage: text($(s).find('.skillDamage').text()) || null,
			effect: text($(s).find('.skillEffect').text()) || null
		}))
	}).filter((s: AsiaSkill) => s.name || s.cost.length || s.damage || s.effect)
	const collector = text($('.collectorNumber').text()) || null
	const [num, tot] = (/(\d+)\s*\/\s*(\d+)/.exec(collector ?? '') ?? []).slice(1).map(Number)
	const dex = /No\.?\s*(\d+)\s*(.*)/.exec(text($('.extraInformation h3').first().text()))
	const sizeText = $('.extraInformation .size')
	const values = sizeText.find('.value').map((_, v) => text($(v).text())).get()
	const weakness = $('td.weakpoint')
	return {
		scrapedAt: new Date().toISOString(),
		region: ctx.region,
		expansionCode: ctx.expansionCode,
		cardId: ctx.cardId,
		sourceUrl: `${HOST}/${ctx.region}/card-search/detail/${ctx.cardId}/`,
		name,
		stageLabel,
		hp: Number(text($('.mainInfomation .number').first().text())) || null,
		types: energies($('.mainInfomation')),
		skills,
		weakness: modifier(weakness),
		resistance: modifier($('td.resist')),
		retreat: energies($('td.escape')).length || null,
		regulationMark: text($('.expansionColumn .alpha').text()) || null,
		collectorNumber: collector,
		number: num ?? null,
		total: tot ?? null,
		rarity: null,
		illustrator: text($('.illustrator a').first().text()) || null,
		dexNumber: dex ? Number(dex[1]) : null,
		species: dex ? text(dex[2]) || null : null,
		height: values[0] ?? null,
		weight: values[1] ?? null,
		flavorText: text($('.extraInformation .discription').html()?.replace(/<br\s*\/?>/g, '') ?? '') || null,
		evolution: $('.evolution li.step').map((_, li) => text($(li).text())).get(),
		imageUrl: abs($('.cardImage img').attr('src')),
		symbolUrl: abs($('.expansionSymbol img').attr('src'))
	}
}

export const cardFile = (region: AsiaRegion, code: string, id: string) => join(root(region), code, `${id}.json`)

export async function readCards(region: AsiaRegion, code: string): Promise<AsiaCard[]> {
	try {
		const files = (await readdir(join(root(region), code))).filter((f) => f.endsWith('.json'))
		// a file being written right now (a scrape is running) can be unreadable for a moment: leave it out this time
		const cards = (await Promise.all(files.map(async (f) => { try { return JSON.parse(await readFile(join(root(region), code, f), 'utf8')) as AsiaCard } catch { return null } }))).filter((c): c is AsiaCard => c !== null)
		return cards.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.cardId.localeCompare(b.cardId, undefined, { numeric: true }))
	} catch { return [] }
}

/**
 * Scrape one product of one region: list its cards, read every card page, work out each card's rarity from the portal's rarity
 * filter (the card pages do not print it as text), and optionally download the images.
 */
export async function scrapeExpansion(region: AsiaRegion, code: string, opts: { images?: boolean; rarities?: boolean } = {}): Promise<{ cards: number; images: number; failed: string[] }> {
	const { ids, rarities, total } = await listAllIds(region, code)
	if (!ids.length) throw new Error(`${region}/${code}: the portal lists no cards`)
	if (total && total !== ids.length) console.warn(`[asia] ${region}/${code}: the listing says ${total} cards, ${ids.length} found`)

	const failed: string[] = []
	const cards: AsiaCard[] = []
	for (const id of ids) {
		try {
			const html = await getPage(region, `/${region}/card-search/detail/${id}/`)
			cards.push(parseCard(html, { region, expansionCode: code, cardId: id }))
		} catch (err) {
			failed.push(`${id}: ${(err as Error).message}`)
			console.warn(`[asia] card ${id}: ${(err as Error).message}`)
		}
	}

	if (opts.rarities !== false) {
		const byId = new Map(cards.map((c) => [c.cardId, c]))
		for (const [value, label] of Object.entries(rarities)) {
			const { ids: hit } = await listAllIds(region, code, value).catch(() => ({ ids: [] as string[] }))
			for (const id of hit) { const c = byId.get(id); if (c) c.rarity = label }
		}
	}

	for (const c of cards) {
		const prev = await readFile(cardFile(region, code, c.cardId), 'utf8').then((s) => JSON.parse(s) as AsiaCard).catch(() => null)
		// a re-parse keeps the image path that an earlier `images` run recorded
		if (prev?.imageFile) c.imageFile = prev.imageFile
		await mkdir(join(root(region), code), { recursive: true })
		await writeFile(cardFile(region, code, c.cardId), JSON.stringify(c, null, '\t'))
	}
	const exps = await readExpansions(region)
	const exp = exps.find((e) => e.code === code)
	if (exp) { exp.cards = cards.length; await writeFile(join(root(region), 'expansions.json'), JSON.stringify(exps, null, '\t')) }

	const images = opts.images === false ? 0 : (await downloadImages(region, code)).downloaded
	return { cards: cards.length, images, failed }
}

// ---- images -----------------------------------------------------------------------------------------------------

const imageLimit = pLimit(2)

export async function download(url: string, file: string): Promise<boolean> {
	try { if ((await stat(file)).size > 0) return false } catch {}
	const res = await request(url)
	if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`not an image: ${url}`)
	await mkdir(dirname(file), { recursive: true })
	await writeFile(file, Buffer.from(await res.arrayBuffer()))
	return true
}

/** One card's slice of a picture that shows several side by side. The image library is the Experimental repo's (as for staging). */
async function downloadPart(url: string, file: string, part: { index: number; of: number }, shared: Map<string, Promise<Buffer>>): Promise<boolean> {
	try { if ((await stat(file)).size > 0) return false } catch {}
	let sharp: any
	try { sharp = createRequire(join(defaultRepo, 'cdn', 'package.json'))('sharp') }
	catch { throw new Error(`sharp is not installed: run "bun install" in ${join(defaultRepo, 'cdn')}`) }
	if (!shared.has(url)) shared.set(url, request(url).then(async (res) => {
		if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`not an image: ${url}`)
		return Buffer.from(await res.arrayBuffer())
	}))
	const whole = await shared.get(url)!
	const { width, height } = await sharp(whole).metadata()
	const left = Math.round((width * part.index) / part.of)
	await mkdir(dirname(file), { recursive: true })
	await sharp(whole).extract({ left, top: 0, width: Math.round((width * (part.index + 1)) / part.of) - left, height }).jpeg({ quality: 95 }).toFile(file)
	return true
}

/** Download the card images (and the product art and set symbol) of a scraped product. Files already on disk are skipped. */
export async function downloadImages(region: AsiaRegion, code: string): Promise<{ downloaded: number; failed: string[] }> {
	const cards = await readCards(region, code)
	let downloaded = 0
	const failed: string[] = []
	const shared = new Map<string, Promise<Buffer>>() // an image that several cards are cut from is fetched once
	await Promise.all(cards.map((c) => imageLimit(async () => {
		if (!c.imageUrl) return
		// a cut-out has its own file name, so it is never taken for the whole picture downloaded under the card's id
		const suffix = c.imagePart ? `_${c.imagePart.index + 1}of${c.imagePart.of}` : ''
		const rel = [region, code, 'img', `${c.cardId}${suffix}${/\.\w+$/.exec(new URL(c.imageUrl).pathname)?.[0] ?? '.png'}`].join('/')
		try {
			const file = join(config.cacheDir, 'asia', rel)
			if (c.imagePart) {
				if (await downloadPart(c.imageUrl, file, c.imagePart, shared)) downloaded++
			} else if (await download(c.imageUrl, file)) downloaded++
			if (c.imageFile !== rel) {
				c.imageFile = rel
				await writeFile(cardFile(region, code, c.cardId), JSON.stringify(c, null, '\t'))
			}
		} catch (err) { failed.push(`${c.cardId}: ${(err as Error).message}`) }
	})))
	const exp = (await readExpansions(region)).find((e) => e.code === code)
	const extras = [exp?.productImage && ['product', exp.productImage], cards[0]?.symbolUrl && ['symbol', cards[0].symbolUrl]].filter(Boolean) as [string, string][]
	for (const [kind, url] of extras) {
		try { if (await download(url, join(root(region), code, 'img', `_${kind}${/\.\w+$/.exec(new URL(url).pathname)?.[0] ?? '.png'}`))) downloaded++ } catch (err) { failed.push(`${kind}: ${(err as Error).message}`) }
	}
	if (failed.length) console.warn(`[asia] ${region}/${code}: ${failed.length} images failed`)
	return { downloaded, failed }
}

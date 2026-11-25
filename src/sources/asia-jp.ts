import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import type { AsiaCard, AsiaExpansion, AsiaSkill } from '../types/asia.ts'
import { cardFile, downloadImages, getUrl, readExpansions, root, text } from './asia-portal.ts'

/**
 * Japan: pokemon-card.com. The search's JSON list (resultAPI.php) ignores set filters, so the whole list (about 600 pages of 39
 * cards, newest first) is read once and kept as cache/asia/ja/cardlist.json; a set is the folder its images sit in
 * (/assets/images/card_images/large/<FOLDER>/...). Card pages give the rest. The rarity is only an icon: its file name is the code.
 */

const HOST = 'https://www.pokemon-card.com'
const REGION = 'ja'
const listUrl = (page: number) => `${HOST}/card-search/resultAPI.php?keyword=&regulation_sidebar_form=all&page=${page}`

interface ListEntry { id: string; folder: string; thumb: string; name: string }

const ENERGY: Record<string, string> = { grass: 'Grass', fire: 'Fire', water: 'Water', lightning: 'Lightning', psychic: 'Psychic', fighting: 'Fighting', evil: 'Darkness', steel: 'Metal', dragon: 'Dragon', none: 'Colorless', fairy: 'Fairy' }
const energies = ($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>) =>
	el.find('.icon').map((_, i) => ENERGY[/icon-([a-z]+)/.exec($(i).attr('class') ?? '')?.[1] ?? ''] ?? null).get().filter((x): x is string => !!x)

/** Reads the whole card list (cached page by page) and writes cardlist.json. */
export async function crawlList(): Promise<ListEntry[]> {
	const first = JSON.parse(await getUrl(REGION, listUrl(1)))
	const entries: ListEntry[] = []
	const take = (j: any) => { for (const c of j.cardList ?? []) entries.push({ id: String(c.cardID), folder: /\/large\/([^/]+)\//.exec(c.cardThumbFile)?.[1] ?? '', thumb: c.cardThumbFile, name: c.cardNameViewText }) }
	take(first)
	for (let p = 2; p <= first.maxPage; p++) take(JSON.parse(await getUrl(REGION, listUrl(p))))
	const unique = [...new Map(entries.map((e) => [e.id, e])).values()]
	await mkdir(root(REGION), { recursive: true })
	await writeFile(join(root(REGION), 'cardlist.json'), JSON.stringify(unique))
	return unique
}
const readList = async () => JSON.parse(await readFile(join(root(REGION), 'cardlist.json'), 'utf8').catch(() => 'null')) as ListEntry[] | null ?? crawlList()

const JP_SERIES = /^(MEGA|スカーレット&バイオレット|ソード&シールド|サン&ムーン|XY(?:BREAK)?|BW|DPt|DP|LEGEND|PCG|ADV|neo|VS|e)$/

/** A set's title and date from its page (/ex/<code>/); missing for the promo and energy folders, which have no page. */
async function setPage(code: string): Promise<{ title: string; series: string | null; releaseDate: string | null } | null> {
	try {
		const html = await getUrl(REGION, `${HOST}/ex/${code.toLowerCase()}/`)
		const full = /<title>ポケモンカードゲーム\s*([^<｜|]+)/.exec(html)?.[1]?.trim()
		if (!full) return null
		const words = full.split(/\s+/)
		const series = words.length > 1 && JP_SERIES.test(words[0]!.replace(/\s/g, '')) ? words[0]! : null
		const date = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '')
		return { title: series ? words.slice(1).join(' ') : full, series, releaseDate: date ? `${date[1]}-${date[2]!.padStart(2, '0')}-${date[3]!.padStart(2, '0')}` : null }
	} catch { return null }
}

export async function listJapan(): Promise<AsiaExpansion[]> {
	const list = await crawlList()
	const folders = new Map<string, ListEntry[]>()
	for (const c of list) { if (!c.folder) continue; if (!folders.has(c.folder)) folders.set(c.folder, []); folders.get(c.folder)!.push(c) }
	const out: AsiaExpansion[] = []
	for (const [code, cards] of folders) {
		const page = await setPage(code)
		out.push({ region: REGION, code, title: page?.title ?? code, series: page?.series ?? null, releaseDate: page?.releaseDate ?? null, productImage: null, cards: cards.length })
	}
	// newest first, as the list is; sets with no date keep their place
	await writeFile(join(root(REGION), 'expansions.json'), JSON.stringify(out, null, '\t'))
	return out
}

export function parseJapanCard(html: string, ctx: { expansionCode: string; cardId: string }): AsiaCard {
	const $ = cheerio.load(html)
	const inner = $('.RightBox-inner')
	const skills: AsiaSkill[] = []
	let section: string | null = null
	let cur: AsiaSkill | null = null
	let stop = false
	inner.children().each((_, el) => {
		if (stop) return
		const $el = $(el)
		if (el.tagName === 'h2') {
			section = text($el.text()) || null
			if (section === '進化') stop = true
			cur = null
		} else if (el.tagName === 'h4') {
			const damage = text($el.find('.f_right').text()) || null
			const name = text($el.clone().find('.icon, .f_right').remove().end().text().replace(/ /g, ' ')) || null
			cur = { section, name, cost: energies($, $el), damage, effect: null }
			skills.push(cur)
		} else if (el.tagName === 'p') {
			const t = text($el.text())
			if (!t) return
			if (!cur) { cur = { section, name: null, cost: [], damage: null, effect: null }; skills.push(cur) }
			cur.effect = cur.effect ? `${cur.effect} ${t}` : t
		}
	})
	const subtext = text($('.subtext').text())
	const [num, tot] = (/(\d+)\s*\/\s*(\d+)/.exec(subtext) ?? []).slice(1).map(Number)
	const rarity = /ic_rare_([a-z0-9]+)/i.exec($('.subtext img[src*="rarity"]').attr('src') ?? '')?.[1]?.toUpperCase() ?? null
	const row = inner.find('table tr').eq(1).find('td')
	const mod = (td: cheerio.Cheerio<any>) => { const types = energies($, td); const value = text(td.text()).replace(/^--$/, '') || null; return types.map((type) => ({ type, value })) }
	const dex = /No\.?\s*(\d+)\s*(.*)/.exec(text($('.card h4').first().text()))
	const size = text($('.card p').first().text())
	const img = $('img.fit').attr('src')
	const sym = $('.img-regulation').attr('src')
	const stageLabel = text($('.TopInfo .type').text()) || null
	const hp = Number(text($('.hp-num').text())) || null
	return {
		scrapedAt: new Date().toISOString(),
		region: REGION,
		expansionCode: ctx.expansionCode,
		cardId: ctx.cardId,
		sourceUrl: `${HOST}/card-search/details.php/card/${ctx.cardId}/regu/all`,
		name: text($('h1.Heading1').text()),
		stageLabel,
		hp,
		types: energies($, $('.TopInfo .td-r')),
		skills: skills.filter((s) => s.section !== '進化' && (s.name || s.cost.length || s.damage || s.effect)),
		weakness: mod(row.eq(0)),
		resistance: mod(row.eq(1)),
		retreat: energies($, row.eq(2)).length || null,
		regulationMark: null,
		collectorNumber: subtext.match(/\d+\s*\/\s*\d+/)?.[0]?.replace(/\s/g, '') ?? null,
		number: num ?? null,
		total: tot ?? null,
		rarity,
		illustrator: text($('.author a').first().text()) || null,
		dexNumber: dex ? Number(dex[1]) : null,
		species: dex ? text(dex[2]) || null : null,
		height: /高さ[：:]\s*([\d.]+)/.exec(size)?.[1] ?? null,
		weight: /重さ[：:]\s*([\d.]+)/.exec(size)?.[1] ?? null,
		flavorText: text($('.card hr').next('p').text()) || null,
		evolution: $('.evolution a').map((_, a) => text($(a).text())).get().reverse(),
		imageUrl: img ? new URL(img, HOST).href : null,
		symbolUrl: sym ? new URL(sym, HOST).href : null
	}
}

/**
 * The cards one page is for. A two-card Stadium (伝説の海溝, "071/076" and "072/076") has one page, with one image, that
 * prints both numbers: each number is its own card, with the page's text. The first keeps the page's id, the others add
 * "-2", ... to it.
 */
export function parseJapanCards(html: string, ctx: { expansionCode: string; cardId: string }): AsiaCard[] {
	const card = parseJapanCard(html, ctx)
	const printed = [...cheerio.load(html)('.subtext').text().matchAll(/(\d+)\s*\/\s*(\d+)/g)]
	const numbers = [...new Map(printed.map((m) => [Number(m[1]), m])).values()]
	if (numbers.length < 2) return [card]
	// the page's one image shows them side by side, left to right in the order the numbers are printed
	const part = (index: number) => ({ index, of: numbers.length })
	return [{ ...card, imagePart: part(0) }, ...numbers.slice(1).map((m, i) => ({ ...card, cardId: `${card.cardId}-${i + 2}`, collectorNumber: `${m[1]}/${m[2]}`, number: Number(m[1]), total: Number(m[2]), imagePart: part(i + 1) }))]
}

export async function scrapeJapan(code: string, opts: { images?: boolean } = {}): Promise<{ cards: number; images: number; failed: string[] }> {
	const entries = (await readList())!.filter((c) => c.folder === code)
	if (!entries.length) throw new Error(`ja/${code}: no cards in the list (run: asia expansions ja)`)
	const failed: string[] = []
	let n = 0
	for (const e of entries) {
		try {
			const cards = parseJapanCards(await getUrl(REGION, `${HOST}/card-search/details.php/card/${e.id}/regu/all`), { expansionCode: code, cardId: e.id })
			if (!cards[0]!.name) throw new Error('no card on the page')
			await mkdir(join(root(REGION), code), { recursive: true })
			for (const card of cards) {
				const prev = await readFile(cardFile(REGION, code, card.cardId), 'utf8').then((s) => JSON.parse(s) as AsiaCard).catch(() => null)
				if (prev?.imageFile) card.imageFile = prev.imageFile
				await writeFile(cardFile(REGION, code, card.cardId), JSON.stringify(card, null, '\t'))
				n++
			}
		} catch (err) { failed.push(`${e.id}: ${(err as Error).message}`); console.warn(`[asia] ja card ${e.id}: ${(err as Error).message}`) }
	}
	const exps = await readExpansions(REGION)
	const exp = exps.find((x) => x.code === code)
	if (exp && exp.title === exp.code) {
		// the set's own page is gone for older sets, but every card page links to it with the set's title
		const link = cheerio.load(await getUrl(REGION, `${HOST}/card-search/details.php/card/${entries[0]!.id}/regu/all`))('.PopupSub .Link').first().text().trim()
		if (link) exp.title = link
	}
	if (exp) { exp.cards = n; await writeFile(join(root(REGION), 'expansions.json'), JSON.stringify(exps, null, '\t')) }
	const images = opts.images === false ? 0 : (await downloadImages(REGION, code)).downloaded
	return { cards: n, images, failed }
}

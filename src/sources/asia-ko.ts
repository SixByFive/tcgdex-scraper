import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import type { AsiaCard, AsiaExpansion, AsiaSkill } from '../types/asia.ts'
import { cardFile, downloadImages, getUrl, readExpansions, root, text } from './asia-portal.ts'

/**
 * Korea: pokemoncard.co.kr. The card pages (/cards/detail/<id>) are plain public pages and are read normally. The card LIST is
 * not available to this scraper: the site's list request answers "access denied" to anything but a browser session, and this tool
 * does not imitate one. So the scraper needs cache/asia/ko/cardlist.json from elsewhere: an array of
 * { id, folder, series, product, thumb } (id = the CardNum in /cards/detail/<id>, folder = the set code in the image path
 * wmimages/<series>/<folder>/..., product = the product name). Given that file it scrapes cards and images as for any region.
 */

const HOST = 'https://www.pokemoncard.co.kr'
const REGION = 'ko'
interface ListEntry { id: string; folder: string; series: string; product: string; thumb: string }

const readList = () => readFile(join(root(REGION), 'cardlist.json'), 'utf8').then((s) => JSON.parse(s) as ListEntry[]).catch(() => null)

/** Products from the card list you supplied; there is no way to ask the site for it. */
export async function listKorea(): Promise<AsiaExpansion[]> {
	const list = await readList()
	if (!list) throw new Error('Korea: put the card list in cache/asia/ko/cardlist.json (see src/sources/asia-ko.ts): pokemoncard.co.kr does not give it to scripts')
	const sets = new Map<string, ListEntry[]>()
	for (const c of list) { if (!sets.has(c.folder)) sets.set(c.folder, []); sets.get(c.folder)!.push(c) }
	const out: AsiaExpansion[] = [...sets].map(([code, cards]) => ({ region: REGION, code, title: cards[0]!.product, series: cards[0]!.series, releaseDate: null, productImage: null, cards: cards.length }))
	await writeFile(join(root(REGION), 'expansions.json'), JSON.stringify(out, null, 2))
	return out
}

const TYPE: Record<string, string> = { 풀: 'Grass', 불꽃: 'Fire', 물: 'Water', 번개: 'Lightning', 초: 'Psychic', 격투: 'Fighting', 악: 'Darkness', 강철: 'Metal', 드래곤: 'Dragon', 무색: 'Colorless', 페어리: 'Fairy' }
const typeOf = ($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>) => el.find('img.type_b').map((_, i) => TYPE[$(i).attr('title') ?? ''] ?? null).get().filter((x): x is string => !!x)
const abs = (u: string | undefined) => (u ? new URL(u, HOST).href : null)

export function parseKoreaCard(html: string, ctx: { expansionCode: string; cardId: string }): AsiaCard {
	const $ = cheerio.load(html)
	const skills: AsiaSkill[] = $('.pokemon-abilities .ability').map((_, a) => {
		const head = $(a).find('.area-parent')
		return {
			section: null,
			name: text($(a).find('.skil_name').text()) || null,
			cost: typeOf($, head),
			damage: /(\d+\s*[+×x]?)\s*$/.exec(text(head.clone().find('.skil_name').remove().end().text()))?.[1]?.replace(/\s/g, '') ?? null,
			effect: text($(a).find('p').text()) || null
		}
	}).get()
	const stat = (label: string) => $('.pokemon-stats .stat').filter((_, s) => text($(s).find('h4').text()) === label).first()
	const wk = stat('약점'), rs = stat('저항력'), rt = stat('후퇴')
	const mod = (el: cheerio.Cheerio<any>) => { const value = text(el.find('span').text()) || null; return typeOf($, el).map((type) => ({ type, value })) }
	const num = /(\d+)\s*\/\s*(\d+)/.exec(text($('.p_num').text()))
	const symbols = $('.pre_info_wrap img').map((_, i) => $(i).attr('src') ?? '').get()
	const mark = /symbol\/([A-Z])\.png/.exec(symbols[1] ?? '')?.[1] ?? null
	const info = text($('.pokemon-info').text()).replace(/^카드 종류\s*:\s*/, '') || null
	const detail = text($('.pokemon-detail').eq(1).text())
	const dex = /<!--No\.\s*(\d+)-->/.exec(html)?.[1]
	const illustrator = text($('.illustrator').html()?.replace(/<br\s*\/?>/g, ' ') ?? '').replace(/^일러스트\s*/, '')
	return {
		scrapedAt: new Date().toISOString(), region: REGION, expansionCode: ctx.expansionCode, cardId: ctx.cardId,
		sourceUrl: `${HOST}/cards/detail/${ctx.cardId}`,
		name: text($('.card-hp.title').text()),
		stageLabel: info,
		hp: Number(/HP\s*(\d+)/.exec(text($('.hp_num').text()))?.[1]) || null,
		types: typeOf($, $('.header .txt_right')),
		skills: skills.filter((s) => s.name || s.cost.length || s.damage || s.effect),
		weakness: mod(wk), resistance: mod(rs),
		retreat: rt.find('.card-energies img').length || null,
		regulationMark: mark, collectorNumber: num ? `${num[1]}/${num[2]}` : null, number: num ? Number(num[1]) : null, total: num ? Number(num[2]) : null,
		rarity: null,
		illustrator: illustrator || null,
		dexNumber: dex ? Number(dex) : null, species: null,
		height: /키\s*:\s*([\d.]+)/.exec(detail)?.[1] ?? null, weight: /몸무게\s*:\s*([\d.]+)/.exec(detail)?.[1] ?? null,
		flavorText: text($('.colsit p').first().text()) || null, evolution: [],
		imageUrl: abs($('img.feature_image').attr('src')?.replace(/\?w=\d+$/, '')),
		symbolUrl: abs(symbols[0])
	}
}

export async function scrapeKorea(code: string, opts: { images?: boolean } = {}): Promise<{ cards: number; images: number; failed: string[] }> {
	const list = await readList()
	if (!list) throw new Error('ko: no cache/asia/ko/cardlist.json (see src/sources/asia-ko.ts)')
	const entries = list.filter((c) => c.folder === code)
	if (!entries.length) throw new Error(`ko/${code}: no cards in the list`)
	const failed: string[] = []
	let n = 0
	await mkdir(join(root(REGION), code), { recursive: true })
	for (const e of entries) {
		try {
			const card = parseKoreaCard(await getUrl(REGION, `${HOST}/cards/detail/${e.id}`), { expansionCode: code, cardId: e.id })
			if (!card.name) throw new Error('no card on the page')
			const prev = await readFile(cardFile(REGION, code, e.id), 'utf8').then((s) => JSON.parse(s) as AsiaCard).catch(() => null)
			if (prev?.imageFile) card.imageFile = prev.imageFile
			await writeFile(cardFile(REGION, code, e.id), JSON.stringify(card, null, '\t'))
			n++
		} catch (err) { failed.push(`${e.id}: ${(err as Error).message}`); console.warn(`[asia] ko card ${e.id}: ${(err as Error).message}`) }
	}
	const exps = await readExpansions(REGION)
	const exp = exps.find((x) => x.code === code)
	if (exp) { exp.cards = n; await writeFile(join(root(REGION), 'expansions.json'), JSON.stringify(exps, null, '\t')) }
	return { cards: n, images: opts.images === false ? 0 : (await downloadImages(REGION, code)).downloaded, failed }
}

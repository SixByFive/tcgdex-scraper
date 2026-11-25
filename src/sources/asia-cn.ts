import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AsiaCard, AsiaExpansion } from '../types/asia.ts'
import { cardFile, getUrl, readExpansions, root } from './asia-portal.ts'

/**
 * Mainland China (zh-cn). There is no official card database, and TCGdex has the sets but no cards. So:
 *   sets   TCGdex (Simplified Chinese name, release date, card count)
 *   cards  Bulbapedia's set pages ("<name> (ATCG)"): number, English name, type, rarity. No Chinese text, no images (its pictures
 *          are uploads under their own terms, so they are not downloaded). Bulbapedia is read through its MediaWiki API.
 * A card's `name` is therefore English, marked by `nameLanguage`.
 */

const REGION = 'zh-cn'
const TCGDEX = 'https://api.tcgdex.net/v2/zh-cn'
const BULBA = 'https://bulbapedia.bulbagarden.net/w/api.php'

/** TCGdex ids are inconsistent (CSM1aC, csm1c, CSV9.5C): compare them without case and the trailing C. */
const key = (id: string) => id.toLowerCase().replace(/c$/, '')

export async function listChina(): Promise<AsiaExpansion[]> {
	const sets = JSON.parse(await getUrl(REGION, `${TCGDEX}/sets`)) as { id: string; name: string; cardCount: { total: number; official: number } }[]
	const out: AsiaExpansion[] = []
	for (const s of sets) {
		let detail: { releaseDate?: string; serie?: { name?: string } } = {}
		try { detail = JSON.parse(await getUrl(REGION, `${TCGDEX}/sets/${encodeURIComponent(s.id)}`)) } catch { /* a set with no detail keeps no date */ }
		out.push({ region: REGION, code: s.id, title: s.name, series: detail.serie?.name ?? null, releaseDate: detail.releaseDate ?? null, productImage: null, cards: null })
	}
	out.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
	await mkdir(root(REGION), { recursive: true })
	await writeFile(join(root(REGION), 'expansions.json'), JSON.stringify(out, null, '\t'))
	return out
}

interface BulbaCard { number: string; total: string; mark: string; name: string; type: string; rarity: string }
type BulbaIndex = Record<string, { page: string; title: string; cards: BulbaCard[] }>

/** Splits a template's arguments on the pipes that are not inside {{ }} or [[ ]]. */
function args(body: string): string[] {
	const out: string[] = []
	let depth = 0, cur = ''
	for (let i = 0; i < body.length; i++) {
		const two = body.slice(i, i + 2)
		if (two === '{{' || two === '[[') { depth++; cur += two; i++ }
		else if (two === '}}' || two === ']]') { depth--; cur += two; i++ }
		else if (body[i] === '|' && depth === 0) { out.push(cur); cur = '' }
		else cur += body[i]
	}
	out.push(cur)
	return out
}

/** "{{TCG ID|Set|Charizard|4}}" -> Charizard; "[[Page|Charizard]]{{GX}}" -> Charizard GX. */
function nameOf(raw: string): string {
	const id = /\{\{TCG ID\|[^|]*\|([^|}]+)/.exec(raw)
	if (id) return id[1]!.trim()
	const link = /\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/.exec(raw)
	const suffix = [...raw.matchAll(/\{\{([^|}]+)\}\}/g)].map((m) => m[1]!.trim()).join(' ')
	return `${link?.[1] ?? raw.replace(/\{\{[^}]*\}\}/g, '')}${suffix ? ' ' + suffix : ''}`.trim()
}

export function parseSetLists(wikitext: string): { code: string; cards: BulbaCard[] }[] {
	const groups: { code: string; cards: BulbaCard[] }[] = []
	for (const line of wikitext.split('\n')) {
		const header = /\{\{Setlist\/header\|.*?image=SetSymbol([A-Za-z0-9.]+?)\.png/.exec(line)
		if (header) { groups.push({ code: header[1]!, cards: [] }); continue }
		const entry = /^\{\{Setlist\/entry\|(.*)\}\}\s*$/.exec(line)
		if (entry && groups.length) {
			const a = args(entry[1]!)
			const [number, total] = (a[0] ?? '').split('/')
			groups[groups.length - 1]!.cards.push({ number: number!.trim(), total: (total ?? '').trim(), mark: (a[1] ?? '').trim(), name: nameOf(a[2] ?? ''), type: (a[3] ?? '').trim(), rarity: (a[5] ?? '').trim() })
		}
	}
	return groups.filter((g) => g.cards.length)
}

/** Reads every mainland set page once (the list of them is the page "Pokémon in mainland China"). */
async function bulbaIndex(): Promise<BulbaIndex> {
	const file = join(root(REGION), 'bulbapedia-index.json')
	try { return JSON.parse(await readFile(file, 'utf8')) } catch { /* build it */ }
	const links = JSON.parse(await getUrl(REGION, `${BULBA}?action=parse&page=${encodeURIComponent('Pokémon_in_mainland_China')}&prop=links&format=json`))
	const pages = [...new Set<string>(links.parse.links.map((l: { '*': string }) => l['*']).filter((t: string) => /\(ATCG\)$/.test(t)))]
	const index: BulbaIndex = {}
	for (const title of pages) {
		const wt = JSON.parse(await getUrl(REGION, `${BULBA}?action=parse&page=${encodeURIComponent(title.replace(/ /g, '_'))}&prop=wikitext&format=json&redirects=1`))
		const text: string | undefined = wt.parse?.wikitext?.['*']
		if (!text) continue
		for (const g of parseSetLists(text)) index[key(g.code)] = { page: title, title, cards: g.cards }
	}
	await mkdir(root(REGION), { recursive: true })
	await writeFile(file, JSON.stringify(index))
	return index
}

const TYPES: Record<string, string> = { Grass: 'Grass', Fire: 'Fire', Water: 'Water', Lightning: 'Lightning', Psychic: 'Psychic', Fighting: 'Fighting', Darkness: 'Darkness', Metal: 'Metal', Dragon: 'Dragon', Colorless: 'Colorless', Fairy: 'Fairy' }

export async function scrapeChina(code: string): Promise<{ cards: number; images: number; failed: string[] }> {
	const entry = (await bulbaIndex())[key(code)]
	if (!entry) throw new Error(`zh-cn/${code}: Bulbapedia has no card list for this set`)
	await mkdir(join(root(REGION), code), { recursive: true })
	let n = 0
	for (const c of entry.cards) {
		const card: AsiaCard = {
			scrapedAt: new Date().toISOString(), region: REGION, expansionCode: code, cardId: c.number.replace(/\W/g, '') || String(n + 1),
			sourceUrl: `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(entry.page.replace(/ /g, '_'))}`,
			name: c.name, nameLanguage: 'en', stageLabel: null, hp: null, types: TYPES[c.type] ? [TYPES[c.type]!] : [], skills: [], weakness: [], resistance: [], retreat: null,
			regulationMark: c.mark || null, collectorNumber: c.total ? `${c.number}/${c.total}` : c.number, number: /^\d+$/.test(c.number) ? Number(c.number) : null,
			total: c.total ? Number(c.total) : null, rarity: c.rarity || null, illustrator: null, dexNumber: null, species: null, height: null, weight: null,
			flavorText: null, evolution: [], imageUrl: null, symbolUrl: null
		}
		await writeFile(cardFile(REGION, code, card.cardId), JSON.stringify(card, null, '\t'))
		n++
	}
	const exps = await readExpansions(REGION)
	const exp = exps.find((x) => x.code === code)
	if (exp) { exp.cards = n; await writeFile(join(root(REGION), 'expansions.json'), JSON.stringify(exps, null, '\t')) }
	return { cards: n, images: 0, failed: [] }
}

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { ScrapedCard } from '../types/scraped.ts'

/**
 * Cardmarket publishes its product catalogue for download (no login, no scraping): every single card's id, name and expansion.
 * Cardmarket product pages are blocked to scripts, so this is the way to check a Cardmarket id: that it exists, and that it is a
 * product of this card. Game 6 is Pokémon. The file is ~14 MB, kept in var/cardmarket and refreshed after a day.
 */
const URL_ = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json'
const FILE = join('var', 'cardmarket', 'products_singles_6.json')
const MAX_AGE_MS = 24 * 3600 * 1000

export interface CmProduct { idProduct: number; name: string; idExpansion: number; dateAdded?: string }

let loaded: Map<number, CmProduct> | undefined

export async function loadCatalogue(opts: { refresh?: boolean } = {}): Promise<Map<number, CmProduct>> {
	if (loaded && !opts.refresh) return loaded
	let fresh = false
	try { fresh = existsSync(FILE) && Date.now() - (await stat(FILE)).mtimeMs < MAX_AGE_MS } catch {}
	if (opts.refresh || !fresh) {
		try {
			const res = await fetch(URL_, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(120000) })
			if (!res.ok) throw new Error(`${res.status}`)
			await mkdir(join('var', 'cardmarket'), { recursive: true })
			await writeFile(FILE, Buffer.from(await res.arrayBuffer()))
		} catch (err) {
			// an old copy is better than none: ids rarely change
			if (!existsSync(FILE)) throw new Error(`Cardmarket catalogue unreachable (${(err as Error).message}) and none saved`)
		}
	}
	const json = JSON.parse(await readFile(FILE, 'utf8')) as { products: CmProduct[] }
	return (loaded = new Map(json.products.map((p) => [p.idProduct, p])))
}

/** Cardmarket writes "Name [Attack | Attack]" (Energy: "Growing [G] Energy"); the tags and attacks are not part of the name. */
const key = (s: unknown): string =>
	String(s ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
		.replace(/[‘’']/g, '').replace(/[​-‍]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^basic /, '').replace(/ lv \d+$/, '').trim()

/**
 * Whether Cardmarket's product could be this card. Lenient on purpose: it only has to catch an id of ANOTHER card ("Snorlax" for
 * Blissey). Names that start alike count ("Growing Grass Energy" is "Growing [G] Energy"; "Legendary Pyroduct" is
 * "Legendary Lava Tube [Left]").
 */
export function sameProduct(cardName: string, product: CmProduct): boolean {
	const a = key(cardName), b = key(product.name)
	if (!a || !b) return true
	if (a === b || a.startsWith(b) || b.startsWith(a) || a.replace(/ /g, '') === b.replace(/ /g, '')) return true
	return a.split(' ')[0] === b.split(' ')[0] && a.split(' ').length > 1 && b.split(' ').length > 1
}

export interface CmProblem { card: string; variant: string; id: number; problem: string }

/** Every Cardmarket id of a scraped set's variants that is not in the catalogue, or is a product of another card. */
export async function verifyCardmarketIds(setId: string, opts: { refresh?: boolean } = {}): Promise<{ checked: number; problems: CmProblem[] }> {
	const catalogue = await loadCatalogue(opts)
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	const problems: CmProblem[] = []
	let checked = 0
	for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
		const card = JSON.parse(await readFile(join(dir, f), 'utf8')) as ScrapedCard
		const name = card.locales.en?.name ?? ''
		for (const v of card.variants ?? []) {
			const id = v.prices.cardmarket
			if (!id) continue
			checked++
			const label = `${v.type}${v.foil ? ':' + v.foil : ''}${v.stamps?.length ? '[' + v.stamps.join(',') + ']' : ''}`
			const p = catalogue.get(id)
			if (!p) problems.push({ card: `${setId}-${card.structural.localId} ${name}`, variant: label, id, problem: 'not in Cardmarket\'s catalogue' })
			else if (!sameProduct(name, p)) problems.push({ card: `${setId}-${card.structural.localId} ${name}`, variant: label, id, problem: `Cardmarket names it "${p.name}"` })
		}
	}
	return { checked, problems }
}

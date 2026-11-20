import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import config from '../../config.json' with { type: 'json' }
import { closeBrowser, getCached } from '../util/fetch.ts'
import { tokens } from './cardmarket-sealed.ts'

/**
 * Pokémon.com's product gallery (pokemon.com/us/pokemon-tcg/product-gallery): the official page of each sealed product, with its
 * launch date and a list of what is inside. One listing per year links to the product pages. Boxes, bundles, ETBs, tins and
 * collections are there; blisters and single packs are not. Each product page is kept as JSON in cache/pokemon-gallery.
 */
const BASE = 'https://www.pokemon.com/us/pokemon-tcg/product-gallery'
const DIR = join(config.cacheDir, 'pokemon-gallery')

/** A list on a product page and the sentence that introduces it ("The … Elite Trainer Box includes:"). */
export interface GallerySection { heading: string; items: string[] }
export interface GalleryProduct {
	slug: string
	url: string
	year: number
	title: string
	/** ISO date of the launch the page gives */
	launch?: string
	/** the paragraphs of the page, in order */
	text: string[]
	sections: GallerySection[]
	images: string[]
	scrapedAt: string
}

const clean = (s: string): string => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

/** "Launch: July 17, 2026" -> "2026-07-17" (the page's date is a day with no time zone). */
export function parseLaunch(text: string): string | undefined {
	const m = text.match(/(?:launch|release)(?:ed|es)?:?\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i)
	if (!m) return undefined
	const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(m[1]!.toLowerCase())
	if (month < 0) return undefined
	return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
}

/** The product slugs a year's listing links to. */
export function parseListing(html: string): string[] {
	const $ = cheerio.load(html)
	const slugs = new Set<string>()
	$('a[href*="/product-gallery/"]').each((_, a) => {
		const m = ($(a).attr('href') ?? '').match(/\/product-gallery\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i)
		if (m && !/^\d{4}$/.test(m[1]!)) slugs.add(m[1]!.toLowerCase())
	})
	return [...slugs]
}

/** A product page: title, launch date, the paragraphs and the bullet lists with the sentence before each. */
export function parseProductPage(html: string, slug: string, year: number): GalleryProduct {
	const $ = cheerio.load(html)
	const title = clean($('h1.us-title').first().text() || $('h1').first().text())
	const body = $('.full-article-body').first()
	const text: string[] = []
	const sections: GallerySection[] = []
	let last = ''
	body.children().each((_, el) => {
		const node = $(el)
		if (node.is('ul')) {
			const items = node.find('li').map((__, li) => clean($(li).text())).get().filter(Boolean)
			if (items.length) sections.push({ heading: last, items })
		} else {
			const t = clean(node.text())
			if (t) { text.push(t); last = t }
		}
	})
	const images = new Set<string>()
	const og = $('meta[property="og:image"]').attr('content')
	if (og) images.add(og)
	body.find('img').each((_, img) => {
		const src = $(img).attr('src')
		if (src) images.add(new URL(src, 'https://www.pokemon.com').href)
	})
	return { slug, url: `${BASE}/${slug}`, year, title, launch: parseLaunch(clean($('.generic-date').first().text())), text, sections, images: [...images], scrapedAt: new Date().toISOString() }
}

export async function loadGallery(): Promise<GalleryProduct[]> {
	if (!existsSync(DIR)) return []
	const out: GalleryProduct[] = []
	for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
		try { out.push(JSON.parse(await readFile(join(DIR, f), 'utf8'))) } catch { /* a half-written file is scraped again */ }
	}
	return out
}

export async function galleryCount(): Promise<number> {
	try { return (await readdir(DIR)).filter((f) => f.endsWith('.json')).length } catch { return 0 }
}

/** The "includes" list as the bulleted text the contents parser reads; every list on the page when none is introduced as one. */
export function galleryContentsText(p: GalleryProduct): string {
	const intro = p.sections.filter((s) => /\b(includes?|contains?|comes with|inside)\b/i.test(s.heading))
	if (!p.sections.length) return p.text.join(' ')
	return (intro.length ? intro : p.sections).flatMap((s) => s.items).map((i) => `• ${i}`).join('<br>')
}

export interface ScrapeOptions { years?: number[]; refresh?: boolean }

/**
 * Lists each year, then every product page not already kept (all of them with `refresh`). Pages are asked for through the shared
 * browser, with the same pacing and bot-check handling as the card scrape: solve a check by hand in the window if one shows.
 */
export async function scrapeGallery(opts: ScrapeOptions = {}): Promise<{ scraped: number; kept: number; failed: string[] }> {
	const thisYear = new Date().getFullYear()
	const years = opts.years?.length ? opts.years : Array.from({ length: thisYear - 2019 }, (_, i) => thisYear - i)
	await mkdir(DIR, { recursive: true })
	let scraped = 0, kept = 0
	const failed: string[] = []
	try {
		for (const year of years) {
			let slugs: string[] = []
			for (const url of [`${BASE}/${year}`, ...(year === thisYear ? [BASE] : [])]) {
				try {
					slugs = parseListing(await getCached(url, { ready: 'a[href*="/product-gallery/"]', marker: 'product-gallery/' }))
					if (slugs.length) break
				} catch (err) { console.warn(`[gallery] ${url}: ${(err as Error).message}`) }
			}
			console.log(`[gallery] ${year}: ${slugs.length} products`)
			for (const slug of slugs) {
				const file = join(DIR, `${slug}.json`)
				if (!opts.refresh && existsSync(file)) { kept++; continue }
				try {
					const html = await getCached(`${BASE}/${slug}`, { ready: '.full-article-body', marker: 'full-article-body' })
					const product = parseProductPage(html, slug, year)
					if (!product.title) throw new Error('no title on the page')
					await writeFile(file, JSON.stringify(product, null, 1))
					scraped++
				} catch (err) {
					console.warn(`[gallery] ${slug}: ${(err as Error).message}`)
					failed.push(slug)
				}
			}
		}
	} finally {
		await closeBrowser()
	}
	console.log(`[gallery] done: ${scraped} scraped, ${kept} already kept, ${failed.length} failed`)
	return { scraped, kept, failed }
}

// ---- finding a product's page ----------------------------------------------------------------------------------------

const STOP = new Set(['tcg', 'mega', 'evolution', 'scarlet', 'violet', 'sword', 'shield', 'pokemon', 'the'])
const straight = (s: string): string => s.replace(/[‘’]/g, "'")
const words = (name: string, setName: string): Set<string> => new Set([...tokens(straight(name), straight(setName))].filter((w) => !STOP.has(w)))
const loose = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const DAY = 86400000
/** The names every set of an era carries ("Scarlet & Violet Elite Trainer Box" is the base set's, "Scarlet & Violet—151 …" is not). */
const SERIES = new Set(['scarlet violet', 'sword shield', 'mega evolution'])

/**
 * The pages that belong to a set: the title names it, or (when it names no set at all) the page launched within a few weeks of it.
 * A page that names another set belongs to that one ("Scarlet & Violet—151 Elite Trainer Box" is not the base set's).
 */
export function pagesForSet(setName: string, released: string | undefined, pages: GalleryProduct[], otherSetNames: string[] = []): GalleryProduct[] {
	const name = loose(setName)
	const own = !SERIES.has(name)
	const others = otherSetNames.map(loose).filter((n) => n.length >= 3 && !SERIES.has(n) && n !== name)
	const at = released ? Date.parse(released) : NaN
	return pages.filter((p) => {
		const t = ` ${loose(p.title)} `
		if (own && t.includes(` ${name} `)) return true
		if (others.some((n) => t.includes(` ${n} `))) return false
		if (!own && t.includes(` ${name} `)) return true
		// a title that names only the era ("Scarlet & Violet Elite Trainer Box") is the base set's, not this set's
		if (own && [...SERIES].some((n) => t.includes(` ${n} `))) return false
		return p.launch !== undefined && !Number.isNaN(at) && Math.abs(Date.parse(p.launch) - at) <= 75 * DAY
	})
}

/** A page that is several products at once ("Sylveon ex Box and Greninja ex Box"): its list is not one product's. */
const several = (title: string): boolean => /\b(and|or)\b|\//i.test(title.replace(/shiny|v-union|sword (and|&) shield/gi, ''))

/** The pages a product could be, best first: the title's words against the product's, from 0.75. */
export function galleryScores(productName: string, setName: string, pages: GalleryProduct[]): { p: GalleryProduct; score: number }[] {
	const want = words(productName, setName)
	if (!want.size) return []
	return pages
		.filter((p) => !several(p.title))
		.map((p) => {
			const have = words(p.title, setName)
			let hit = 0
			for (const w of want) if (have.has(w)) hit++
			return { p, score: hit / (want.size + have.size - hit || 1) }
		})
		.filter((x) => x.score >= 0.75)
		.sort((a, b) => b.score - a.score)
}

/**
 * Which page is each product's. `pages` are the set's (see pagesForSet); a page goes to the product it fits best, so "Elite Trainer
 * Box Plus" does not take the plain Elite Trainer Box's page; a product whose two best pages are equally close gets none.
 */
export function assignGallery(products: { key: string; name: string }[], setName: string, pages: GalleryProduct[]): Map<string, GalleryProduct> {
	const options = products.map((x) => ({ key: x.key, list: galleryScores(x.name, setName, pages) }))
	const pairs = options.flatMap((o) => (o.list.length > 1 && o.list[0]!.score === o.list[1]!.score ? [] : o.list.map((x) => ({ key: o.key, ...x })))).sort((a, b) => b.score - a.score)
	const out = new Map<string, GalleryProduct>(), used = new Set<string>()
	for (const x of pairs) if (!out.has(x.key) && !used.has(x.p.slug)) { out.set(x.key, x.p); used.add(x.p.slug) }
	return out
}

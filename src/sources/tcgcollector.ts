import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import config from '../../config.json' with { type: 'json' }
import { root } from './asia-portal.ts'

/**
 * TCG Collector's list of the Japanese sets (https://www.tcgcollector.com/sets/jp): a reference for each set's English name,
 * release date and how many cards it has, counted two ways:
 *   cards         one per card number            ("any card variant")
 *   variantCards  one per card and variant       ("all card variants"): more than `cards` where a set has reverse or pattern prints
 * Two requests in all (one per way of counting), kept on disk for a day. Reference data only: nothing from it is a provider id.
 */

export interface CollectorSet {
	/** TCG Collector's own set id */
	id: number
	/** the set code as the site prints it ("M6"); the same codes the Japanese portal uses */
	code: string
	name: string
	/** ISO date */
	releaseDate: string | null
	cards: number | null
	variantCards: number | null
}

const BASE = 'https://www.tcgcollector.com/sets/jp'
const MODES = { cards: 'anyCardVariant', variantCards: 'allCardVariants' } as const
const MAX_AGE = 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jul 31, 2026" -> "2026-07-31" */
export function parseDate(s: string): string | null {
	const m = s.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/)
	const month = m ? MONTHS.indexOf(m[1]!) : -1
	return m && month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null
}

/** One page of the list: every set with its count as the site shows it for that way of counting. */
export function parseList(html: string): { id: number; code: string; name: string; releaseDate: string | null; count: number | null }[] {
	const $ = cheerio.load(html)
	const out: { id: number; code: string; name: string; releaseDate: string | null; count: number | null }[] = []
	$('.set-search-result-item').each((_, el) => {
		const row = $(el)
		const id = Number(row.attr('data-set-id'))
		const name = row.find('.set-list-item-name').first().text().trim()
		const code = row.find('.set-list-item-code').first().text().trim()
		if (!id || !name) return
		// "0/113" is how many the visitor has of the set's cards: the part after the slash is the count
		const label = row.find('.progress-label').first().text().trim()
		const total = label.match(/\/\s*(\d+)/)?.[1]
		out.push({ id, code, name, releaseDate: parseDate(row.find('.set-list-item-release-date-entry').first().text()), count: total ? Number(total) : null })
	})
	return out
}

async function page(mode: string, fresh: boolean): Promise<string> {
	const dir = root('ja')
	const file = join(dir, `tcgcollector-${mode}.html`)
	if (!fresh) {
		try { if (Date.now() - (await stat(file)).mtimeMs < MAX_AGE) return await readFile(file, 'utf8') } catch { /* fetch it */ }
	}
	const res = await fetch(`${BASE}?cardCountMode=${mode}&releaseDateOrder=newToOld&displayAs=list`, { headers: { 'User-Agent': config.userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(60_000) })
	if (!res.ok) throw new Error(`TCG Collector ${res.status} ${res.statusText}`)
	const html = await res.text()
	await mkdir(dir, { recursive: true })
	await writeFile(file, html)
	return html
}

/** The Japanese sets by lower-case set code (the newest when a code appears twice). */
export async function collectorSets(fresh = false): Promise<Map<string, CollectorSet>> {
	const [any, all] = await Promise.all([page(MODES.cards, fresh), page(MODES.variantCards, fresh)])
	const variants = new Map(parseList(all).map((s) => [s.id, s.count]))
	const out = new Map<string, CollectorSet>()
	for (const s of parseList(any)) {
		const key = s.code.toLowerCase()
		if (!key || out.has(key)) continue
		out.set(key, { id: s.id, code: s.code, name: s.name, releaseDate: s.releaseDate, cards: s.count, variantCards: variants.get(s.id) ?? null })
	}
	return out
}

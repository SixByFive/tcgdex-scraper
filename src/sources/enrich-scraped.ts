import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { ScrapedCard } from '../types/scraped.ts'
import { buildVariants } from '../emit/variants.ts'
import { fetchCardExtras } from './tcgdex-cards.ts'
import { buildSetMeta } from './set-meta.ts'
import { defaultRepo, listSets, loadSchema } from '../util/experimental.ts'
import { cardKey, tcgdexLocalId } from '../emit/normalise.ts'

export interface EnrichScrapedOptions {
	setId: string
	repo?: string
	/** TCGplayer group id; found from the set file, or by name, when omitted */
	tcgplayerSet?: number
	noVariants?: boolean
	noTcgdex?: boolean
	log?: (line: string) => void
}

/**
 * Adds the lookups that don't come from pokemon.com to each scraped card of a set, so that `emit-experimental` only has
 * to write files:
 *   - `variants`: one per finish/stamp TCGTracking lists, with Cardmarket, TCGplayer and CardTrader ids
 *   - `tcgdex`: flavor text per language and the regulation mark, from the TCGdex API (always fetched fresh)
 * Safe to run again later: TCGTracking and TCGdex fill in new sets over the first weeks.
 */
export async function enrichScrapedSet(opts: EnrichScrapedOptions): Promise<void> {
	const log = opts.log ?? console.log
	const warn = (m: string) => log(`[enrich] warning: ${m}`)
	const repo = opts.repo ?? defaultRepo

	const dir = join(config.cacheDir, 'pokemon-com', opts.setId)
	if (!existsSync(dir)) throw new Error(`No scrape at ${dir}. Run scrape set first.`)
	const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
	const cards = await Promise.all(files.map(async (f) => ({ file: join(dir, f), card: JSON.parse(await readFile(join(dir, f), 'utf8')) as ScrapedCard })))
	log(`[enrich] ${cards.length} scraped cards in ${opts.setId}`)

	// ---- TCGTracking: variants and provider ids -------------------------------------------------------------------
	let variants: Awaited<ReturnType<typeof buildVariants>> | undefined
	let groupId = opts.tcgplayerSet
	if (!opts.noVariants) {
		if (!groupId) {
			try { groupId = (await listSets(repo)).find((s) => s.id === opts.setId)?.prices?.tcgplayer } catch {}
		}
		if (!groupId) {
			// no set file yet: the same name/abbreviation lookup `set-meta` does, as a dry run
			try {
				const meta = await buildSetMeta({ setId: opts.setId, repo, apply: false, log: () => {} })
				groupId = (meta.record.prices as { tcgplayer?: number } | undefined)?.tcgplayer
			} catch (err) {
				warn(`could not look up the TCGplayer group: ${(err as Error).message}`)
			}
		}
		if (!groupId) warn('no TCGplayer group found: variants and provider ids skipped (pass --tcgplayer-set <id>)')
		else {
			log(`[enrich] TCGTracking group ${groupId}`)
			variants = await buildVariants(groupId, await loadSchema(repo), warn)
		}
	}

	// ---- TCGdex: flavor text and regulation marks -----------------------------------------------------------------
	const extras = opts.noTcgdex ? undefined : await fetchCardExtras(opts.setId, cards.map(({ card }) => tcgdexLocalId(card)), warn, true)

	// ---- store ----------------------------------------------------------------------------------------------------
	let withVariants = 0, withText = 0, withMark = 0
	const now = new Date().toISOString()
	for (const { file, card } of cards) {
		if (variants) {
			const list = variants.get(cardKey(card) ?? '')
			if (list?.length) { card.variants = list; withVariants++ } else delete card.variants
			card.tcgplayerSet = groupId
		}
		if (extras) {
			const e = extras.get(tcgdexLocalId(card))
			if (e) {
				card.tcgdex = e
				if (Object.keys(e.description).length) withText++
				if (e.regulationMark) withMark++
			}
		}
		card.enrichedAt = now
		await writeFile(file, JSON.stringify(card, null, 2))
	}
	log(`[enrich] stored: ${variants ? `${withVariants}/${cards.length} cards with variants` : 'variants skipped'}; ${extras ? `${withText} with flavor text, ${withMark} with a regulation mark` : 'TCGdex skipped'}`)
}

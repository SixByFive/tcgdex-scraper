import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pLimit from 'p-limit'
import config from '../../config.json' with { type: 'json' }
import type { AsiaCard, AsiaRegion } from '../types/asia.ts'
import { cardFile, readCards, REGION_LANGUAGE, root } from './asia-portal.ts'
import { buildVariants, sortVariants, type VariantOut } from '../emit/variants.ts'
import { collectorKey } from '../emit/normalise.ts'
import { defaultRepo, loadSchema } from '../util/experimental.ts'
import { listPokemonSets, POKEMON_CATEGORY, POKEMON_JAPAN_CATEGORY, setCategory } from '../util/tcgtracking-open.ts'
import type { TcgdexCard } from './tcgdex-cards.ts'
import { collectorSets } from './tcgcollector.ts'

/**
 * The second step of the Asia flow (scrape -> enrich -> emit), like `enrich-scraped` for International sets. Adds to each
 * scraped card, without overwriting anything the scrape has:
 *   tcgdex    the TCGdex API's card in the region's language: regulation mark, rarity, flavor text, Pokédex number, stage
 *   variants  Japan: the finishes TCGTracking lists for the set (Pokémon Japan on TCGplayer) with TCGplayer, Cardmarket and
 *             CardTrader ids. Every other region: TCGdex's own list of finishes, with no provider ids (no provider sells them).
 * Safe to run again: both sources fill in new sets over the first weeks.
 */

const TCGDEX = 'https://api.tcgdex.net/v2'
/** the languages TCGdex has cards in; Hong Kong's text is not one of them */
const TCGDEX_LANGUAGE: Partial<Record<AsiaRegion, string>> = { tw: 'zh-tw', th: 'th', id: 'id', ja: 'ja', ko: 'ko', 'zh-cn': 'zh-cn' }

export interface EnrichAsiaOptions {
	region: AsiaRegion
	code: string
	repo?: string
	/** Japan: the Pokémon Japan TCGplayer group, found by the set code when omitted */
	tcgplayerSet?: number
	noVariants?: boolean
	noTcgdex?: boolean
	/** ask TCGdex again instead of using what is kept on disk */
	fresh?: boolean
	log?: (line: string) => void
}

export const localIdOf = (c: AsiaCard): string | null => (c.number !== null ? String(c.number).padStart(3, '0') : c.collectorNumber)

async function tcgdexCard(region: AsiaRegion, code: string, lang: string, localId: string, fresh: boolean): Promise<TcgdexCard | null> {
	const file = join(root(region), code, 'tcgdex', `${localId}.json`)
	if (!fresh) { try { return JSON.parse(await readFile(file, 'utf8')) } catch { /* ask */ } }
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(`${TCGDEX}/${lang}/cards/${encodeURIComponent(code)}-${encodeURIComponent(localId)}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(20_000) })
			if (res.status === 404) { await mkdir(join(root(region), code, 'tcgdex'), { recursive: true }); await writeFile(file, 'null'); return null }
			if (!res.ok) throw new Error(`${res.status}`)
			const body = (await res.json()) as TcgdexCard
			await mkdir(join(root(region), code, 'tcgdex'), { recursive: true })
			await writeFile(file, JSON.stringify(body))
			return body
		} catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))) }
	}
	return null
}

const sameName = (a: string, b: string) => a.normalize('NFKC').replace(/\s+/g, '') === b.normalize('NFKC').replace(/\s+/g, '')

export async function enrichAsiaSet(opts: EnrichAsiaOptions): Promise<{ problems: string[] }> {
	const log = opts.log ?? console.log
	const problems: string[] = []
	const warn = (m: string) => log(`[enrich-asia] warning: ${m}`)
	const repo = opts.repo ?? defaultRepo
	const cards = await readCards(opts.region, opts.code)
	if (!cards.length) throw new Error(`No scrape of ${opts.region}/${opts.code}. Run: asia scrape ${opts.region} ${opts.code}`)
	log(`[enrich-asia] ${cards.length} scraped cards in ${opts.region}/${opts.code}`)

	// ---- TCGdex ----
	const lang = TCGDEX_LANGUAGE[opts.region]
	const dex = new Map<string, TcgdexCard>()
	if (opts.noTcgdex) log('[enrich-asia] TCGdex skipped')
	else if (!lang) { log(`[enrich-asia] TCGdex has no cards in ${REGION_LANGUAGE[opts.region]}: skipped`) }
	else {
		const limit = pLimit(6)
		let wrongCard = 0
		await Promise.all(cards.map((c) => limit(async () => {
			const id = localIdOf(c)
			if (!id) return
			const t = await tcgdexCard(opts.region, opts.code, lang, id, Boolean(opts.fresh))
			if (!t) return
			// the same number can be another card (a set TCGdex numbers differently): only a card with the same printed name is used
			if (!c.nameLanguage && t.name && !sameName(t.name, c.name)) { wrongCard++; return }
			dex.set(c.cardId, t)
		})))
		log(`[enrich-asia] TCGdex has ${dex.size} of ${cards.length} cards${wrongCard ? ` (${wrongCard} numbers are another card there, not used)` : ''}`)
		if (!dex.size) problems.push('TCGdex has none of this set\'s cards: no regulation marks, rarities or finishes from it')
	}

	// ---- Japan: TCGTracking variants and provider ids ----
	let group = opts.tcgplayerSet
	let tracked: Map<string, VariantOut[]> | undefined
	let groupName: string | undefined
	if (opts.noVariants) log('[enrich-asia] variants skipped')
	else if (opts.region === 'ja') {
		setCategory(POKEMON_JAPAN_CATEGORY)
		try {
			const groups = await listPokemonSets()
			group ??= groups.find((s) => s.abbreviation?.toLowerCase() === opts.code.toLowerCase())?.id
			// TCGplayer names it "M6: Storm Emeralda": the English name of the set is what follows the code
			groupName = groups.find((s) => s.id === group)?.name.replace(/^[^:]{1,12}:\s*/, '').trim() || undefined
			if (!group) { warn('no Pokémon Japan group on TCGplayer for this set code: no provider ids'); problems.push('no TCGplayer group found: no provider ids') }
			else {
				log(`[enrich-asia] TCGTracking Pokémon Japan group ${group}`)
				tracked = await buildVariants(group, await loadSchema(repo), warn)
				if (![...tracked.values()].some((v) => v.length)) { warn('the group has no products yet'); problems.push('the TCGplayer group has no products yet') }
			}
		} catch (err) { warn(`TCGTracking: ${(err as Error).message}`); problems.push(`TCGTracking failed: ${(err as Error).message}`) }
		finally { setCategory(POKEMON_CATEGORY) }
	}

	// ---- Japan: TCG Collector's name, date and counts for the set (reference only) ----
	let collector: AsiaCard['collector']
	if (opts.region === 'ja') {
		try {
			const s = (await collectorSets(Boolean(opts.fresh))).get(opts.code.toLowerCase())
			if (!s) warn('TCG Collector does not list this set code: no English name from it')
			else {
				collector = { name: s.name, releaseDate: s.releaseDate, cards: s.cards, variantCards: s.variantCards }
				log(`[enrich-asia] TCG Collector: "${s.name}", ${s.releaseDate ?? 'no date'}, ${s.cards ?? '?'} cards, ${s.variantCards ?? '?'} with every variant counted`)
				if (s.cards !== null && s.cards !== cards.length) warn(`TCG Collector lists ${s.cards} cards, the scrape has ${cards.length}`)
			}
		} catch (err) { warn(`TCG Collector: ${(err as Error).message}`) }
	}

	// ---- write back ----
	const when = new Date().toISOString()
	let withVariants = 0
	for (const c of cards) {
		const t = dex.get(c.cardId)
		if (t) {
			const mark = t.regulationMark?.trim().toUpperCase()
			c.tcgdex = {
				regulationMark: mark && /^[A-Z]$/.test(mark) ? mark : undefined,
				rarity: t.rarity?.trim() || undefined,
				description: t.description?.trim() || undefined,
				dexId: t.dexId?.length ? t.dexId : undefined,
				stage: t.stage?.trim() || undefined
			}
		} else delete c.tcgdex

		let variants: VariantOut[] | undefined = tracked?.get(collectorKey(c.collectorNumber) ?? '')?.map((v) => ({ ...v, prices: { ...v.prices } }))
		if (!variants?.length && t?.variants_detailed?.length) {
			// TCGdex's list of finishes: no provider ids, unless it knows some
			variants = t.variants_detailed.filter((v) => v.type).map((v) => ({
				type: v.type!, foil: v.foil || undefined, size: v.size && v.size !== 'standard' ? v.size : undefined,
				stamps: v.stamp?.length ? [...v.stamp].sort() : undefined,
				prices: { cardmarket: v.thirdParty?.cardmarket || undefined, tcgplayer: v.thirdParty?.tcgplayer || undefined, cardtrader: v.thirdParty?.cardtrader || undefined }
			}))
		}
		if (variants?.length) { c.variants = sortVariants(variants); withVariants++ } else delete c.variants
		if (group && tracked) { c.tcgplayerSet = group; if (groupName) c.tcgplayerSetName = groupName }
		if (collector) c.collector = collector; else delete c.collector
		c.enrichedAt = when
		await writeFile(cardFile(opts.region, opts.code, c.cardId), JSON.stringify(c, null, '\t'))
	}
	log(`[enrich-asia] ${withVariants} of ${cards.length} cards have variants${group && tracked ? ` (TCGplayer group ${group})` : ''}`)
	// TCG Collector counts the variants it knows (reverse and pattern prints): fewer here than there means some are missing
	// only the extra ones (beyond one per card) are compared, so a card the scrape lacks does not count as a missing variant
	if (collector?.variantCards && collector.cards) {
		const theirs = collector.variantCards - collector.cards
		const ours = cards.reduce((n, c) => n + Math.max(0, (c.variants?.length ?? 0) - 1), 0)
		if (ours < theirs) warn(`TCG Collector lists ${theirs} extra variants in this set (${collector.variantCards} over ${collector.cards} cards), enrich has ${ours}: some (reverse or pattern prints) may be missing`)
	}
	return { problems }
}

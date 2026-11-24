import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { carryOver } from './carry-over.ts'
import config from '../../config.json' with { type: 'json' }
import type { ScrapedCard } from '../types/scraped.ts'
import { cardKey, cardLocalId, damageValue, mapRarity, normaliseKind, perLang, tcgdexLocalId, toStage, typeList, typeValues } from './normalise.ts'
import { buildVariants, sortVariants } from './variants.ts'
import { fetchCardExtras } from '../sources/tcgdex-cards.ts'
import { sameCardAtNumber } from './names.ts'
import { evolvedStage } from './evolution.ts'
import { defaultRepo, listSets, loadFormat, loadPriceProviders, loadSchema, today } from '../util/experimental.ts'

// curly and straight apostrophes/quotes and case differ between sources for the same card
const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-/g, ' ').replace(/ +/g, ' ').toLowerCase().trim()
const sameName = (a: string, b: string) => sameCardAtNumber(a, b)

export interface ExperimentalEmitOptions {
	/** the set id, e.g. "me06": names the scrape folder and the set file made by `set-meta` */
	setId: string
	repo?: string
	/** TCGplayer group for variants and Cardmarket/CardTrader ids; defaults to `prices.tcgplayer` of the set file */
	tcgplayerSet?: number
	/** skip variants (no provider calls) */
	noVariants?: boolean
	/** skip flavor text and regulation marks from the TCGdex API */
	noTcgdex?: boolean
	apply?: boolean
	overwrite?: boolean
	log?: (line: string) => void
}

export interface ExperimentalEmitResult {
	setFile: string
	dir: string
	written: string[]
	skipped: string[]
	warnings: string[]
}

/**
 * Writes the scraped cards of a set as Experimental card files: `data/pokemon/intl/<Series>/<Set>/<localId>.ts`.
 * The set must exist already (run `set-meta` first). Layout comes from the repo's own formatter.
 * Written: names, text, stats and ids of every language pokemon.com has; variants with their Cardmarket, TCGplayer and
 * CardTrader ids when a TCGplayer group is linked; description (flavor text) and regulationMark from the TCGdex API.
 * Not written: images (the game's default image pattern serves them).
 */
export async function emitExperimental(opts: ExperimentalEmitOptions): Promise<ExperimentalEmitResult> {
	const log = opts.log ?? console.log
	const repo = opts.repo ?? defaultRepo
	const warnings: string[] = []
	const warn = (m: string) => { warnings.push(m); log(`[emit] warning: ${m}`) }

	const set = (await listSets(repo)).find((s) => s.id === opts.setId)
	if (!set) throw new Error(`No set "${opts.setId}" in ${repo}. Run set-meta --apply first.`)

	// a set whose TCGdex ids are not padded and stay so (My First Battle: "1")
	const regSet = (await (await import('../registry/build.ts')).loadRegistry().catch(() => ({ sets: [] }))).sets.find((s) => s.id === opts.setId)
	const keepIds = regSet?.keepTcgdexIds === true
	const plainIds = regSet?.plainCardIds === true

	const scrapedDir = join(config.cacheDir, 'pokemon-com', opts.setId)
	if (!existsSync(scrapedDir)) throw new Error(`No scrape at ${scrapedDir}. Run scrape set first.`)
	const scraped: ScrapedCard[] = []
	for (const f of (await readdir(scrapedDir)).filter((f) => f.endsWith('.json')).sort()) {
		scraped.push(JSON.parse(await readFile(join(scrapedDir, f), 'utf8')))
	}
	log(`[emit] ${scraped.length} scraped cards -> ${set.dir}`)

	const [{ renderCard }, schema, providers] = await Promise.all([loadFormat(repo), loadSchema(repo), loadPriceProviders(repo)])
	let unpriceable = 0
	let carriedOver = 0

	// Variants, provider ids, flavor text and regulation marks are stored with the scrape (`scrape set` / `enrich-scraped`).
	// A scrape made before that existed has none of it: then they are fetched live here, as before.
	const enriched = scraped.some((c) => c.enrichedAt)
	let variants: Awaited<ReturnType<typeof buildVariants>> | undefined
	let extras: Awaited<ReturnType<typeof fetchCardExtras>> | undefined

	if (enriched) {
		const when = scraped.map((c) => c.enrichedAt).filter(Boolean).sort().pop()!.slice(0, 10)
		log(`[emit] using the variants and TCGdex data stored with the scrape (${when}); run enrich-scraped to refresh`)
		if (!opts.noVariants && scraped.some((c) => c.variants)) variants = new Map(scraped.flatMap((c) => c.variants ? [[cardLocalId(c, keepIds, plainIds), sortVariants([...c.variants])] as const] : []))
		else if (!opts.noVariants) warn('the scrape has no variants (no TCGplayer group was found): cards are written without them')
		if (!opts.noTcgdex) extras = new Map(scraped.flatMap((c) => c.tcgdex ? [[tcgdexLocalId(c), c.tcgdex] as const] : []))
	} else {
		const groupId = opts.tcgplayerSet ?? set.prices?.tcgplayer
		if (opts.noVariants) log('[emit] variants skipped (--no-variants)')
		else if (!groupId) warn('set has no prices.tcgplayer group: cards are written without variants')
		else variants = await buildVariants(groupId, schema, warn)

		if (opts.noTcgdex) log('[emit] TCGdex extras skipped (--no-tcgdex)')
		else extras = await fetchCardExtras(opts.setId, scraped.map((c) => tcgdexLocalId(c)), warn)
	}

	const written: string[] = []
	const skipped: string[] = []
	if (opts.apply) await mkdir(set.dir, { recursive: true })

	for (const card of scraped) {
		const s = card.structural
		const localId = cardLocalId(card, keepIds, plainIds)
		const label = `${opts.setId}-${localId}`
		const file = join(set.dir, `${localId}.ts`)
		const kind = normaliseKind(card)
		// pokemon.com gives no stage for ex cards that evolve; TCGdex does (only trusted when it is the same card)
		const tcgdex = extras?.get(tcgdexLocalId(card))
		const enName = card.locales.en?.name
		let usedTcgdex = false
		const tcgdexStage = tcgdex && (!tcgdex.name || (enName && sameName(tcgdex.name, enName))) ? toStage(tcgdex.stage) : undefined
		if (kind.category === 'Pokemon' && !kind.stage && tcgdexStage) {
			kind.stage = tcgdexStage
			usedTcgdex = true
			kind.warnings = kind.warnings.filter((w) => !w.startsWith('stage unknown'))
		}
		// neither source gives the stage: it follows from what the card evolves from
		const from = card.locales.en?.evolvesFromName
		if (kind.category === 'Pokemon' && !kind.stage && from) {
			const inferred = await evolvedStage(from, scraped, opts.setId)
			if (inferred) { kind.stage = inferred; kind.warnings = kind.warnings.filter((w) => !w.startsWith('stage unknown')) }
		}
		kind.warnings.forEach((w) => warn(`${label}: ${w}`))
		const { rarity, warning } = mapRarity(s.rarity, schema.rarities)
		if (warning) warn(`${label}: ${warning}`)

		const name = perLang(card, (b) => b.name)
		if (!name.en) { warn(`${label}: skipped, no English name`); skipped.push(file); continue }

		const out: Record<string, unknown> = {
			game: 'pokemon',
			category: kind.category,
			set: opts.setId,
			localId,
			name,
			rarity,
			illustrator: s.illustrator ?? undefined,
			dexId: s.dexIds?.length ? s.dexIds : undefined,
			hp: s.hp ?? undefined,
			stage: kind.stage,
			suffix: kind.suffix,
			types: s.types?.length ? typeList(s.types) : undefined,
			retreat: s.retreat ?? undefined,
			trainerType: kind.trainerType,
			energyType: kind.energyType,
			provenance: undefined // set below, once the sources that contributed are known
		}

		// flavor text and regulation mark: only merged when TCGdex's card has the same English name as the scraped one
		const extra = extras?.get(tcgdexLocalId(card))
		if (extra?.name && !sameName(extra.name, name.en)) {
			warn(`${label}: TCGdex has "${extra.name}" for this number, not "${name.en}"; its description and regulation mark were not used`)
		} else if (extra) {
			// "None" is TCGdex's way of saying the card has no mark (My First Battle's last cards): nothing to write, nothing to warn about
			if (extra.regulationMark && extra.regulationMark.trim().toLowerCase() !== 'none') {
				// TCGdex sometimes returns it lowercase ("j"); the schema's marks are uppercase
				const mark = extra.regulationMark.trim().toUpperCase()
				if (schema.regulationMarks.includes(mark)) { out.regulationMark = mark; usedTcgdex = true }
				else warn(`${label}: regulation mark "${extra.regulationMark}" is not in the schema, left out`)
			}
			if (Object.keys(extra.description).length) { out.description = extra.description; usedTcgdex = true }
		}

		const evolveFrom = perLang(card, (b) => b.evolvesFromName)
		if (Object.keys(evolveFrom).length) out.evolveFrom = evolveFrom

		// attacks and abilities are matched across languages by their position on the page
		const blocks = card.locales.en?.abilities ?? []
		const at = (i: number, field: 'name' | 'effect') => perLang(card, (b) => b.abilities?.[i]?.[field])
		const attacks: Record<string, unknown>[] = []
		const abilities: Record<string, unknown>[] = []
		blocks.forEach((a, i) => {
			if (a.kind === 'attack') {
				const attackName = at(i, 'name')
				if (!attackName.en) { warn(`${label}: attack ${i + 1} has no English name, left out`); return }
				const effect = at(i, 'effect')
				attacks.push({
					cost: a.cost.length ? typeList(a.cost) : undefined,
					name: attackName,
					effect: Object.keys(effect).length ? effect : undefined,
					damage: damageValue(a.damage)
				})
			} else if (a.kind === 'ability') {
				const effect = at(i, 'effect')
				// "Pokémon ex rule" and similar rule boxes show as a named ability with no text: they are not abilities
				if (!Object.keys(effect).length) return
				abilities.push({ type: 'Ability', name: at(i, 'name'), effect })
			}
		})
		if (kind.category === 'Trainer' || kind.category === 'Energy') {
			const i = blocks.findIndex((a) => a.kind === 'rule')
			const effect = i >= 0 ? at(i, 'effect') : {}
			if (Object.keys(effect).length) out.effect = effect
		}
		if (attacks.length) out.attacks = attacks
		if (abilities.length) out.abilities = abilities
		if (s.weaknesses?.length) out.weaknesses = typeValues(s.weaknesses)
		if (s.resistances?.length) out.resistances = typeValues(s.resistances)

		if (variants) {
			// stored variants are keyed by the card's id (cards can share a printed number: four Classic Collection cards are "15")
			const list = variants.get(enriched && !opts.noVariants && scraped.some((c) => c.variants) ? cardLocalId(card, keepIds, plainIds) : cardKey(card) ?? '')
			if (list?.length) {
				// the repo accepts a provider's id on a variant only when the provider has a price group for its type (Cardmarket and
				// TCGplayer have normal/holo/reverse): a lenticular or metal variant keeps its other ids and loses these
				out.variants = list.map((v) => {
					const prices = { ...v.prices } as Record<string, number | undefined>
					for (const [provider, id] of Object.entries(prices)) {
						const groups = providers[provider]?.subtypes
						if (id != null && groups && Object.keys(groups).length > 0 && !(v.type in groups)) { delete prices[provider]; unpriceable++ }
					}
					return { ...v, prices }
				})
			}
			else warn(`${label}: no TCGTracking product matched, written without variants`)
		}

		// Where the data came from. It is the scraper's own reading of three sources, not checked against a card by anyone,
		// so it is `inferred` (not `verified`).
		out.provenance = {
			source: [...(card.sourceSlug === 'tcgdex' ? [] : ['pokemon.com']),...(out.variants && out.variants.length > (tcgdex?.variantsAdded ?? 0) + (card.tcgcsvVariants ?? 0) ? ['tcgtracking'] : []), ...(card.tcgcsvVariants ? ['tcgcsv'] : []), ...(usedTcgdex || card.sourceSlug === 'tcgdex' || (tcgdex?.variantsAdded ?? 0) > 0 ? ['tcgdex-api'] : [])].join(' + '),
			importedAt: today(),
			validation: 'inferred'
		}

		if (existsSync(file) && !opts.overwrite) { skipped.push(file); continue }
		// a rebuild keeps the es-mx text and cameo ids the file it replaces has and the scrape can't supply
		if (existsSync(file)) {
			try { carriedOver += carryOver(out, (await import(pathToFileURL(file).href + '?' + Math.random())).default) } catch { /* an unreadable old file: nothing to keep */ }
		}
		if (opts.apply) {
			const previous = existsSync(file) ? await readFile(file, 'utf8') : ''
			await writeFile(file, renderCard(out, previous), 'utf8')
		}
		written.push(file)
	}

	if (carriedOver) log(`[emit] kept ${carriedOver} values (es-mx text, cameo dex ids) from the files being replaced`)
	if (unpriceable) log(`[emit] ${unpriceable} provider ids left off variants whose type the provider has no price group for (e.g. lenticular)`)
	log(`[emit] ${opts.apply ? 'wrote' : 'would write'} ${written.length} cards, ${skipped.length} skipped, ${warnings.length} warnings${opts.apply ? '' : ' (pass --apply)'}`)
	const existing = skipped.filter((f) => existsSync(f)).length
	if (existing > 0 && !opts.overwrite) log(`[emit] ${existing} cards were NOT written because their files already exist. To replace them, tick "Overwrite existing files" (or pass --overwrite).`)
	return { setFile: set.file, dir: set.dir, written, skipped, warnings }
}

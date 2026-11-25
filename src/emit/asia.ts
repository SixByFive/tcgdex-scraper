import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import config from '../../config.json' with { type: 'json' }
import { readCards, readExpansions, REGION_LANGUAGE } from '../sources/asia-portal.ts'
import type { AsiaCard, AsiaRegion, AsiaSkill } from '../types/asia.ts'
import { defaultRepo, fileSafe, loadFormat, loadPriceProviders, loadSchema, today } from '../util/experimental.ts'

/**
 * Writes scraped Asia portal cards as Experimental files: `data/pokemon/asia/<Series>/<Set>/<localId>.ts`, with the series and
 * set files if they are new. Only Taiwan (zh-tw) is understood so far: the section headings and rule-box labels that tell
 * attacks from abilities and Items from Supporters are per language, and each language needs its own table below.
 * Nothing is invented: no English names, no rarity the portal's code can't be mapped to with certainty, and the variant is
 * `normal` only because a variant is needed to attach the image (the provenance says the finish is unknown).
 * A card file that exists already gets the new language added to it (all languages of a card live in one file).
 */

type Lang = 'zh-tw' | 'ja'
interface LanguageRules {
	attacks: RegExp
	abilities: RegExp
	/** names of rule boxes ([物品規則], [VSTAR規則], ...): not abilities, not written */
	ruleBox: RegExp
	trainer: [RegExp, 'Tool' | 'Item' | 'Supporter' | 'Stadium'][]
	specialEnergy: RegExp
	basicEnergy: RegExp
	/** block headings that hold rules, not attacks or abilities (Japan: 特別なルール) */
	ruleSection?: RegExp
	/** by the stage label with its spaces removed */
	stage: Record<string, 'Basic' | 'Stage1' | 'Stage2'>
}
const RULES: Partial<Record<Lang, LanguageRules>> = {
	'zh-tw': {
		attacks: /^招式$/,
		abilities: /^特性$/,
		ruleBox: /^\[[^\]]*規則\]$/,
		// the order matters: 寶可夢道具 (Tool) before 物品 (Item)
		trainer: [[/寶可夢道具/, 'Tool'], [/支援者/, 'Supporter'], [/競技場/, 'Stadium'], [/物品/, 'Item']],
		specialEnergy: /特殊能量/,
		basicEnergy: /^基本.+能量$/,
		stage: { 基礎: 'Basic', '1階進化': 'Stage1', '2階進化': 'Stage2' }
	}
}

RULES.ja = {
	attacks: /^ワザ$/,
	abilities: /^特性$/,
	ruleBox: /^$^/,
	ruleSection: /^特別なルール$/,
	trainer: [[/ポケモンのどうぐ/, 'Tool'], [/サポート/, 'Supporter'], [/スタジアム/, 'Stadium'], [/グッズ/, 'Item']],
	specialEnergy: /特殊エネルギー/,
	basicEnergy: /^基本.+エネルギー$/,
	stage: { たね: 'Basic', '1進化': 'Stage1', '2進化': 'Stage2' }
}

const STAGES = new Set(['Basic', 'Stage1', 'Stage2', 'VMAX', 'VSTAR', 'MEGA', 'Baby', 'BREAK', 'RESTORED'])

/** The series each product heading belongs to (Japan's headings are added below), by the heading's text (all regions of the portal use the same few). */
const SERIES: Record<string, string> = { 超級進化: 'M', '朱＆紫': 'SV', '劍＆盾': 'S', '太陽＆月亮': 'SM' }

Object.assign(SERIES, { MEGA: 'M', 'スカーレット&バイオレット': 'SV', 'ソード&シールド': 'S', 'サン&ムーン': 'SM' })

/** The portal's rarity labels that mean one rarity in every era. Others are era-dependent and handled in `rarityOf`. */
const RARITY: Record<string, string> = {
	C: 'Common', U: 'Uncommon', R: 'Rare', RRR: 'Triple Rare', SAR: 'Special illustration rare', AR: 'Illustration rare',
	ACE: 'ACE SPEC Rare', UR: 'Hyper rare', HR: 'Hyper rare', MUR: 'Mega Hyper Rare', PR: 'Promo', 無標記: 'None'
}
function rarityOf(card: AsiaCard): { rarity?: string; warning?: string } {
	const r = card.rarity
	if (!r) return { warning: 'no rarity from the portal' }
	if (RARITY[r]) return { rarity: RARITY[r] }
	// RR and SR changed meaning with the era; the regulation mark G and later is the Scarlet & Violet era
	const mark = card.regulationMark ?? card.tcgdex?.regulationMark
	const sv = !!mark && mark >= 'G'
	if (r === 'RR' && sv) return { rarity: 'Double rare' }
	if (r === 'SR' && sv) return { rarity: 'Ultra Rare' }
	return { warning: `rarity "${r}" has no certain mapping${r === 'RR' || r === 'SR' ? ' for this era' : ''}, left out` }
}

/** a damage as the schema holds it: a plain number, or the printed text with the full-width signs made plain ("30＋" -> "30+") */
const num = (s: string | null) => {
	const t = s?.normalize('NFKC').replace(/\s+/g, '')
	return t && /^\d+$/.test(t) ? Number(t) : t || undefined
}

/** The site each region's cards were read from, for the provenance. */
const SOURCE: Record<string, string> = { tw: 'asia.pokemon-card.com', hk: 'asia.pokemon-card.com', th: 'asia.pokemon-card.com', id: 'asia.pokemon-card.com', ja: 'pokemon-card.com', ko: 'pokemoncard.co.kr', 'zh-cn': 'bulbapedia.bulbagarden.net' }

function suffixAndStage(card: AsiaCard, rules: LanguageRules): { stage?: string; suffix?: string; warning?: string } {
	const n = card.name
	let suffix: string | undefined
	let stage = card.stageLabel ? rules.stage[card.stageLabel.replace(/\s+/g, '')] : undefined
	if (/VSTAR$/.test(n)) stage = 'VSTAR'
	else if (/VMAX$/.test(n)) stage = 'VMAX'
	else if (/GX$/.test(n)) suffix = 'GX'
	else if (/EX$/.test(n)) suffix = 'EX'
	else if (/ex$/.test(n)) suffix = 'ex'
	else if (/V$/.test(n)) suffix = 'V'
	if (!stage) return { suffix, warning: `stage "${card.stageLabel ?? ''}" not understood, left out` }
	return { stage, suffix }
}

/** Series and set files by id, since the folder of a file is its English name or, with none, its id. */
async function findById(dir: string, id: string): Promise<{ file: string; folder: string; data: Record<string, unknown> } | null> {
	if (!existsSync(dir)) return null
	for (const e of await readdir(dir, { withFileTypes: true })) {
		if (!e.isFile() || !e.name.endsWith('.ts')) continue
		const file = join(dir, e.name)
		const data = (await import(pathToFileURL(file).href + `?t=${Date.now()}`)).default
		if (data?.id === id) return { file, folder: join(dir, e.name.slice(0, -3)), data }
	}
	return null
}

const asiaDir = (repo: string) => join(repo, 'data', 'pokemon', 'asia')

/** Adds `lang`'s text from `fresh` to `old` (a card already written for another language). Returns what it added. */
function mergeLanguage(old: Record<string, any>, fresh: Record<string, any>, lang: string, warn: (m: string) => void): number {
	let added = 0
	const take = (a: Record<string, any> | undefined, b: Record<string, any> | undefined) => {
		if (!b?.[lang] || a === undefined) return
		if (a[lang] === undefined) { a[lang] = b[lang]; added++ }
	}
	for (const key of ['name', 'description', 'evolveFrom', 'effect']) {
		if (fresh[key]?.[lang] === undefined) continue
		old[key] ??= {}
		take(old[key], fresh[key])
	}
	for (const key of ['attacks', 'abilities']) {
		for (const [i, item] of (fresh[key] ?? []).entries()) {
			const target = old[key]?.[i]
			if (!target) { warn(`${key}[${i}] has no counterpart in the existing card: not merged`); continue }
			take(target.name, item.name); if (item.effect) { target.effect ??= {}; take(target.effect, item.effect) }
		}
	}
	return added
}

export interface AsiaEmitOptions {
	region: AsiaRegion
	/** portal product code, e.g. SLL, M2a */
	code: string
	repo?: string
	/** series id when the product's heading is not one of the known ones */
	series?: string
	/** write the files (default is a dry run) */
	apply?: boolean
	/** replace card files that exist instead of adding the language to them */
	overwrite?: boolean
	/** convert and copy the card images into <dir> as the CDN lays them out (cards/<language>/<set>/<localId>/normal/large.webp) */
	imagesOut?: string
	log?: (line: string) => void
}

export async function emitAsia(opts: AsiaEmitOptions) {
	const log = opts.log ?? console.log
	const repo = opts.repo ?? defaultRepo
	const warnings: string[] = []
	const warn = (m: string) => { warnings.push(m); log(`[emit-asia] warning: ${m}`) }

	const lang = REGION_LANGUAGE[opts.region]
	if (lang !== 'zh-tw' && lang !== 'ja') throw new Error(`only Taiwan (zh-tw) and Japan (ja) can be written so far: "${opts.region}" needs its own section headings and rarity checks${lang === 'zh-hk' ? ', and zh-hk is not a language of data/pokemon/game.ts' : ''}`)
	const rules = RULES[lang as Lang]!

	const cards = await readCards(opts.region, opts.code)
	if (!cards.length) throw new Error(`No scrape of ${opts.region}/${opts.code}. Run: asia scrape ${opts.region} ${opts.code}`)
	const expansion = (await readExpansions(opts.region)).find((e) => e.code === opts.code)
	if (!expansion) warn('the product is not in the region\'s product list (run asia expansions): no title or release date')

	const [{ renderCard, renderRecord }, schema, providers] = await Promise.all([loadFormat(repo), loadSchema(repo), loadPriceProviders(repo)])
	if (!cards.some((c) => c.enrichedAt)) warn('the scrape is not enriched (run: asia enrich): cards get one "normal" variant and no TCGdex data')

	// ---- series and set ----
	const seriesId = opts.series ?? (expansion?.series ? SERIES[expansion.series] : undefined)
	if (!seriesId) throw new Error(`Which series is "${expansion?.series ?? '?'}"? Pass --series <id> (known headings: ${Object.keys(SERIES).join(', ')})`)
	const existingSeries = await findById(asiaDir(repo), seriesId)
	const seriesFile = existingSeries?.file ?? join(asiaDir(repo), `${fileSafe(seriesId)}.ts`)
	const seriesFolder = existingSeries?.folder ?? join(asiaDir(repo), fileSafe(seriesId))

	const setId = opts.code
	// the English name TCGplayer gives the set ("Storm Emeralda"); a set with none is named by its id, like PMCG
	const collectorName = cards.find((c) => c.collector)?.collector?.name
	// the repo files a set by its English name, so the characters a file name cannot have are left out ("Deck Set: Espeon" -> "Deck Set Espeon")
	const rawEnglish = collectorName ?? cards.find((c) => c.tcgplayerSetName)?.tcgplayerSetName
	const englishName = rawEnglish ? fileSafe(rawEnglish) : undefined
	const existingSet = await findById(seriesFolder, setId)
	const setFile = existingSet?.file ?? join(seriesFolder, `${fileSafe(englishName ?? setId)}.ts`)
	const setFolder = existingSet?.folder ?? join(seriesFolder, fileSafe(englishName ?? setId))

	const provenance = { source: SOURCE[opts.region] ?? 'asia.pokemon-card.com', importedAt: today(), validation: 'inferred' as const }
	const outputs: { file: string; text: string; kind: string }[] = []
	if (!existingSeries) {
		// the heading the source gave, else the series' own name in this language (a series has to have a name)
		const own = Object.entries(SERIES).find(([, id]) => id === seriesId)?.[0]
		const names: Record<string, string> = { M: 'MEGA', SV: 'スカーレット&バイオレット', S: 'ソード&シールド', SM: 'サン&ムーン' }
		const seriesName = expansion?.series ?? (lang === 'ja' ? names[seriesId] : lang === 'zh-tw' ? own : undefined)
		if (!seriesName) throw new Error(`Series "${seriesId}" is new and has no name in ${lang}: write data/pokemon/asia/${seriesId}.ts by hand first`)
		const name = { [lang]: seriesName }
		outputs.push({ kind: 'series', file: seriesFile, text: renderRecord('Series', { id: seriesId, name, provenance }) })
	}
	const printed = cards.map((c) => c.total).filter((t): t is number => !!t)
	const official = printed.length ? Math.max(...printed) : undefined
	if (!existingSet) {
		outputs.push({
			kind: 'set', file: setFile,
			text: renderRecord('CardSet', {
				id: setId,
				name: { ...(expansion?.title ? { [lang]: expansion.title } : {}), ...(englishName ? { en: englishName } : {}) },
				releaseDate: (expansion?.releaseDate ?? cards.find((c) => c.collector?.releaseDate)?.collector?.releaseDate) ? { [lang]: (expansion?.releaseDate ?? cards.find((c) => c.collector?.releaseDate)?.collector?.releaseDate)! } : undefined,
				cardCount: { official, total: cards.length },
				prices: cards.find((c) => c.tcgplayerSet)?.tcgplayerSet ? { tcgplayer: cards.find((c) => c.tcgplayerSet)!.tcgplayerSet } : undefined,
				provenance: englishName ? { ...provenance, limitations: [`English name "${englishName}" is the name ${collectorName ? 'TCG Collector gives the set' : 'of the set\'s TCGplayer group (Pokémon Japan)'}; not confirmed against an official source`] } : provenance
			})
		})
	} else log(`[emit-asia] set ${setId} exists (${existingSet.file}): its file is left as it is`)

	// ---- cards ----
	const seen = new Set<string>()
	const images: { from: string; localId: string }[] = []
	for (const c of cards) {
		const localId = c.number !== null ? String(c.number).padStart(3, '0') : c.collectorNumber ?? ''
		const label = `${setId}-${localId || c.cardId}`
		if (!localId || !/^[A-Za-z0-9._-]+$/.test(localId)) { warn(`${label}: no usable card number (${c.collectorNumber}), skipped`); continue }
		if (seen.has(localId)) { warn(`${label}: a second card with this number, skipped (portal id ${c.cardId})`); continue }
		seen.add(localId)

		const attacks: Record<string, unknown>[] = []
		const abilities: Record<string, unknown>[] = []
		let trainerType: string | undefined
		let isEnergy = false
		let ruleText: string | undefined
		const isCreature = c.hp !== null
		for (const s of c.skills as AsiaSkill[]) {
			if ((s.name && rules.ruleBox.test(s.name)) || (s.section && rules.ruleSection?.test(s.section))) continue
			if (isCreature) {
				if (s.section && rules.abilities.test(s.section)) {
					if (s.name && s.effect) abilities.push({ type: 'Ability', name: { [lang]: s.name }, effect: { [lang]: s.effect } })
				} else if (s.section && rules.attacks.test(s.section)) {
					attacks.push({
						cost: s.cost.length ? s.cost : undefined,
						name: { [lang]: s.name ?? '' },
						effect: s.effect ? { [lang]: s.effect } : undefined,
						damage: num(s.damage)
					})
				} else warn(`${label}: block "${s.section}" not understood, "${s.name}" left out`)
			} else {
				const hit = s.section ? rules.trainer.find(([re]) => re.test(s.section!)) : undefined
				if (hit) trainerType = hit[1]
				else if (s.section && rules.specialEnergy.test(s.section)) isEnergy = true
				if (s.effect && !ruleText) ruleText = s.effect
			}
		}
		const category = isCreature ? 'Pokemon' : trainerType ? 'Trainer' : isEnergy || rules.basicEnergy.test(c.name) ? 'Energy' : undefined
		if (!category) { warn(`${label}: "${c.name}" is neither a Pokémon, a known Trainer nor an Energy, skipped`); continue }
		const energyType = category === 'Energy' ? (rules.basicEnergy.test(c.name) ? 'Normal' : 'Special') : undefined

		const { rarity, warning } = rarityOf(c)
		if (warning) warn(`${label}: ${warning}`)
		const kind = isCreature ? suffixAndStage(c, rules) : {}
		if (kind.warning) warn(`${label}: ${kind.warning}`)
		// the portal's value first, then TCGdex's (Japan's pages print no regulation mark)
		const markRaw = c.regulationMark ?? c.tcgdex?.regulationMark
		const mark = markRaw && (schema.regulationMarks as readonly string[]).includes(markRaw) ? markRaw : undefined
		if (markRaw && !mark) warn(`${label}: regulation mark "${markRaw}" is not in the schema, left out`)
		let finalRarity = rarity
		if (!finalRarity && c.tcgdex?.rarity) {
			if ((schema.rarities as readonly string[]).includes(c.tcgdex.rarity)) finalRarity = c.tcgdex.rarity
			else warn(`${label}: TCGdex rarity "${c.tcgdex.rarity}" is not in the schema, left out`)
		}
		const stage = kind.stage ?? (isCreature && c.tcgdex?.stage && STAGES.has(c.tcgdex.stage) ? c.tcgdex.stage : undefined)
		const description = c.flavorText ?? c.tcgdex?.description
		const dexId = c.dexNumber ? [c.dexNumber] : c.tcgdex?.dexId

		// The variants the enrich step found. A provider id stays only where the provider has a price group for the variant's type.
		const imagePath = `cards/${lang}/${setId}/${localId}/normal/large.webp`
		const image = [{ kind: 'card', source: 'tcgdex-assets', path: imagePath, language: lang }]
		const variants = c.variants?.length
			? c.variants.map((v, i) => {
				const prices = { ...v.prices } as Record<string, number | undefined>
				for (const [provider, id] of Object.entries(prices)) {
					const groups = providers[provider]?.subtypes
					if (id != null && groups && Object.keys(groups).length > 0 && !(v.type in groups)) delete prices[provider]
				}
				// the first variant is the default and carries the image; the others use it
				return { ...v, prices: Object.keys(prices).some((k) => prices[k] != null) ? prices : undefined, images: i === 0 ? image : undefined }
			})
			: [{ type: 'normal', images: image }]
		const sources = [provenance.source, ...(c.tcgdex ? ['tcgdex-api'] : []), ...(c.variants?.some((v) => v.prices.tcgplayer) ? ['tcgtracking'] : [])].join(' + ')
		const out: Record<string, unknown> = {
			game: 'pokemon',
			category,
			set: setId,
			localId,
			name: { [lang]: c.name },
			rarity: finalRarity,
			illustrator: c.illustrator && c.illustrator.toLowerCase() !== 'n/a' ? c.illustrator : undefined,
			dexId,
			hp: c.hp ?? undefined,
			stage,
			suffix: kind.suffix,
			types: c.types.length ? c.types : undefined,
			regulationMark: mark,
			retreat: isCreature ? c.retreat ?? 0 : undefined,
			trainerType,
			energyType,
			region: opts.region,
			description: description ? { [lang]: description } : undefined,
			effect: !isCreature && ruleText ? { [lang]: ruleText } : undefined,
			attacks: attacks.length ? attacks : undefined,
			abilities: abilities.length ? abilities : undefined,
			weaknesses: c.weakness.length ? c.weakness.map((w) => ({ type: w.type, value: w.value ?? undefined })) : undefined,
			resistances: c.resistance.length ? c.resistance.map((w) => ({ type: w.type, value: w.value ?? undefined })) : undefined,
			variants,
			provenance: c.variants?.length ? { ...provenance, source: sources } : { ...provenance, source: sources, limitations: ['the source does not say a card\'s finish: the variant is "normal" so the image has one to attach to'] }
		}
		const file = join(setFolder, `${localId}.ts`)
		let text = renderCard(out)
		if (existsSync(file) && !opts.overwrite) {
			const old = (await import(pathToFileURL(file).href + `?t=${Date.now()}`)).default
			const added = mergeLanguage(old, out, lang, (m) => warn(`${label}: ${m}`))
			if (!added) { log(`[emit-asia] ${label}: already has ${lang}, left alone`); continue }
			text = renderCard(old, await readFile(file, 'utf8'))
		}
		outputs.push({ kind: 'card', file, text })
		if (c.imageFile) images.push({ from: join(config.cacheDir, 'asia', ...c.imageFile.split('/')), localId })
	}

	// ---- write ----
	if (opts.apply) {
		await mkdir(seriesFolder, { recursive: true })
		await mkdir(setFolder, { recursive: true })
		for (const o of outputs) await writeFile(o.file, o.text, 'utf8')
	}
	const count = (k: string) => outputs.filter((o) => o.kind === k).length
	log(`[emit-asia] ${opts.apply ? 'wrote' : 'would write'} ${count('series')} series, ${count('set')} set, ${count('card')} cards, ${warnings.length} warnings${opts.apply ? '' : ' (pass --apply)'}`)

	if (opts.imagesOut) {
		if (!opts.apply) log(`[emit-asia] would convert ${images.length} images into ${opts.imagesOut}`)
		else await stageImages(repo, images, join(opts.imagesOut, 'cards', lang, setId), log)
	}
	return { outputs: outputs.map((o) => o.file), warnings }
}

/** Card images as the CDN holds them: <dir>/<localId>/normal/large.webp (full size) and small.webp (300 px wide). */
async function stageImages(repo: string, images: { from: string; localId: string }[], dir: string, log: (l: string) => void): Promise<void> {
	let sharp: typeof import('sharp')
	try { sharp = createRequire(join(repo, 'cdn', 'package.json'))('sharp') }
	catch { throw new Error(`sharp is not installed: run "bun install" in ${join(repo, 'cdn')}`) }
	let done = 0
	for (const { from, localId } of images) {
		const target = join(dir, localId, 'normal')
		await mkdir(target, { recursive: true })
		await sharp(from).webp({ quality: 85 }).toFile(join(target, 'large.webp'))
		await sharp(from).resize({ width: 300 }).webp({ quality: 80 }).toFile(join(target, 'small.webp'))
		done++
	}
	log(`[emit-asia] ${done} images converted into ${dir}`)
}

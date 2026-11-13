import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ScrapedCard } from '../types/scraped.ts'
import config from '../../config.json' with { type: 'json' }

export interface EmitOptions {
	scrapedSetId: string
	repo: string
	serie: string
	setName: string
	setId: string
	overwrite?: boolean
	log?: (line: string) => void
}

export interface EmitResult {
	setFileWritten: boolean
	cardsWritten: number
	cardsSkipped: number
	cardsErrored: Array<{ localId: string; error: string }>
	setDir: string
}

export async function emitSet(opts: EmitOptions): Promise<EmitResult> {
	const log = opts.log ?? console.log
	const result: EmitResult = {
		setFileWritten: false,
		cardsWritten: 0,
		cardsSkipped: 0,
		cardsErrored: [],
		setDir: ''
	}

	const scrapedDir = join(config.cacheDir, 'pokemon-com', opts.scrapedSetId)
	if (!existsSync(scrapedDir)) {
		throw new Error(`No scrape found at ${scrapedDir}. Run scrape set first.`)
	}

	const serieDir = join(opts.repo, 'data', opts.serie)
	const setDir = join(serieDir, opts.setName)
	const setFile = join(serieDir, `${opts.setName}.ts`)
	result.setDir = setDir

	await mkdir(setDir, { recursive: true })
	log(`[emit] target: ${setDir}`)

	const files = (await readdir(scrapedDir)).filter((f) => f.endsWith('.json')).sort()
	const scraped: ScrapedCard[] = []
	for (const f of files) {
		try { scraped.push(JSON.parse(await readFile(join(scrapedDir, f), 'utf8'))) } catch {}
	}
	log(`[emit] ${scraped.length} scraped cards`)

	if (!existsSync(setFile) || opts.overwrite) {
		const total = scraped[0]?.structural?.total ?? scraped.length
		const setSource = serializeSet({
			id: opts.setId,
			name: opts.setName,
			cardCount: total,
			serieFile: opts.serie
		})
		await writeFile(setFile, setSource, 'utf8')
		result.setFileWritten = true
		log(`[emit] wrote set file: ${opts.setName}.ts`)
	} else {
		log(`[emit] set file exists, skipping (pass --overwrite to force)`)
	}

	for (const card of scraped) {
		const localId = String(card.structural.localId)
		const padded = localId.padStart(3, '0')
		const cardFile = join(setDir, `${padded}.ts`)
		if (existsSync(cardFile) && !opts.overwrite) {
			result.cardsSkipped++
			continue
		}
		try {
			const source = serializeCard(card, opts.setName)
			await writeFile(cardFile, source, 'utf8')
			result.cardsWritten++
		} catch (err) {
			result.cardsErrored.push({ localId, error: err instanceof Error ? err.message : String(err) })
		}
	}

	log(`[emit] done: ${result.cardsWritten} written, ${result.cardsSkipped} skipped, ${result.cardsErrored.length} errors`)
	return result
}

function serializeSet(opts: { id: string; name: string; cardCount: number; serieFile: string }): string {
	return `import { Set } from '../../interfaces'
import serie from '../${opts.serieFile}'

const set: Set = {
\tid: ${JSON.stringify(opts.id)},

\tname: {
\t\ten: ${JSON.stringify(opts.name)}
\t},

\tserie: serie,

\tcardCount: {
\t\tofficial: ${opts.cardCount}
\t}
}

export default set
`
}

function serializeCard(card: ScrapedCard, setFileName: string): string {
	const s = card.structural
	const en = card.locales.en ?? ({} as NonNullable<ScrapedCard['locales']['en']>)
	const parts: string[] = []

	parts.push(`import { Card } from "../../../interfaces"`)
	parts.push(`import Set from "../${setFileName}"`)
	parts.push(``)
	parts.push(`const card: Card = {`)

	if (s.dexIds?.length) parts.push(`\tdexId: [${s.dexIds.join(', ')}],`)
	parts.push(`\tset: Set,`)
	parts.push(``)

	parts.push(`\tname: ${formatLocaleObj(buildNameLocales(card), '\t')},`)
	parts.push(``)

	if (s.rarity) parts.push(`\trarity: ${JSON.stringify(s.rarity)},`)
	if (s.category) parts.push(`\tcategory: ${JSON.stringify(s.category)},`)
	if (s.hp != null) parts.push(`\thp: ${s.hp},`)
	if (s.types?.length) parts.push(`\ttypes: ${JSON.stringify(s.types)},`)
	if (s.stage) parts.push(`\tstage: ${JSON.stringify(s.stage)},`)
	if (s.trainerSubtype) parts.push(`\ttrainerType: ${JSON.stringify(s.trainerSubtype)},`)

	const evolveLocales = buildEvolveFromLocales(card)
	if (Object.keys(evolveLocales).length) {
		parts.push(``)
		parts.push(`\tevolveFrom: ${formatLocaleObj(evolveLocales, '\t')},`)
	}

	const allAbilities = en.abilities ?? []
	const attacks = allAbilities.filter((a) => a.kind === 'attack')
	if (attacks.length) {
		parts.push(``)
		parts.push(`\tattacks: [`)
		for (const a of attacks) {
			const origIndex = allAbilities.indexOf(a)
			parts.push(`\t\t{`)
			if (a.cost?.length) parts.push(`\t\t\tcost: ${JSON.stringify(a.cost)},`)
			parts.push(`\t\t\tname: ${formatLocaleObj(buildAttackLocales(card, origIndex, 'name'), '\t\t\t')},`)
			const effectLocales = buildAttackLocales(card, origIndex, 'effect')
			if (Object.keys(effectLocales).length) {
				parts.push(`\t\t\teffect: ${formatLocaleObj(effectLocales, '\t\t\t')},`)
			}
			if (a.damage) {
				const isPureNumber = /^-?\d+$/.test(a.damage)
				parts.push(`\t\t\tdamage: ${isPureNumber ? Number(a.damage) : JSON.stringify(a.damage)}`)
			}
			parts.push(`\t\t},`)
		}
		parts.push(`\t],`)
	}

	const abilities = allAbilities.filter((a) => a.kind === 'ability')
	if (abilities.length) {
		parts.push(``)
		parts.push(`\tabilities: [`)
		for (const a of abilities) {
			const origIndex = allAbilities.indexOf(a)
			parts.push(`\t\t{`)
			parts.push(`\t\t\ttype: "Ability",`)
			parts.push(`\t\t\tname: ${formatLocaleObj(buildAttackLocales(card, origIndex, 'name'), '\t\t\t')},`)
			const effectLocales = buildAttackLocales(card, origIndex, 'effect')
			if (Object.keys(effectLocales).length) {
				parts.push(`\t\t\teffect: ${formatLocaleObj(effectLocales, '\t\t\t')},`)
			}
			parts.push(`\t\t},`)
		}
		parts.push(`\t],`)
	}

	if (s.weaknesses?.length) {
		parts.push(``)
		parts.push(`\tweaknesses: [`)
		for (const w of s.weaknesses) {
			parts.push(`\t\t{ type: ${JSON.stringify(w.type)}, value: ${JSON.stringify(w.value)} },`)
		}
		parts.push(`\t],`)
	}

	if (s.resistances?.length) {
		parts.push(`\tresistances: [`)
		for (const r of s.resistances) {
			parts.push(`\t\t{ type: ${JSON.stringify(r.type)}, value: ${JSON.stringify(r.value)} },`)
		}
		parts.push(`\t],`)
	}

	if (s.retreat != null) parts.push(`\tretreat: ${s.retreat},`)
	if (s.illustrator) parts.push(`\tillustrator: ${JSON.stringify(s.illustrator)}`)

	parts.push(`}`)
	parts.push(``)
	parts.push(`export default card`)
	parts.push(``)

	return parts.join('\n')
}

function buildNameLocales(card: ScrapedCard): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [lang, block] of Object.entries(card.locales)) {
		if (block?.name) out[lang] = block.name
	}
	return out
}

function buildEvolveFromLocales(card: ScrapedCard): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [lang, block] of Object.entries(card.locales)) {
		if (block?.evolvesFromName) out[lang] = block.evolvesFromName
	}
	return out
}

function buildAttackLocales(card: ScrapedCard, attackIdx: number, field: 'name' | 'effect'): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [lang, block] of Object.entries(card.locales)) {
		const a = block?.abilities?.[attackIdx]
		if (a && a[field]) out[lang] = a[field] as string
	}
	return out
}

function formatLocaleObj(obj: Record<string, string>, indent: string): string {
	const keys = Object.keys(obj).sort()
	if (!keys.length) return '{}'
	const inner = keys.map((k) => `${indent}\t${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(',\n')
	return `{\n${inner}\n${indent}}`
}

export async function emit(setId: string): Promise<void> {
	throw new Error(`emit <scrapedSetId> now requires --serie, --set, and --set-id. See 'emit --help' or use the UI's "Emit scraped" button.`)
}

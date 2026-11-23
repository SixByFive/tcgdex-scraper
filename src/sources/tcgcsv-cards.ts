import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { RegistrySet } from '../registry/build.ts'
import type { EnergyTypes, ScrapedCard, ScrapedLocaleBlock, ScrapedStructural } from '../types/scraped.ts'
import { fetchGroup, type CsvProduct } from './tcgcsv.ts'
import { fillFromReprints, fillFromTcgdex } from './tcgdex-fallback.ts'

/**
 * Builds scraped cards from TCGplayer's catalogue (TCGCSV) for sets neither pokemon.com nor TCGdex has cards for (the Radiant
 * Collection), and fills the holes TCGdex leaves in a set it has (the Lycanroc trainer kit lacks 12 of its Fighting Energy).
 * The cards are written in the same shape as a pokemon.com scrape (cache/pokemon-com/<set>/<file>.json), `sourceSlug` "tcgcsv".
 *
 * What TCGplayer gives: number, rarity, HP, stage, type (not on every card), attacks, ability, weakness, resistance, retreat.
 * What it does not: the illustrator, the dex number, other languages. Those stay empty rather than guessed.
 */

const ENERGY: Record<string, EnergyTypes> = { R: 'Fire', G: 'Grass', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' }
const TYPE_NAME: Record<string, EnergyTypes> = { Grass: 'Grass', Fire: 'Fire', Water: 'Water', Lightning: 'Lightning', Psychic: 'Psychic', Fighting: 'Fighting', Darkness: 'Darkness', Metal: 'Metal', Dragon: 'Dragon', Fairy: 'Fairy', Colorless: 'Colorless' }

const ed = (p: CsvProduct, name: string) => p.extendedData?.find((e) => e.name === name)?.value?.trim() || undefined
const text = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;| /g, ' ').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim()

/** "[1R]" -> [Colorless, Fire]; "[GGL]" -> [Grass, Grass, Lightning]; "[3]" -> three Colorless; "[]" -> none. */
export function parseCost(raw: string): EnergyTypes[] {
	const out: EnergyTypes[] = []
	for (const m of raw.matchAll(/(\d+)|([A-Z])/g)) {
		if (m[1]) for (let i = 0; i < Number(m[1]); i++) out.push('Colorless')
		else if (m[2] && ENERGY[m[2]]) out.push(ENERGY[m[2]]!)
	}
	return out
}

/**
 * One "Attack N" value: "[1R] Mega Ascension\r\n<br>Search your deck..." (effect on the next line) or, in older products,
 * "[3] Relaxed Roll (30x) Flip a coin..." (everything on one line, the damage in parentheses after the name).
 */
export function parseAttack(raw: string): ScrapedLocaleBlock['abilities'][number] | undefined {
	const m = raw.match(/^\s*\[([^\]]*)\]\s*([\s\S]*)$/)
	if (!m) return undefined
	const rest = text(m[2]!)
	const nl = rest.indexOf('\n')
	let head = nl < 0 ? rest : rest.slice(0, nl)
	let effect = nl < 0 ? '' : rest.slice(nl + 1).trim()
	let damage: string | null = null
	const d = head.match(/^(.+?)\s*\((\d+[+x×-]?)\)\s*(.*)$/)
	if (d) { head = d[1]!.trim(); damage = d[2]!; if (d[3]) effect = [d[3], effect].filter(Boolean).join(' ') }
	// no damage: older products put the effect after the name on one line ("Growth - Attach a G Energy card ...")
	else if (!effect && head.includes(' - ')) { const at = head.indexOf(' - '); effect = head.slice(at + 3).trim(); head = head.slice(0, at).trim() }
	return { kind: 'attack', cost: parseCost(m[1]!), name: head || null, damage, effect: effect || null }
}

/** An ability as TCGplayer writes it: "<strong>Ability — Bust In</strong>\r\n<br>text" or "Smooth Coat - text  (Ability)". */
function parseAbility(cardText: string): ScrapedLocaleBlock['abilities'][number] | undefined {
	const strong = cardText.match(/<strong>\s*(?:Ability|Poké-?(?:Power|Body))\s*[—–-]\s*([^<]+?)\s*<\/strong>([\s\S]*)/i)
	if (strong) {
		const effect = text(strong[2]!.split(/<em>/i)[0]!)
		return { kind: 'ability', cost: [], name: strong[1]!.trim(), damage: null, effect: effect || null }
	}
	const old = text(cardText).match(/^(.+?)\s+-\s+([\s\S]+?)\s*\((Ability|Poké-?Power|Poké-?Body)\)\s*$/i)
	if (old) return { kind: 'ability', cost: [], name: old[1]!.trim(), damage: null, effect: old[2]!.replace(/\s+/g, ' ').trim() }
	return undefined
}

/** "Fx2" -> Fighting x2; "P-20" -> Psychic -20. */
function parseModifier(raw: string | undefined): { type: EnergyTypes; value: string }[] {
	const m = raw?.match(/^([A-Z])\s*([x×+-])\s*(\d+)$/)
	if (!m || !ENERGY[m[1]!]) return []
	return [{ type: ENERGY[m[1]!]!, value: m[2] === 'x' || m[2] === '×' ? `×${m[3]}` : `${m[2]}${m[3]}` }]
}

/** A product's name without the number and the tags: "Fighting Energy (#2)" -> "Fighting Energy", "Caterpie" -> "Caterpie". */
export const cleanProductName = (name: string): string => name.replace(/\s*[(\[][^)\]]*[)\]]/g, '').replace(/\s+-\s+[A-Za-z]*\d+(?:\/\w+)?$/, '').trim()

/** A TCGplayer product as a scraped card, or undefined when it is not a numbered card (a box, a code card). */
export function productToCard(p: CsvProduct, setTotal: number): ScrapedCard | undefined {
	const numberText = ed(p, 'Number')
	const m = numberText?.match(/^([A-Za-z]*)(\d+)(?:\/([A-Za-z]*)(\d+))?$/)
	if (!m) return undefined
	const [, prefix, digits, , totalDigits] = m
	const number = Number(digits)
	const localId = prefix ? `${prefix}${digits}` : String(number)
	const typeText = ed(p, 'Card Type')
	// a Trainer card can list HP "0"
	const hp = Number(ed(p, 'HP')) > 0 ? ed(p, 'HP') : undefined
	const category: ScrapedStructural['category'] = /energy/i.test(typeText ?? '') ? 'Energy' : hp ? 'Pokemon' : 'Trainer'
	const cardText = p.extendedData?.find((e) => e.name === 'CardText')?.value ?? ''

	const abilities: ScrapedLocaleBlock['abilities'] = []
	const ability = hp ? parseAbility(cardText) : undefined
	if (ability) abilities.push(ability)
	for (const key of ['Attack 1', 'Attack 2', 'Attack 3', 'Attack 4']) {
		const raw = p.extendedData?.find((e) => e.name === key)?.value
		const a = raw ? parseAttack(raw) : undefined
		if (a) abilities.push(a)
	}
	// a Trainer's or Energy's rules text is one "rule" block, as pokemon.com has it
	if (category !== 'Pokemon' && cardText) abilities.push({ kind: 'rule', cost: [], name: null, damage: null, effect: text(cardText) || null })

	const stage = ed(p, 'Stage')
	const rarity = ed(p, 'Rarity')
	const structural: ScrapedStructural = {
		localId,
		number,
		printedNumber: prefix ? localId : null,
		total: Number(totalDigits) || setTotal,
		rarity: rarity && rarity.toLowerCase() !== 'none' ? rarity : null,
		hp: hp ? Number(hp) || null : null,
		types: typeText && TYPE_NAME[typeText] ? [TYPE_NAME[typeText]!] : [],
		stage: category === 'Pokemon' && stage ? stage.replace(/\s+/g, '') : null,
		category,
		trainerSubtype: category === 'Energy' ? (/basic/i.test(typeText ?? '') ? 'Basic' : 'Special') : null,
		evolvesFromKey: null,
		pokedexSlug: null,
		dexIds: [],
		retreat: ed(p, 'RetreatCost') != null ? Number(ed(p, 'RetreatCost')) : null,
		weaknesses: parseModifier(ed(p, 'Weakness')),
		resistances: parseModifier(ed(p, 'Resistance')),
		illustrator: null,
		expansionSetCode: null,
		imageUrls: {}
	}
	return {
		scrapedAt: new Date().toISOString(),
		sourceSlug: 'tcgcsv',
		structural,
		locales: { en: { name: cleanProductName(p.name) || null, evolvesFromName: null, abilities } }
	}
}

/**
 * Writes the cards of TCGplayer group `groupId` that the set's cache lacks. `names` limits it to products of those names (a
 * top-up of a set TCGdex has most of). A product that shares its number with a card already there is left alone: where TCGplayer
 * lists two decks in one group (the Lycanroc and Alolan Raichu kit) the number alone does not say which deck a product is of.
 */
export async function fillFromTcgcsv(setId: string, groupId: number, opts: { names?: string[]; setTotal?: number; log?: (m: string) => void } = {}): Promise<{ written: string[]; skipped: string[] }> {
	const log = opts.log ?? console.log
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	await mkdir(dir, { recursive: true })
	const have = new Set((await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')))
	const wanted = opts.names ? new Set(opts.names.map((n) => n.toLowerCase())) : null
	const group = await fetchGroup(groupId)
	const written: string[] = [], skipped: string[] = []
	for (const p of group.products) {
		const card = productToCard(p, opts.setTotal ?? 0)
		if (!card) continue
		if (wanted && !wanted.has((card.locales.en?.name ?? '').toLowerCase())) continue
		// stored under the padded number, as every other source does ("TG01" is 001.json); the localId is inside
		const file = String(card.structural.number).padStart(3, '0')
		if (have.has(file)) { skipped.push(file); continue }
		await writeFile(join(dir, `${file}.json`), JSON.stringify(card, null, 2))
		have.add(file)
		written.push(file)
	}
	log(`[tcgcsv] ${setId}: group ${groupId}, wrote ${written.length} cards${skipped.length ? `, ${skipped.length} already there` : ''}`)
	return { written, skipped }
}

/** Fills a registry set that pokemon.com does not have: from TCGCSV alone, or from TCGdex with TCGCSV topping up what it lacks. */
export async function fillRegistrySet(set: Pick<RegistrySet, 'id' | 'source' | 'tcgplayerGroup' | 'tcgcsvNames' | 'reprints' | 'total' | 'official'>, log: (m: string) => void = console.log): Promise<void> {
	const total = set.total ?? set.official ?? 0
	if (set.source === 'tcgcsv') {
		if (!set.tcgplayerGroup) throw new Error(`${set.id}: no TCGplayer group in the registry`)
		await fillFromTcgcsv(set.id, set.tcgplayerGroup, { setTotal: total, log })
		return
	}
	if (set.reprints?.length) { await fillFromReprints(set.id, set.reprints, { total, log }); return }
	await fillFromTcgdex(set.id, { log, lettered: set.letteredIds })
	if (set.tcgcsvNames?.length && set.tcgplayerGroup) await fillFromTcgcsv(set.id, set.tcgplayerGroup, { names: set.tcgcsvNames, setTotal: total, log })
}

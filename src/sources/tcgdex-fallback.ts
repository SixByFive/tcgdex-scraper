import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { EnergyTypes, Lang, ScrapedCard, ScrapedLocaleBlock, ScrapedStructural } from '../types/scraped.ts'
import { tcgdexSetId } from '../util/tcgdex-id.ts'
import { fetchCard, type TcgdexCard } from './tcgdex-cards.ts'

/**
 * Builds scraped cards from the TCGdex API for cards pokemon.com doesn't have: sets it has no expansion for (Scarlet & Violet
 * Energy, My First Battle) and the holes in its numbering (SVP skips 31, 56, 129-132, ...). The cards are written in the same
 * shape as a pokemon.com scrape (cache/pokemon-com/<set>/<nnn>.json) so enrich and emit treat them alike; `sourceSlug` is
 * "tcgdex" and the emitter records them as coming from tcgdex-api only.
 * A card that is already scraped is never touched. Only what TCGdex gives is filled in: a language it lacks is left absent.
 */
const LANGS: Lang[] = ['en', 'de', 'fr', 'it', 'es', 'pt']
const TCGDEX = 'https://api.tcgdex.net/v2'

const cost = (list: string[] | undefined | null): EnergyTypes[] => (list ?? []).filter(Boolean) as EnergyTypes[]

/** Every card id TCGdex lists for a set: [{ localId: "031" }, ...]. */
export async function listTcgdexCards(setId: string): Promise<{ localId: string }[]> {
	const res = await fetch(`${TCGDEX}/en/sets/${tcgdexSetId(setId)}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(20000) })
	if (!res.ok) throw new Error(`TCGdex set ${setId} -> ${res.status}`)
	const body = (await res.json()) as { cards?: { localId: string }[] }
	return body.cards ?? []
}

function localeBlock(card: TcgdexCard): ScrapedLocaleBlock {
	const blocks: ScrapedLocaleBlock['abilities'] = []
	for (const a of card.abilities ?? []) blocks.push({ kind: 'ability', cost: [], name: a.name ?? null, damage: null, effect: a.effect ?? null })
	for (const a of card.attacks ?? []) blocks.push({ kind: 'attack', cost: cost(a.cost), name: a.name ?? null, damage: a.damage == null ? null : String(a.damage), effect: a.effect ?? null })
	// a Trainer's (or Energy's) rules text is one "rule" block, as pokemon.com has it
	if (card.effect && card.category !== 'Pokemon') blocks.push({ kind: 'rule', cost: [], name: null, damage: null, effect: card.effect })
	return { name: card.name?.trim() ?? null, evolvesFromName: card.evolveFrom ?? null, abilities: blocks }
}

/**
 * One card of TCGdex as a scraped card, or null when TCGdex has no English card for it. `setId`/`localId` say where it is fetched
 * from; `structuralId` and `printedNumber` what the scraped card is called (they differ for a reprint, which is another set's
 * card under a number of its own); `total` overrides the set's official count.
 */
async function buildFromTcgdex(o: { setId: string; localId: string; n: number; alphaOnly: boolean; structuralId: string; printedNumber: string | null; total?: number }, log: (m: string) => void): Promise<ScrapedCard | null> {
	const { setId, localId, n, alphaOnly } = o
	const blocks: Partial<Record<Lang, ScrapedLocaleBlock>> = {}
	const imageUrls: Partial<Record<Lang, string>> = {}
	const absentLangs: Lang[] = []
	const failedLangs: Lang[] = []
	let en: TcgdexCard | null = null
	for (const lang of LANGS) {
		let card: TcgdexCard | null = null
		try {
			for (const form of [...new Set(alphaOnly ? [localId] : [localId, localId.padStart(3, '0'), String(n)])]) { card = await fetchCard(setId, form, lang, false); if (card) break }
		} catch (err) {
			failedLangs.push(lang)
			log(`[tcgdex] ${setId}/${localId} ${lang}: ${(err as Error).message}`)
			continue
		}
		if (!card) { absentLangs.push(lang); continue }
		blocks[lang] = localeBlock(card)
		if (card.image) imageUrls[lang] = card.image
		if (lang === 'en') en = card
	}
	if (!en) return null

	const category = en.category === 'Trainer' || en.category === 'Energy' ? en.category : 'Pokemon'
	const raw = en.rarity?.trim()
	const structural: ScrapedStructural = {
		// the id as TCGdex writes it ("1" in My First Battle, "031" in SVP): it is also the repo's file name and card id
		localId: o.structuralId,
		number: n,
		// a lettered id is also the number printed on the card, and how TCGTracking numbers its product
		printedNumber: o.printedNumber,
		total: o.total ?? (Number((en as { set?: { cardCount?: { official?: number } } }).set?.cardCount?.official) || 0),
		rarity: raw && raw.toLowerCase() !== 'none' ? raw : null,
		hp: en.hp ?? null,
		types: cost(en.types),
		// the stage the way pokemon.com words it is what normalise maps from: "Stage1", "Basic", ...
		stage: category === 'Pokemon' ? en.stage ?? null : null,
		category,
		trainerSubtype: category === 'Trainer' ? en.trainerType ?? null : category === 'Energy' ? en.energyType ?? null : null,
		evolvesFromKey: en.evolveFrom ?? null,
		pokedexSlug: null,
		dexIds: en.dexId ?? [],
		retreat: en.retreat ?? null,
		weaknesses: (en.weaknesses ?? []).map((w) => ({ type: w.type as EnergyTypes, value: w.value ?? '' })),
		resistances: (en.resistances ?? []).map((w) => ({ type: w.type as EnergyTypes, value: w.value ?? '' })),
		illustrator: en.illustrator ?? null,
		expansionSetCode: null,
		imageUrls
	}
	const scraped: ScrapedCard = { scrapedAt: new Date().toISOString(), sourceSlug: 'tcgdex', structural, locales: blocks, absentLangs, failedLangs }
	return scraped
}

/**
 * Writes the cards of `setId` that are missing from the cache. `only` limits it to those card numbers; `onlyMissing`
 * (default) skips cards already scraped. Returns the numbers written and the ones TCGdex has no card for.
 */
export async function fillFromTcgdex(setId: string, opts: { only?: number[]; lettered?: boolean; log?: (m: string) => void } = {}): Promise<{ written: number[]; notOnTcgdex: number[]; skipped: string[] }> {
	const log = opts.log ?? console.log
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	await mkdir(dir, { recursive: true })
	// the cache files: "031.json" for a numbered card, "Museum.json" for one whose id is only letters
	const haveFiles = new Set((await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')))
	const wanted = opts.only ? new Set(opts.only) : null

	const listed = await listTcgdexCards(setId)
	const written: number[] = [], notOnTcgdex: number[] = [], skipped: string[] = []
	for (const { localId } of listed) {
		// a lettered id (TG01, SWSH061) is stored under its number, but only when asked for by number (`only`): a hole in pokemon.com's
		// numbering of a promo set. Without that it could be mistaken for a plain card of the same number.
		const lettered = localId.match(/^[A-Za-z]+(\d+)$/)
		// An id of only letters ("Museum", the 30th Celebration's "B", "G", "R") can't be mistaken for another card and has no
		// number: it is stored under its name, and only a full fill (no `only`) writes it.
		// (the Unown Collection's "!" and "?": TCGdex lists the second URL-encoded, "%3F", which is also a file name Windows accepts)
		const alphaOnly = /^(?:[A-Za-z]+|!|%3F)$/.test(localId)
		// a number with a letter after it ("24a", the alternate art of card 24) is its own card: stored as "024a"
		const suffixed = localId.match(/^(\d+)([A-Za-z])$/)
		if (!/^\d+$/.test(localId) && !(lettered && (wanted || opts.lettered)) && !alphaOnly && !suffixed) { skipped.push(localId); continue }
		// a set that carries a prefixed subset of its own ("RC1".."RC32" in Generations; registry `letteredIds`): kept under its own id
		const own = Boolean(opts.lettered && lettered && !wanted)
		const n = alphaOnly ? 0 : Number(suffixed ? suffixed[1] : lettered ? lettered[1] : localId)
		const fileName = alphaOnly || own ? localId : String(n).padStart(3, '0') + (suffixed ? suffixed[2]!.toLowerCase() : '')
		if (haveFiles.has(fileName) || (wanted && (alphaOnly || suffixed || !wanted.has(n)))) continue

		const scraped = await buildFromTcgdex({ setId, localId, n, alphaOnly: alphaOnly || own, structuralId: localId, printedNumber: /^[A-Za-z]/.test(localId) ? localId : null }, log)
		if (!scraped) { notOnTcgdex.push(n); continue }
		await writeFile(join(dir, `${fileName}.json`), JSON.stringify(scraped, null, 2))
		written.push(n)
	}
	if (skipped.length) log(`[tcgdex] ${setId}: ${skipped.length} cards with lettered ids not handled (${skipped.slice(0, 5).join(', ')})`)
	log(`[tcgdex] ${setId}: wrote ${written.length} cards${notOnTcgdex.length ? `; TCGdex has no card ${notOnTcgdex.join(', ')}` : ''}`)
	return { written, notOnTcgdex, skipped }
}

/**
 * Builds a set whose cards are reprints of other sets' cards (W Promotional: seven cards of the Jungle, Fossil, ... sets with a gold
 * "W" stamp). Card n takes its data from `reprints[n-1]` on TCGdex; the stamp makes the variant. A card already in the cache is left.
 */
export async function fillFromReprints(setId: string, reprints: { set: string; localId: string; stamps?: string[] }[], opts: { total?: number; log?: (m: string) => void } = {}): Promise<number[]> {
	const log = opts.log ?? console.log
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	await mkdir(dir, { recursive: true })
	const have = new Set((await readdir(dir)).filter((f) => f.endsWith('.json')))
	const written: number[] = []
	for (const [i, r] of reprints.entries()) {
		const n = i + 1
		const file = `${String(n).padStart(3, '0')}.json`
		if (have.has(file)) continue
		const card = await buildFromTcgdex({ setId: r.set, localId: r.localId, n, alphaOnly: false, structuralId: String(n), printedNumber: null, total: opts.total ?? reprints.length }, log)
		if (!card) { log(`[tcgdex] ${setId} ${n}: TCGdex has no ${r.set}-${r.localId}`); continue }
		// the parent card's own printing data is not this card's: it is the parent with the promo's stamp
		card.variants = [{ type: 'normal', stamps: r.stamps?.length ? [...r.stamps].sort() : undefined, prices: {} }]
		card.structural.rarity = null
		await writeFile(join(dir, file), JSON.stringify(card, null, 2))
		written.push(n)
	}
	log(`[tcgdex] ${setId}: wrote ${written.length} reprint cards`)
	return written
}

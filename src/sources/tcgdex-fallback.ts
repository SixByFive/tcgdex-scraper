import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { EnergyTypes, Lang, ScrapedCard, ScrapedLocaleBlock, ScrapedStructural } from '../types/scraped.ts'
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
	const res = await fetch(`${TCGDEX}/en/sets/${setId}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(20000) })
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
 * Writes the cards of `setId` that are missing from the cache. `only` limits it to those card numbers; `onlyMissing`
 * (default) skips cards already scraped. Returns the numbers written and the ones TCGdex has no card for.
 */
export async function fillFromTcgdex(setId: string, opts: { only?: number[]; log?: (m: string) => void } = {}): Promise<{ written: number[]; notOnTcgdex: number[]; skipped: string[] }> {
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
		const alphaOnly = /^[A-Za-z]+$/.test(localId)
		if (!/^\d+$/.test(localId) && !(lettered && wanted) && !alphaOnly) { skipped.push(localId); continue }
		const n = alphaOnly ? 0 : Number(lettered ? lettered[1] : localId)
		const fileName = alphaOnly ? localId : String(n).padStart(3, '0')
		if (haveFiles.has(fileName) || (wanted && (alphaOnly || !wanted.has(n)))) continue

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
		if (!en) { notOnTcgdex.push(n); continue }

		const category = en.category === 'Trainer' || en.category === 'Energy' ? en.category : 'Pokemon'
		const raw = en.rarity?.trim()
		const structural: ScrapedStructural = {
			// the id as TCGdex writes it ("1" in My First Battle, "031" in SVP): it is also the repo's file name and card id
			localId,
			number: n,
			// a lettered id is also the number printed on the card, and how TCGTracking numbers its product
			printedNumber: /^[A-Za-z]/.test(localId) ? localId : null,
			total: Number((en as { set?: { cardCount?: { official?: number } } }).set?.cardCount?.official) || 0,
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
		await writeFile(join(dir, `${fileName}.json`), JSON.stringify(scraped, null, 2))
		written.push(n)
	}
	if (skipped.length) log(`[tcgdex] ${setId}: ${skipped.length} cards with lettered ids not handled (${skipped.slice(0, 5).join(', ')})`)
	log(`[tcgdex] ${setId}: wrote ${written.length} cards${notOnTcgdex.length ? `; TCGdex has no card ${notOnTcgdex.join(', ')}` : ''}`)
	return { written, notOnTcgdex, skipped }
}

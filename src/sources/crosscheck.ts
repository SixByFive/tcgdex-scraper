import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import config from '../../config.json' with { type: 'json' }
import type { ScrapedCard } from '../types/scraped.ts'
import { fetchCards } from '../util/tcgtracking-open.ts'
import { nameKey } from '../emit/variants.ts'
import { looseName } from '../emit/names.ts'

/** PokeData's names carry the rarity ("Full Art Dhelmise V") and drop apostrophes ("Ns Zekrom"): neither is a different card. */
const pdKey = (s: string): string => nameKey(looseName(s).replace(/['’]/g, '').replace(/^(full art|secret|alternate art|alt art|rainbow|gold|special illustration|illustration) /, ''))
import { listSets as listExperimentalSets } from '../util/experimental.ts'

/**
 * Cross-references a scraped set against every other source that has the same card and reports what disagrees: nothing is
 * changed. Sources compared: the card already in the Experimental repo (an earlier import), and the TCGTracking product each
 * variant's TCGplayer id points at (its name must be the card's). When a card has come from TCGdex alone (`sourceSlug: tcgdex`)
 * this is the only check there is, so those cards are listed first.
 */
export interface Disagreement { card: string; field: string; scraped: unknown; other: unknown; against: string }

const norm = (v: unknown) => String(v ?? '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()
const attacksOf = (blocks: { kind?: string; name?: string | null; damage?: string | number | null; cost?: string[] }[] | undefined) =>
	(blocks ?? []).filter((b) => b.kind === 'attack').map((b) => `${norm(b.name)}|${norm(b.damage)}|${(b.cost ?? []).join(',')}`)

export async function crossCheckSet(setId: string, repo: string, tcgplayerGroup?: number, setName?: string): Promise<{ checked: number; disagreements: Disagreement[]; tcgdexOnly: number; pokedata?: { entries: number; missingIds: Disagreement[] } }> {
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
	const meta = (await listExperimentalSets(repo)).find((s) => s.id === setId)
	const products = new Map<number, { name: string }>()
	if (tcgplayerGroup) for (const p of (await fetchCards(tcgplayerGroup)).products) products.set(p.id, p)

	const out: Disagreement[] = []
	let tcgdexOnly = 0
	for (const f of files) {
		const card = JSON.parse(await readFile(join(dir, f), 'utf8')) as ScrapedCard
		const id = f.replace('.json', '')
		const en = card.locales.en
		if (card.sourceSlug === 'tcgdex') tcgdexOnly++
		const diff = (field: string, scraped: unknown, other: unknown, against: string) => { if (norm(scraped) !== norm(other)) out.push({ card: id, field, scraped, other, against }) }

		// 1. the card as the repo has it today
		if (meta) {
			for (const name of [`${id}.ts`, `${Number(id)}.ts`]) {
				let old: any
				try { old = (await import(pathToFileURL(join(meta.dir, name)).href + '?' + Math.random())).default } catch { continue }
				if (!old) continue
				const against = `repo ${name} (${old.provenance?.source ?? 'unknown source'})`
				diff('name', en?.name, old.name?.en, against)
				if (old.hp !== undefined || card.structural.hp != null) diff('hp', card.structural.hp, old.hp, against)
				if (old.types || card.structural.types.length) diff('types', card.structural.types.join(','), (old.types ?? []).join(','), against)
				if (old.illustrator || card.structural.illustrator) diff('illustrator', card.structural.illustrator, old.illustrator, against)
				if (old.retreat !== undefined && card.structural.retreat != null) diff('retreat', card.structural.retreat, old.retreat, against)
				const oldAttacks = (old.attacks ?? []).map((a: any) => `${norm(a.name?.en)}|${norm(a.damage)}|${(a.cost ?? []).join(',')}`)
				const newAttacks = attacksOf(en?.abilities)
				if (oldAttacks.length || newAttacks.length) diff('attacks', newAttacks.join(' ; '), oldAttacks.join(' ; '), against)
				break
			}
		}

		// 2. the TCGTracking product behind each variant: it must be this card
		for (const v of card.variants ?? []) {
			const p = v.prices.tcgplayer ? products.get(v.prices.tcgplayer) : undefined
			if (!p || !en?.name) continue
			if (nameKey(p.name) !== nameKey(en.name) && !nameKey(p.name).includes(nameKey(en.name))) {
				out.push({ card: id, field: `variant ${v.type} tcgplayer ${v.prices.tcgplayer}`, scraped: en.name, other: p.name, against: 'TCGTracking product name' })
			}
		}
	}

	// 3. PokeData: an independent list of the set's cards with their TCGplayer ids. A name that differs is a disagreement; a TCGplayer
	// id it has that none of our variants has is only a candidate (it may be a printing we leave out), listed apart.
	let pokedata: { entries: number; missingIds: Disagreement[] } | undefined
	try {
		const { pokedataSetId, pokedataCards } = await import('./pokedata.ts')
		const pid = await pokedataSetId(setId, setName ?? meta?.name.en ?? setId)
		if (pid) {
			const entries = await pokedataCards(pid)
			const byNum = new Map<string, typeof entries>()
			for (const e of entries) { const k = String(Number(e.num)); byNum.set(k, [...(byNum.get(k) ?? []), e]) }
			const missingIds: Disagreement[] = []
			for (const f of files) {
				const card = JSON.parse(await readFile(join(dir, f), 'utf8')) as ScrapedCard
				const k = String(card.structural.number)
				const theirs = byNum.get(k)
				const en = card.locales.en?.name ?? ''
				if (!theirs) { if (k === '0') continue; out.push({ card: f.replace('.json', ''), field: 'number', scraped: k, other: 'none', against: 'PokeData has no entry with this number' }); continue }
				if (!theirs.some((e) => pdKey(e.name).startsWith(pdKey(en)) || pdKey(en).startsWith(pdKey(e.name)))) {
					out.push({ card: f.replace('.json', ''), field: 'name', scraped: en, other: theirs.map((e) => e.name).join(' / '), against: 'PokeData' })
				}
				const ours = new Set((card.variants ?? []).map((v) => String(v.prices.tcgplayer)))
				// only entries named like this card count: PokeData's number is the printed one, so an entry can be another set's card ("Charmander 4/165")
				for (const e of theirs.filter((x) => pdKey(x.name).startsWith(pdKey(en)))) if (e.tcgplayer_id && !ours.has(String(e.tcgplayer_id))) missingIds.push({ card: f.replace('.json', ''), field: 'tcgplayer id', scraped: 'none', other: `${e.name} ${e.tcgplayer_id}`, against: 'PokeData (candidate variant)' })
			}
			pokedata = { entries: entries.length, missingIds }
		}
	} catch (err) {
		out.push({ card: '-', field: 'pokedata', scraped: '-', other: (err as Error).message, against: 'PokeData unreachable: not compared' })
	}
	// 4. Cardmarket's own catalogue: every Cardmarket id must be a product of this card
	try {
		const { verifyCardmarketIds } = await import('./cardmarket-catalogue.ts')
		for (const p of (await verifyCardmarketIds(setId)).problems) out.push({ card: p.card, field: `cardmarket ${p.id} (${p.variant})`, scraped: p.card, other: p.problem, against: 'Cardmarket catalogue' })
	} catch (err) {
		out.push({ card: '-', field: 'cardmarket catalogue', scraped: '-', other: (err as Error).message, against: 'Cardmarket catalogue unreachable: ids not verified' })
	}
	return { checked: files.length, disagreements: out, tcgdexOnly, pokedata }
}

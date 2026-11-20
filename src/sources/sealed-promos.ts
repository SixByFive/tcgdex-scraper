import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import { cardLocalId } from '../emit/normalise.ts'
import { looseName } from '../emit/names.ts'
import { loadCatalogue } from './cardmarket-catalogue.ts'

/**
 * Which promo card a sealed product holds. The retailer's text names the Pokémon ("a promotional card of Eevee", an Elite Trainer
 * Box's "promo card featuring Charmander", a blister's [Eevee]); the promo set (svp, swshp, mep) has several cards of that name, so
 * the right one is the one Cardmarket added to its catalogue at the same time as the product (promos and the product that holds
 * them are listed together). A name with one candidate is taken; with several, only a clear nearest-in-time winner is.
 */
export interface PromoCard { id: string; name: string; added?: number; tcg?: number[]; rarity?: string }

const ms = (s: string | undefined) => (s ? Date.parse(s.replace(' ', 'T') + 'Z') : undefined)

export async function loadPromoCards(promoSets: string[]): Promise<PromoCard[]> {
	const catalogue = await loadCatalogue()
	const out: PromoCard[] = []
	for (const set of promoSets) {
		const dir = join(config.cacheDir, 'pokemon-com', set)
		if (!existsSync(dir)) continue
		for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
			const c = JSON.parse(readFileSync(join(dir, f), 'utf8'))
			const dates = (c.variants ?? []).map((v: any) => ms((catalogue.get(v.prices?.cardmarket) as any)?.dateAdded)).filter((d: unknown): d is number => typeof d === 'number')
			out.push({ id: `${set}-${cardLocalId(c)}`, name: c.locales?.en?.name ?? '', added: dates.length ? Math.min(...dates) : undefined, tcg: (c.variants ?? []).map((v: any) => v.prices?.tcgplayer).filter(Boolean), rarity: String(c.structural?.rarity ?? '') })
		}
	}
	return out
}

/** The Pokémon a product's description says its promo card is, if it names one. */
export function promoNameFromText(raw: string | undefined): string | undefined {
	if (!raw || raw === 'undefined') return undefined
	const t = raw.split(/Release Description|Set Configuration/i)[0]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
	const m = t.match(/promo(?:tional)? (?:foil )?cards? (?:of|featuring) ([^,.;•]+)/i) ?? t.match(/promotional foil ([A-Z][^,.;•]*)/)
	if (!m) return undefined
	const name = m[1]!.replace(/\s+(?:and|plus)\s+.*$/i, '').replace(/^(?:an?|the)\s+/i, '').trim()
	return name && name.length < 40 && !/\d/.test(name) ? name : undefined
}

export interface PromoPick { id?: string; ids?: string[]; why?: string }
/** `ref`: when the product was added to Cardmarket (or its set's release), in ms. */
function pickOne(name: string, cards: PromoCard[], ref: number | undefined, refTcg?: number, rarity?: RegExp): PromoPick {
	const want = looseName(name)
	const pool = cards.filter((c) => looseName(c.name) === want)
	const cand = rarity && pool.some((c) => rarity.test(c.rarity ?? '')) ? pool.filter((c) => rarity.test(c.rarity ?? '')) : pool
	if (!cand.length) return { why: `no promo card named ${name}` }
	if (cand.length === 1) return { id: cand[0]!.id }
	const dated = cand.filter((c) => c.added !== undefined && ref !== undefined).map((c) => ({ c, d: Math.abs(c.added! - ref!) })).sort((a, b) => a.d - b.d)
	const day = 86400000
	if (dated.length && (dated.length === 1 || dated[1]!.d - dated[0]!.d >= 7 * day) && dated[0]!.d <= 120 * day) return { id: dated[0]!.c.id }
	// TCGplayer ids are handed out in order too: a promo listed with its product has a nearby id
	if (refTcg) {
		const near = cand.map((c) => ({ c, d: Math.min(...(c.tcg?.length ? c.tcg : [Infinity]).map((t) => Math.abs(t - refTcg))) })).sort((a, b) => a.d - b.d)
		if (near[0]!.d <= 8000 && (near.length === 1 || near[1]!.d >= near[0]!.d * 3)) return { id: near[0]!.c.id }
	}
	return { why: `${cand.length} promo cards named ${name} (${cand.map((c) => c.id).join(', ')}) and none is clearly nearest in time` }
}

/**
 * A contents line that is a card of a named Pokémon ("Foil card featuring Kadabra", "Etched foil promo card featuring Shiny X ex",
 * "Foil SWSH015 Cinderace V promo"): the names it lists. One name means one card; several ("X, Y, or Z") mean a choice of cards,
 * which a product's contents can't express, so those stay as items.
 */
export function featuredCards(line: string): { names: string[] } | { direct: string } | undefined {
	const direct = line.match(/\b(SWSH\d{3})\b/i)
	if (direct && /promo|foil/i.test(line)) return { direct: `swshp-${direct[1]!.toUpperCase()}` }
	const m = line.match(/^(.*?)\bfeaturing:?\s+(.+)$/i)
	if (!m) return undefined
	const lead = m[1]!
	if (!/(promo|foil|oversize|etched|full[- ]?art|holo)/i.test(lead) || !/(card|promo)/i.test(lead)) return undefined
	if (/sleeve|pin\b|playmat|figure|coin|album|binder|deck|pack\b/i.test(lead)) return undefined
	const names = m[2]!.replace(/\s+with .*$/i, '').split(/,\s*(?:or\s+|and\s+)?|\s+or\s+/i).map((n) => n.trim().replace(/^(?:an?|the)\s+/i, '')).filter(Boolean)
	return names.length ? { names } : undefined
}

/**
 * The card(s) for a name as a description writes it. Tidies the name ("Shiny Mimikyu" is the set's shiny card of Mimikyu; "Mega Lucario"
 * is "Mega Lucario ex"), and splits "A & B" / "A and B" / "A/B" into two cards when no card has that whole name and each half is one.
 */
export function pickPromo(raw: string, cards: PromoCard[], ref: number | undefined, refTcg?: number): PromoPick {
	let name = raw.replace(/\s+/g, ' ').trim()
	if (/<br|\bone of\b|\blogo\b|^star |\bboth\b/i.test(name) || name.length > 45) return { why: `not a Pokémon name: ${name.slice(0, 50)}` }
	if (/^[^:]*\s[^:]*:\s*\S/.test(name) && !/^type: ?null/i.test(name)) name = name.split(':').pop()!.trim()
	const shiny = /^shiny /i.test(name)
	const base = name.replace(/^shiny /i, '')
	const rarity = shiny ? /shiny/i : undefined
	let last: PromoPick = { why: `no promo card named ${name}` }
	for (const n of [base, `${base} ex`]) {
		const r = pickOne(n, cards, ref, refTcg, rarity)
		if (r.id) return r
		if (!/^no promo card/.test(r.why ?? '') || n === base) last = r.why!.startsWith('no promo card') && last.why!.startsWith('no promo card') ? { why: `no promo card named ${name}` } : r
	}
	const parts = base.split(/\s*(?:&|\band\b|\/)\s*/i).filter(Boolean)
	if (parts.length === 2 && last.why?.startsWith('no promo card')) {
		const picks = parts.map((p) => pickOne(p, cards, ref, refTcg, rarity))
		if (picks.every((p) => p.id)) return { ids: picks.map((p) => p.id!) }
	}
	return last
}

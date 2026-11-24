import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Checks on the scraped cache itself (cache/pokemon-com): every bug fixed while rebuilding the data left a mark that can be
 * tested for. They are skipped when a set isn't cached on this machine.
 */
const ROOT = join('cache', 'pokemon-com')
const cached = existsSync(ROOT)

interface CachedVariant { type: string; foil?: string; stamps?: string[]; prices: { cardmarket?: number; tcgplayer?: number; cardtrader?: number } }
interface Cached { file: string; set: string; localId: string; name: string; variants: CachedVariant[]; tcgdexVariants: any[] }

const all: Cached[] = []
if (cached) {
	for (const set of readdirSync(ROOT)) {
		const dir = join(ROOT, set)
		let files: string[]
		try { files = readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { continue }
		for (const f of files) {
			const c = JSON.parse(readFileSync(join(dir, f), 'utf8'))
			all.push({ file: f, set, localId: String(c.structural?.localId), name: c.locales?.en?.name ?? '', variants: c.variants ?? [], tcgdexVariants: c.tcgdex?.variants ?? [] })
		}
	}
}
const get = (set: string, localId: string) => all.find((c) => c.set === set && c.localId === localId)
// Legendary Treasures' RC cards are the Radiant Collection set's cards, so the Experimental repo keeps them idless (reprints.ts links them)
const shared = (c: { set: string; localId: string }) => c.set === 'bw11' && /^RC/.test(c.localId)
const t = cached ? test : test.skip
const has = (set: string) => all.some((c) => c.set === set)
const tIf = (set: string) => (has(set) ? test : test.skip)

describe('provider ids belong to one card', () => {
	t('no id is held by two cards, across every set (the validator rejects it)', () => {
		const owner = { tcgplayer: new Map<number, string>(), cardmarket: new Map<number, string>(), cardtrader: new Map<number, string>() }
		const dups: string[] = []
		for (const c of all) for (const v of c.variants) for (const k of ['tcgplayer', 'cardmarket', 'cardtrader'] as const) {
			if (shared(c)) continue
			const id = v.prices[k]
			if (!id) continue
			const who = `${c.set}-${c.localId}`
			const first = owner[k].get(id)
			if (first && first !== who) dups.push(`${k} ${id}: ${first} and ${who}`)
			else owner[k].set(id, who)
		}
		expect(dups).toEqual([])
	})

	t('a variant TCGdex also lists is not left without an id TCGdex has (the relabel bug), bar the hand-made fixes', () => {
		const fixes = JSON.parse(readFileSync(join('registry', 'id-fixes.json'), 'utf8')) as { set: string; card: string }[]
		const fixed = new Set(fixes.map((f) => `${f.set}-${f.card.replace(/^0+/, '')}`))
		const sig = (v: { type: string; foil?: string; stamps?: string[] }) => `${v.type}|${v.foil ?? ''}|${[...(v.stamps ?? [])].sort().join(',')}`
		const lost: string[] = []
		for (const c of all) {
			if (fixed.has(`${c.set}-${c.localId.replace(/^0+/, '')}`)) continue
			if (shared(c)) continue
			for (const x of c.tcgdexVariants) {
				const mine = c.variants.find((v) => sig(v) === sig(x))
				if (!mine) continue
				for (const k of ['tcgplayer', 'cardmarket', 'cardtrader'] as const) if (x[k] && !mine.prices[k]) lost.push(`${c.set}-${c.localId} ${sig(x)} ${k} ${x[k]}`)
			}
		}
		// swshp-7: TCGTracking pairs Cardmarket 437159 with the staff variant, TCGdex with the plain one: a known disagreement
		expect(lost.filter((l) => !l.startsWith('swshp-7 '))).toEqual([])
	})
})

describe('hand-checked id fixes are in place (registry/id-fixes.json)', () => {
	t('every fix is applied', () => {
		const fixes = JSON.parse(readFileSync(join('registry', 'id-fixes.json'), 'utf8')) as { set: string; card: string; variant: { type: string; foil?: string; stamps?: string[] }; provider: 'tcgplayer' | 'cardmarket' | 'cardtrader'; id: number | null }[]
		const notApplied: string[] = []
		for (const f of fixes) {
			if (!has(f.set)) continue
			const c = all.find((x) => x.set === f.set && x.localId.replace(/^0+/, '') === f.card.replace(/^0+/, ''))
			const v = c?.variants.find((x) => x.type === f.variant.type && (x.foil ?? undefined) === f.variant.foil && [...(x.stamps ?? [])].sort().join() === [...(f.variant.stamps ?? [])].sort().join())
			if (!v || (v.prices[f.provider] ?? null) !== f.id) notApplied.push(`${f.set}-${f.card} ${f.provider} ${f.id}`)
		}
		expect(notApplied).toEqual([])
	})
})

describe('cards that used to lose or get the wrong ids', () => {
	// Turbo Patch (Secret) 200/189 was taken by the regular Turbo Patch's stamped variant, which stripped card 200's ids
	tIf('swsh3')('swsh3 #200 Turbo Patch keeps its own product', () => expect(get('swsh3', '200')?.variants.some((v) => v.prices.tcgplayer === 219317)).toBe(true))
	// four Classic Collection cards are numbered 15; each has its own product
	tIf('cel25cc')('cel25cc: the four cards numbered 15 each have their own TCGplayer id', () => {
		const ids = ['CC003', 'CC006', 'CC007', 'CC016'].map((id) => get('cel25cc', id)?.variants[0]?.prices.tcgplayer)
		expect(ids.every(Boolean)).toBe(true)
		expect(new Set(ids).size).toBe(4)
	})
	// mee: TCGTracking numbers match the cards, but names differ ("Basic Fire Energy" vs "Fire Energy"): matching by name gave cards
	// 009-016 the plain Energy products of 001-008
	tIf('mee')('mee: Basic Fire Energy 010 has the 30th Celebration product, not the plain Fire Energy one', () => {
		const prices = get('mee', '010')?.variants.map((v) => v.prices.tcgplayer)
		expect(prices).toContain(713249)
		expect(prices).not.toContain(656264)
	})
	tIf('mee')('mee: cards 001-008 have their own normal products', () => expect(get('mee', '002')?.variants.some((v) => v.type === 'normal' && v.prices.tcgplayer === 656264)).toBe(true))
	// mep-100: TCGTracking's label and TCGdex's differ; the Cardmarket id was lost
	tIf('mep')('mep #100 Sylveon ex has its Cardmarket id', () => expect(get('mep', '100')?.variants.some((v) => v.prices.cardmarket === 895612)).toBe(true))
	// secret rares took the ids of the common card of the same name
	tIf('swsh10')('swsh10: Decidueye VSTAR 195 (Secret) holds its product, not card 84', () => {
		expect(get('swsh10', '195')?.variants.some((v) => v.prices.tcgplayer === 272449)).toBe(true)
		expect(get('swsh10', '84')?.variants.some((v) => v.prices.tcgplayer === 272449)).toBe(false)
	})
	tIf('swsh9tg')('swsh9tg TG24 does not carry swsh9-129’s product', () => expect(get('swsh9tg', '24')?.variants.some((v) => v.prices.tcgplayer === 263852)).toBe(false))
})

describe('sets are complete', () => {
	const sizes: [string, number][] = [['swshp', 307], ['swsh10.5', 88], ['mep', 112], ['30th', 161], ['svp', 226], ['cel25cc', 25], ['mee', 16]]
	for (const [set, n] of sizes) tIf(set)(`${set} has ${n} cards`, () => expect(all.filter((c) => c.set === set).length).toBe(n))
})

describe('names have no invisible characters', () => {
	t('no cached English name contains a zero-width character', () => {
		expect(all.filter((c) => /[​-‍﻿­]/.test(c.name)).map((c) => `${c.set}-${c.localId}`)).toEqual([])
	})
})

// Cardmarket publishes its catalogue (var/cardmarket, downloaded by `crosscheck`): every Cardmarket id in the cache must be a
// product of its own card. Sinking ids of another card (Blissey's was Snorlax's) is how the wrong ones were found.
import { sameProduct } from '../src/sources/cardmarket-catalogue.ts'
describe('Cardmarket ids are products of their own card', () => {
	const file = join('var', 'cardmarket', 'products_singles_6.json')
	const haveCatalogue = cached && existsSync(file)
	// Cardmarket and TCGdex word these cards differently (base1-73: "Imposter" vs "Impostor"); the ids are right
	const translated = new Set(['me06-90', 'me06-101', 'me06-126', 'base1-73'])
	;(haveCatalogue ? test : test.skip)('no cached Cardmarket id is in the catalogue under another name', () => {
		const products = new Map<number, { idProduct: number; name: string; idExpansion: number }>(JSON.parse(readFileSync(file, 'utf8')).products.map((p: any) => [p.idProduct, p]))
		const bad: string[] = []
		for (const set of readdirSync(ROOT)) {
			const dir = join(ROOT, set)
			let files: string[]
			try { files = readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { continue }
			for (const f of files) {
				const c = JSON.parse(readFileSync(join(dir, f), 'utf8'))
				const id = `${set}-${String(c.structural.localId).replace(/^0+/, '')}`
				if (translated.has(id)) continue
				for (const v of c.variants ?? []) {
					const cm = v.prices?.cardmarket
					if (!cm) continue
					const p = products.get(cm)
					if (!p) bad.push(`${id} cm ${cm} not in the catalogue`)
					else if (!sameProduct(c.locales?.en?.name ?? '', p)) bad.push(`${id} cm ${cm} is "${p.name}"`)
				}
			}
		}
		expect(bad).toEqual([])
	})

	test('sameProduct tells another card from a differently written one', () => {
		const p = (name: string) => ({ idProduct: 1, idExpansion: 1, name })
		expect(sameProduct('Growing Grass Energy', p('Growing [G] Energy'))).toBe(true)
		expect(sameProduct('Legendary Pyroduct', p('Legendary Lava Tube [Left]'))).toBe(true)
		expect(sameProduct('Palafin', p('Palafin [Jet Punch | Justice Kick]'))).toBe(true)
		expect(sameProduct('Blissey', p('Snorlax [Block | Collapse]'))).toBe(false)
		expect(sameProduct('Rellor', p('Ethan\'s Magcargo [Melt Away | Lava Burst]'))).toBe(false)
		expect(sameProduct('Town Store', p('Pidgeot ex [Quick Search | Blustery Wind]'))).toBe(false)
	})
})

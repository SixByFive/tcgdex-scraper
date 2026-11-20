import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }

/**
 * Cardmarket's catalogue of everything that is not a single card (boxes, packs, blisters...), downloaded like the singles one.
 * Its names differ from TCGplayer's ("Booster" for a pack, "Eevee 3-Pack Blister", "10 Elite Trainer Box Case"), so a sealed
 * product is matched by the words of its name, inside the set's Cardmarket expansion, one product to one product.
 */
const URL_ = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json'
const FILE = join('var', 'cardmarket', 'products_nonsingles_6.json')
export interface CmSealed { idProduct: number; name: string; idExpansion: number; dateAdded?: string }

let loaded: CmSealed[] | undefined
export async function loadSealedCatalogue(): Promise<CmSealed[]> {
	if (loaded) return loaded
	let fresh = false
	try { fresh = existsSync(FILE) && Date.now() - (await stat(FILE)).mtimeMs < 24 * 3600 * 1000 } catch {}
	if (!fresh) {
		try {
			const res = await fetch(URL_, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(120000) })
			if (!res.ok) throw new Error(`${res.status}`)
			await mkdir(join('var', 'cardmarket'), { recursive: true })
			await writeFile(FILE, Buffer.from(await res.arrayBuffer()))
		} catch (err) { if (!existsSync(FILE)) throw new Error(`Cardmarket catalogue unreachable (${(err as Error).message}) and none saved`) }
	}
	return (loaded = JSON.parse(await readFile(FILE, 'utf8')).products as CmSealed[])
}

const SYNONYM: Record<string, string> = { single: '1', boosters: 'booster', packs: 'pack', pokemon: '', tins: 'tin', decks: 'deck', pokémon: '' }

/** The words of a product name that say what it is: no set name, no quantities of a case, packs and boosters alike. */
export function tokens(name: string, setName: string): Set<string> {
	let s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
	const half = /\(\s*18 boosters?\s*\)/.test(s)
	s = s.replace(/\([^)]*\)/g, ' ').replace(setName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), ' ')
	const words = s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => SYNONYM[w] ?? w).filter(Boolean)
	const isCase = words.includes('case') || words.includes('display')
	const out = new Set<string>()
	for (const w of words) { if (isCase && /^\d+$/.test(w)) continue; if (w === 'pack' || w === 'exclusive' || w === 'set' || w === 'of') continue; out.add(w) }
	if (half) out.add('half')
	if (/single blister pack/.test(name.toLowerCase())) { out.add('premium'); out.add('checklane') }
	return out
}

const score = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1) }

export interface Wanted { key: string; name: string }
/** want -> Cardmarket id; each Cardmarket product used once, best score first; below 0.6 (or a tie) is left unmatched. */
export function matchSealed(wanted: Wanted[], catalogue: CmSealed[], setName: string, taken: Set<number> = new Set()): { matched: Map<string, number>; unmatched: string[] } {
	const cand = catalogue.filter((c) => !taken.has(c.idProduct)).map((c) => ({ c, t: tokens(c.name, setName), plain: !c.name.includes('(') }))
	const pairs: { key: string; id: number; s: number }[] = []
	for (const w of wanted) {
		const t = tokens(w.name, setName)
		const scored = cand.map((x) => ({ id: x.c.idProduct, s: score(t, x.t) - (x.plain ? 0 : 0.001) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s)
		if (scored.length > 1 && scored[0]!.s === scored[1]!.s) continue // can't tell them apart
		if (scored[0]) pairs.push({ key: w.key, id: scored[0].id, s: scored[0].s })
	}
	const matched = new Map<string, number>(), used = new Set<number>()
	for (const p of pairs.sort((a, b) => b.s - a.s)) if (!used.has(p.id) && !matched.has(p.key)) { matched.set(p.key, p.id); used.add(p.id) }
	return { matched, unmatched: wanted.filter((w) => !matched.has(w.key)).map((w) => w.name) }
}

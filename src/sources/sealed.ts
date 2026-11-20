import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileSafe } from '../util/experimental.ts'
import { loadSealedCatalogue, matchSealed, type CmSealed } from './cardmarket-sealed.ts'
import { featuredCards, loadPromoCards, pickPromo, promoNameFromText, type PromoCard } from './sealed-promos.ts'
import { assignGallery, galleryContentsText, type GalleryProduct } from './pokemon-gallery.ts'
import { fetchSealed } from '../util/tcgtracking-open.ts'

/**
 * Sealed products of one set -> Experimental product files (data/pokemon/intl/products/<set folder>/<id>.ts).
 * TCGTracking lists them with the TCGplayer id and, where matched, Cardmarket and CardTrader ids; the retailer's description says
 * what is inside, so `contents` are parsed from that text and nothing is guessed: a product with no description has no contents.
 * Retailer-exclusive and promo-artwork versions of one product are folded into its variants.
 */
export interface Tracked { id: number; name: string; number?: string | null; ext_data?: { CardText?: string }; cardmarket_id?: number | null; cardtrader_id?: number | null; descFrom?: string }

type Content = { oneOf: string[]; quantity: number } | { product: string; quantity: number } | { card: string; quantity: number } | { item: { en: string }; quantity: number }
type PromoOut = string | { oneOf: string[] } | { name: string }
/** What a product holds, by kind (schemas/product.ts in the Experimental repo). */
export interface ContentsOut {
	boosterPacks?: Record<string, { quantity: number }>
	products?: Record<string, { quantity: number }>
	promos?: PromoOut[]
	items?: { item: { en: string }; quantity: number }[]
}

export interface ProductFile {
	id: string; type: string; name: { en: string }; set: string; releaseDate?: string
	contents?: ContentsOut
	variants: Record<string, unknown>[]
	provenance: { source: string; validation: 'unverified'; limitations?: string[] }
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** The part of a variant's id its promos give; the same as the Experimental repo's promoKey. */
export const promoKey = (promos: PromoOut[] | undefined): string =>
	(promos ?? []).map((p) => (typeof p === 'string' ? p : 'oneOf' in p ? [...p.oneOf].sort().join('+') : slug(p.name))).sort().join('+')
/** A variant's id: its attributes, then its promos; none of either is "standard". */
export const variantKeyOf = (v: Record<string, unknown>): string => [v.exclusive, v.artwork, promoKey((v.contents as ContentsOut | undefined)?.promos)].filter(Boolean).join('-') || 'standard'

/** The lines the description was read into, sorted into the kinds a product's contents have. */
export function toContents(lines: Content[] | undefined, packId: string): ContentsOut | undefined {
	const out: ContentsOut = {}
	for (const c of lines ?? []) {
		if ('product' in c) { const kind = c.product === packId ? 'boosterPacks' : 'products'; (out[kind] ??= {})[c.product] = { quantity: c.quantity } }
		else if ('card' in c) for (let n = 0; n < c.quantity; n++) (out.promos ??= []).push(c.card)
		else if ('oneOf' in c) for (let n = 0; n < c.quantity; n++) (out.promos ??= []).push({ oneOf: c.oneOf })
		else (out.items ??= []).push({ item: c.item, quantity: c.quantity })
	}
	return Object.keys(out).length ? out : undefined
}
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const num = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()])

/** Cases, displays and cartons are logistics units (N of another product), not products of the dataset: the scraper leaves them out. */
export const isCase = (name: string): boolean => /\b(case|cases|display|carton)\b/i.test(name)

export function productType(base: string): string | undefined {
	const b = base.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim()
	if (/art bundle/.test(b)) return 'collection'
	if (/booster bundle/.test(b)) return 'booster-bundle'
	if (/booster box/.test(b)) return 'booster-box'
	if (/booster pack/.test(b)) return 'booster-pack'
	if (/elite trainer box/.test(b)) return 'elite-trainer-box'
	if (/build (&|and) battle/.test(b)) return 'build-and-battle'
	if (/blister/.test(b)) return 'blister'
	if (/\btins?\b/.test(b)) return 'tin'
	if (/fun pack/.test(b)) return 'fun-pack'
	if (/battle deck/.test(b)) return 'battle-deck'
	if (/theme deck|trial deck/.test(b)) return 'theme-deck'
	if (/\b(v|ex|vmax) box\b|hanger box|collector chest|surprise box|partners box|bundle|\bbox\b/.test(b)) return 'collection'
	if (/collection/.test(b)) return /premium/.test(b) ? 'premium-collection' : 'collection'
	return undefined
}

interface Parsed { base: string; artwork?: string; artworkName?: string; exclusive?: 'pokemon-center' }

/** "Obsidian Flames Pokemon Center Elite Trainer Box (Exclusive)" -> base "Elite Trainer Box", exclusive pokemon-center */
export function parseName(name: string, setName: string): Parsed {
	let s = name.startsWith(setName) ? name.slice(setName.length).trim() : name.trim()
	const out: Parsed = { base: '' }
	s = s.replace(/\s*\(Exclusive\)\s*$/i, '')
	if (/^pokemon center /i.test(s)) { out.exclusive = 'pokemon-center'; s = s.replace(/^pokemon center /i, '') }
	const m = s.match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
	if (m) {
		s = m[1]!
		// "[Set of 2]" is a different product, not a version of the blister
		if (/^set of \d+$/i.test(m[2]!)) s = `${s} ${m[2]}`
		else { out.artwork = slug(m[2]!); out.artworkName = m[2]!.trim() }
	}
	// "Single Pack Blister", "Single Blister Pack" and "3 Pack Blister" are the retailer's wording for the same shapes
	s = s.replace(/^[:–-]s*/, '')
	out.base = s.replace(/^Single Blister Pack$/i, 'Single Pack Blister').trim()
	return out
}

/** The bullet lines of a description that say what is inside (what comes before the marketing text). */
export function contentLines(text: string | undefined): string[] {
	if (!text || text === 'undefined') return []
	const head = text.split(/Release Description|Set Configuration|<strong>Set/i)[0]!
	return head.replace(/<\/?(em|strong|b|i)>/gi, '').split(/<br\s*\/?>|\r?\n|•/i).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** Bullets ("• 9 booster packs") and the sentence form ("comes with 1 booster pack, a coin, and a promotional card") are read; marketing text is not. */
export function parseContents(raw: string | undefined, setId: string, have: (id: string) => boolean): Content[] | undefined {
	if (!raw || raw === 'undefined') return undefined
	const out: Content[] = []
	const add = (c: Content) => {
		const same = 'product' in c ? out.find((x) => 'product' in x && x.product === c.product) : undefined
		if (same) { if (same.quantity < c.quantity) same.quantity = c.quantity; return }
		if (!out.some((x) => JSON.stringify(x) === JSON.stringify(c))) out.push(c) }
	const text = raw.split(/Release Description|Set Configuration/i)[0]!.replace(/<\/?(em|strong|b|i)>/gi, ' ')
	const packId = `${setId}-booster-pack`
	const packLine = (n: number) => (have(packId) ? add({ product: packId, quantity: n }) : add({ item: { en: n > 1 ? 'Booster packs' : 'Booster pack' }, quantity: n }))
	let lines = text.split(/<br\s*\/?>|\r?\n/i).map((l) => l.trim()).filter((l) => l.startsWith('•')).map((l) => l.replace(/^•\s*/, '').replace(/\s+/g, ' '))
	if (!lines.length) {
		// a sentence: "Each blister comes with 1 Obsidian Flames booster pack, a coin, and a promotional card of Pawmi."
		const m = text.replace(/\s+/g, ' ').match(/(?:comes with|containing|contains|includes)\s+(.+?)(?:\.\s|\.$|$)/i)
		if (!m) return undefined
		lines = m[1]!.replace(/\s+containing \d+ cards/i, '').split(/,\s*(?:and\s+)?|\s+and\s+/i).map((l) => l.trim()).filter(Boolean)
		if (!lines.some((l) => /booster pack|coin|promo/i.test(l))) return undefined
	}
	for (const line of lines) {
		if (/random cards per pack/i.test(line)) continue
		const pk = line.match(/^(\w+)\s+(?:[A-Za-z0-9é&—’' :-]*?)booster packs?\b/i)
		if (pk && num(pk[1]!)) { packLine(num(pk[1]!)!); continue }
		if (/^(a|an)\s+(?:[A-Za-zé&—’' -]*?)booster pack\b/i.test(line)) { packLine(1); continue }
		if (/^(?:an?\s+|the\s+)?(?:(?:full-art|foil)\s+)*(?:promotional|promo)\b/i.test(line)) { add({ item: { en: 'Promo card' }, quantity: 1 }); continue }
		const q = line.match(/^(\d+)\s+(.*)$/)
		add({ item: { en: (q ? q[2]! : line.replace(/^(an?|the)\s+/i, '')).replace(/[!.]+$/, '').replace(/^./, (c) => c.toUpperCase()) }, quantity: q ? Number(q[1]) : 1 })
	}
	return out.length ? out : undefined
}

export interface BuildResult { files: ProductFile[]; skipped: { id: number; name: string; why: string }[]; cardmarket: { filled: number; conflicts: string[]; unmatched: string[] }; galleryFor: Record<string, string>; galleryUsed: string[]; promos: { linked: string[]; unlinked: string[] }; review: Record<string, ProductReview>; cardNames: Record<string, string> }

/** Where each variant of a product came from, for a person checking it: the names the providers give the ids, and the description the contents were read from. */
export interface ReviewMember { variant: string; tcgplayerId: number; tcgplayerName: string; cardmarketId?: number; cardmarketName?: string; cardmarketHow?: 'TCGTracking' | 'name match'; cardtraderId?: number }
export interface ProductReview { members: ReviewMember[]; description?: string; descriptionFrom?: string }

export function buildProducts(setId: string, setName: string, released: string | undefined, tracked: Tracked[], cm: CmSealed[] = [], promoCards: PromoCard[] = [], gallery: GalleryProduct[] = []): BuildResult {
	const galleryUsed = new Set<string>()
	const galleryFor: Record<string, string> = {}
	const promoLinked: string[] = [], promoUnlinked: string[] = []
	const pfx = setId.replace(/\./g, '-')
	const skipped: BuildResult['skipped'] = []
	const real = tracked.filter((p) => !p.number && !isCase(p.name))
	// an id that is not a product of this set's Cardmarket expansion is another set's (TCGTracking gave Obsidian Flames' Stadium Paradox Rift's)
	if (cm.length) for (const p of real) if (p.cardmarket_id && !cm.some((c) => c.idProduct === p.cardmarket_id)) p.cardmarket_id = null
	const { matched, unmatched } = matchSealed(real.filter((p) => !p.cardmarket_id).map((p) => ({ key: String(p.id), name: p.name })), cm, setName, new Set(real.map((p) => p.cardmarket_id).filter(Boolean) as number[]))
	const conflicts: string[] = []
	let filled = 0
	const filledBy = new Set<number>()
	for (const p of real) {
		const m = matched.get(String(p.id))
		if (m && p.cardmarket_id && p.cardmarket_id !== m) {
			// an id that is not a product of this set's Cardmarket expansion is another set's (TCGTracking gave the Stadium Paradox Rift's)
			if (!cm.some((c) => c.idProduct === p.cardmarket_id)) { conflicts.push(`${p.name}: TCGTracking ${p.cardmarket_id} is not in this expansion; used ${m}`); p.cardmarket_id = m; filledBy.add(p.id) }
			else conflicts.push(`${p.name}: TCGTracking ${p.cardmarket_id}, name match ${m}; kept TCGTracking's`)
		}
		if (m && !p.cardmarket_id) { p.cardmarket_id = m; filled++; filledBy.add(p.id) }
	}
	const groups = new Map<string, { base: string; type: string; members: { p: Tracked; parsed: Parsed }[] }>()
	for (const p of tracked) {
		if (p.number || isCase(p.name)) continue // a numbered product is a card; cases are left out
		const parsed = parseName(p.name, setName)
		const type = productType(parsed.base)
		if (!type) { skipped.push({ id: p.id, name: p.name, why: 'no product type for it' }); continue }
		const key = slug(parsed.base)
		const g = groups.get(key) ?? { base: parsed.base, type, members: [] }
		g.members.push({ p, parsed })
		groups.set(key, g)
	}
	const packArt = new Map<string, number>()
	for (const k of groups.keys()) { const m = k.match(/^((?:sleeved-)?booster-pack)-art-bundle-set-of-(\d+)$/); if (m) packArt.set(m[1]!, Number(m[2])) }
	// pokemon.com's own page for a product, when it has one, says what is inside: it is preferred to the retailers' text
	const pageOf = assignGallery([...groups].map(([key, g]) => ({ key, name: g.base })), setName, gallery)
	const ids = new Set([...groups.keys()].map((k) => `${pfx}-${k}`))
	const files: ProductFile[] = []
	const review: Record<string, ProductReview> = {}
	for (const [key, g] of groups) {
		const id = `${pfx}-${key}`
		const std = g.members.find((m) => !m.parsed.exclusive && !m.parsed.artwork) ?? g.members.find((m) => !m.parsed.exclusive) ?? g.members[0]!
				const page = pageOf.get(key)
		if (page && galleryContentsText(page)) { galleryUsed.add(page.slug); galleryFor[id] = page.slug; std.p.ext_data = { ...std.p.ext_data, CardText: galleryContentsText(page) }; std.p.descFrom = `pokemon.com: ${page.title}` }
		const variants: Record<string, unknown>[] = []
		// a name in brackets is the promo card the version holds (a blister, or anything whose text names a promo): the version is told apart by its promos, not an attribute; else it is a pack or box artwork
		const promoish = g.type === 'blister' || /promo/i.test(std.p.ext_data?.CardText ?? '')
		const priceOf = (p: Tracked) => ({ tcgplayer: p.id, ...(p.cardmarket_id ? { cardmarket: p.cardmarket_id } : {}), ...(p.cardtrader_id ? { cardtrader: p.cardtrader_id } : {}) })
		// "standard" first, then the others in a stable order
		const order = [std, ...g.members.filter((x) => x !== std).sort((a, b) => a.p.id - b.p.id)]
		for (const m of order) {
			const attrs: Record<string, unknown> = {}
			if (m.parsed.exclusive) attrs.exclusive = m.parsed.exclusive
			if (m.parsed.artwork && !promoish) attrs.artwork = m.parsed.artwork
			variants.push({ ...attrs, prices: priceOf(m.p) })
		}
		// the art bundle says how many pack artworks there are ("Set of 4"); the packs are priced as one product, so those variants carry no ids
		for (let k = 0; k < (packArt.get(key) ?? 0); k++) variants.push({ artwork: String.fromCharCode(97 + k) })
			const refOf = (p: Tracked): number | undefined => {
				const c = p.cardmarket_id ? (cm.find((x) => x.idProduct === p.cardmarket_id) as { dateAdded?: string } | undefined) : undefined
				const d = c?.dateAdded ? Date.parse(c.dateAdded.replace(' ', 'T') + 'Z') : released ? Date.parse(released) : undefined
				return d
			}
			const contents = parseContents(std.p.ext_data?.CardText, pfx, (x) => ids.has(x))
			if (promoCards.length && contents && g.members.filter((m) => m.parsed.artworkName).length < 2) {
				// lines that are a card of one named Pokémon ("Foil card featuring Kadabra"): link the card
				for (let i = 0; i < contents.length; i++) {
					const c = contents[i]!
					if (!('item' in c)) continue
					const f = featuredCards(c.item.en)
					if (!f) continue
					if ('direct' in f) { if (promoCards.some((x) => x.id === f.direct)) { contents[i] = { card: f.direct, quantity: c.quantity }; promoLinked.push(`${id} -> ${f.direct}`) } continue }
					if (f.names.length > 1) {
						// a choice: "Zacian V or Zamazenta V" is one of those cards, which the contents say as oneOf
						const picks = f.names.map((n) => pickPromo(n, promoCards, refOf(std.p), std.p.id))
						const one = picks.map((p) => p.id)
						if (one.every(Boolean) && new Set(one).size === one.length) { contents[i] = { oneOf: one as string[], quantity: c.quantity }; promoLinked.push(`${id} -> one of ${one.join(', ')}`) }
						else promoUnlinked.push(`${id}: a choice of ${f.names.join(' / ')}: ${picks.filter((p) => !p.id).map((p) => p.why).join('; ') || 'two names are one card'}`)
						continue
					}
					const pick = pickPromo(f.names[0]!, promoCards, refOf(std.p), std.p.id)
					const got = pick.id ? [pick.id] : pick.ids
					if (got) { contents.splice(i, 1, ...got.map((card) => ({ card, quantity: c.quantity }))); i += got.length - 1; promoLinked.push(`${id} -> ${got.join(', ')}`) }
					else promoUnlinked.push(`${id}: ${pick.why}`)
				}
			}
			const genericPromo = () => contents?.findIndex((c) => 'item' in c && /^promo card$|promo(?:tional)? .*card/i.test(c.item.en)) ?? -1
			const bracketed = promoish ? order.map((m, idx) => ({ m, idx })).filter(({ m }) => m.parsed.artworkName) : []
			if (bracketed.length) {
				// a promo per version: each variant lists its own card (or only the Pokémon's name when the card is not in the dataset)
				for (const { m, idx } of bracketed) {
					const pick = promoCards.length ? pickPromo(m.parsed.artworkName!, promoCards, refOf(m.p), m.p.id) : { why: 'no promo set to look in' }
					const got = pick.id ? [pick.id] : pick.ids
					variants[idx]!.contents = { promos: got ?? [{ name: m.parsed.artworkName! }] }
					if (got) promoLinked.push(`${id} [${m.parsed.artworkName}] -> ${got.join(', ')}`)
					else promoUnlinked.push(`${id} [${m.parsed.artworkName}]: ${pick.why}`)
				}
				const g0 = genericPromo()
				if (contents && g0 >= 0) contents.splice(g0, 1) // every version names its own promo, so the product does not list a generic one
			} else if (promoCards.length && contents) {
				const promoItem = genericPromo()
				if (promoItem >= 0) {
					const name = promoNameFromText(std.p.ext_data?.CardText)
					if (name) {
						const pick = pickPromo(name, promoCards, refOf(std.p), std.p.id)
						const got = pick.id ? [pick.id] : pick.ids
						if (got) { const q = (contents[promoItem] as { quantity: number }).quantity; contents.splice(promoItem, 1, ...got.map((card) => ({ card, quantity: q }))); promoLinked.push(`${id} -> ${got.join(', ')}`) }
						else promoUnlinked.push(`${id}: ${pick.why}`)
					} else promoUnlinked.push(`${id}: the description names no Pokémon for its promo`)
				}
			}
			if (contents) for (let i = contents.length - 1; i >= 0; i--) {
				const c = contents[i]!
				if (!('card' in c) && !('oneOf' in c)) continue
				const same = (x: Content) => ('card' in c && 'card' in x && x.card === c.card) || ('oneOf' in c && 'oneOf' in x && [...x.oneOf].sort().join() === [...c.oneOf].sort().join())
				const j = contents.findIndex((x, k) => k < i && same(x))
				if (j >= 0) { contents[j]!.quantity = Math.max(contents[j]!.quantity, c.quantity); contents.splice(i, 1) }
			}
			const seenVersion = new Set<string>()
			for (let i = 0; i < variants.length; i++) {
				const k = variantKeyOf(variants[i]!)
				if (!seenVersion.has(k)) { seenVersion.add(k); continue }
				const m = order[i]
				if (m) skipped.push({ id: m.p.id, name: m.p.name, why: `the same version as another of ${id} (${k}): left out` })
				variants.splice(i, 1); order.splice(i, 1); i--
			}
			const contentsOut = toContents(contents, `${pfx}-booster-pack`)
			review[id] = {
				descriptionFrom: std.p.descFrom ?? 'TCGTracking',
				description: std.p.ext_data?.CardText && std.p.ext_data.CardText !== 'undefined' ? std.p.ext_data.CardText : undefined,
				members: order.map((m, idx) => {
					const c = m.p.cardmarket_id ? cm.find((x) => x.idProduct === m.p.cardmarket_id) : undefined
					return { variant: variantKeyOf(variants[idx]!), tcgplayerId: m.p.id, tcgplayerName: m.p.name, ...(m.p.cardmarket_id ? { cardmarketId: m.p.cardmarket_id, cardmarketName: c?.name, cardmarketHow: filledBy.has(m.p.id) ? 'name match' as const : 'TCGTracking' as const } : {}), ...(m.p.cardtrader_id ? { cardtraderId: m.p.cardtrader_id } : {}) }
				})
			}
			files.push({
			id, type: g.type, name: { en: `${setName} ${g.base}` }, set: setId, ...(released ? { releaseDate: released } : {}),
			...(contentsOut ? { contents: contentsOut } : {}), variants,
			provenance: { source: 'tcgtracking', validation: 'unverified', limitations: ['contents are read from the retailer description; Cardmarket ids matched by product name; promo cards matched by the Pokémon named in the description and when the promo was listed (unverified)'] }
		})
	}
	return { files, skipped, cardmarket: { filled, conflicts, unmatched: cm.length ? unmatched : [] }, galleryFor, galleryUsed: [...galleryUsed], promos: { linked: promoLinked, unlinked: promoUnlinked }, review, cardNames: Object.fromEntries(promoCards.map((c) => [c.id, c.name])) }
}

// ---- writing -----------------------------------------------------------------------------------------------------

const ts = (v: unknown, depth = 0): string => {
	const pad = '\t'.repeat(depth + 1), end = '\t'.repeat(depth)
	if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad + ts(x, depth + 1)).join(',\n')}\n${end}]` : '[]'
	if (v && typeof v === 'object') {
		const e = Object.entries(v).filter(([, x]) => x !== undefined)
		return `{\n${e.map(([k, x]) => `${pad}${/^[A-Za-z_]\w*$/.test(k) ? k : `'${k}'`}: ${ts(x, depth + 1)}`).join(',\n')}\n${end}}`
	}
	return typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(v)
}
export const productSource = (p: ProductFile) => `import type { Product } from '@schemas/product'\n\nexport default ${ts(p)} satisfies Product\n`

export async function sealedForSet(setId: string, setName: string, group: number, repoIntl: string, opts: { write: boolean; cmExpansion?: number; promoSets?: string[] }): Promise<BuildResult & { dir: string }> {
	const set = await fetchSealed(group)
	const sealed = (set.products as unknown as Tracked[]).filter((p) => !p.number && !/^code card/i.test(p.name))
	const cm = opts.cmExpansion ? (await loadSealedCatalogue()).filter((c) => c.idExpansion === opts.cmExpansion) : []
	const built = buildProducts(setId, setName, set.set_released ?? undefined, sealed, cm, opts.promoSets?.length ? await loadPromoCards(opts.promoSets) : [])
	const dir = join(repoIntl, 'products', fileSafe(setName))
	if (opts.write) {
		await mkdir(dir, { recursive: true })
		for (const f of built.files) await writeFile(join(dir, `${f.id}.ts`), productSource(f), 'utf8')
	}
	return { ...built, dir }
}
void readFile

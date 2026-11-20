import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultRepo, fileSafe, intlDir, listSets } from '../util/experimental.ts'
import { loadSealedCatalogue } from './cardmarket-sealed.ts'
import { buildProducts, productSource, type BuildResult, type ProductFile, type Tracked } from './sealed.ts'
import { loadPromoCards } from './sealed-promos.ts'
import { fetchGroup } from './tcgcsv.ts'

/**
 * One set's sealed products end to end, for the CLI and the UI: the registry says which TCGplayer group and Cardmarket expansion the
 * set has, TCGTracking's list is kept in var/sealed for a few hours, hand-made corrections (registry/product-fixes.json) are applied
 * last, and the result can be written into the Experimental repo.
 */
const FIXES_FILE = join('registry', 'product-fixes.json')
const REGISTRY = join('registry', 'pokemon-intl.json')
const SEALED_TTL_MS = 12 * 3600 * 1000
const PROMO_SET_FOR_SERIES: Record<string, string> = { sv: 'svp', swsh: 'swshp', me: 'mep' }

export interface RegistrySetLite { id: string; series: string; name: string; releaseDate?: string; tcgplayerGroup?: number }
export const registrySets = async (): Promise<RegistrySetLite[]> => {
	const r = JSON.parse(await readFile(REGISTRY, 'utf8'))
	return r.sets ?? r
}

/** A correction a person made after looking at a product; applied on top of what the scraper built. */
export type ProductFix =
	| { set: string; product: string; op: 'exclude'; why?: string }
	| { set: string; product: string; op: 'type'; value: string; why?: string }
	| { set: string; product: string; op: 'name'; value: string; why?: string }
	| { set: string; product: string; op: 'contents'; value: unknown[]; why?: string }
	| { set: string; product: string; op: 'price'; variant: string; provider: 'tcgplayer' | 'cardmarket' | 'cardtrader'; value: number | null; why?: string }

export async function loadFixes(): Promise<ProductFix[]> {
	try { return JSON.parse(await readFile(FIXES_FILE, 'utf8')) } catch { return [] }
}
export async function saveFixes(fixes: ProductFix[]): Promise<void> {
	await mkdir('registry', { recursive: true })
	await writeFile(FIXES_FILE, JSON.stringify(fixes, null, '\t') + '\n')
}
/** The same correction replaces the earlier one for the same product (and variant and provider). */
export const sameFix = (a: ProductFix, b: ProductFix): boolean =>
	a.set === b.set && a.product === b.product && a.op === b.op && (a.op !== 'price' || (b.op === 'price' && a.variant === b.variant && a.provider === b.provider))

export const variantKey = (v: Record<string, unknown>): string => [v.exclusive, v.artwork].filter(Boolean).join('-') || 'standard'

export function applyFixes(files: ProductFile[], fixes: ProductFix[]): { files: ProductFile[]; applied: Record<string, string[]> } {
	const applied: Record<string, string[]> = {}
	const note = (id: string, s: string) => (applied[id] ??= []).push(s)
	const gone = new Set<string>()
	const out = files.map((f) => structuredClone(f))
	for (const fix of fixes) {
		const p = out.find((x) => x.id === fix.product)
		if (!p) continue
		if (fix.op === 'exclude') { gone.add(p.id); note(p.id, 'left out') }
		else if (fix.op === 'type') { p.type = fix.value; note(p.id, `type ${fix.value}`) }
		else if (fix.op === 'name') { p.name = { en: fix.value }; note(p.id, 'name') }
		else if (fix.op === 'contents') { p.contents = fix.value as ProductFile['contents']; note(p.id, 'contents') }
		else if (fix.op === 'price') {
			const v = p.variants.find((x) => variantKey(x) === fix.variant) as { prices?: Record<string, number> } | undefined
			if (!v) continue
			v.prices ??= {}
			if (fix.value === null) delete v.prices[fix.provider]; else v.prices[fix.provider] = fix.value
			note(p.id, `${fix.provider} id (${fix.variant})`)
		}
	}
	// a product that is left out can't be listed in another's contents
	for (const p of out) {
		if (!p.contents) continue
		const before = p.contents.length
		p.contents = p.contents.filter((c) => !('product' in c && gone.has(c.product)))
		if (p.contents.length !== before) note(p.id, 'a line for a product that was left out is dropped')
		if (!p.contents.length) delete p.contents
	}
	return { files: out.filter((p) => !gone.has(p.id)), applied }
}

async function sealedFor(group: number, refresh: boolean): Promise<{ set_released?: string; products: Tracked[]; fetchedAt: string }> {
	const file = join('var', 'sealed', `${group}.json`)
	let fresh = false
	try { fresh = !refresh && existsSync(file) && Date.now() - (await stat(file)).mtimeMs < SEALED_TTL_MS } catch {}
	if (!fresh) {
		const res = await fetch(`https://openapi.tcgtracking.com/v1/3/sets/${group}/sealed`, { headers: { Accept: 'application/json' } })
		if (!res.ok) throw new Error(`TCGTracking sealed list for ${group}: ${res.status}`)
		await mkdir(join('var', 'sealed'), { recursive: true })
		await writeFile(file, Buffer.from(await res.arrayBuffer()))
	}
	const j = JSON.parse(await readFile(file, 'utf8'))
	return { set_released: j.set_released, products: j.products as Tracked[], fetchedAt: (await stat(file)).mtime.toISOString() }
}

export interface SetProducts extends Omit<BuildResult, 'files'> {
	set: RegistrySetLite
	/** what the scraper built, before any correction */
	built: ProductFile[]
	/** after the corrections: what would be written */
	files: ProductFile[]
	applied: Record<string, string[]>
	fixes: ProductFix[]
	fetchedAt: string
	folder: string
	/** product ids already in the Experimental repo for this set */
	inRepo: string[]
}

export async function buildSet(setId: string, opts: { refresh?: boolean; repo?: string } = {}): Promise<SetProducts> {
	const repo = opts.repo ?? defaultRepo
	const set = (await registrySets()).find((s) => s.id === setId)
	if (!set) throw new Error(`${setId} is not in the registry`)
	if (!set.tcgplayerGroup) throw new Error(`${setId} has no TCGplayer group`)
	const sealed = await sealedFor(set.tcgplayerGroup, !!opts.refresh)
	const expansion = (await listSets(repo)).find((s) => s.id === setId)?.prices?.cardmarket
	const cm = expansion ? (await loadSealedCatalogue()).filter((c) => c.idExpansion === expansion) : []
	const promoSet = PROMO_SET_FOR_SERIES[set.series]
	// TCGTracking has no description for most recent products; TCGCSV (TCGplayer's own catalogue) does
	const noText = (p: Tracked) => !p.ext_data?.CardText || p.ext_data.CardText === 'undefined'
	if (sealed.products.some((p) => !p.number && noText(p))) {
		try {
			const csv = await fetchGroup(set.tcgplayerGroup)
			const text = new Map(csv.products.map((p) => [p.productId, ((p as unknown as { extendedData?: { name: string; value: string }[] }).extendedData ?? []).find((e) => e.name === 'CardText')?.value]))
			for (const p of sealed.products) {
				const t = text.get(p.id)
				if (noText(p) && t) { p.ext_data = { ...p.ext_data, CardText: t }; p.descFrom = 'TCGCSV' }
			}
		} catch { /* the page then shows products without a description */ }
	}
	const tracked = sealed.products.filter((p) => !p.number && !/^code card/i.test(p.name))
	const built = buildProducts(setId, set.name, sealed.set_released ?? undefined, tracked, cm, promoSet ? await loadPromoCards([promoSet], setId) : [])
	const fixes = (await loadFixes()).filter((f) => f.set === setId)
	const { files, applied } = applyFixes(built.files, fixes)
	const folder = join(intlDir(repo), 'products', fileSafe(set.name))
	let inRepo: string[] = []
	try { inRepo = (await readdir(folder)).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)) } catch {}
	const { files: builtFiles, ...rest } = built
	return { ...rest, set, built: builtFiles, files, applied, fixes, fetchedAt: sealed.fetchedAt, folder, inRepo }
}

/** Writes the set's products (corrections applied) into the Experimental repo; returns what was written. */
export async function writeSet(r: SetProducts): Promise<string[]> {
	await mkdir(r.folder, { recursive: true })
	for (const f of r.files) await writeFile(join(r.folder, `${f.id}.ts`), productSource(f), 'utf8')
	return r.files.map((f) => f.id)
}

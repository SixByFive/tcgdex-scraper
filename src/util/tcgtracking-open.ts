import type { TCGTrackingProduct, TCGTrackingSkuEntry } from '../pricing/types.ts'

const BASE = 'https://openapi.tcgtracking.com/v1'
export const POKEMON_CATEGORY = 3
export const POKEMON_JAPAN_CATEGORY = 85
/** The category the functions below ask about: Pokémon (3), unless a caller switches it to Pokémon Japan (85) for a while. */
let category = POKEMON_CATEGORY
export const setCategory = (id: number): void => { category = id }

async function getJson<T>(url: string, allow404 = false): Promise<T | null> {
	// connect timeouts (undici's 10 s) come and go; a network error or a 5xx is tried again, a 4xx is not
	let res: Response | undefined
	for (let attempt = 1; ; attempt++) {
		try {
			res = await fetch(url, { headers: { Accept: 'application/json' } })
			if (res.status < 500 || attempt >= 4) break
		} catch (err) {
			if (attempt >= 4) throw err
		}
		await new Promise((r) => setTimeout(r, 1000 * attempt))
	}
	if (res.status === 404 && allow404) return null
	if (!res.ok) throw new Error(`TCGTracking ${url} -> ${res.status} ${res.statusText}`)
	return res.json() as Promise<T>
}

export interface TrackedSetSummary { id: number; name: string; abbreviation: string | null; published_on: string | null; product_count: number }

export async function listPokemonSets(): Promise<TrackedSetSummary[]> {
	const data = await getJson<{ sets: TrackedSetSummary[] }>(`${BASE}/${category}/sets`)
	return (data?.sets ?? []).filter((s) => !s.name.startsWith('[Inactive]'))
}

export interface TrackedSet {
	set_id: number
	set_name: string
	set_abbr: string | null
	set_released: string | null
	products: TCGTrackingProduct[]
}

/** Singles and sealed products of a set, with the Cardmarket and CardTrader ids TCGTracking has matched. */
export async function fetchCards(groupId: number): Promise<TrackedSet> {
	const data = await getJson<TrackedSet>(`${BASE}/${category}/sets/${groupId}/cards`)
	if (!data) throw new Error(`TCGTracking has no set ${groupId}`)
	return data
}

/** Sealed products of a set (boxes, packs, blisters...), with the ids TCGTracking has matched. */
export async function fetchSealed(groupId: number): Promise<TrackedSet> {
	const data = await getJson<TrackedSet>(`${BASE}/${category}/sets/${groupId}/sealed`)
	if (!data) throw new Error(`TCGTracking has no set ${groupId}`)
	return data
}

export async function fetchSetInfo(groupId: number): Promise<Omit<TrackedSet, 'products'> & { product_count: number }> {
	const data = await getJson<any>(`${BASE}/${category}/sets/${groupId}`)
	if (!data) throw new Error(`TCGTracking has no set ${groupId}`)
	return data
}

/** product id -> sku id -> sku, the matrix that says which finishes exist. null when the set has none yet. */
export async function fetchSkus(groupId: number): Promise<Record<string, Record<string, TCGTrackingSkuEntry>> | null> {
	const data = await getJson<{ products: Record<string, Record<string, TCGTrackingSkuEntry>> }>(`${BASE}/${category}/sets/${groupId}/skus`, true)
	return data?.products ?? null
}

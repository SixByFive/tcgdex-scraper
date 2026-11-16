/**
 * What a rebuilt card keeps from the file it replaces.
 *
 * Two things in the Experimental repo come from a source the scraper doesn't have: Latin American Spanish text ("es-mx",
 * pokemon.com is only read in six languages) and `cameoDexIds`. A rebuild that dropped them would be a loss, so they are carried
 * over, but only for the same card and only while the English text is still the same: a translation never moves onto
 * different wording.
 */
const EXTRA_LANGS = ['es-mx'] as const

const plain = (s: unknown) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** An array item of the old card that is the same as `item`: same English name, else the same position. */
function counterpart(item: unknown, index: number, old: unknown[]): unknown {
	const name = isObj(item) && isObj(item.name) ? plain(item.name.en) : ''
	if (name) {
		const byName = old.find((o) => isObj(o) && isObj(o.name) && plain(o.name.en) === name)
		if (byName) return byName
	}
	return old[index]
}

/** Adds to `out` what `existing` had; returns how many values were carried over. */
export function carryOver(out: Record<string, any>, existing: unknown): number {
	if (!isObj(existing) || !isObj(existing.name) || !isObj(out.name) || plain(existing.name.en) !== plain(out.name.en)) return 0
	let carried = 0

	if (Array.isArray(existing.cameoDexIds) && existing.cameoDexIds.length && !out.cameoDexIds) {
		out.cameoDexIds = [...existing.cameoDexIds]
		carried++
	}

	// the Pokédex numbers come from PokeAPI: when that was unreachable the scrape has none, and the file's own are kept
	if (Array.isArray(existing.dexId) && existing.dexId.length && !out.dexId) {
		out.dexId = [...existing.dexId]
		carried++
	}

	// values the page doesn't give for an old card (a retreat cost of 0, the SP suffix) stay as the file had them
	for (const key of ['retreat', 'suffix'] as const) {
		if (existing[key] !== undefined && out[key] === undefined) { out[key] = existing[key]; carried++ }
	}

	const walk = (now: unknown, old: unknown): void => {
		if (Array.isArray(now) && Array.isArray(old)) {
			now.forEach((item, i) => walk(item, counterpart(item, i, old)))
		} else if (isObj(now) && isObj(old)) {
			// a text in several languages: { en, de, fr, ... }
			if (typeof now.en === 'string' && typeof old.en === 'string') {
				if (plain(now.en) !== plain(old.en)) return
				for (const lang of EXTRA_LANGS) {
					if (typeof old[lang] === 'string' && old[lang] && now[lang] === undefined) { now[lang] = old[lang]; carried++ }
				}
				return
			}
			for (const key of Object.keys(now)) if (key in old) walk(now[key], old[key])
		}
	}
	for (const key of Object.keys(out)) if (key !== 'variants' && key !== 'provenance' && key in existing) walk(out[key], existing[key])
	return carried
}

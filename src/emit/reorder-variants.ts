import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { Glob } from 'bun'
import { defaultRepo, loadFormat } from '../util/experimental.ts'

/** The pattern order: Poké Ball, Great Ball, Ultra Ball, Master Ball, then the other patterns (same as sortVariants). */
const FOIL_ORDER = ['pokeball', 'greatball', 'ultraball', 'masterball', 'loveball', 'friendball', 'quickball', 'duskball']
const isPattern = (v: { foil?: string }) => FOIL_ORDER.includes(v.foil ?? '')
const rank = (v: { foil?: string }) => FOIL_ORDER.indexOf(v.foil ?? '')

export interface ReorderOptions {
	repo?: string
	/** only this set id (e.g. "sv08.5"); every Pokémon card file when omitted */
	setId?: string
	apply?: boolean
	log?: (line: string) => void
}

/**
 * Puts the ball-pattern variants of already-written card files in order, in place: only the pattern variants move, and only
 * among the positions pattern variants already hold, so a card's default variant (the first) and every other variant stay
 * where they are. A file is rewritten only when its order is wrong, and only after checking that the data is the same
 * but for that order. Returns the files changed.
 */
export async function reorderVariants(opts: ReorderOptions = {}): Promise<string[]> {
	const log = opts.log ?? console.log
	const repo = opts.repo ?? defaultRepo
	const { renderCard } = await loadFormat(repo)
	const changed: string[] = []
	let scanned = 0

	for await (const rel of new Glob('data/pokemon/*/*/*/*.ts').scan({ cwd: repo, onlyFiles: true })) {
		if (rel.includes('products')) continue
		const file = join(repo, rel)
		const card = (await import(pathToFileURL(file).href + `?t=${Date.now()}`)).default as Record<string, any>
		if (opts.setId && card.set !== opts.setId) continue
		scanned++

		const variants: any[] | undefined = card.variants
		if (!variants || variants.filter(isPattern).length < 2) continue
		const slots = variants.flatMap((v, i) => (isPattern(v) ? [i] : []))
		const sorted = slots.map((i) => variants[i]).sort((a, b) => rank(a) - rank(b)) // Array.sort is stable: equal ranks keep their order
		const next = [...variants]
		slots.forEach((slot, k) => { next[slot] = sorted[k] })
		if (next.every((v, i) => v === variants[i])) continue

		// the data must be identical but for the order of the variants
		const reordered = { ...card, variants: next }
		const sameSet = (a: any[], b: any[]) => a.length === b.length && a.every((x) => b.some((y) => isDeepStrictEqual(x, y)))
		if (!sameSet(variants, next)) throw new Error(`${rel}: reordering would change the data, left alone`)

		changed.push(file)
		if (opts.apply) {
			const previous = existsSync(file) ? await readFile(file, 'utf8') : ''
			await writeFile(file, renderCard(reordered, previous), 'utf8')
		}
	}
	log(`[reorder] ${scanned} card files checked, ${changed.length} ${opts.apply ? 'reordered' : 'would be reordered'}${opts.apply ? '' : ' (pass --apply)'}`)
	return changed
}

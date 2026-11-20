import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import config from '../../config.json' with { type: 'json' }
import type { ScrapedCard } from '../types/scraped.ts'
import { looseName } from './names.ts'
import { normaliseKind } from './normalise.ts'

/**
 * pokemon.com gives an ex/GX/V card that evolves no stage ("Charizard-GX" is just "-GX"), and TCGdex has none for the older ones. The
 * stage follows from what it evolves from: from a Basic it is Stage 1, from a Stage 1 it is Stage 2.
 */
export const stageAfter = (from: string | undefined): 'Stage1' | 'Stage2' | undefined => (from === 'Basic' ? 'Stage1' : from === 'Stage1' ? 'Stage2' : undefined)

let others: Map<string, Set<string>> | undefined

/** Every other scraped set's Pokémon by name -> the stages that name has had: read once, only when a set needs it. */
async function stagesInOtherSets(skipSet?: string): Promise<Map<string, Set<string>>> {
	if (others) return others
	const map = new Map<string, Set<string>>()
	const root = join(config.cacheDir, 'pokemon-com')
	if (existsSync(root)) {
		for (const set of await readdir(root)) {
			if (set === skipSet) continue
			let files: string[]
			try { files = (await readdir(join(root, set))).filter((f) => f.endsWith('.json')) } catch { continue }
			for (const f of files) {
				try {
					const card = JSON.parse(await readFile(join(root, set, f), 'utf8')) as ScrapedCard
					const stage = normaliseKind(card).stage
					const name = card.locales?.en?.name
					if (card.structural?.category === 'Pokemon' && stage && name) (map.get(looseName(name)) ?? map.set(looseName(name), new Set()).get(looseName(name))!).add(stage)
				} catch { /* not a card file */ }
			}
		}
	}
	return (others = map)
}

/**
 * The stage of a card that evolves from `evolvesFrom`: the stage that Pokémon has in the same set, else in any other scraped set
 * (when every printing agrees on it).
 */
export async function evolvedStage(evolvesFrom: string, scraped: ScrapedCard[], setId?: string): Promise<'Stage1' | 'Stage2' | undefined> {
	const want = looseName(evolvesFrom)
	const here = new Set<string>()
	for (const c of scraped) {
		const name = c.locales?.en?.name
		if (name && looseName(name) === want) { const s = normaliseKind(c).stage; if (s) here.add(s) }
	}
	if (here.size === 1) return stageAfter([...here][0])
	if (here.size > 1) return undefined
	const elsewhere = (await stagesInOtherSets(setId)).get(want)
	return elsewhere?.size === 1 ? stageAfter([...elsewhere][0]) : undefined
}

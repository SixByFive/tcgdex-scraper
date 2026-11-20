import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TCGdex's id for one of our set ids: the same, unless the registry gives a `tcgdexId`. The repo calls the Hidden Fates Shiny Vault
 * "sm11.5sv" (like Shining Fates' "swsh4.5sv"); TCGdex calls it "sma".
 */
let ids: Map<string, string> | undefined
export function tcgdexSetId(id: string): string {
	if (!ids) {
		ids = new Map()
		const file = join(process.cwd(), 'registry', 'pokemon-intl.json')
		if (existsSync(file)) {
			try { for (const s of (JSON.parse(readFileSync(file, 'utf8')) as { sets: { id: string; tcgdexId?: string }[] }).sets) if (s.tcgdexId) ids.set(s.id, s.tcgdexId) } catch { /* no usable registry: ids are TCGdex's */ }
		}
	}
	return ids.get(id) ?? id
}

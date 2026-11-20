import { readFile } from 'node:fs/promises'
import { sealedForSet } from './sources/sealed.ts'
import { defaultRepo, intlDir, listSets } from './util/experimental.ts'

/**
 * bun src/sealed-cli.ts <setId|all> [--write]
 * Builds the sealed products of a set (or of every registry set that has a TCGplayer group) from TCGTracking's sealed list.
 * Dry run unless --write; prints what could not be typed.
 */
const [target, ...flags] = process.argv.slice(2)
if (!target) { console.error('usage: bun src/sealed-cli.ts <setId|all> [--write]'); process.exit(1) }
const registry = JSON.parse(await readFile('registry/pokemon-intl.json', 'utf8'))
const sets: { id: string; name: string; tcgplayerGroup?: number }[] = (registry.sets ?? registry).filter((s: any) => target === 'all' || s.id === target)
let total = 0, filled = 0, linked = 0
const report: string[] = ['# Sealed products: promo cards\n']
const promoSetFor: Record<string, string> = { sv: 'svp', swsh: 'swshp', me: 'mep' }
const expansion = new Map((await listSets(defaultRepo)).map((s) => [s.id, s.prices?.cardmarket]))
for (const s of sets) {
	if (!s.tcgplayerGroup) { console.log(`${s.id}: no TCGplayer group`); continue }
	try {
		const r = await sealedForSet(s.id, s.name, s.tcgplayerGroup, intlDir(defaultRepo), { write: flags.includes('--write'), cmExpansion: expansion.get(s.id), promoSets: promoSetFor[(s as any).series] ? [promoSetFor[(s as any).series]!] : [] })
		total += r.files.length; filled += r.cardmarket.filled; linked += r.promos.linked.length
		if (r.promos.unlinked.length) report.push(`## ${s.id}\n`, ...r.promos.unlinked.map((x) => `- ${x}`), '')
		for (const x of r.cardmarket.conflicts) console.log(`  CONFLICT ${x}`)
		if (flags.includes('--unmatched')) for (const x of r.cardmarket.unmatched) console.log(`  unmatched ${x}`)
		console.log(`${s.id}: ${r.files.length} products${r.skipped.length ? `; not typed: ${r.skipped.map((x) => x.name).join(', ')}` : ''}`)
	} catch (err) { console.log(`${s.id}: ${(err as Error).message}`) }
}
await (await import('node:fs/promises')).writeFile('reports/sealed-promos.md', report.join('\n'))
console.log(`${total} products; ${filled} Cardmarket ids filled; ${linked} promo cards linked`)

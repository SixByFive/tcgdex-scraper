import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import config from '../../config.json' with { type: 'json' }

const CardmarketExport = z.object({
	meta: z.object({ groupKey: z.string() }),
	byCardId: z.record(z.string(), z.object({
		cardId: z.string(),
		ids: z.object({
			base: z.array(z.number()),
			additional: z.array(z.number())
		}),
		cardmarketProducts: z.array(z.object({
			productId: z.number(),
			name: z.string(),
			variantLabel: z.string(),
			bucket: z.enum(['base', 'additional'])
		}))
	}))
})

export type CardmarketImportedCard = {
	localId: string
	productIds: Array<{ id: number; bucket: 'base' | 'additional'; name: string; label: string }>
}

export async function importCardmarket(setId: string, jsonPath: string) {
	const raw = JSON.parse(await readFile(jsonPath, 'utf8'))
	const parsed = CardmarketExport.parse(raw)

	const cards: CardmarketImportedCard[] = Object.values(parsed.byCardId).map((c) => ({
		localId: c.cardId.split('-').pop()!.replace(/^0+/, '') || '0',
		productIds: c.cardmarketProducts.map((p) => ({
			id: p.productId,
			bucket: p.bucket,
			name: p.name,
			label: p.variantLabel
		}))
	}))

	const outPath = join(config.cardmarketDir, `${setId}.normalized.json`)
	await mkdir(config.cardmarketDir, { recursive: true })
	await writeFile(outPath, JSON.stringify({ setId, cards }, null, 2))

	const ambiguous = cards.filter((c) => c.productIds.length > 1)
	if (ambiguous.length) {
		const reviewPath = join(config.reviewDir, `${setId}-cardmarket.json`)
		await mkdir(config.reviewDir, { recursive: true })
		await writeFile(reviewPath, JSON.stringify({
			setId,
			instructions: 'For each card, set `variantType` on each productId entry. Valid: normal | reverse | holo | reverse-holo | stamp:<name> | foil:<name>',
			cards: ambiguous.map((c) => ({
				localId: c.localId,
				productIds: c.productIds.map((p) => ({ ...p, variantType: null }))
			}))
		}, null, 2))
		console.log(`${ambiguous.length} ambiguous cards → ${reviewPath}`)
	}
	console.log(`Imported ${cards.length} cards → ${outPath}`)
}
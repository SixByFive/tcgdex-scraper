import * as cheerio from 'cheerio'
import pLimit from 'p-limit'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getCached, closeBrowser } from '../util/fetch.ts'
import type { EnergyTypes, Lang, ScrapedCard, ScrapedLocaleBlock, ScrapedStructural } from '../types/scraped.ts'
import config from '../../config.json' with { type: 'json' }

const LANGS: Lang[] = ['en', 'de', 'fr', 'it', 'es', 'pt']

function urlFor(lang: Lang, slug: string, n: number): string {
	const l = (config.locales as Record<Lang, { host: string; cardPath: string }>)[lang]
	return l.host + l.cardPath.replace('{slug}', slug).replace('{n}', String(n))
}

function energyFromLi($: cheerio.CheerioAPI, li: any): EnergyTypes | null {
    const $li = $(li)
    const fromData = $li.find('a[data-energy-type]').first().attr('data-energy-type')
    if (fromData) return fromData.trim() as EnergyTypes
    const iClass = $li.find('i.energy').first().attr('class') || ''
    const m = iClass.match(/icon-(\w+)/)
    if (m && m[1]) return (m[1].charAt(0).toLocaleUpperCase() + m[1].slice(1)) as EnergyTypes
    return null
}

function parseStage(h2: string): { category: 'Pokemon' | 'Trainer' | 'Energy'; stage: string | null; trainerSubtype: string | null } {
	const s = h2.trim()
	if (/Basic Pokémon/i.test(s)) return { category: 'Pokemon', stage: 'Basic', trainerSubtype: null }
	if (/Stage 1 Pokémon/i.test(s)) return { category: 'Pokemon', stage: 'Stage1', trainerSubtype: null }
	if (/Stage 2 Pokémon/i.test(s)) return { category: 'Pokemon', stage: 'Stage2', trainerSubtype: null }

	if (/VMAX/i.test(s)) return { category: 'Pokemon', stage: 'VMAX', trainerSubtype: null }
	if (/VSTAR/i.test(s)) return { category: 'Pokemon', stage: 'VSTAR', trainerSubtype: null }
	if (/Mega/i.test(s) && /Pokémon/i.test(s)) return { category: 'Pokemon', stage: 'Mega', trainerSubtype: null }

	if (/^Pokémon Tool$/i.test(s)) return { category: 'Trainer', stage: null, trainerSubtype: 'Tool' }
	const trainerMatch = s.match(/^Trainer-(.+)$/i)
	if (trainerMatch) return { category: 'Trainer', stage: null, trainerSubtype: trainerMatch[1]!.trim() }
	if (/Special Energy/i.test(s)) return { category: 'Energy', stage: null, trainerSubtype: 'Special' }
	if (/Basic .* Energy|Basic Energy/i.test(s)) return { category: 'Energy', stage: null, trainerSubtype: 'Normal' }

	if (/Pokémon/i.test(s)) return { category: 'Pokemon', stage: s.replace(/\s*Pokémon\s*/i, '').trim() || 'Basic', trainerSubtype: null }

	return { category: 'Trainer', stage: null, trainerSubtype: s }
}

// we don't need the strict type here — we only wrap the element in $().
function parseAbilityBlock($: cheerio.CheerioAPI, el: any): ScrapedLocaleBlock['abilities'][number] {
	const $el = $(el)
	const cost: EnergyTypes[] = $el.find('ul.left > li').toArray()
		.map((li) => energyFromLi($, li))
		.filter((t): t is EnergyTypes => t !== null && t !== 'Free')
	const name = $el.find('h4.left.label').text().trim() || null
	const damage = $el.find('span.right.plus').text().trim() || null
	const effect = $el.find('pre p').text().trim() || null

	let kind: 'attack' | 'ability' | 'rule' = 'attack'
	if (cost.length === 0 && !damage) {
		kind = name ? 'ability' : 'rule'
	}
	return { kind, cost, name, damage, effect }
}

function parseLocale(html: string): { structural: Partial<ScrapedStructural>; locale: ScrapedLocaleBlock; imageUrl: string | null } {
	const $ = cheerio.load(html)
	const fci = $('.full-card-information').first()

	const name = fci.find('.card-description h1').first().text().trim() || null
	const stageH2 = fci.find('.card-description .card-type h2').first().text().trim()
	const { category, stage, trainerSubtype } = parseStage(stageH2)

	const hpText = fci.find('.card-hp').first().text().replace(/HP/i, '').trim()
	const hp = hpText ? Number(hpText) : null

	const types: EnergyTypes[] = fci.find('.card-description .right i.energy').toArray()
		.map((e) => {
			const cls = $(e).attr('class') || ''
			const m = cls.match(/icon-(\w+)/)
			return m && m[1] ? (m[1].charAt(0).toUpperCase() + m[1].slice(1)) as EnergyTypes : null
		})
		.filter((t): t is EnergyTypes => t !== null)

	const evolvesFromName = fci.find('.card-description .card-type h4 a').first().text().trim() || null

	const abilities: ScrapedLocaleBlock['abilities'] = fci.find('.pokemon-abilities > .ability').toArray()
		.map((el) => parseAbilityBlock($, el))

		const weaknesses = fci.find('.pokemon-stats .stat').toArray().flatMap((stat) => {
		const $stat = $(stat)
		if (!/Weakness/i.test($stat.find('h4').text())) return []
		return $stat.find('ul.card-energies > li').toArray().flatMap((li) => {
			const type = energyFromLi($, li)
			if (!type) return []
			const value = ($(li).text().match(/[×x]\s*\d+/)?.[0] || '').trim()
			return [{ type, value: value || '×2' }]
		})
	})
	const resistances = fci.find('.pokemon-stats .stat').toArray().flatMap((stat) => {
		const $stat = $(stat)
		if (!/Resistance/i.test($stat.find('h4').text())) return []
		return $stat.find('ul.card-energies > li').toArray().flatMap((li) => {
			const type = energyFromLi($, li)
			if (!type) return []
			const value = ($(li).text().match(/-\s*\d+/)?.[0] || '-30').trim()
			return [{ type, value }]
		})
	})

	const retreat = fci.find('.pokemon-stats .stat.last ul.card-energies > li').length || null

	const footer = fci.find('.stats-footer span').first().text().trim()
	const footerParts = footer.split(/\s+/, 2)
	const numTotal = footerParts[0] ?? ''
	const rarity = footerParts[1] ?? null

	const numParts = numTotal.split('/')
	const number = Number(numParts[0])
	const total = Number(numParts[1])

	const expansionSetCode = (fci.find('.expansion i').attr('class') || '')
		.match(/icon-([a-z0-9]+)-expansion-symbol/)?.[1] ?? null

	const illustrator = $('.illustrator a').first().text().trim() || null

	const imageUrl = $('.card-image img').attr('src')
		|| $('main img').first().attr('src')
		|| null

	return {
		structural: {
			number: Number.isFinite(number) ? number : undefined,
			total: Number.isFinite(total) ? total : undefined,
			rarity,
			hp,
			types,
			stage,
			category,
			trainerSubtype,
			retreat,
			weaknesses,
			resistances,
			illustrator,
			expansionSetCode
		},
		locale: { name, evolvesFromName, abilities },
		imageUrl
	}
}

export async function scrapeSet(slug: string, opts: { serie: string; setId: string }) {
	const limit = pLimit(config.concurrency ?? 3)

	console.log(`[pokemon.com] discovering card count via ${slug}/1`)
	const firstHtml = await getCached(urlFor('en', slug, 1))
	const first = parseLocale(firstHtml)
	const total = first.structural.total
	if (!total || !Number.isFinite(total)) throw new Error(`Could not discover total card count from ${slug}/1`)
	console.log(`[pokemon.com] total = ${total}`)

	const outDir = join(config.cacheDir, 'pokemon-com', opts.setId)
	await mkdir(outDir, { recursive: true })

	const tasks: Promise<void>[] = []
	for (let n = 1; n <= total; n++) {
		tasks.push(limit(async () => {
			const localeBlocks: Partial<Record<Lang, ScrapedLocaleBlock>> = {}
			const imageUrls: Partial<Record<Lang, string>> = {}
			let structural: ScrapedStructural | null = null

			for (const lang of LANGS) {
				let html: string
				try {
					html = await getCached(urlFor(lang, slug, n))
				} catch (err) {
					console.warn(`[${lang}] ${slug}/${n} failed: ${(err as Error).message}`)
					continue
				}
				const parsed = parseLocale(html)
				localeBlocks[lang] = parsed.locale
				if (parsed.imageUrl) imageUrls[lang] = parsed.imageUrl
				if (lang === 'en') {
					structural = {
						localId: String(n),
						number: parsed.structural.number ?? n,
						total: parsed.structural.total ?? total,
						rarity: parsed.structural.rarity ?? null,
						hp: parsed.structural.hp ?? null,
						types: parsed.structural.types ?? [],
						stage: parsed.structural.stage ?? null,
						category: parsed.structural.category ?? 'Pokemon',
						trainerSubtype: parsed.structural.trainerSubtype ?? null,
						evolvesFromKey: parsed.locale.evolvesFromName ?? null,
						retreat: parsed.structural.retreat ?? null,
						weaknesses: parsed.structural.weaknesses ?? [],
						resistances: parsed.structural.resistances ?? [],
						illustrator: parsed.structural.illustrator ?? null,
						expansionSetCode: parsed.structural.expansionSetCode ?? null,
						imageUrls: {}
					}
				}
			}
			if (!structural) {
				console.warn(`[pokemon.com] skipping ${slug}/${n}: no EN page`)
				return
			}
			structural.imageUrls = imageUrls

			const card: ScrapedCard = {
				scrapedAt: new Date().toISOString(),
				sourceSlug: slug,
				structural,
				locales: localeBlocks
			}
			await writeFile(join(outDir, `${String(n).padStart(3, '0')}.json`), JSON.stringify(card, null, 2))
			if (n % 10 === 0) console.log(`[pokemon.com] ${n}/${total}`)
		}))
	}
	try {
		await Promise.all(tasks)
		console.log(`[pokemon.com] done → ${outDir}`)
	} finally {
		await closeBrowser()
	}
}
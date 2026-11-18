import * as cheerio from 'cheerio'
import pLimit from 'p-limit'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getCached, getListingKeys, closeBrowser, readCachedOnly } from '../util/fetch.ts'
import type { EnergyTypes, Lang, ScrapedCard, ScrapedLocaleBlock, ScrapedStructural } from '../types/scraped.ts'
import config from '../../config.json' with { type: 'json' }

const LANGS: Lang[] = ['en', 'de', 'fr', 'it', 'es', 'pt']

function urlFor(lang: Lang, slug: string, key: string | number): string {
	const l = (config.locales as Record<Lang, { host: string; cardPath: string }>)[lang]
	return l.host + l.cardPath.replace('{slug}', slug).replace('{n}', String(key))
}

/**
 * How a set numbers its cards in its URLs: plain numbers ("/sv8pt5/1/") or a prefix with fixed digits ("/swsh12tg/TG01/",
 * "/swsh45sv/SV001/"). Read from the first links of the set's search listing; plain numbers when it can't be read.
 */
async function keyStyle(slug: string): Promise<(n: number) => string> {
	try {
		const keys = await getListingKeys(`https://www.pokemon.com/uk/pokemon-tcg/pokemon-cards/?${slug}=on`)
		const m = keys[0]?.match(/^([A-Za-z]+)(\d+)$/)
		if (m) { const [, prefix, digits] = m; console.log(`[pokemon.com] ${slug}: cards are numbered ${keys[0]}, ... (prefix ${prefix})`); return (n) => prefix + String(n).padStart(digits!.length, '0') }
	} catch (err) {
		console.warn(`[pokemon.com] ${slug}: could not read the card listing (${(err as Error).message}); assuming plain numbers`)
	}
	return (n) => String(n)
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
	if (/^Mega Evolution/i.test(s)) return { category: 'Pokemon', stage: 'Mega', trainerSubtype: null }
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
	let name = $el.find('h4.left.label').text().trim() || null
	const damage = $el.find('span.right.plus').text().trim() || null
	let effect = $el.find('pre p').text().trim() || null

	// An Ability has its own markup: <h3><div class="poke-ability">Ability</div><div>Scale Up</div></h3><p>effect</p>
	const abilityHead = $el.find('h3 .poke-ability').first()
	if (abilityHead.length && !name) {
		name = abilityHead.parent().children().not('.poke-ability').first().text().trim() || null
		// the paragraphs can sit in a wrapper (a VSTAR Power is inside div.vstar-power)
		effect = $el.find('p').toArray().map((p) => $(p).text().trim()).filter(Boolean).join('\n') || null
		return { kind: name ? 'ability' : 'rule', cost: [], name, damage: null, effect }
	}

	let kind: 'attack' | 'ability' | 'rule' = 'attack'
	if (cost.length === 0 && !damage) {
		kind = name ? 'ability' : 'rule'
	}
	return { kind, cost, name, damage, effect }
}

export function parseLocale(html: string): { structural: Partial<ScrapedStructural>; locale: ScrapedLocaleBlock; imageUrl: string | null } {
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

	// a Pokémon with no retreat cost still has the stat, with an empty list: that is 0, not "unknown"
	const retreatStat = fci.find('.pokemon-stats .stat.last')
	const retreat = retreatStat.length ? retreatStat.find('ul.card-energies > li').length : null

	const footer = fci.find('.stats-footer span').first().text().trim()
	// "005/197 Double Rare": the first word is the number, everything after it is the rarity (it can be several words)
	const footerMatch = footer.match(/^(\S+)\s*(.*)$/s)
	const numTotal = footerMatch?.[1] ?? ''
	const rarity = footerMatch?.[2]?.trim() || null

	const numParts = numTotal.split('/')
	const number = Number(numParts[0])
	const total = Number(numParts[1])

	const expansionSetCode = (fci.find('.expansion i').attr('class') || '')
		.match(/icon-([a-z0-9]+)-expansion-symbol/)?.[1] ?? null

	const illustrator = $('.illustrator a').first().text().trim() || null

    const pokedexSlug = $('a[href*="/pokedex/"]').first().attr('href')
		?.match(/\/pokedex\/([^/?#]+)/)?.[1] ?? null

	const imageUrl = $('.card-image img').attr('src')
		|| $('main img').first().attr('src')
		|| null

	return {
		structural: {
			number: Number.isFinite(number) ? number : undefined,
			printedNumber: numParts[0]?.trim() || null,
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
			expansionSetCode,
            pokedexSlug
		},
		locale: { name, evolvesFromName, abilities },
		imageUrl
	}
}

/**
 * Parses the pages already on disk again, without the network, and refreshes what the parser got wrong or learned since:
 * the abilities of every language and the retreat cost. Everything else in the scraped cards (dex ids, variants, TCGdex data)
 * stays as it is. Run `enrich-scraped` and `emit-experimental` afterwards to carry the change into the files.
 */
export async function reparseSet(slug: string, setId: string): Promise<{ cards: number; changed: number; missingPages: number }> {
	const keyFor = await keyStyle(slug)
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	let changed = 0, missingPages = 0, cards = 0
	for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
		const file = join(dir, f)
		const card = JSON.parse(await readFile(file, 'utf8')) as ScrapedCard
		const n = Number(card.structural.localId)
		const before = JSON.stringify([card.structural.retreat, Object.values(card.locales).map((l) => l?.abilities)])
		for (const lang of Object.keys(card.locales) as Lang[]) {
			const html = await readCachedOnly(urlFor(lang, slug, keyFor(n)))
			if (!html) { missingPages++; continue }
			const parsed = parseLocale(html)
			card.locales[lang]!.abilities = parsed.locale.abilities
			if (lang === 'en') card.structural.retreat = parsed.structural.retreat ?? null
		}
		cards++
		if (JSON.stringify([card.structural.retreat, Object.values(card.locales).map((l) => l?.abilities)]) !== before) {
			changed++
			await writeFile(file, JSON.stringify(card, null, 2))
		}
	}
	return { cards, changed, missingPages }
}

export async function scrapeSet(slug: string, opts: { serie: string; setId: string; enrich?: boolean; tcgplayerSet?: number; repo?: string; count?: number }) {
	const limit = pLimit(config.concurrency ?? 3)

	const keyFor = await keyStyle(slug)

	// the official count: printed on every card ("67/131") but not on gallery cards, so it can also come from --count
	let total = 0
	try {
		console.log(`[pokemon.com] discovering card count via ${slug}/${keyFor(1)}`)
		total = parseLocale(await getCached(urlFor('en', slug, keyFor(1)))).structural.total ?? 0
	} catch (err) {
		if (!opts.count) throw new Error(`Could not read ${slug}/${keyFor(1)}: ${(err as Error).message}`)
	}
	// a set whose pages print no usable total (SVP prints none) is scraped up to the registry's count, so holes in pokemon.com's numbering can't end it early
	if (total < 2 && !opts.count) {
		try {
			const { loadRegistry } = await import('../registry/build.ts')
			const s = (await loadRegistry()).sets.find((x) => x.id === opts.setId)
			const expected = s?.total ?? s?.official
			if (expected && expected > 1) { opts = { ...opts, count: expected }; console.log(`[pokemon.com] ${slug}: no printed total, using the registry's ${expected}`) }
		} catch {}
	}
	if (!total && !opts.count) console.log('[pokemon.com] no printed total: scraping until pokemon.com runs out of cards')
	else console.log(`[pokemon.com] total = ${total || opts.count}`)

	const outDir = join(config.cacheDir, 'pokemon-com', opts.setId)
	await mkdir(outDir, { recursive: true })

	// one card in every language; 'missing' when pokemon.com has no such number (the end of the set)
	const scrapeCard = async (n: number): Promise<'ok' | 'missing' | 'error'> => {
		const localeBlocks: Partial<Record<Lang, ScrapedLocaleBlock>> = {}
		const imageUrls: Partial<Record<Lang, string>> = {}
		const absentLangs: Lang[] = []
		const failedLangs: Lang[] = []
		let structural: ScrapedStructural | null = null

		for (const lang of LANGS) {
			let html: string
			try {
				html = await getCached(urlFor(lang, slug, keyFor(n)))
			} catch (err) {
				const msg = (err as Error).message
				if (lang === 'en') {
					if (/^404\b/.test(msg)) return 'missing'
					console.warn(`[en] ${slug}/${n} failed: ${msg}`)
					return 'error'
				}
				if (/^404\b/.test(msg)) absentLangs.push(lang)
				else { failedLangs.push(lang); console.warn(`[${lang}] ${slug}/${n} failed: ${msg}`) }
				continue
			}
			const parsed = parseLocale(html)
			localeBlocks[lang] = parsed.locale
			if (parsed.imageUrl) imageUrls[lang] = parsed.imageUrl
			if (lang === 'en') {
				structural = {
					localId: String(n),
                        pokedexSlug: parsed.structural.pokedexSlug ?? null,
                        dexIds: [],
					number: parsed.structural.number ?? n,
					printedNumber: parsed.structural.printedNumber ?? null,
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
			return 'error'
		}
		structural.imageUrls = imageUrls

		const card: ScrapedCard = {
			scrapedAt: new Date().toISOString(),
			sourceSlug: slug,
			structural,
			locales: localeBlocks,
			absentLangs,
			failedLangs
		}
		await writeFile(join(outDir, `${String(n).padStart(3, '0')}.json`), JSON.stringify(card, null, 2))
		if (n % 10 === 0) console.log(`[pokemon.com] ${n}/${total || opts.count || '?'}`)
		return 'ok'
	}

	// The number on a card ("67/131") is the official count. Secret rares are numbered past it (132-180 in Prismatic
	// Evolutions) and have pages too, so keep going until pokemon.com runs out of cards, or stop at --count.
	const official = total
	const limitTo = opts.count && opts.count > 0 ? opts.count : undefined
	const tasks: Promise<unknown>[] = []
	for (let n = 1; n <= (limitTo ?? official); n++) tasks.push(limit(() => scrapeCard(n)))
	try {
		await Promise.all(tasks)
		if (!limitTo) {
			const step = config.concurrency ?? 3
			// pokemon.com has holes (SVP has no page 31 but has 32 onwards), so one missing page isn't the end of the set:
			// the end is GAP_END missing pages in a row
			const GAP_END = 10
			let n = official + 1, found = 0, missingRun = 0, stopped: 'missing' | 'error' | null = null
			while (!stopped) {
				const batch = await Promise.all(Array.from({ length: step }, (_, i) => limit(() => scrapeCard(n + i))))
				for (const r of batch) {
					if (stopped) break
					if (r === 'ok') { found++; missingRun = 0 }
					else if (r === 'missing') { if (++missingRun >= GAP_END) stopped = 'missing' }
					else stopped = r
				}
				n += step
			}
			console.log(`[pokemon.com] ${found} cards beyond the official ${official} (secret rares and so on)`)
			if (stopped === 'error') console.warn('[pokemon.com] stopped early on an error (see above), not at the end of the set: run the same command again to continue, or pass --count <n>')
		}
		console.log(`[pokemon.com] done → ${outDir}`)
	} finally {
		await closeBrowser()
	}

	// numbers pokemon.com has no page for (a hole in its numbering) are filled in from TCGdex when it has the card
	const expected = opts.count ?? (total > 1 ? total : 0)
	if (expected > 1) {
		try {
			const have = new Set((await readdir(outDir)).filter((f) => f.endsWith('.json')).map((f) => Number(f.replace('.json', ''))))
			const holes = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !have.has(n))
			if (holes.length) {
				console.log(`[pokemon.com] ${holes.length} of ${expected} cards have no page: looking for them on TCGdex`)
				const { fillFromTcgdex } = await import('./tcgdex-fallback.ts')
				await fillFromTcgdex(opts.setId, { only: holes })
			}
		} catch (err) {
			console.warn(`[pokemon.com] could not fill the missing cards from TCGdex: ${(err as Error).message}`)
		}
	}

    // the Pokédex numbers come from PokeAPI; if it can't be reached the scrape is still good and the enrich below goes on
    try {
        const { resolvePokedex } = await import('./pokedex.ts')
        await resolvePokedex(opts.setId)
    } catch (err) {
        console.warn(`[pokedex] failed (${(err as Error).message}); run \`pokedex ${opts.setId}\` to retry`)
    }

    // variants + Cardmarket/TCGplayer/CardTrader ids and TCGdex flavor text / regulation marks are stored with the scrape,
    // so `emit-experimental` only has to write files. A failure here does not undo the scrape: re-run `enrich-scraped`.
    if (opts.enrich !== false) {
        try {
            const { enrichScrapedSet } = await import('./enrich-scraped.ts')
            await enrichScrapedSet({ setId: opts.setId, tcgplayerSet: opts.tcgplayerSet, repo: opts.repo })
        } catch (err) {
            console.warn(`[enrich] failed (${(err as Error).message}); run \`enrich-scraped ${opts.setId}\` to retry`)
        }
    }
}
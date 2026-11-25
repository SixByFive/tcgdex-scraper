import { Command } from "commander";

const program = new Command() 
    .name('tcgdex-scraper')
    .description('Scrape a new set into tcgdex .ts files')
    .version('0.1.0')

const scrape = program.command('scrape')
scrape
	.command('set <pokemonComSlug>')
	.requiredOption('--serie <serieId>', 'tcgdex Serie id, e.g. sv')
	.requiredOption('--set <setId>', 'tcgdex Set id, e.g. sv11')
	.option('--count <n>', 'scrape exactly cards 1..n instead of going on past the official count until pokemon.com has no more', (v) => Number(v))
	.option('--no-enrich', 'do not fetch variants/provider ids and TCGdex extras after scraping')
	.option('--tcgplayer-set <id>', 'TCGplayer group id (found by name when omitted)', (v) => Number(v))
	.option('--repo <path>', 'Experimental repo path (used to find the set and its schema)')
	.option('--fresh', 'ignore the cache: download every page again and replace the cached copy')
	.action(async (slug, opts) => {
		if (opts.fresh) (await import('./util/fetch.ts')).setFresh(true)
		const { scrapeSet } = await import('./sources/pokemon-com.ts')
		await scrapeSet(slug, { serie: opts.serie, setId: opts.set, enrich: opts.enrich !== false, tcgplayerSet: opts.tcgplayerSet, repo: opts.repo, count: opts.count })
		// nothing should keep the process alive after a scrape (a leaked browser used to); make sure it ends
		process.exit(0)
	})

const scrapeNotOnPokemonCom = async (setId: string, opts: { only?: string; tcgplayerSet?: number; repo?: string; enrich?: boolean }) => {
	const { loadRegistry } = await import('./registry/build.ts')
	const set = (await loadRegistry()).sets.find((s) => s.id === setId)
	if (opts.only || !set) {
		const { fillFromTcgdex } = await import('./sources/tcgdex-fallback.ts')
		await fillFromTcgdex(setId, { only: opts.only ? String(opts.only).split(',').map(Number) : undefined, lettered: (await loadRegistry()).sets.find((s) => s.id === setId)?.letteredIds })
	} else await (await import('./sources/tcgcsv-cards.ts')).fillRegistrySet(set)
	if (opts.enrich !== false) {
		const { enrichScrapedSet } = await import('./sources/enrich-scraped.ts')
		await enrichScrapedSet({ setId, repo: opts.repo, tcgplayerSet: opts.tcgplayerSet ?? set?.tcgplayerGroup ?? undefined })
	}
	process.exit(0)
}
scrape
	.command('tcgcsv <setId>')
	.description("Build the cards of a set neither pokemon.com nor TCGdex has (Radiant Collection) from TCGplayer's catalogue (TCGCSV)")
	.option('--tcgplayer-set <id>', 'TCGplayer group id', (v) => Number(v))
	.option('--repo <path>', 'Experimental repo path')
	.option('--no-enrich', 'do not fetch variants/provider ids after')
	.action((setId, opts) => scrapeNotOnPokemonCom(setId, opts))

scrape
	.command('tcgdex <setId>')
	.description("Build the cards of a set pokemon.com doesn't have (or the numbers it skips) from the TCGdex API, topped up from TCGCSV where the registry says so")
	.option('--only <numbers>', 'only these card numbers, comma separated (default: every card not scraped yet)')
	.option('--tcgplayer-set <id>', 'TCGplayer group id', (v) => Number(v))
	.option('--repo <path>', 'Experimental repo path')
	.option('--no-enrich', 'do not fetch variants/provider ids after')
	.action((setId, opts) => scrapeNotOnPokemonCom(setId, opts))

program
	.command('crosscheck <setIds...>')
	.description('Compare scraped sets with the repo and TCGTracking and list every disagreement (changes nothing)')
	.option('--repo <path>', 'Experimental repo path')
	.action(async (setIds: string[], opts) => {
		const { loadRegistry } = await import('./registry/build.ts')
		const { crossCheckSet } = await import('./sources/crosscheck.ts')
		const { defaultRepo } = await import('./util/experimental.ts')
		const registry = await loadRegistry()
		for (const id of setIds) {
			const set = registry.sets.find((s) => s.id === id)
			const r = await crossCheckSet(id, opts.repo ?? defaultRepo, set?.tcgplayerGroup ?? undefined, set?.name)
			console.log(`[crosscheck] ${id}: ${r.checked} cards (${r.tcgdexOnly} from TCGdex alone), ${r.disagreements.length} disagreements`)
			for (const d of r.disagreements.slice(0, 40)) console.log(`  ${d.card} ${d.field}: scraped ${JSON.stringify(d.scraped)} vs ${JSON.stringify(d.other)} [${d.against}]`)
			if (r.disagreements.length > 40) console.log(`  ... and ${r.disagreements.length - 40} more`)
			if (r.pokedata) {
				console.log(`[crosscheck] ${id}: PokeData has ${r.pokedata.entries} entries; ${r.pokedata.missingIds.length} of its TCGplayer ids are on none of our variants (candidates, not errors)`)
				for (const d of r.pokedata.missingIds.slice(0, 20)) console.log(`  ${d.card}: ${d.other}`)
			} else console.log(`[crosscheck] ${id}: no PokeData set found, not compared with it`)
		}
		process.exit(0)
	})

program
	.command('reparse <setIds...>')
	.description('Parse the cached pokemon.com pages of scraped sets again (no network) to refresh abilities and retreat costs')
	.action(async (setIds: string[]) => {
		const { loadRegistry } = await import('./registry/build.ts')
		const { reparseSet } = await import('./sources/pokemon-com.ts')
		const registry = await loadRegistry()
		for (const id of setIds) {
			const set = registry.sets.find((s) => s.id === id)
			if (!set?.slug) { console.error(`${id}: not in the registry`); continue }
			const r = await reparseSet(set.slug, id)
			console.log(`[reparse] ${id}: ${r.cards} cards, ${r.changed} changed${r.missingPages ? `, ${r.missingPages} language pages not on disk (kept as they were)` : ''}`)
		}
		process.exit(0)
	})

// pricing is off for now; remove the comment markers to bring these back
/*
const prices = program.command('prices')
prices
    .command('tcgplayer <setId>')
    .requiredOption('--group <groupId>', 'TCGPlayer Group ID')
    .action(async (setId, opts) => {
        const { fetchTcgplayer } = await import('./sources/tcgplayer')
        await fetchTcgplayer(setId, opts.group)
    })

prices 
    .command('cardmarket <setId> <jsonPath>')
    .description('Import Tampermonkey JSON export')
    .action(async (setId, jsonPath) => {
        const { importCardmarket } = await import('./sources/cardmarket-import')
        await importCardmarket(setId, jsonPath)
    })
*/

program
    .command('emit <scrapedSetId>')
    .description('Emit scraped cards to cards-database as .ts files (creates <Serie>/<SetName>/NNN.ts)')
    .requiredOption('--serie <serieName>', 'Serie folder name under data/ (e.g. "Scarlet & Violet")')
    .requiredOption('--set <setName>', 'Set file/folder name (e.g. "Delta Reign")')
    .requiredOption('--set-id <id>', 'tcgdex set id (e.g. "me06" or "sv11")')
    .option('--repo <path>', 'cards-database path', 'H:/cards-database')
    .option('--overwrite', 'overwrite existing card files', false)
    .action(async (scrapedSetId, opts) => {
        const { emitSet } = await import('./emit/card.ts')
        await emitSet({
            scrapedSetId,
            repo: opts.repo,
            serie: opts.serie,
            setName: opts.set,
            setId: opts.setId,
            overwrite: Boolean(opts.overwrite)
        })
    })

program 
    .command('images <setId>')
    .action(async (setId) => {
        const { downloadImages } = await import('./emit/images')
        await downloadImages(setId)
    })

program
	.command('pokedex <setId>')
	.description('Resolve pokedexSlug → dexIds via PokeAPI')
	.action(async (setId) => {
		const { resolvePokedex } = await import('./sources/pokedex.ts')
		await resolvePokedex(setId)
	})

/* pricing off: enrich
program
    .command('enrich')
    .description('Enrich an existing cards-database set with TCGPlayer/CardMarket/CardTrader IDs')
    .requiredOption('--set <setPath>', 'Set path relative to data/, e.g. "Scarlet & Violet/Obsidian Flames"')
    .option('--repo <path>', 'Path to cards-database repo', 'H:/cards-database')
    .option('--apply', 'Write changes (default is dry-run)', false)
    .option('--fill-missing-cardtrader', 'Safe mode: only add missing CardTrader IDs', false)
    .option('--cardmarket-json <path>', 'CardMarket merge JSON from the Tampermonkey exporter')
    .option('--cardmarket-map <path>', 'Manual CardMarket mapping file')
    .option('--tcgplayer-set-id <id>', 'Override the TCGPlayer set ID', (v) => Number(v))
    .option('--tcgplayer-json <path>', 'Local TCGPlayer set JSON or TCGCSV file')
    .option('--tcgplayer-id-map <path>', 'Collector-number → TCGPlayer product ID map (JSON)')
    .action(async (opts) => {
        const { runEnrichment } = await import('./pricing/enrichment.ts')
        await runEnrichment({
            repo: opts.repo,
            set: opts.set,
            apply: Boolean(opts.apply),
            fillMissingCardtrader: Boolean(opts.fillMissingCardtrader),
            cardmarketJson: opts.cardmarketJson,
            cardmarketMap: opts.cardmarketMap,
            tcgplayerSetId: opts.tcgplayerSetId,
            tcgplayerJson: opts.tcgplayerJson,
            tcgplayerIdMap: opts.tcgplayerIdMap
        })
    })
*/

program
	.command('set-meta <setId>')
	.description('Build the set file (and series file if new) in the Experimental repo from TCGdex API + TCGTracking + the scrape')
	.option('--repo <path>', 'Experimental repo path')
	.option('--series <id>', 'series id, only needed when TCGdex does not know the set')
	.option('--series-name <name>', 'English series name for a new series TCGdex does not know')
	.option('--name <name>', 'English set name override')
	.option('--abbreviation <abbr>', 'abbreviation override')
	.option('--release-date <date>', 'release date override (YYYY-MM-DD)')
	.option('--tcgplayer-set <id>', 'TCGplayer group id (found by name when omitted)', (v) => Number(v))
	.option('--overwrite', 'replace an existing set file', false)
	.option('--apply', 'write the files (default is a dry run)', false)
	.action(async (setId, opts) => {
		const { buildSetMeta } = await import('./sources/set-meta.ts')
		const r = await buildSetMeta({
			setId, repo: opts.repo, series: opts.series, seriesName: opts.seriesName, name: opts.name,
			abbreviation: opts.abbreviation, releaseDate: opts.releaseDate, tcgplayerSet: opts.tcgplayerSet,
			overwrite: Boolean(opts.overwrite), apply: Boolean(opts.apply)
		})
		console.log(JSON.stringify({ series: r.seriesRecord, set: r.record }, null, 2))
		r.notes.forEach((n) => console.log(`note: ${n}`))
		console.log(opts.apply ? `wrote: ${r.written.join(', ') || 'nothing'}` : 'dry run, nothing written (pass --apply)')
	})

program
	.command('enrich-scraped <setId>')
	.description('Fetch variants + provider ids (TCGTracking) and flavor text + regulation marks (TCGdex) into a scraped set; re-run to refresh')
	.option('--repo <path>', 'Experimental repo path')
	.option('--tcgplayer-set <id>', 'TCGplayer group id (found by name when omitted)', (v) => Number(v))
	.option('--no-variants', 'skip variants and provider ids')
	.option('--no-tcgdex', 'skip description and regulationMark')
	.action(async (setId, opts) => {
		const { enrichScrapedSet } = await import('./sources/enrich-scraped.ts')
		// the registry knows the group (and its overrides); without it only sets already in the repo, or found by name, got one
		const { loadRegistry } = await import('./registry/build.ts')
		const set = (await loadRegistry()).sets.find((s) => s.id === setId)
		await enrichScrapedSet({ setId, repo: opts.repo, tcgplayerSet: opts.tcgplayerSet ?? set?.tcgplayerGroup ?? undefined, noVariants: opts.variants === false, noTcgdex: opts.tcgdex === false })
	})

const registryCmd = program.command('registry').description('The list of sets to build: id, pokemon.com slug and TCGTracking group for each')
registryCmd
	.command('build')
	.description('Build registry/pokemon-intl.json for the eras (TCGdex set lists + pokemon.com slugs + TCGTracking groups); corrections go in registry/overrides.json')
	.option('--series <ids>', 'comma-separated TCGdex series ids', 'me,sv,swsh')
	.option('--refresh-expansions', "read pokemon.com's expansion list again instead of using the cached one", false)
	.action(async (opts) => {
		const { buildRegistry } = await import('./registry/build.ts')
		const reg = await buildRegistry({ series: String(opts.series).split(',').map((x: string) => x.trim()), refreshExpansions: Boolean(opts.refreshExpansions) })
		const pad = (v: unknown, n: number) => String(v ?? '—').padEnd(n)
		console.log(`${pad('id', 10)}${pad('slug', 14)}${pad('group', 7)}${pad('cards', 6)}name`)
		for (const x of reg.sets) {
			console.log(`${pad(x.id, 10)}${pad(x.slug, 14)}${pad(x.tcgplayerGroup, 7)}${pad(x.total ?? x.official, 6)}${x.name}${x.skip ? `   [SKIP: ${x.skip}]` : ''}`)
			x.notes.forEach((n) => console.log(`            note: ${n}`))
		}
		const buildable = reg.sets.filter((x) => !x.skip)
		console.log(`
${reg.sets.length} sets: ${buildable.length} buildable, ${buildable.filter((x) => !x.tcgplayerGroup).length} of those without a TCGplayer group (no variants/ids)`)
		process.exit(0)
	})

program
	.command('build-era <series...>')
	.description('Build every set of the eras (TCGdex series ids, e.g. me sv swsh), newest first: scrape, enrich, then write set + cards. Resumable. Dry run unless --apply')
	.option('--repo <path>', 'Experimental repo path')
	.option('--sets <ids>', 'only these set ids, comma-separated')
	.option('--from <id>', 'start at this set (to continue after a stop)')
	.option('--apply', 'write the Experimental repo (default: scrape + enrich into the cache and report what would be written)', false)
	.option('--overwrite', 'replace files that already exist (a rebuild)', false)
	.option('--refresh', 'scrape again even when the cache already has the set', false)
	.option('--plan', 'list what would run and exit (no network, no files)', false)
	.option('--allow-incomplete', 'write a set even when a source failed (it may lack variants, ids or text)', false)
	.action(async (series: string[], opts) => {
		const { buildEras } = await import('./batch.ts')
		await buildEras({
			series, repo: opts.repo, sets: opts.sets ? String(opts.sets).split(',').map((x: string) => x.trim()) : undefined,
			from: opts.from, apply: Boolean(opts.apply), overwrite: Boolean(opts.overwrite), refresh: Boolean(opts.refresh), plan: Boolean(opts.plan), allowIncomplete: Boolean(opts.allowIncomplete)
		})
		process.exit(0)
	})

const gallery = program.command('gallery').description("Pokémon.com's official product gallery: what is inside each sealed product")
gallery
	.command('scrape')
	.description('Download the product pages (a visible browser opens, like the card scrape) into cache/pokemon-gallery. Pages already kept are skipped')
	.option('--years <years>', 'comma-separated years (default: 2020 to now)')
	.option('--refresh', 'download the pages again', false)
	.action(async (opts) => {
		const { scrapeGallery } = await import('./sources/pokemon-gallery.ts')
		const years = opts.years ? String(opts.years).split(',').map((y: string) => Number(y.trim())).filter(Boolean) : undefined
		const r = await scrapeGallery({ years, refresh: Boolean(opts.refresh) })
		process.exit(r.failed.length ? 1 : 0)
	})

const asia = program.command('asia').description('Asia: the portal (tw, hk, th, id), Japan (ja) and Mainland China (zh-cn)')
const regionOf = (v: string) => {
	if (!['tw', 'hk', 'th', 'id', 'ja', 'ko', 'zh-cn'].includes(v)) throw new Error(`unknown region "${v}" (tw, hk, th, id, ja, ko, zh-cn)`)
	return v as import('./types/asia.ts').AsiaRegion
}
asia
	.command('expansions <region>')
	.description("List the region's products (code, title, release date) into cache/asia/<region>/expansions.json")
	.option('--fresh', 'ask the portal again instead of using the cached pages', false)
	.action(async (region, opts) => {
		const m = await import('./sources/asia-sources.ts')
		if (opts.fresh) (await import('./sources/asia-portal.ts')).setAsiaFresh(true)
		const list = await m.listExpansions(regionOf(region))
		for (const e of list) console.log(`${e.code.padEnd(10)}${(e.releaseDate ?? '—').padEnd(12)}${e.title}`)
		console.log(`${list.length} products`)
		process.exit(0)
	})
asia
	.command('scrape <region> <codes...>')
	.description('Scrape products by code: every card page, rarities, and the card images')
	.option('--no-images', 'skip downloading the images')
	.option('--no-rarities', 'skip the rarity lookup (one extra listing per rarity)')
	.option('--fresh', 'ask the portal again instead of using the cached pages', false)
	.action(async (region, codes: string[], opts) => {
		const m = await import('./sources/asia-sources.ts')
		if (opts.fresh) (await import('./sources/asia-portal.ts')).setAsiaFresh(true)
		let bad = 0
		for (const code of codes) {
			const r = await m.scrapeExpansion(regionOf(region), code, { images: opts.images !== false, rarities: opts.rarities !== false })
			console.log(`[asia] ${region}/${code}: ${r.cards} cards, ${r.images} images downloaded${r.failed.length ? `, ${r.failed.length} failed` : ''}`)
			bad += r.failed.length
		}
		process.exit(bad ? 1 : 0)
	})
asia
	.command('images <region> <codes...>')
	.description('Download the images of products that are already scraped (files on disk are skipped)')
	.action(async (region, codes: string[]) => {
		const m = await import('./sources/asia-sources.ts')
		let bad = 0
		for (const code of codes) {
			const r = await m.downloadImages(regionOf(region), code)
			console.log(`[asia] ${region}/${code}: ${r.downloaded} downloaded, ${r.failed.length} failed`)
			bad += r.failed.length
		}
		process.exit(bad ? 1 : 0)
	})

asia
	.command('enrich <region> <codes...>')
	.description('Add TCGdex data (regulation mark, rarity, text, finishes) and, for Japan, TCGTracking variants with provider ids to scraped cards')
	.option('--repo <path>', 'Experimental repo path')
	.option('--tcgplayer-set <id>', 'Japan: the Pokémon Japan TCGplayer group (found by set code when omitted)', (v) => Number(v))
	.option('--no-variants', 'skip variants and provider ids')
	.option('--no-tcgdex', 'skip the TCGdex lookup')
	.option('--fresh', 'ask TCGdex again instead of using what is kept', false)
	.action(async (region, codes: string[], opts) => {
		const { enrichAsiaSet } = await import('./sources/enrich-asia.ts')
		let bad = 0
		for (const code of codes) bad += (await enrichAsiaSet({ region: regionOf(region), code, repo: opts.repo, tcgplayerSet: opts.tcgplayerSet, noVariants: opts.variants === false, noTcgdex: opts.tcgdex === false, fresh: Boolean(opts.fresh) })).problems.length
		process.exit(bad ? 1 : 0)
	})
asia
	.command('build <region> <codes...>')
	.description('The whole flow for products: scrape -> enrich -> emit (like build-era for International). Dry run unless --apply; a source that failed stops the product being written unless --allow-incomplete')
	.option('--repo <path>', 'Experimental repo path')
	.option('--series <id>', 'series id, when the product heading is not a known one')
	.option('--overwrite', 'replace card files that exist instead of adding the language to them', false)
	.option('--images-out <dir>', 'also convert the images to webp into <dir>, laid out as on the CDN (needs --apply)')
	.option('--refresh', 'scrape again even when the product is already scraped', false)
	.option('--allow-incomplete', 'write a product even when an enrich source failed (it may lack variants or ids)', false)
	.option('--apply', 'write the files (default is a dry run)', false)
	.action(async (region, codes: string[], opts) => {
		const { scrapeExpansion, downloadImages } = await import('./sources/asia-sources.ts')
		const { readCards } = await import('./sources/asia-portal.ts')
		const { enrichAsiaSet } = await import('./sources/enrich-asia.ts')
		const { emitAsia } = await import('./emit/asia.ts')
		const r = regionOf(region)
		let failed = 0
		for (const code of codes) {
			console.log(`\n=== ${region}/${code} ===`)
			try {
				if (opts.refresh || !(await readCards(r, code)).length) {
					const s = await scrapeExpansion(r, code, { images: true })
					console.log(`[build] scraped ${s.cards} cards, ${s.images} images`)
					if (s.failed.length) throw new Error(`${s.failed.length} card pages failed; run again to retry them`)
				} else { await downloadImages(r, code); console.log('[build] already scraped (use --refresh to scrape again)') }
				const e = await enrichAsiaSet({ region: r, code, repo: opts.repo })
				if (e.problems.length && !opts.allowIncomplete) throw new Error(`not written, enrich found problems (--allow-incomplete writes it anyway):\n  - ${e.problems.join('\n  - ')}`)
				await emitAsia({ region: r, code, repo: opts.repo, series: opts.series, overwrite: Boolean(opts.overwrite), imagesOut: opts.imagesOut, apply: Boolean(opts.apply) })
			} catch (err) { failed++; console.error(`[build] ${region}/${code}: ${(err as Error).message}`) }
		}
		process.exit(failed ? 1 : 0)
	})
asia
	.command('emit <region> <code>')
	.description('Write a scraped Asia product as Experimental files (data/pokemon/asia/<Series>/<Set>/): series, set and cards. Dry run unless --apply')
	.option('--repo <path>', 'Experimental repo path')
	.option('--series <id>', 'series id, when the product heading is not a known one')
	.option('--overwrite', 'replace card files that exist instead of adding the language to them', false)
	.option('--images-out <dir>', 'also convert the images to webp into <dir>, laid out as on the CDN (needs --apply)')
	.option('--apply', 'write the files (default is a dry run)', false)
	.action(async (region, code, opts) => {
		const { emitAsia } = await import('./emit/asia.ts')
		await emitAsia({ region: regionOf(region), code, repo: opts.repo, series: opts.series, overwrite: Boolean(opts.overwrite), imagesOut: opts.imagesOut, apply: Boolean(opts.apply) })
		process.exit(0)
	})

program
	.command('reorder-variants')
	.description('Put the ball-pattern variants (Poke Ball before Master Ball) of already-written card files in order; changes nothing else')
	.option('--repo <path>', 'Experimental repo path')
	.option('--set <setId>', 'only this set (default: every Pokemon card file)')
	.option('--apply', 'write the files (default is a dry run)', false)
	.action(async (opts) => {
		const { reorderVariants } = await import('./emit/reorder-variants.ts')
		await reorderVariants({ repo: opts.repo, setId: opts.set, apply: Boolean(opts.apply) })
		process.exit(0)
	})

program
	.command('emit-experimental <setId>')
	.description('Emit scraped cards as Experimental card files (needs the set from set-meta); variants and provider ids from TCGTracking')
	.option('--repo <path>', 'Experimental repo path')
	.option('--tcgplayer-set <id>', 'TCGplayer group id (default: prices.tcgplayer of the set file)', (v) => Number(v))
	.option('--no-variants', 'skip variants and provider ids')
	.option('--no-tcgdex', 'skip description and regulationMark from the TCGdex API')
	.option('--overwrite', 'replace existing card files', false)
	.option('--apply', 'write the files (default is a dry run)', false)
	.action(async (setId, opts) => {
		const { emitExperimental } = await import('./emit/experimental.ts')
		await emitExperimental({
			setId, repo: opts.repo, tcgplayerSet: opts.tcgplayerSet, noVariants: opts.variants === false, noTcgdex: opts.tcgdex === false,
			overwrite: Boolean(opts.overwrite), apply: Boolean(opts.apply)
		})
	})

program
	.command('ui')
	.description('Start the web UI on http://localhost:<port>')
	.option('--port <port>', 'HTTP port', '5173')
	.action(async (opts) => {
		const { startUi } = await import('./ui/server.ts')
		await startUi(Number(opts.port))
	})

program.parseAsync()
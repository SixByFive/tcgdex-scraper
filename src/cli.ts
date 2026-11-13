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
		await enrichScrapedSet({ setId, repo: opts.repo, tcgplayerSet: opts.tcgplayerSet, noVariants: opts.variants === false, noTcgdex: opts.tcgdex === false })
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
	.action(async (series: string[], opts) => {
		const { buildEras } = await import('./batch.ts')
		await buildEras({
			series, repo: opts.repo, sets: opts.sets ? String(opts.sets).split(',').map((x: string) => x.trim()) : undefined,
			from: opts.from, apply: Boolean(opts.apply), overwrite: Boolean(opts.overwrite), refresh: Boolean(opts.refresh), plan: Boolean(opts.plan)
		})
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
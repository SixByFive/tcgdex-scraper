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
	.action(async (slug, opts) => {
		const { scrapeSet } = await import('./sources/pokemon-com.ts')
		await scrapeSet(slug, { serie: opts.serie, setId: opts.set })
	})

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

program
    .command('emit <setId>')
    .action(async (setId) => {
        const { emit } = await import('./emit/card')
        await emit(setId)
    })

program 
    .command('images <setId>')
    .action(async (setId) => {
        const { downloadImages } = await import('./emit/images')
        await downloadImages(setId)
    })

program.parseAsync()
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import config from '../config.json' with { type: 'json' }
import { loadRegistry, type RegistrySet } from './registry/build.ts'
import { scrapeSet } from './sources/pokemon-com.ts'
import { blockingProblems, enrichScrapedSet } from './sources/enrich-scraped.ts'
import { spawn } from 'node:child_process'
import { defaultRepo } from './util/experimental.ts'

const STATE_FILE = join('var', 'batch-state.json')

export interface BatchOptions {
	/** TCGdex series ids, in the order to build them: ["me", "sv", "swsh"] */
	series: string[]
	/** only these set ids */
	sets?: string[]
	/** start at this set id (newest-first order), to continue after a stop */
	from?: string
	repo?: string
	/** write the Experimental repo (otherwise scrape + enrich into the cache and report what would be written) */
	apply?: boolean
	/** replace files that exist (a rebuild) */
	overwrite?: boolean
	/** scrape again even when the cache already has the set */
	refresh?: boolean
	/** list what would run and exit: no network, no files */
	plan?: boolean
	/** write a set even when a source failed (TCGTracking, TCGdex, TCGCSV): it may lack variants, ids or text */
	allowIncomplete?: boolean
	log?: (line: string) => void
}

interface SetState {
	at: string
	scraped?: number
	expected?: number | null
	enriched?: boolean
	written?: number
	skipped?: number
	warnings?: number
	notes: string[]
	error?: string
}

const cachedCount = async (setId: string) => {
	try { return (await readdir(join(config.cacheDir, 'pokemon-com', setId))).filter((f) => f.endsWith('.json')).length } catch { return 0 }
}

/**
 * Cards of a scraped set that may be missing languages by accident: a language whose page failed (bot wall, timeout), or, in a
 * scrape from before absences were recorded, any gap that was never confirmed as a real 404.
 */
async function incompleteCards(setId: string): Promise<number> {
	const dir = join(config.cacheDir, 'pokemon-com', setId)
	let n = 0
	try {
		for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
			const c = JSON.parse(await readFile(join(dir, f), 'utf8'))
			const langs = Object.keys(c.locales ?? {}).length
			if (c.failedLangs?.length || (c.absentLangs === undefined && langs < 6)) n++
		}
	} catch {}
	return n
}

async function loadState(): Promise<Record<string, SetState>> {
	try { return JSON.parse(await readFile(STATE_FILE, 'utf8')) } catch { return {} }
}
async function saveState(state: Record<string, SetState>) {
	await mkdir(dirname(STATE_FILE), { recursive: true })
	await writeFile(STATE_FILE, JSON.stringify(state, null, 1))
}

/**
 * Builds every set of the given eras, newest first, from the registry: scrape pokemon.com, enrich (TCGTracking variants and
 * ids, TCGdex text), then write the set file and the cards. Resumable: a set already in the cache isn't scraped again, and
 * every set's outcome is kept in var/batch-state.json. A set that fails is reported and the run goes on to the next one.
 */
export async function buildEras(opts: BatchOptions): Promise<void> {
	const log = opts.log ?? console.log
	const repo = opts.repo ?? defaultRepo
	const registry = await loadRegistry()

	let sets = registry.sets.filter((s) => opts.series.includes(s.series))
	// the order given on the command line wins (me, sv, swsh), newest first inside each era
	sets.sort((a, b) => opts.series.indexOf(a.series) - opts.series.indexOf(b.series) || (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
	if (opts.sets?.length) sets = sets.filter((s) => opts.sets!.includes(s.id))
	if (opts.from) {
		const at = sets.findIndex((s) => s.id === opts.from)
		if (at < 0) throw new Error(`--from ${opts.from}: not in the selected sets`)
		sets = sets.slice(at)
	}
	const skipped = sets.filter((s) => s.skip)
	const todo = sets.filter((s) => !s.skip)

	const state = await loadState()
	if (opts.plan) {
		log(`${todo.length} sets to build, newest first (${opts.apply ? 'would write' : 'dry run'}):`)
		for (const s of todo) {
			const have = await cachedCount(s.id)
			const want = s.total ?? s.official
			log(`  ${s.id.padEnd(10)} ${s.name.padEnd(36)} cache ${String(have).padStart(3)}/${want ?? '?'}  ${state[s.id]?.error ? 'last run: ERROR ' + state[s.id]!.error : state[s.id]?.written != null ? `last run: wrote ${state[s.id]!.written}` : ''}`)
		}
		skipped.forEach((s) => log(`  ${s.id.padEnd(10)} ${s.name.padEnd(36)} SKIPPED: ${s.skip}`))
		return
	}

	log(`[batch] ${todo.length} sets (${opts.series.join(', ')}), ${opts.apply ? 'WRITING to ' + repo : 'dry run: cache only'}${opts.overwrite ? ', overwriting existing files' : ''}`)
	skipped.forEach((s) => log(`[batch] skipping ${s.id} ${s.name}: ${s.skip}`))

	let consecutiveScrapeFailures = 0
	let n = 0
	for (const set of todo) {
		n++
		const t0 = Date.now()
		const entry: SetState = { at: new Date().toISOString(), notes: [] }
		state[set.id] = entry
		log(`\n[batch] (${n}/${todo.length}) ${set.id} ${set.name} [${set.slug}]`)
		try {
			await buildOne(set, entry, { repo, apply: Boolean(opts.apply), overwrite: Boolean(opts.overwrite), refresh: Boolean(opts.refresh), allowIncomplete: Boolean(opts.allowIncomplete), log })
			consecutiveScrapeFailures = 0
		} catch (err) {
			entry.error = (err as Error).message
			log(`[batch] ${set.id} FAILED: ${entry.error}`)
			if (/scrape|pokemon\.com|bot wall|No \.full-card-information|Could not discover/i.test(entry.error)) consecutiveScrapeFailures++
			if (consecutiveScrapeFailures >= 3) {
				await saveState(state)
				throw new Error('3 sets in a row failed to scrape: pokemon.com is probably blocking. Wait a while, then continue with --from ' + set.id)
			}
		}
		await saveState(state)
		log(`[batch] ${set.id} done in ${Math.round((Date.now() - t0) / 1000)}s`)
	}

	// ---- summary ----------------------------------------------------------------------------------------------------
	log('\n[batch] summary')
	for (const set of todo) {
		const e = state[set.id]!
		log(`  ${set.id.padEnd(10)} ${set.name.padEnd(34)} ${e.error ? 'ERROR ' + e.error : `scraped ${e.scraped}/${e.expected ?? '?'}, ${opts.apply ? 'wrote' : 'would write'} ${e.written ?? 0}, ${e.warnings ?? 0} warnings`}${e.notes.length ? '  | ' + e.notes.join('; ') : ''}`)
	}
	const failed = todo.filter((s) => state[s.id]?.error)
	if (failed.length) log(`\n[batch] ${failed.length} failed: ${failed.map((s) => s.id).join(', ')}. Fix and re-run with --sets ${failed.map((s) => s.id).join(',')}`)
}

async function buildOne(set: RegistrySet, entry: SetState, o: { repo: string; apply: boolean; overwrite: boolean; refresh: boolean; allowIncomplete?: boolean; log: (l: string) => void }) {
	const expected = set.total ?? set.official
	entry.expected = expected

	// 1. scrape (skipped when the cache has it)
	let have = await cachedCount(set.id)
	const incomplete = await incompleteCards(set.id)
	if (set.source === 'tcgdex') {
		// pokemon.com doesn't have this set: its cards come from the TCGdex API
		if (have < (expected ?? 1)) await (await import('./sources/tcgdex-fallback.ts')).fillFromTcgdex(set.id, { log: o.log })
		have = await cachedCount(set.id)
		if (have === 0) throw new Error('TCGdex has no cards for this set')
	} else if (o.refresh || have === 0 || (expected != null && have < expected) || incomplete > 0) {
		if (incomplete > 0) o.log(`[batch] ${set.id}: ${incomplete} cards have languages to retry`)
		// pages already fetched come from the cache, so this only asks pokemon.com for the ones that are missing
		await scrapeSet(set.slug!, { serie: set.series, setId: set.id, enrich: false, count: expected ?? undefined })
		have = await cachedCount(set.id)
		const still = await incompleteCards(set.id)
		if (still > 0) throw new Error(`${still} cards still have failed languages after a retry (bot wall?): run the set again before writing it`)
	} else o.log(`[batch] ${set.id}: ${have} cards already scraped`)
	entry.scraped = have
	if (have === 0) throw new Error('scrape found no cards on pokemon.com')
	if (expected != null && have < expected) entry.notes.push(`${set.source === 'tcgdex' ? 'TCGdex' : 'pokemon.com and TCGdex have'} ${have} of ${expected} cards`)

	// 2. enrich: variants and provider ids, flavor text, regulation marks, stages
	const enrich = await enrichScrapedSet({ setId: set.id, repo: o.repo, tcgplayerSet: set.tcgplayerGroup ?? undefined })
	entry.enriched = true
	// A source that failed or gave nothing leaves cards without variants, ids or text that the files being replaced may have. Writing
	// them would lose data; the enrich result is kept in the cache, so re-running the set only repeats what failed.
	// (A set the registry has no TCGplayer group for is written without variants on purpose: that is a note, not a stop.)
	const blocking = blockingProblems(enrich.problems, set.tcgplayerGroup != null)
	if (blocking.length && !o.allowIncomplete) {
		if (set.tcgplayerGroup == null) entry.notes.push('no TCGplayer group in the registry: written without variants')
		throw new Error(`enrich incomplete, nothing written: ${blocking.join('; ')}. Run the set again, or pass --allow-incomplete to write it anyway`)
	}
	if (enrich.problems.length) entry.notes.push(...enrich.problems.map((p) => `incomplete: ${p}`))

	// cross-check against the repo's current card, TCGTracking and PokeData: reported, never changed, never stops the build
	try {
		const { crossCheckSet } = await import('./sources/crosscheck.ts')
		const r = await crossCheckSet(set.id, o.repo, set.tcgplayerGroup ?? undefined, set.name)
		const real = r.disagreements.filter((d) => !(d.field === 'number' && d.other === 'none'))
		if (real.length) {
			entry.notes.push(`cross-check: ${real.length} disagreements (run the Cross-check button or "crosscheck ${set.id}")`)
			real.slice(0, 3).forEach((d) => o.log(`[batch]   cross-check ${d.card} ${d.field}: ${JSON.stringify(d.scraped)} vs ${JSON.stringify(d.other)} [${d.against}]`))
		}
		if (r.pokedata?.missingIds.length) entry.notes.push(`PokeData lists ${r.pokedata.missingIds.length} TCGplayer ids we have no variant for`)
	} catch (err) { o.log(`[batch] cross-check skipped: ${(err as Error).message}`) }

	// 3 + 4. the set file and the cards. These load the Experimental repo's own formatter, which only runs under Bun, while the
	// scrape above needs Node (Playwright hangs under Bun): so they run as Bun child processes.
	const common = ['--repo', o.repo, ...(o.apply ? ['--apply'] : []), ...(o.overwrite ? ['--overwrite'] : [])]
	const meta = await runBun(['set-meta', set.id, '--series', set.series, ...(set.tcgplayerGroup ? ['--tcgplayer-set', String(set.tcgplayerGroup)] : []), ...common])
	meta.lines.filter((l) => l.startsWith('note: ') && !l.includes('prices.cardmarket')).forEach((l) => entry.notes.push(l.slice(6)))

	// a dry run of a new set has no set file yet: say so rather than fail
	const emit = await runBun(['emit-experimental', set.id, ...common], { allowFailure: !o.apply })
	if (emit.code !== 0) {
		if (!o.apply && /No set "/.test(emit.text)) { entry.notes.push('new set: the cards are written once the set file exists (--apply)'); return }
		throw new Error(`emit-experimental failed: ${emit.lines.slice(-3).join(' | ')}`)
	}
	const m = emit.text.match(/(?:wrote|would write) (\d+) cards, (\d+) skipped, (\d+) warnings/)
	if (m) { entry.written = Number(m[1]); entry.skipped = Number(m[2]); entry.warnings = Number(m[3]) }
	const warns = emit.lines.filter((l) => l.includes('warning:'))
	warns.slice(0, 3).forEach((w) => o.log(`[batch]   ${w.replace('[emit] ', '')}`))
	if (warns.length > 3) o.log(`[batch]   ... and ${warns.length - 3} more warnings`)
	if (entry.skipped && !o.overwrite) entry.notes.push(`${entry.skipped} existing files kept (use --overwrite to rebuild)`)
}

/** Runs one of this tool's commands in a Bun child process and returns its output. */
function runBun(args: string[], opts: { allowFailure?: boolean } = {}): Promise<{ code: number; text: string; lines: string[] }> {
	return new Promise((resolve, reject) => {
		const child = spawn('bun', ['run', 'src/cli.ts', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
		let text = ''
		child.stdout.on('data', (d) => { text += d })
		child.stderr.on('data', (d) => { text += d })
		child.on('error', (err) => reject(new Error(`could not start bun: ${err.message}`)))
		child.on('close', (code) => {
			const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
			if (code !== 0 && !opts.allowFailure) reject(new Error(`${args[0]} failed (exit ${code}): ${lines.slice(-3).join(' | ')}`))
			else resolve({ code: code ?? 1, text, lines })
		})
	})
}

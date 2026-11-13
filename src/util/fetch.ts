import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
/// <reference lib="dom" />
import { chromium, type Browser, type BrowserContext } from 'playwright'
import pLimit from 'p-limit'
import config from '../../config.json' with { type: 'json' }

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

let browser: Browser | null = null
let context: BrowserContext | null = null
const pageLimit = pLimit(config.concurrency ?? 3)

// NOTE: Playwright's browser launch hangs under Bun (Windows); run scrapes through Node (`bun run scrape:set` uses tsx).
// The launch is shared: with several pages loading at once, every caller used to start its own browser before the first
// one had finished launching, and the extra browsers were never closed, which kept the process alive after the scrape.
let launching: Promise<BrowserContext> | null = null
function ensureContext(): Promise<BrowserContext> {
	launching ??= launchContext().catch((err) => { launching = null; throw err })
	return launching
}

/**
 * The browser looks like a person's: a profile that is kept between runs (so a check you solved by hand, and the cookie it
 * earns, is still there next time), the browser's own user agent (a made-up one that disagreed with the real engine was itself
 * a bot signal), images loaded, and pauses between pages (see `pace`).
 */
async function launchContext(): Promise<BrowserContext> {
	console.log('[playwright] launching chromium…')
	const opts = {
		headless: false,
		args: ['--disable-blink-features=AutomationControlled', '--disable-features=IsolateOrigins,site-per-process'],
		locale: 'en-GB',
		viewport: { width: 1280, height: 800 }
	}
	const profileDir = (config as { browserProfileDir?: string }).browserProfileDir
	if (profileDir) {
		try {
			context = await chromium.launchPersistentContext(profileDir, opts)
		} catch (err) {
			// the profile can be used by one browser at a time (another scrape, the UI's Rescrape button)
			console.warn(`[playwright] could not use the saved profile (${(err as Error).message.split('\n')[0]}); using a fresh one, so a solved check won't be remembered`)
		}
	}
	if (!context) {
		browser = await chromium.launch({ headless: opts.headless, args: opts.args })
		context = await browser.newContext({ locale: opts.locale, viewport: opts.viewport })
	}
	// Hide the biggest automation tell
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
	})
	// Images and fonts are loaded like a real visit unless `blockMedia` is set in config.json (faster, but looks less human)
	if ((config as { blockMedia?: boolean }).blockMedia) {
		await context.route('**/*', (route) => {
			const t = route.request().resourceType()
			if (t === 'image' || t === 'font' || t === 'media') return route.abort()
			return route.continue()
		})
	}
	console.log('[playwright] ready')
	return context
}

// ---- pacing ----------------------------------------------------------------------------------------------------
// Requests start at random gaps (config requestDelayMs: [min, max]) instead of back to back. After a challenge the gaps
// are tripled for five minutes: whatever tripped it is more likely to again.
const [DELAY_MIN, DELAY_MAX] = (config as unknown as { requestDelayMs?: [number, number] }).requestDelayMs ?? [500, 1500]
let nextSlot = 0
let slowUntil = 0
async function pace(): Promise<void> {
	const factor = Date.now() < slowUntil ? 3 : 1
	const gap = (DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)) * factor
	const slot = Math.max(Date.now(), nextSlot)
	nextSlot = slot + gap
	const wait = slot - Date.now()
	if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

// With `fresh` on, a page or listing is fetched again even when it is cached, and the new copy replaces the cached one.
// Each URL is fetched again once per run, so a page asked for twice in the same run is not downloaded twice.
let fresh = false
const refetched = new Set<string>()
export function setFresh(on: boolean): void { fresh = on; refetched.clear() }
const mustFetch = (url: string) => fresh && !refetched.has(url)

export async function getCached(url: string): Promise<string> {
	const path = join(config.cacheDir, `${sha(url)}.html`)
	if (!mustFetch(url)) {
		try {
			return await readFile(path, 'utf8')
		} catch {}
	}

	const html = await pageLimit(async () => {
		const ctx = await ensureContext()
		const page = await ctx.newPage()
		try {
			await pace()
			console.log(`[fetch] ${url}`)
			// a bot challenge is waited out (up to CHALLENGE_WAIT_MS, solved by hand in the browser window), then the page is asked for again
			let lastErr: Error | null = null
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
					if (resp?.status() === 404) throw new Error(`404 ${url}`)
					await page.waitForSelector('.full-card-information', { timeout: 15000 }).catch(() => {})
					if (await page.$('.full-card-information')) return await page.content()
					if (await isChallenge(page)) { await waitOutChallenge(page, url); continue }
					if (resp?.status() === 403 || resp?.status() === 429) {
						// blocked or rate limited, with a page we don't recognise: back off, then ask again
						console.warn(`[fetch] ${resp.status()} at ${url}: backing off 30s`)
						await page.waitForTimeout(30_000)
						continue
					}
					if (!resp || !resp.ok()) throw new Error(`${resp?.status() ?? 'no-response'} ${url}`)
					break
				} catch (err) {
					// a missing page is final; anything else (the page navigating under us during a challenge redirect, a timeout) is asked again
					const msg = (err as Error).message
					if (msg.startsWith('404 ') || /^bot challenge not cleared/.test(msg)) throw err
					lastErr = err as Error
					console.warn(`[fetch] ${url}: ${msg.split(String.fromCharCode(10))[0]} (attempt ${attempt + 1}/3)`)
					await page.waitForTimeout(2000).catch(() => {})
				}
			}
			if (lastErr && !(await page.$('.full-card-information').catch(() => null))) throw lastErr
			return await page.content()
		} finally {
			await page.close()
		}
	})

	if (!html.includes('full-card-information')) {
		throw new Error(`No .full-card-information in ${url} (bot wall?)`)
	}
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, html)
	refetched.add(url)
	return html
}

const CHALLENGE_WAIT_MS = 10 * 60 * 1000

/**
 * A bot-protection challenge instead of the real page. pokemon.com has shown two: Imperva's "Additional security check is
 * required" with an hCaptcha "I am human" box, and DataDome's "Pardon Our Interruption".
 */
async function isChallenge(page: import('playwright').Page): Promise<boolean> {
	try {
		return await page.evaluate(() => {
			const text = document.body?.innerText ?? ''
			return /additional security check|security check is required|imperva|i am human|pardon our interruption|verify you are (a )?human|are you a robot/i.test(text)
				|| !!document.querySelector('iframe[src*="hcaptcha"], .h-captcha, iframe[src*="captcha-delivery"], iframe[src*="datadome"], #captcha-container')
		})
	} catch { return false }
}

let challengeAnnounced = 0
/** Waits for the page to turn into the real one. While it waits, whoever is at the browser window can solve the challenge. */
async function waitOutChallenge(page: import('playwright').Page, url: string): Promise<void> {
	if (Date.now() - challengeAnnounced > 60_000) {
		challengeAnnounced = Date.now()
		console.warn(`[fetch] BOT CHALLENGE at ${url}: solve it in the browser window (tick \"I am human\"). Waiting up to ${CHALLENGE_WAIT_MS / 60000} minutes…`)
	}
	const until = Date.now() + CHALLENGE_WAIT_MS
	while (Date.now() < until) {
		await page.waitForTimeout(2000)
		if (await page.$('.full-card-information')) { slowUntil = Date.now() + 5 * 60_000; console.log('[fetch] challenge cleared, continuing at a slower pace for 5 minutes'); return }
		if (!(await isChallenge(page))) { slowUntil = Date.now() + 5 * 60_000; return }
	}
	throw new Error(`bot challenge not cleared within ${CHALLENGE_WAIT_MS / 60000} minutes: ${url}`)
}

/**
 * The card ids of the first page of a set's search listing (12 cards), e.g. ["TG01", "TG02", ...] or ["1", "2", ...].
 * Cached on disk. It tells how a set numbers its cards: plain numbers, or a prefix (TG01, GG01, SV001).
 */
export async function getListingKeys(url: string): Promise<string[]> {
	const path = join(config.cacheDir, `${sha(url)}.listing.json`)
	if (!mustFetch(url)) { try { return JSON.parse(await readFile(path, 'utf8')) } catch {} }

	const keys = await pageLimit(async () => {
		const ctx = await ensureContext()
		const page = await ctx.newPage()
		try {
			await pace()
			console.log(`[fetch] ${url}`)
			const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
			if (!resp || !resp.ok()) throw new Error(`${resp?.status() ?? 'no-response'} ${url}`)
			await page.waitForSelector('a[href*="/pokemon-cards/series/"]', { timeout: 20000 }).catch(() => {})
			return await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/pokemon-cards/series/"]'))
				.map((a) => ((a as HTMLAnchorElement).getAttribute('href') ?? '').replace(/\/+$/, '').split('/').pop() ?? '')
				.filter(Boolean))
		} finally {
			await page.close()
		}
	})
	if (!keys.length) throw new Error(`No cards listed at ${url} (bot wall?)`)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, JSON.stringify(keys))
	refetched.add(url)
	return keys
}

export async function closeBrowser(): Promise<void> {
	const pending = launching
	launching = null
	// let a launch that is still in flight finish, so its browser is closed too
	await pending?.catch(() => {})
	await context?.close().catch(() => {})
	await browser?.close().catch(() => {})
	context = null
	browser = null
}
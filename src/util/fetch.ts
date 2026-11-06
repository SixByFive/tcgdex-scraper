import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import pLimit from 'p-limit'
import config from '../../config.json' with { type: 'json' }

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

let browser: Browser | null = null
let context: BrowserContext | null = null
const pageLimit = pLimit(config.concurrency ?? 3)

async function ensureContext(): Promise<BrowserContext> {
	if (context) return context
	console.log('[playwright] launching chromium…')
	browser = await chromium.launch({
		headless: false,
		args: [
			'--disable-blink-features=AutomationControlled',
			'--disable-features=IsolateOrigins,site-per-process'
		]
	})
	context = await browser.newContext({
		userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		locale: 'en-GB',
		viewport: { width: 1280, height: 800 }
	})
	// Hide the biggest automation tell
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
	})
	// Block only images/fonts/media — leave CSS alone (DataDome inspects it)
	await context.route('**/*', (route) => {
		const t = route.request().resourceType()
		if (t === 'image' || t === 'font' || t === 'media') return route.abort()
		return route.continue()
	})
	console.log('[playwright] ready')
	return context
}

export async function getCached(url: string): Promise<string> {
	const path = join(config.cacheDir, `${sha(url)}.html`)
	try {
		return await readFile(path, 'utf8')
	} catch {}

	const html = await pageLimit(async () => {
		const ctx = await ensureContext()
		const page = await ctx.newPage()
		try {
			console.log(`[fetch] ${url}`)
			const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
			if (!resp || !resp.ok()) throw new Error(`${resp?.status() ?? 'no-response'} ${url}`)
			await page.waitForSelector('.full-card-information', { timeout: 15000 }).catch(() => {})
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
	return html
}

export async function closeBrowser(): Promise<void> {
	await context?.close().catch(() => {})
	await browser?.close().catch(() => {})
	context = null
	browser = null
}
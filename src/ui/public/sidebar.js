// The sidebar: Game > Region > Source, with the tools of a game under it. The address (#/<game>/<region>/<source>) is the
// only state, so every page can be linked to and the sidebar just shows where you are.
// Games and their regions come from the Experimental repo (/api/games); Asia's sources from /api/asia/overview.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const LANG_NAMES = { en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', 'es-mx': 'Español (MX)', it: 'Italiano', pt: 'Português', 'pt-br': 'Português (BR)', 'pt-pt': 'Português (PT)', nl: 'Nederlands', pl: 'Polski', ru: 'Русский', ja: '日本語', ko: '한국어', 'zh-tw': '繁體中文', 'zh-hk': '繁體中文 (HK)', 'zh-cn': '简体中文', id: 'Indonesia', th: 'ไทย' }
const DATASET_NAMES = { intl: 'International', asia: 'Asia' }

let games = []
let asia = []
export const getGames = () => games
export const gameIds = () => games.map((g) => g.id)

export async function loadSidebar() {
	try { games = (await (await fetch('/api/games')).json()).sort((a, b) => (a.id === 'pokemon' ? -1 : b.id === 'pokemon' ? 1 : a.name.localeCompare(b.name))) } catch { games = [] }
	try { asia = await (await fetch('/api/asia/overview')).json() } catch { asia = [] }
	drawSidebar()
}

/** Highlights the entry for the current address. Called on every route change. */
export function drawSidebar() {
	const el = document.getElementById('sidebar')
	const hash = window.location.hash.slice(1) || '/'
	const here = hash.split('/').filter(Boolean).map(decodeURIComponent)
	const on = (...parts) => parts.every((p, i) => here[i] === p)
	const cur = (active) => (active ? ' aria-current="page"' : '')

	el.innerHTML = games.map((g) => {
		const open = here[0] === g.id || (here.length === 0 && g.id === 'pokemon') || (['catalog', 'products', 'experimental'].includes(here[0]) && g.id === 'pokemon')
		return `<section class="sb-game">
			<a class="sb-game-name" href="#/${esc(g.id)}">${esc(g.name)}</a>
			${open ? g.datasets.map((d) => {
				return `<div class="sb-dataset">
					<a class="sb-link sb-dataset-name"${cur(on(g.id, d.id) && here.length === 2)} href="#/${esc(g.id)}/${esc(d.id)}">${esc(DATASET_NAMES[d.id] ?? d.id)}<span class="sb-n">${d.languages.length} languages</span></a>
					${d.id === 'asia' && g.id === 'pokemon' ? asia.map((s) => {
						const scraped = s.expansions.filter((e) => e.scraped).length
						return `<a class="sb-link sb-source${s.scraper ? '' : ' sb-planned'}"${cur(on(g.id, 'asia', s.id))} href="#/${esc(g.id)}/asia/${esc(s.id)}" title="${esc(s.site)}">
							<span>${esc(s.name)}<span class="sb-lang">${esc(LANG_NAMES[s.language] ?? s.language)}</span></span>
							<span class="sb-n">${s.scraper ? (s.expansions.length ? `${scraped}/${s.expansions.length}` : '—') : 'no scraper'}</span></a>`
					}).join('') : ''}
				</div>`
			}).join('') : ''}
			${open && g.id === 'pokemon' ? `<div class="sb-tools"><span class="sb-label">Tools</span>
				<a class="sb-link"${cur(here[0] === 'catalog')} href="#/catalog">Catalog</a>
				<a class="sb-link"${cur(here[0] === 'products')} href="#/products">Products</a>
				<a class="sb-link"${cur(here[0] === 'experimental')} href="#/experimental">Experimental</a></div>` : ''}
		</section>`
	}).join('')
}

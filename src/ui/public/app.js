const app = document.getElementById('app')
const modalRoot = document.getElementById('modal-root')
const topbarStatus = document.getElementById('topbar-status')

let currentEs = null
let currentCards = []  // cache for modal lookup

const ENERGY = {
	Grass: ['e-grass', 'G'], Fire: ['e-fire', 'R'], Water: ['e-water', 'W'],
	Lightning: ['e-lightning', 'L'], Psychic: ['e-psychic', 'P'],
	Fighting: ['e-fighting', 'F'], Darkness: ['e-darkness', 'D'],
	Metal: ['e-metal', 'M'], Dragon: ['e-dragon', 'N'],
	Colorless: ['e-colorless', 'C'], Fairy: ['e-fairy', 'Y'], Free: ['e-colorless', '—']
}
const LOCALES = ['en', 'de', 'fr', 'it', 'es', 'pt']

function energy(type) {
	const [cls, letter] = ENERGY[type] ?? ['e-colorless', '?']
	return `<span class="energy-chip ${cls}">${letter}</span>`
}
function imgProxy(u) { return u ? `/img?url=${encodeURIComponent(u)}` : '' }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }

function route() {
	closeModal()
	const hash = window.location.hash.slice(1) || '/'
	const parts = hash.split('/').filter(Boolean)
	if (parts.length === 0) return renderSetsIndex()
	if (parts.length === 1) return renderSetGrid(parts[0])
	if (parts.length === 2) {
		renderSetGrid(parts[0]).then(() => openModal(parts[1]))
		return
	}
	app.innerHTML = `<div class="page"><div class="empty">Not found</div></div>`
}
window.addEventListener('hashchange', route)
window.addEventListener('DOMContentLoaded', route)

function closeStream() { if (currentEs) { currentEs.close(); currentEs = null } }
function setTopbarStatus(html) { topbarStatus.innerHTML = html }

async function renderSetsIndex() {
	closeStream()
	setTopbarStatus('')
	app.innerHTML = `<div class="page">
		<div class="page-head"><div><h1 class="page-title">Sets</h1><div class="page-sub">Scraped and existing sets</div></div></div>
		<div class="section-label">Scraped</div>
		<div id="scraped-sets" class="empty">Loading…</div>
		<div class="section-label" style="margin-top: 32px;">cards-database<span class="section-label-aside" id="db-count"></span></div>
		<div id="db-sets" class="empty">Loading…</div>
	</div>`

	// Scraped sets (from local cache)
	fetch('/api/sets').then(r => r.json()).then(sets => {
		const el = document.getElementById('scraped-sets')
		if (!sets.length) {
			el.innerHTML = 'Nothing scraped yet. Run <code>bunx tsx src/cli.ts scrape set …</code> first.'
			return
		}
		el.className = 'sets-grid'
		el.innerHTML = sets.map(s => `<a class="set-tile" href="#/${encodeURIComponent(s)}">
			<div class="set-tile-id">${esc(s)}</div>
			<div class="set-tile-sub">pokemon.com cache</div>
		</a>`).join('')
	})

	// cards-database sets (from H:/cards-database, grouped by serie)
	fetch('/api/db/sets').then(r => r.json()).then(sets => {
		const el = document.getElementById('db-sets')
		if (!sets.length) {
			el.innerHTML = 'cards-database not found. Set <code>cardsDatabaseDir</code> in <code>config.json</code>.'
			return
		}
		document.getElementById('db-count').textContent = ` · ${sets.length} sets across ${new Set(sets.map(s => s.serie)).size} series`
		const bySerie = new Map()
		for (const s of sets) {
			if (!bySerie.has(s.serie)) bySerie.set(s.serie, [])
			bySerie.get(s.serie).push(s)
		}
		const serieNames = [...bySerie.keys()].sort()
		el.className = ''
		el.innerHTML = serieNames.map(serie => {
			const items = bySerie.get(serie).sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
			return `<div class="serie-block">
				<div class="serie-head">${esc(serie)} <span class="muted">${items.length}</span></div>
				<div class="sets-grid">
					${items.map(s => `<div class="set-tile set-tile-static" title="${esc(s.setName)}">
						<div class="set-tile-id">${esc(s.nameEn)}</div>
						<div class="set-tile-sub">
							${s.id ? `<span class="mono">${esc(s.id)}</span>` : ''}
							${s.cardCount ? ` · ${s.cardCount} cards` : ''}
							${s.releaseDate ? `<br><span class="small muted">${esc(s.releaseDate)}</span>` : ''}
						</div>
					</div>`).join('')}
				</div>
			</div>`
		}).join('')
	})
}

async function renderSetGrid(setId) {
	closeStream()
	app.innerHTML = `<div class="page">
		<div class="page-head">
			<div>
				<h1 class="page-title">${esc(setId)}</h1>
				<div class="page-sub">
					<span class="mono">${esc(setId)}</span><span class="sep">·</span>
					<span id="sub-count"><span id="count">0</span> cards</span>
				</div>
			</div>
			<div class="toolbar">
				<input class="search" id="filter" type="search" placeholder="Filter cards…">
				<button class="btn btn-ghost" data-action="pokedex">Refresh dexIds</button>
				<button class="btn btn-ghost" data-action="emit">Emit .ts</button>
				<button class="btn btn-primary" data-action="scrape">Rescrape</button>
			</div>
		</div>
		<div class="progress-strip">
			<span class="label">pokemon.com</span>
			<div class="progress-bar"><div class="progress-fill" id="progress" style="width: 0%"></div></div>
			<span class="progress-count"><strong id="done">0</strong> / <span id="total">?</span></span>
		</div>
		<div class="card-grid" id="grid"></div>
	</div>`

	const grid = document.getElementById('grid')
	const filter = document.getElementById('filter')
	const counter = document.getElementById('count')
	const done = document.getElementById('done')
	const total = document.getElementById('total')
	const progress = document.getElementById('progress')
	const seen = new Map()
	let totalKnown = null

	function updateProgress() {
		done.textContent = seen.size
		counter.textContent = seen.size
		if (totalKnown) {
			total.textContent = totalKnown
			progress.style.width = Math.min(100, (seen.size / totalKnown) * 100) + '%'
		}
	}

	function addCard(card, isNew) {
		const key = String(card.structural.localId)
		if (seen.has(key)) return
		seen.set(key, card)
		currentCards.push(card)
		if (!totalKnown && card.structural.total) totalKnown = card.structural.total
		const tile = cardTile(setId, card)
		if (isNew) tile.classList.add('new')
		insertSorted(grid, tile, Number(card.structural.localId))
		updateProgress()
		applyFilter()
	}

	function applyFilter() {
		const q = filter.value.trim().toLowerCase()
		for (const el of grid.children) {
			const name = (el.dataset.name || '').toLowerCase()
			const id = el.dataset.id || ''
			el.style.display = !q || name.includes(q) || id.includes(q) ? '' : 'none'
		}
	}
	filter.addEventListener('input', applyFilter)

	// Action buttons: Rescrape, Refresh dexIds, Emit .ts
	function markRunning(btn) {
		if (btn.dataset.running === '1') return
		btn.dataset.running = '1'
		btn.dataset.label = btn.textContent
		btn.disabled = true
		btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.2-8.55" stroke-linecap="round"/></svg> ${btn.dataset.label}…`
	}
	function markIdle(btn) {
		if (btn.dataset.running !== '1') return
		btn.dataset.running = ''
		btn.disabled = false
		btn.textContent = btn.dataset.label
	}
	for (const btn of document.querySelectorAll('[data-action]')) {
		btn.addEventListener('click', async () => {
			if (btn.dataset.running === '1') return
			markRunning(btn)
			const r = await fetch(`/api/sets/${encodeURIComponent(setId)}/${btn.dataset.action}`, { method: 'POST' })
			if (!r.ok) {
				markIdle(btn)
				if (r.status === 409) alert('Already running')
			}
		})
	}
	// Initial job state (handles reload while a scrape is already going)
	fetch(`/api/sets/${encodeURIComponent(setId)}/status`).then(r => r.json()).then(s => {
		for (const kind of s.running || []) {
			const btn = document.querySelector(`[data-action="${kind}"]`)
			if (btn) markRunning(btn)
		}
	})

	currentCards = []
	const initial = await fetch(`/api/sets/${encodeURIComponent(setId)}/cards`).then(r => r.json())
	initial.sort((a, b) => Number(a.structural.localId) - Number(b.structural.localId))
		.forEach(c => addCard(c, false))

	// Live updates
	currentEs = new EventSource(`/api/sets/${encodeURIComponent(setId)}/events`)
	currentEs.addEventListener('card-added', e => {
		addCard(JSON.parse(e.data), true)
		setTopbarStatus(`<span class="live"><span class="pulse"></span><span class="live-text">Scraping · <strong>${seen.size}</strong> / ${totalKnown ?? '?'}</span></span>`)
	})
	currentEs.addEventListener('error', () => {})
	currentEs.addEventListener('job-started', e => {
		const { kind } = JSON.parse(e.data)
		const btn = document.querySelector(`[data-action="${kind}"]`)
		if (btn) markRunning(btn)
	})
	currentEs.addEventListener('job-done', e => {
		const { kind } = JSON.parse(e.data)
		const btn = document.querySelector(`[data-action="${kind}"]`)
		if (btn) markIdle(btn)
	})
}

function insertSorted(grid, tile, n) {
	for (const child of grid.children) {
		if (Number(child.dataset.id) > n) { grid.insertBefore(tile, child); return }
	}
	grid.appendChild(tile)
}

function cardTile(setId, card) {
	const el = document.createElement('a')
	el.className = 'card-tile'
	const localId = String(card.structural.localId)
	el.href = `#/${encodeURIComponent(setId)}/${encodeURIComponent(localId)}`
	el.dataset.id = localId
	el.dataset.name = card.locales?.en?.name ?? ''
	const img = imgProxy(card.structural.imageUrls?.en)
	const name = card.locales?.en?.name ?? '(no name)'
	const padded = localId.padStart(3, '0')
	const rarity = card.structural.rarity ?? ''
	const hasPokemon = true
	const hasTcg = Boolean(card.structural.tcgplayer)
	const hasCm = Boolean(card.structural.cardmarket)
	el.innerHTML = `
		<img class="card-img" loading="lazy" src="${img}" alt="${esc(name)}">
		<div class="tile-meta">
			<div class="tile-head"><span class="tile-id">#${padded}</span><span class="tile-name">${esc(name)}</span></div>
			<div class="tile-sub">${esc(rarity)}</div>
			<div class="tile-chips">
				<span class="chip ${hasPokemon ? 'ok' : 'off'}"><span class="chip-dot"></span>pokemon.com</span>
				<span class="chip ${hasTcg ? 'ok' : 'off'}"><span class="chip-dot"></span>TCGPlayer</span>
				<span class="chip ${hasCm ? 'ok' : 'off'}"><span class="chip-dot"></span>Cardmarket</span>
			</div>
		</div>`
	return el
}

// ─── Modal ───────────────────────────────────────────────────────────────

function openModal(localId) {
	const card = currentCards.find(c => String(c.structural.localId) === String(localId))
	if (!card) return
	renderModal(card)
	modalRoot.hidden = false
	document.body.style.overflow = 'hidden'
}

function closeModal() {
	modalRoot.hidden = true
	modalRoot.innerHTML = ''
	document.body.style.overflow = ''
}

document.addEventListener('keydown', e => {
	if (e.key === 'Escape' && !modalRoot.hidden) {
		history.pushState(null, '', '#/' + window.location.hash.slice(1).split('/')[1])
		closeModal()
	}
})

function renderModal(card) {
	const s = card.structural
	const en = card.locales?.en ?? {}
	const padded = String(s.localId).padStart(3, '0')

	const dlRow = (label, val) => val != null && val !== '' ? `<dt>${label}</dt><dd>${val}</dd>` : ''
	const dlRowRaw = (label, html) => html ? `<dt>${label}</dt><dd>${html}</dd>` : ''

	const typesHtml = s.types?.length ? s.types.map(energy).join('') : ''
	const retreatHtml = s.retreat ? Array(s.retreat).fill(energy('Colorless')).join('') : ''
	const weakHtml = s.weaknesses?.length ? s.weaknesses.map(w => `${energy(w.type)} ${esc(w.value)}`).join(' ') : ''
	const resistHtml = s.resistances?.length ? s.resistances.map(w => `${energy(w.type)} ${esc(w.value)}`).join(' ') : ''

	const setId = window.location.hash.slice(1).split('/')[1]
	const backHash = '#/' + setId

	modalRoot.innerHTML = `
		<div class="modal-backdrop" data-close></div>
		<div class="modal" role="dialog" aria-modal="true" aria-label="Card detail">
			<div class="modal-head">
				<div class="modal-head-title">
					<span class="num">#${padded}</span>
					<span class="name">${esc(en.name ?? '')}</span>
				</div>
				<div class="modal-head-actions">
					<button class="icon-btn" data-close aria-label="Close">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M6 18L18 6"/></svg>
					</button>
				</div>
			</div>
			<div class="modal-body">
				<div class="detail">
					<div>
						<div class="detail-image">
							<img src="${imgProxy(s.imageUrls?.en)}" alt="${esc(en.name ?? '')}">
							<div class="detail-image-cap">${esc(setId.toUpperCase())}_EN_${s.localId}.png</div>
							<div class="detail-locales-strip">
								${LOCALES.map(l => `<span class="pill-lang ${card.locales?.[l] ? '' : 'off'}">${l.toUpperCase()}</span>`).join('')}
							</div>
						</div>
					</div>
					<div class="detail-main">
						<div class="panel"><div class="panel-body">
							<h2 class="detail-name">
								${esc(en.name ?? '')}
								${s.hp ? `<span class="hp">HP <strong>${s.hp}</strong></span>` : ''}
							</h2>
							<dl class="dl">
								${dlRow('Category', esc([s.category, s.stage, s.trainerSubtype].filter(Boolean).join(' · ')))}
								${dlRowRaw('Types', typesHtml)}
								${dlRow('Rarity', esc(s.rarity))}
								${dlRow('Illustrator', esc(s.illustrator))}
								${s.pokedexSlug ? dlRow('Pokédex', `${esc(s.pokedexSlug)} ${s.dexIds?.length ? `<span style="color: var(--fg-muted); font-family: var(--font-mono);">· #${s.dexIds.join(', #')}</span>` : ''}`) : ''}
								${s.evolvesFromKey ? dlRow('Evolves from', esc(s.evolvesFromKey)) : ''}
								${dlRowRaw('Weakness', weakHtml)}
								${dlRowRaw('Resistance', resistHtml)}
								${dlRowRaw('Retreat', retreatHtml)}
							</dl>
						</div></div>

						${en.abilities?.length ? `
						<div class="panel">
							<div class="panel-head">Attacks & abilities <span class="muted">English</span></div>
							<div class="panel-body">
								${en.abilities.map(a => `
									<div class="attack-row">
										<div class="attack-cost">${(a.cost ?? []).map(energy).join('')}</div>
										<div class="attack-head">
											<div class="attack-name">${esc(a.name ?? '(unnamed)')}<span class="attack-tag">${a.kind}</span></div>
											<div class="attack-damage">${esc(a.damage ?? '')}</div>
										</div>
										${a.effect ? `<div class="attack-effect">${esc(a.effect)}</div>` : ''}
									</div>`).join('')}
							</div>
						</div>` : ''}

						<div class="panel">
							<div class="panel-head">Translations <span class="muted">${Object.keys(card.locales ?? {}).length} locales</span></div>
							<div class="panel-body">
								<div class="locale-grid">
									${LOCALES.map(l => `<div class="locale-cell">
										<div class="locale-flag">${l}</div>
										<div class="locale-name">${esc(card.locales?.[l]?.name ?? '—')}</div>
									</div>`).join('')}
								</div>
							</div>
						</div>

						<div class="panel">
							<div class="panel-head">Marketplace IDs</div>
							<div class="panel-body">
								<dl class="dl">
									<dt>pokemon.com</dt><dd><span class="chip ok"><span class="chip-dot"></span>scraped</span></dd>
									<dt>TCGPlayer</dt><dd><span class="chip off"><span class="chip-dot"></span>not matched</span></dd>
									<dt>Cardmarket</dt><dd><span class="chip off"><span class="chip-dot"></span>no import yet</span></dd>
								</dl>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>`

	// Close handlers
	modalRoot.addEventListener('click', e => {
		if (e.target.closest('[data-close]')) {
			history.pushState(null, '', backHash)
			closeModal()
		}
	}, { once: true })
}
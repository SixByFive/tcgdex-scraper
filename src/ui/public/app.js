const app = document.getElementById('app')
const modalRoot = document.getElementById('modal-root')
const topbarStatus = document.getElementById('topbar-status')
import { renderCatalog as drawCatalog } from './catalog.js'

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
	const parts = hash.split('/').filter(Boolean).map(decodeURIComponent)
	if (parts.length === 0) return renderSetsIndex()
	if (parts[0] === 'catalog') return drawCatalog(app, { closeStream, setTopbarStatus })
	if (parts[0] === 'experimental') return renderExperimental(parts[1] ?? '')
	// pricing is off for now: the enrich page is not reachable (re-enable with the buttons and /api/enrich/* routes)
	// if (parts[0] === 'enrich' && parts.length >= 3) {
	// 	return renderEnrich(parts.slice(1).join('/'))
	// }
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
		<div class="section-label" style="margin-top: 32px;">Experimental repo</div>
		<div class="empty"><a class="btn btn-primary" href="#/experimental">Choose a set to build →</a></div>
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

	/* pricing off: cards-database enrich tiles
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
					${items.map(s => `<a class="set-tile" href="#/enrich/${encodeURIComponent(serie)}/${encodeURIComponent(s.setName)}" title="Enrich ${esc(s.setName)}">
						<div class="set-tile-id">${esc(s.nameEn)}</div>
						<div class="set-tile-sub">
							${s.id ? `<span class="mono">${esc(s.id)}</span>` : ''}
							${s.cardCount ? ` · ${s.cardCount} cards` : ''}
							${s.releaseDate ? `<br><span class="small muted">${esc(s.releaseDate)}</span>` : ''}
						</div>
					</a>`).join('')}
				</div>
			</div>`
		}).join('')
	})
	*/
}

async function renderSetGrid(setId) {
	closeStream()
	app.innerHTML = `<div class="page">
		<div class="page-head">
			<div>
				<h1 class="page-title">${esc(setId)}</h1>
				<div class="page-sub">
					<span class="mono">${esc(setId)}</span><span class="sep">·</span>
					<span id="sub-count"><span id="count">0</span> cards</span><span class="sep">·</span>
					<span id="enrich-state" class="muted">…</span>
				</div>
			</div>
			<div class="toolbar">
				<input class="search" id="filter" type="search" placeholder="Filter cards…">
				<button class="btn btn-ghost" data-action="pokedex">Refresh dexIds</button>
				<button class="btn btn-ghost" data-action="enrich" title="Fetch variants + Cardmarket/TCGplayer/CardTrader ids (TCGTracking) and flavor text + regulation marks (TCGdex) into the scraped cards">Enrich</button>
				<a class="btn" href="#/experimental/${encodeURIComponent(setId)}">Build in Experimental →</a>
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
			// the printed total is the official count; secret rares are numbered past it, so never show fewer than we have
			const shown = Math.max(totalKnown, seen.size)
			total.textContent = shown
			progress.style.width = Math.min(100, (seen.size / shown) * 100) + '%'
		}
	}

	function addCard(card, isNew) {
		const key = String(card.structural.localId)
		if (seen.has(key)) {
			// the card file changed (enrichment, a rescrape): show the new data in its tile and in the modal
			seen.set(key, card)
			const i = currentCards.findIndex(c => String(c.structural.localId) === key)
			if (i >= 0) currentCards[i] = card
			grid.querySelector(`[data-id="${CSS.escape(key)}"]`)?.replaceWith(cardTile(setId, card))
			applyFilter()
			return
		}
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

	// Enrich pricing: pick a target cards-database set to jump into the enrich page for
	// pricing off: document.getElementById('btn-enrich-pick').addEventListener('click', () => openEnrichPicker(setId))

	// What enrichment has stored with the scrape. Read from the files again (not from the tiles, which ignore a card they already show).
	async function refreshEnrichState(failed) {
		const el = document.getElementById('enrich-state')
		if (!el) return
		if (failed) { el.textContent = 'Enrich failed: see the server log'; return }
		const cards = await fetch(`/api/sets/${encodeURIComponent(setId)}/cards`).then(r => r.json()).catch(() => [])
		const when = cards.map(c => c.enrichedAt).filter(Boolean).sort().pop()
		if (!when) { el.textContent = 'Not enriched yet'; return }
		const n = cards.length
		const withV = cards.filter(c => c.variants?.length).length
		const withText = cards.filter(c => c.tcgdex && Object.keys(c.tcgdex.description ?? {}).length).length
		const withMark = cards.filter(c => c.tcgdex?.regulationMark).length
		el.textContent = `Enriched ${when.slice(0, 10)} · variants ${withV}/${n} · flavor text ${withText}/${n} · reg. mark ${withMark}/${n}`
	}

	currentCards = []
	const initial = await fetch(`/api/sets/${encodeURIComponent(setId)}/cards`).then(r => r.json())
	refreshEnrichState()
	initial.sort((a, b) => Number(a.structural.localId) - Number(b.structural.localId))
		.forEach(c => addCard(c, false))

	// Live updates
	currentEs = new EventSource(`/api/sets/${encodeURIComponent(setId)}/events`)
	currentEs.addEventListener('card-added', e => {
		addCard(JSON.parse(e.data), true)
		setTopbarStatus(`<span class="live"><span class="pulse"></span><span class="live-text">Scraping · <strong>${seen.size}</strong> / ${totalKnown ? Math.max(totalKnown, seen.size) : '?'}</span></span>`)
	})
	currentEs.addEventListener('error', () => {})
	currentEs.addEventListener('job-started', e => {
		const { kind } = JSON.parse(e.data)
		const btn = document.querySelector(`[data-action="${kind}"]`)
		if (btn) markRunning(btn)
	})
	currentEs.addEventListener('job-done', e => {
		const { kind, code } = JSON.parse(e.data)
		const btn = document.querySelector(`[data-action="${kind}"]`)
		if (btn) markIdle(btn)
		setTopbarStatus('')
		// a scrape enriches at its end too
		if (kind === 'enrich' || kind === 'scrape') refreshEnrichState(kind === 'enrich' && code !== 0)
	})
}

function insertSorted(grid, tile, n) {
	for (const child of grid.children) {
		if (Number(child.dataset.id) > n) { grid.insertBefore(tile, child); return }
	}
	grid.appendChild(tile)
}

// A variant as the Experimental schema names it: "reverse · masterball · staff"
function variantLabel(v) {
	return [v.type, v.foil, v.size, ...(v.stamps ?? [])].filter(Boolean).join(' · ')
}
const MARKET_LINKS = {
	tcgplayer: id => `https://www.tcgplayer.com/product/${id}`,
	cardmarket: id => `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${id}`,
	cardtrader: null // no stable public link by blueprint id: shown as plain text
}
function idCell(kind, id) {
	if (id == null) return '<span class="muted">—</span>'
	const link = MARKET_LINKS[kind]?.(id)
	return link ? `<a class="mono" href="${link}" target="_blank" rel="noopener">${id}</a>` : `<span class="mono">${id}</span>`
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
	const variants = card.variants ?? []
	const hasTcg = variants.some(v => v.prices?.tcgplayer)
	const hasCm = variants.some(v => v.prices?.cardmarket)
	const hasCt = variants.some(v => v.prices?.cardtrader)
	el.innerHTML = `
		<img class="card-img" loading="lazy" src="${img}" alt="${esc(name)}">
		<div class="tile-meta">
			<div class="tile-head"><span class="tile-id">#${padded}</span><span class="tile-name">${esc(name)}</span></div>
			<div class="tile-sub">${esc(rarity)}</div>
			<div class="tile-chips">
				<span class="chip ${hasPokemon ? 'ok' : 'off'}"><span class="chip-dot"></span>pokemon.com</span>
				<span class="chip ${hasTcg ? 'ok' : 'off'}"><span class="chip-dot"></span>TCGPlayer</span>
				<span class="chip ${hasCm ? 'ok' : 'off'}"><span class="chip-dot"></span>Cardmarket</span>
				<span class="chip ${hasCt ? 'ok' : 'off'}"><span class="chip-dot"></span>CardTrader</span>
				${variants.length ? `<span class="chip ok" title="${esc(variants.map(variantLabel).join('\n'))}"><span class="chip-dot"></span>${variants.length} variant${variants.length === 1 ? '' : 's'}</span>` : ''}
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
							<div class="panel-head">Variants &amp; marketplace IDs <span class="muted">${card.enrichedAt ? `enriched ${esc(card.enrichedAt.slice(0, 10))}` : 'not enriched'}</span></div>
							<div class="panel-body">
								${card.variants?.length ? `<table class="variant-table">
									<thead><tr><th>Variant</th><th>TCGplayer</th><th>Cardmarket</th><th>CardTrader</th></tr></thead>
									<tbody>${card.variants.map(v => `<tr>
										<td>${esc(variantLabel(v))}</td>
										<td>${idCell('tcgplayer', v.prices?.tcgplayer)}</td>
										<td>${idCell('cardmarket', v.prices?.cardmarket)}</td>
										<td>${idCell('cardtrader', v.prices?.cardtrader)}</td>
									</tr>`).join('')}</tbody>
								</table>` : `<div class="muted small">${card.enrichedAt ? 'No TCGTracking product matched this card.' : 'Not enriched yet: use Enrich on the set page.'}</div>`}
								<dl class="dl" style="margin-top: 12px;">
									<dt>pokemon.com</dt><dd><span class="chip ok"><span class="chip-dot"></span>scraped</span></dd>
									${card.tcgdex ? `
									<dt>Reg. mark</dt><dd>${card.tcgdex.regulationMark ? `<span class="mono">${esc(card.tcgdex.regulationMark)}</span>` : '<span class="muted">—</span>'}</dd>
									<dt>Flavor text</dt><dd>${Object.keys(card.tcgdex.description ?? {}).length ? Object.entries(card.tcgdex.description).map(([l, t]) => `<div class="small"><span class="mono muted">${esc(l)}</span> ${esc(t)}</div>`).join('') : '<span class="muted">none on TCGdex</span>'}</dd>` : ''}
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

// ─── Enrich target picker ────────────────────────────────────────────────

async function openEnrichPicker(scrapedSetId) {
	modalRoot.innerHTML = `
		<div class="modal-backdrop" data-close></div>
		<div class="modal" role="dialog" aria-modal="true" aria-label="Pick cards-database set" style="width: min(700px, calc(100% - 24px));">
			<div class="modal-head">
				<div class="modal-head-title">
					<span class="name">Enrich pricing for <span class="mono" style="color: var(--fg-muted); font-weight: 400;">${esc(scrapedSetId)}</span></span>
				</div>
				<div class="modal-head-actions">
					<button class="icon-btn" data-close aria-label="Close">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M6 18L18 6"/></svg>
					</button>
				</div>
			</div>
			<div class="modal-body">
				<div class="small muted" style="margin-bottom: 10px;">Pick the cards-database set this scrape maps to. If the set doesn't exist yet, create a new target below.</div>
				<input class="input" id="pick-filter" type="search" placeholder="Filter by name, id, or serie…" autofocus>
				<div id="pick-list" class="pick-list"><div class="muted small">Loading…</div></div>

				<div class="section-label" style="margin: 22px 0 10px;">Or open as new target</div>
				<div class="pick-new">
					<datalist id="serie-list"></datalist>
					<label><span>Serie (folder name under cards-database/data)</span>
						<input class="input" id="new-serie" list="serie-list" placeholder="e.g. Scarlet &amp; Violet">
					</label>
					<label><span>Set name (file/folder name)</span>
						<input class="input" id="new-setname" placeholder="e.g. Delta Reign">
					</label>
					<button class="btn btn-primary" id="btn-new-open" disabled>Open enrich →</button>
					<div class="small muted">The enrich page opens even if the set isn't in cards-database yet; a dry-run will tell you what's missing.</div>
				</div>
			</div>
		</div>`
	modalRoot.hidden = false
	document.body.style.overflow = 'hidden'

	modalRoot.addEventListener('click', e => {
		if (e.target.closest('[data-close]')) closeModal()
	}, { once: true })

	const list = document.getElementById('pick-list')
	const filter = document.getElementById('pick-filter')

	const newSerie = document.getElementById('new-serie')
	const newSetName = document.getElementById('new-setname')
	const btnNewOpen = document.getElementById('btn-new-open')
	const serieList = document.getElementById('serie-list')

	const sets = await fetch('/api/db/sets').then(r => r.json())

	// Populate serie datalist for autocomplete
	const serieNames = [...new Set(sets.map(s => s.serie))].sort()
	serieList.innerHTML = serieNames.map(s => `<option value="${esc(s)}">`).join('')

	// Seed filter + new-target name with the scraped setId
	filter.value = scrapedSetId
	newSetName.value = scrapedSetId

	const refreshNewBtn = () => {
		btnNewOpen.disabled = !(newSerie.value.trim() && newSetName.value.trim())
	}
	newSerie.addEventListener('input', refreshNewBtn)
	newSetName.addEventListener('input', refreshNewBtn)
	refreshNewBtn()

	btnNewOpen.addEventListener('click', () => {
		const s = newSerie.value.trim(), n = newSetName.value.trim()
		if (!s || !n) return
		closeModal()
		window.location.hash = `#/enrich/${encodeURIComponent(s)}/${encodeURIComponent(n)}`
	})

	const render = () => {
		const q = filter.value.trim().toLowerCase()
		// Keep new-target name synced to filter text (user can still override)
		if (document.activeElement === filter) newSetName.value = filter.value.trim()
		const rows = sets
			.filter(s => !q || s.setName.toLowerCase().includes(q) || (s.id ?? '').toLowerCase().includes(q) || s.serie.toLowerCase().includes(q) || s.nameEn.toLowerCase().includes(q))
			.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
			.slice(0, 50)
		if (!rows.length) { list.innerHTML = '<div class="muted small">No matches. Create a new target below.</div>'; return }
		list.innerHTML = rows.map(s => `<a class="pick-row" href="#/enrich/${encodeURIComponent(s.serie)}/${encodeURIComponent(s.setName)}" data-close>
			<div class="pick-row-main">
				<div class="pick-row-name">${esc(s.nameEn)}</div>
				<div class="pick-row-sub">${esc(s.serie)} ${s.id ? `· <span class="mono">${esc(s.id)}</span>` : ''}${s.cardCount ? ` · ${s.cardCount} cards` : ''}</div>
			</div>
			<div class="pick-row-date muted small">${esc(s.releaseDate ?? '')}</div>
		</a>`).join('')
	}
	render()
	filter.addEventListener('input', render)
	refreshNewBtn()
}

// ─── Enrich page ─────────────────────────────────────────────────────────

async function renderEnrich(setPath) {
	closeStream()
	setTopbarStatus('')
	app.innerHTML = `<div class="page page-full">
		<div class="page-head">
			<div>
				<h1 class="page-title">${esc(setPath.split('/').pop() ?? setPath)}</h1>
				<div class="page-sub">
					<span>${esc(setPath)}</span><span class="sep">·</span>
					<span>cards-database enrichment</span>
				</div>
			</div>
			<div class="toolbar"><a class="btn btn-ghost" href="#/">← Sets</a></div>
		</div>

		<div class="panel" style="margin-bottom: 16px;">
			<div class="panel-head">Emit scraped data <span class="muted">for new sets · creates <span class="mono">data/${esc(setPath)}/</span></span></div>
			<div class="panel-body emit-row">
				<label><span>Scraped source set</span>
					<select class="input" id="emit-source"><option value="">— pick a scraped set —</option></select>
				</label>
				<label><span>tcgdex set id</span>
					<input class="input" id="emit-set-id" type="text" placeholder="e.g. me06, sv11">
				</label>
				<label class="inline" style="align-self: end; padding-bottom: 7px;"><input type="checkbox" id="emit-overwrite"> Overwrite existing</label>
				<button class="btn btn-primary" id="btn-emit" disabled style="align-self: end;">Emit scraped → cards-database</button>
			</div>
		</div>

		<div class="enrich-grid">
			<div class="panel">
				<div class="panel-head">Options</div>
				<div class="panel-body enrich-form">
					<label><span>CardMarket merge JSON</span>
						<div class="file-field">
							<input class="input" id="cm-json" type="text" placeholder="path to cardmarket-*-merged.json (optional)">
							<button class="btn btn-ghost" data-browse="cm-json" data-accept=".json">Browse…</button>
						</div>
					</label>
					<label><span>CardMarket manual map</span>
						<div class="file-field">
							<input class="input" id="cm-map" type="text" placeholder="auto: <cm-json>.manual-map.json">
							<button class="btn btn-ghost" data-browse="cm-map" data-accept=".json">Browse…</button>
						</div>
					</label>
					<label><span>TCGPlayer set ID</span>
						<input class="input" id="tcg-id" type="number" placeholder="only needed when set file lacks thirdParty.tcgplayer">
					</label>
					<label><span>TCGPlayer set JSON / CSV</span>
						<div class="file-field">
							<input class="input" id="tcg-json" type="text" placeholder="local export or TCGCSV file (optional)">
							<button class="btn btn-ghost" data-browse="tcg-json" data-accept=".json,.csv">Browse…</button>
						</div>
					</label>
					<label><span>TCGPlayer ID override map</span>
						<div class="file-field">
							<input class="input" id="tcg-map" type="text" placeholder="collector → productId (optional)">
							<button class="btn btn-ghost" data-browse="tcg-map" data-accept=".json">Browse…</button>
						</div>
					</label>
					<label class="inline"><input type="checkbox" id="fill-ct"> Fill missing CardTrader IDs only (safe mode)</label>
					<div class="toolbar" style="margin-top: 6px;">
						<button class="btn" id="btn-dry">Dry-run</button>
						<button class="btn btn-primary" id="btn-apply">Apply</button>
					</div>
				</div>
			</div>

			<div class="panel">
				<div class="panel-head">Live log <span class="muted" id="log-status">idle</span></div>
				<div class="panel-body"><pre class="enrich-log" id="log">Ready. Click Dry-run to preview changes.</pre></div>
			</div>
		</div>

		<div class="panel" style="margin-top: 16px;">
			<div class="panel-head">Report <span class="muted" id="report-mode"></span></div>
			<div class="panel-body" id="report"><div class="muted small">Run a dry-run to see the diff.</div></div>
		</div>
	</div>`

	const cmJson = document.getElementById('cm-json')
	const cmMap = document.getElementById('cm-map')
	const tcgId = document.getElementById('tcg-id')
	const tcgJson = document.getElementById('tcg-json')
	const tcgMap = document.getElementById('tcg-map')
	const fillCt = document.getElementById('fill-ct')
	const btnDry = document.getElementById('btn-dry')
	const btnApply = document.getElementById('btn-apply')
	const logEl = document.getElementById('log')
	const logStatus = document.getElementById('log-status')
	const reportEl = document.getElementById('report')
	const reportMode = document.getElementById('report-mode')

	const storageKey = `enrich-opts:${setPath}`
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
		if (saved.cmJson) cmJson.value = saved.cmJson
		if (saved.cmMap) cmMap.value = saved.cmMap
		if (saved.tcgId) tcgId.value = saved.tcgId
		if (saved.tcgJson) tcgJson.value = saved.tcgJson
		if (saved.tcgMap) tcgMap.value = saved.tcgMap
	} catch {}

	function persist() {
		try {
			localStorage.setItem(storageKey, JSON.stringify({
				cmJson: cmJson.value, cmMap: cmMap.value, tcgId: tcgId.value, tcgJson: tcgJson.value, tcgMap: tcgMap.value
			}))
		} catch {}
	}

	async function run(apply) {
		persist()
		btnDry.disabled = true; btnApply.disabled = true
		logStatus.textContent = apply ? 'applying…' : 'dry-run…'
		logEl.textContent = ''
		reportEl.innerHTML = '<div class="muted small">Running…</div>'
		reportMode.textContent = ''

		const body = {
			set: setPath,
			apply,
			fillMissingCardtrader: fillCt.checked,
			cardmarketJson: cmJson.value.trim() || undefined,
			cardmarketMap: cmMap.value.trim() || undefined,
			tcgplayerSetId: tcgId.value ? Number(tcgId.value) : undefined,
			tcgplayerJson: tcgJson.value.trim() || undefined,
			tcgplayerIdMap: tcgMap.value.trim() || undefined
		}

		try {
			const res = await fetch('/api/enrich/run', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buf = ''
			while (true) {
				const { value, done } = await reader.read()
				if (done) break
				buf += decoder.decode(value, { stream: true })
				let idx
				while ((idx = buf.indexOf('\n\n')) >= 0) {
					const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
					for (const line of chunk.split('\n')) {
						if (!line.startsWith('data:')) continue
						const payload = JSON.parse(line.slice(5).trim())
						if (payload.type === 'log') {
							logEl.textContent += payload.line + '\n'
							logEl.scrollTop = logEl.scrollHeight
						} else if (payload.type === 'done') {
							renderReport(payload.report)
							logStatus.textContent = apply ? 'applied' : 'dry-run complete'
						} else if (payload.type === 'error') {
							logEl.textContent += `\nERROR: ${payload.message}\n`
							logStatus.textContent = 'error'
						}
					}
				}
			}
		} catch (err) {
			logEl.textContent += `\nCONNECTION ERROR: ${err?.message ?? err}\n`
			logStatus.textContent = 'error'
		} finally {
			btnDry.disabled = false; btnApply.disabled = false
		}
	}

	btnDry.addEventListener('click', () => run(false))
	btnApply.addEventListener('click', () => {
		if (confirm('Apply writes changes to cards-database. Continue?')) run(true)
	})

	// Emit scraped → cards-database
	const emitSource = document.getElementById('emit-source')
	const emitSetId = document.getElementById('emit-set-id')
	const emitOverwrite = document.getElementById('emit-overwrite')
	const btnEmit = document.getElementById('btn-emit')
	const setNameFromPath = setPath.split('/').pop() ?? ''

	fetch('/api/sets').then(r => r.json()).then(scraped => {
		if (!scraped.length) return
		emitSource.innerHTML = '<option value="">— pick a scraped set —</option>' + scraped.map(s => `<option value="${esc(s)}" ${s === setNameFromPath ? 'selected' : ''}>${esc(s)}</option>`).join('')
		// Default set id = scraped setId if one is selected
		if (emitSource.value && !emitSetId.value) emitSetId.value = emitSource.value
		refreshEmitBtn()
	})

	function refreshEmitBtn() {
		btnEmit.disabled = !(emitSource.value && emitSetId.value.trim())
	}
	emitSource.addEventListener('change', () => {
		if (emitSource.value && !emitSetId.value) emitSetId.value = emitSource.value
		refreshEmitBtn()
	})
	emitSetId.addEventListener('input', refreshEmitBtn)

	btnEmit.addEventListener('click', async () => {
		if (!emitSource.value) return
		const [serie, setName] = setPath.split('/')
		if (!serie || !setName) { alert('Enrich target must be Serie/SetName'); return }
		const was = btnEmit.textContent
		btnEmit.disabled = true; btnEmit.textContent = 'Emitting…'
		logEl.textContent = ''
		logStatus.textContent = 'emitting…'
		try {
			const res = await fetch('/api/emit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					scrapedSetId: emitSource.value,
					serie, setName,
					setId: emitSetId.value.trim(),
					overwrite: emitOverwrite.checked
				})
			})
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buf = ''
			while (true) {
				const { value, done } = await reader.read()
				if (done) break
				buf += decoder.decode(value, { stream: true })
				let idx
				while ((idx = buf.indexOf('\n\n')) >= 0) {
					const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
					for (const line of chunk.split('\n')) {
						if (!line.startsWith('data:')) continue
						const payload = JSON.parse(line.slice(5).trim())
						if (payload.type === 'log') {
							logEl.textContent += payload.line + '\n'
							logEl.scrollTop = logEl.scrollHeight
						} else if (payload.type === 'done') {
							const r = payload.result
							logEl.textContent += `\nDone. ${r.cardsWritten} cards written, ${r.cardsSkipped} skipped${r.setFileWritten ? ', set file created' : ''}.\n`
							logStatus.textContent = 'emit complete'
						} else if (payload.type === 'error') {
							logEl.textContent += `\nERROR: ${payload.message}\n`
							logStatus.textContent = 'error'
						}
					}
				}
			}
		} catch (err) {
			logEl.textContent += `\nCONNECTION ERROR: ${err?.message ?? err}\n`
		} finally {
			btnEmit.textContent = was
			refreshEmitBtn()
		}
	})

	// File picker → upload → path into the text input
	app.querySelectorAll('[data-browse]').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.preventDefault()
			const target = document.getElementById(btn.dataset.browse)
			const picker = document.createElement('input')
			picker.type = 'file'
			if (btn.dataset.accept) picker.accept = btn.dataset.accept
			picker.onchange = async () => {
				const file = picker.files?.[0]
				if (!file || !target) return
				const was = btn.textContent
				btn.disabled = true; btn.textContent = 'Uploading…'
				try {
					const buf = await file.arrayBuffer()
					const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
						method: 'POST',
						headers: { 'content-type': 'application/octet-stream' },
						body: buf
					})
					const data = await res.json()
					if (!res.ok || !data.path) throw new Error(data.error ?? 'upload failed')
					target.value = data.path
					target.dispatchEvent(new Event('input', { bubbles: true }))
				} catch (err) {
					alert(`Upload failed: ${err?.message ?? err}`)
				} finally {
					btn.disabled = false; btn.textContent = was
				}
			}
			picker.click()
		})
	})

	function renderReport(rep) {
		reportMode.textContent = rep.mode
		const s = rep.summary
		const tally = (label, n) => `<div class="tally"><div class="tally-n">${n}</div><div class="tally-label">${label}</div></div>`
		reportEl.innerHTML = `
			<div class="tallies">
				${tally('Cards', s.cardFiles)}
				${tally('Matched', s.matched)}
				${tally('Ambiguous', s.ambiguous)}
				${tally('Unmatched', s.unmatched)}
				${tally('Orphans', s.orphanProducts)}
				${tally('Review', s.reviewRequired)}
				${rep.mode === 'apply' ? tally('Written', s.written) : ''}
				${rep.mode === 'apply' ? tally('Skipped', s.skipped) : ''}
			</div>
			${rep.cardmarket ? `<div class="small muted" style="margin-top: 10px;">
				CardMarket: ${s.cardmarketMappedProducts} mapped, <strong>${s.cardmarketUnmappedProducts}</strong> unmapped across ${s.cardmarketCardsNeedingMapping} cards
			</div>` : ''}
			${rep.ambiguous?.length ? `<details style="margin-top: 14px;"><summary class="muted small">Ambiguous (${rep.ambiguous.length})</summary>
				<ul class="report-list">${rep.ambiguous.map(a => `<li>${esc(shortPath(a.cardFile))} <span class="muted small">(${a.products.length} products)</span></li>`).join('')}</ul></details>` : ''}
			${rep.unmatched?.length ? `<details style="margin-top: 10px;"><summary class="muted small">Unmatched (${rep.unmatched.length})</summary>
				<ul class="report-list">${rep.unmatched.map(u => `<li>${esc(shortPath(u.cardFile))}</li>`).join('')}</ul></details>` : ''}
			${rep.orphanProducts?.length ? `<details style="margin-top: 10px;"><summary class="muted small">Orphan products (${rep.orphanProducts.length})</summary>
				<ul class="report-list">${rep.orphanProducts.map(o => `<li>${esc(o.product.name)} <span class="muted small">#${o.product.number ?? '—'} · TCGPlayer ${o.product.id}</span></li>`).join('')}</ul></details>` : ''}
		`
	}

	function shortPath(p) {
		const parts = String(p ?? '').replace(/\\/g, '/').split('/')
		return parts.slice(-3).join('/')
	}
}

// ─── Experimental: pick a scraped set and build it into the Experimental repo ───────────────────────────
async function renderExperimental(preselect) {
	closeStream()
	setTopbarStatus('')
	app.innerHTML = `<div class="page page-full">
		<div class="page-head">
			<div>
				<h1 class="page-title">Experimental</h1>
				<div class="page-sub">Write a scraped set into the TCGdex Experimental repo</div>
			</div>
			<div class="toolbar"><a class="btn btn-ghost" href="#/">← Sets</a></div>
		</div>

		<div class="panel" style="margin-bottom: 16px;">
			<div class="panel-head">Repository <span class="muted" id="exp-repo-status"></span></div>
			<div class="panel-body emit-row">
				<label><span>Path to the Experimental repo</span>
					<input class="input" id="exp-repo" type="text" placeholder="H:/TCGDex Experimental">
				</label>
				<button class="btn" id="btn-repo" style="align-self: end;">Use this repo</button>
			</div>
		</div>

		<div class="enrich-grid">
			<div class="panel">
				<div class="panel-head">Set</div>
				<div class="panel-body enrich-form">
					<label><span>Scraped set</span>
						<select class="input" id="exp-set"><option value="">— pick a scraped set —</option></select>
					</label>
					<div class="small muted" id="exp-set-state"></div>
					<details>
						<summary class="small muted" style="cursor: pointer;">Overrides (only when TCGdex doesn't know the set)</summary>
						<div class="enrich-form" style="margin-top: 8px;">
							<label><span>Series id</span><input class="input" id="exp-series" type="text" placeholder="e.g. me"></label>
							<label><span>Series name (English, new series only)</span><input class="input" id="exp-series-name" type="text"></label>
							<label><span>Set name (English)</span><input class="input" id="exp-name" type="text"></label>
							<label><span>Abbreviation</span><input class="input" id="exp-abbr" type="text"></label>
							<label><span>Release date</span><input class="input" id="exp-date" type="text" placeholder="YYYY-MM-DD"></label>
							<label><span>TCGplayer group id (found by name when empty)</span><input class="input" id="exp-group" type="number"></label>
						</div>
					</details>
					<label class="inline"><input type="checkbox" id="exp-overwrite"> Overwrite existing files</label>
					<label class="inline"><input type="checkbox" id="exp-no-tcgdex"> Skip TCGdex description / regulation mark</label>
					<label class="inline"><input type="checkbox" id="exp-no-variants"> Skip variants and Cardmarket / TCGplayer / CardTrader ids</label>
					<div class="small muted">Dry runs write nothing. “Set file” builds the set (and series) file; “Cards” needs it to exist; “Both” does the two in order.</div>
					<div class="toolbar" style="margin-top: 6px; flex-wrap: wrap;">
						<button class="btn" data-run="both" data-apply="0">Dry-run both</button>
						<button class="btn btn-primary" data-run="both" data-apply="1">Apply both</button>
					</div>
					<div class="toolbar" style="flex-wrap: wrap;">
						<button class="btn btn-ghost" data-run="set-meta" data-apply="1">Apply set file</button>
						<button class="btn btn-ghost" data-run="emit" data-apply="0">Dry-run cards</button>
						<button class="btn btn-ghost" data-run="emit" data-apply="1">Apply cards</button>
					</div>
				</div>
			</div>

			<div class="panel">
				<div class="panel-head">Live log <span class="muted" id="exp-log-status">idle</span></div>
				<div class="panel-body"><pre class="enrich-log" id="exp-log">Pick a scraped set and run a dry-run.</pre></div>
			</div>
		</div>

		<div class="panel" style="margin-top: 16px;">
			<div class="panel-head">Sets in the repo <span class="muted" id="exp-count"></span></div>
			<div class="panel-body" id="exp-sets"><div class="muted small">Loading…</div></div>
		</div>
	</div>`

	const $ = (id) => document.getElementById(id)
	const repoInput = $('exp-repo'), repoStatus = $('exp-repo-status'), setSel = $('exp-set')
	const logEl = $('exp-log'), logStatus = $('exp-log-status')
	let state = { repo: '', valid: false, sets: [] }

	function paintState() {
		repoInput.value = state.repo
		repoStatus.textContent = state.valid ? 'ok' : 'not found'
		$('exp-count').textContent = state.valid ? ` · ${state.sets.length} sets` : ''
		const rows = [...state.sets].sort((a, b) => a.series.localeCompare(b.series) || a.name.localeCompare(b.name))
		$('exp-sets').innerHTML = !state.valid
			? `<div class="muted small">${esc(state.error ?? 'No data/pokemon/intl folder at this path.')}</div>`
			: `<div class="sets-grid">${rows.map(r => `<div class="set-tile"><div class="set-tile-id">${esc(r.name)}</div>
				<div class="set-tile-sub"><span class="mono">${esc(r.id)}</span> · ${r.cards} cards<br><span class="small muted">${esc(r.series)}</span></div></div>`).join('')}</div>`
		paintSetState()
	}
	function paintSetState() {
		const hit = state.sets.find(x => x.id === setSel.value)
		$('exp-set-state').textContent = !setSel.value ? '' : hit
			? `In the repo already: ${hit.name} (${hit.cards} card files). Existing files are skipped unless "Overwrite existing files" is ticked.`
			: 'Not in the repo yet: apply the set file first'
	}

	async function loadState() {
		state = await fetch('/api/exp/state').then(r => r.json())
		paintState()
	}
	$('btn-repo').addEventListener('click', async () => {
		const r = await fetch('/api/exp/repo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: repoInput.value }) })
		const body = await r.json()
		if (!r.ok) { repoStatus.textContent = body.error ?? 'Could not use that repo'; return }
		state = body; paintState()
	})
	setSel.addEventListener('change', paintSetState)

	const scraped = await fetch('/api/sets').then(r => r.json())
	setSel.innerHTML = '<option value="">— pick a scraped set —</option>' + scraped.map(x => `<option value="${esc(x)}" ${x === preselect ? 'selected' : ''}>${esc(x)}</option>`).join('')
	await loadState()

	async function run(action, apply) {
		// no alert()/confirm() here: some browsers (the desktop app's) drop them silently, which made Apply do nothing
		if (!setSel.value) { logEl.textContent = 'Pick a scraped set first.' + '\n'; logStatus.textContent = 'idle'; return }
		const body = {
			setId: setSel.value, action, apply,
			overwrite: $('exp-overwrite').checked, noTcgdex: $('exp-no-tcgdex').checked, noVariants: $('exp-no-variants').checked,
			tcgplayerSet: $('exp-group').value ? Number($('exp-group').value) : undefined,
			series: $('exp-series').value, seriesName: $('exp-series-name').value, name: $('exp-name').value,
			abbreviation: $('exp-abbr').value, releaseDate: $('exp-date').value
		}
		const buttons = document.querySelectorAll('[data-run]')
		buttons.forEach(b => b.disabled = true)
		logEl.textContent = ''; logStatus.textContent = 'running…'
		try {
			const res = await fetch('/api/exp/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
			if (!res.ok) throw new Error(await res.text())
			const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''
			while (true) {
				const { value, done } = await reader.read()
				if (done) break
				buf += decoder.decode(value, { stream: true })
				let idx
				while ((idx = buf.indexOf('\n\n')) >= 0) {
					const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
					for (const line of chunk.split('\n')) {
						if (!line.startsWith('data:')) continue
						const payload = JSON.parse(line.slice(5).trim())
						if (payload.type === 'log') { logEl.textContent += payload.line + '\n'; logEl.scrollTop = logEl.scrollHeight }
						else if (payload.type === 'done') { state = payload.state; paintState(); logStatus.textContent = apply ? 'applied' : 'dry-run complete' }
						else if (payload.type === 'error') { logEl.textContent += `\nERROR: ${payload.message}\n`; logStatus.textContent = 'error' }
					}
				}
			}
		} catch (err) {
			logEl.textContent += `\nERROR: ${err?.message ?? err}\n`; logStatus.textContent = 'error'
		} finally {
			buttons.forEach(b => b.disabled = false)
		}
	}
	// Apply buttons ask for a second click (in the button itself) before they write anything
	document.querySelectorAll('[data-run]').forEach(b => {
		b.dataset.label = b.textContent
		let timer = null
		const disarm = () => { clearTimeout(timer); b.dataset.armed = ''; b.textContent = b.dataset.label }
		b.addEventListener('click', () => {
			const apply = b.dataset.apply === '1'
			if (apply && b.dataset.armed !== '1') {
				if (!setSel.value) { logEl.textContent = 'Pick a scraped set first.' + '\n'; return }
				b.dataset.armed = '1'
				b.textContent = 'Click again to write'
				logEl.textContent = `About to write into ${state.repo}${$('exp-overwrite').checked ? ' (existing files will be overwritten)' : ' (existing files are skipped)'}. Click the button again within 5 seconds to confirm.
`
				timer = setTimeout(disarm, 5000)
				return
			}
			disarm()
			run(b.dataset.run, apply)
		})
	})
}

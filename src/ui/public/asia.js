// Asia pages: the overview of its sources, one source's products, and one product's cards with their downloaded images.
// Addresses: #/pokemon/asia, #/pokemon/asia/<source>, #/pokemon/asia/<source>/<code>

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const post = (region, kind, codes = []) => fetch(`/api/asia/run?region=${region}&kind=${kind}&codes=${encodeURIComponent(codes.join(','))}`, { method: 'POST' }).then((r) => r.json())
const base = '#/pokemon/asia'
const crumbs = (...items) => `<div class="page-sub">${items.map((i) => (i.href ? `<a href="${i.href}">${esc(i.label)}</a>` : `<span>${esc(i.label)}</span>`)).join('<span class="sep">/</span>')}</div>`
const overview = async () => (await fetch('/api/asia/overview')).json()

/** #/pokemon/asia: every source Asia gets its cards from, with how far each is. */
export async function renderAsiaOverview(app, { closeStream, setTopbarStatus }) {
	closeStream(); setTopbarStatus('')
	app.innerHTML = `<div class="page"><div class="empty">Loading…</div></div>`
	const sources = await overview()
	app.innerHTML = `<div class="page">
		<div class="page-head"><div>${crumbs({ label: 'Pokémon TCG' }, { label: 'Asia' })}<h1 class="page-title">Asia</h1>
			<div class="page-sub">Where each language's cards are scraped from</div></div></div>
		<div class="sets-grid">${sources.map((s) => {
			const scraped = s.expansions.filter((e) => e.scraped).length
			const cards = s.expansions.reduce((n, e) => n + e.scraped, 0)
			return `<a class="set-tile src-tile${s.scraper ? '' : ' src-planned'}" href="${base}/${esc(s.id)}">
				<div class="set-tile-id">${esc(s.name)} <span class="mono muted">${esc(s.language)}</span></div>
				<div class="set-tile-sub">${esc(s.site)}</div>
				<div class="tile-chips">${s.scraper
					? `<span class="chip ${scraped ? 'ok' : 'off'}"><span class="chip-dot"></span>${scraped} of ${s.expansions.length || '?'} products</span><span class="chip ${cards ? 'ok' : 'off'}"><span class="chip-dot"></span>${cards} cards</span>`
					: `<span class="chip off"><span class="chip-dot"></span>no scraper yet</span>`}</div></a>`
		}).join('')}</div></div>`
}

/** #/pokemon/asia/<source>: the products of one source. */
export async function renderAsiaSource(app, id, { closeStream, setTopbarStatus }) {
	closeStream(); setTopbarStatus('')
	app.innerHTML = `<div class="page"><div class="empty">Loading…</div></div>`
	const s = (await overview()).find((x) => x.id === id)
	if (!s) { app.innerHTML = `<div class="page"><div class="empty">Unknown source</div></div>`; return }
	const head = `<div class="page-head"><div>${crumbs({ label: 'Pokémon TCG' }, { label: 'Asia', href: base }, { label: s.name })}
		<h1 class="page-title">${esc(s.name)}</h1><div class="page-sub">${esc(s.language)} · ${esc(s.site)}</div></div>`
	if (!s.scraper) {
		app.innerHTML = `<div class="page">${head}</div><div class="empty">There is no scraper for ${esc(s.name)} yet (${esc(s.site)}).</div></div>`
		return
	}
	app.innerHTML = `<div class="page">${head}
		<div class="toolbar"><input class="search" id="asia-q" type="search" placeholder="Filter by code or title…" autocomplete="off">
			<button class="btn" id="asia-list">${s.running.includes('expansions') ? 'Listing…' : 'Refresh product list'}</button></div></div>
		<div id="asia-body"></div></div>`
	const body = document.getElementById('asia-body'), q = document.getElementById('asia-q')
	const draw = () => {
		const needle = q.value.trim().toLowerCase()
		const list = s.expansions.filter((e) => !needle || e.code.toLowerCase().includes(needle) || e.title.toLowerCase().includes(needle))
		if (!s.expansions.length) { body.innerHTML = `<div class="empty">No product list yet. Use “Refresh product list”.</div>`; return }
		// grouped by the series heading the portal puts them under, in the order the portal lists them (newest first)
		const groups = new Map()
		for (const e of list) { const k = e.series ?? 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e) }
		body.innerHTML = [...groups].map(([series, items]) => `<div class="section-label">${esc(series)} <span class="muted">${items.length}</span></div>
			<div class="sets-grid">${items.map((e) => `<div class="set-tile asia-tile">
				<a class="asia-tile-link" href="${base}/${esc(s.id)}/${encodeURIComponent(e.code)}">
					<div class="set-tile-id"><span class="mono">${esc(e.code)}</span></div>
					<div class="set-tile-sub">${esc(e.title)}${e.englishName ? `<br><span class="muted">${esc(e.englishName)}</span>` : ''}${e.releaseDate ? `<br><span class="small muted">${esc(e.releaseDate)}</span>` : ''}</div></a>
				<div class="asia-tile-foot"><span class="chip ${e.scraped ? 'ok' : 'off'}"><span class="chip-dot"></span>${e.scraped ? `${e.scraped} cards` : 'not scraped'}</span>
					<button class="btn btn-ghost" data-code="${esc(e.code)}">${e.scraped ? 'Rescrape' : 'Scrape'}</button></div></div>`).join('')}</div>`).join('')
	}
	draw()
	q.addEventListener('input', draw)
	document.getElementById('asia-list').addEventListener('click', async (e) => { e.target.disabled = true; e.target.textContent = (await post(s.id, 'expansions')).started ? 'Started (see terminal)' : 'Already running' })
	body.addEventListener('click', async (e) => {
		const b = e.target.closest('button[data-code]')
		if (!b) return
		b.disabled = true
		b.textContent = (await post(s.id, 'scrape', [b.dataset.code])).started ? 'Started (see terminal)' : 'Already running'
	})
}

/** the set's English name from its enriched cards: TCG Collector's, else TCGplayer's */
const setEnglish = (cards) => cards.find((c) => c.collector)?.collector.name ?? cards.find((c) => c.tcgplayerSetName)?.tcgplayerSetName ?? ''
const energy = (t) => `<span class="energy-chip e-${esc(String(t).toLowerCase())}" title="${esc(t)}">${esc(String(t)[0])}</span>`
const row = (k, v) => (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? '' : `<dt>${esc(k)}</dt><dd>${v}</dd>`)

/** The card's detail window. ← → move to the neighbouring card, Esc closes. */
function openCard(c, image, all) {
	document.getElementById('asia-modal')?.remove()
	const root = document.createElement('div')
	root.id = 'asia-modal'
	root.className = 'modal-root'
	const i = all.findIndex((x) => x.cardId === c.cardId)
	const skills = c.skills.map((s) => `<div class="attack-row">
		<div class="attack-cost">${s.cost.map(energy).join('')}</div>
		<div class="attack-head"><span class="attack-name">${esc(s.name ?? '')}${s.section ? `<span class="attack-tag">${esc(s.section)}</span>` : ''}</span>${s.damage ? `<span class="attack-damage">${esc(s.damage)}</span>` : ''}</div>
		${s.effect ? `<div class="attack-effect">${esc(s.effect)}</div>` : ''}</div>`).join('')
	const pairs = (a) => a.map((w) => `${energy(w.type)}${esc(w.value ?? '')}`).join(' ')
	const ids = (p) => Object.entries(p ?? {}).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${esc(v)}`).join('<br>')
	const variants = c.variants?.length ? `<table class="variant-table"><tr><th>Type</th><th>Foil</th><th>Size</th><th>Stamps</th><th>Provider ids</th></tr>${c.variants.map((v) => `<tr><td>${esc(v.type)}</td><td>${esc(v.foil ?? '')}</td><td>${esc(v.size ?? '')}</td><td>${esc((v.stamps ?? []).join(', '))}</td><td class="mono small">${ids(v.prices) || '<span class="muted">none</span>'}</td></tr>`).join('')}</table>` : ''
	const dex = c.tcgdex
	root.innerHTML = `<div class="modal-backdrop"></div><div class="modal" role="dialog" aria-modal="true">
		<div class="modal-head"><div class="modal-head-title"><span class="num">${esc(c.collectorNumber ?? '')}</span><span class="name">${esc(c.name)}</span></div>
			<div class="modal-head-actions"><button class="btn btn-ghost" data-nav="-1" ${i <= 0 ? 'disabled' : ''}>←</button><button class="btn btn-ghost" data-nav="1" ${i >= all.length - 1 ? 'disabled' : ''}>→</button>
			<a class="btn btn-ghost" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">portal ↗</a><button class="btn btn-ghost" data-close>✕</button></div></div>
		<div class="modal-body"><div class="detail">
			<div class="detail-image">${image ? `<img src="${image}" alt="${esc(c.name)}">` : '<div class="empty">no image</div>'}<div class="detail-image-cap">${esc(c.cardId)}</div></div>
			<div class="detail-main">
				<div class="panel"><div class="panel-body"><h2 class="detail-name">${esc(c.name)}${c.hp ? `<span class="hp"><strong>${c.hp}</strong> HP</span>` : ''}</h2><dl class="dl">
					${row('Stage', esc(c.stageLabel))}${row('Type', c.types.map(energy).join(''))}${row('Rarity', esc(c.rarity))}${row('Regulation', esc(c.regulationMark))}
					${row('Weakness', pairs(c.weakness))}${row('Resistance', pairs(c.resistance))}${row('Retreat', c.retreat !== null ? esc(c.retreat) : '')}
					${row('Illustrator', esc(c.illustrator))}${row('Pokédex', c.dexNumber ? esc(`#${c.dexNumber}${c.species ? ` ${c.species}` : ''}`) : '')}${row('Size', esc([c.height, c.weight].filter(Boolean).join(' · ')))}
					${row('Evolves', esc((c.evolution ?? []).join(' → ')))}${row('Name language', esc(c.nameLanguage))}</dl></div></div>
				${skills ? `<div class="panel"><div class="panel-head">Text</div><div class="panel-body">${skills}</div></div>` : ''}
				${c.flavorText ? `<div class="panel"><div class="panel-head">Flavor text</div><div class="panel-body attack-effect">${esc(c.flavorText)}</div></div>` : ''}
				<div class="panel"><div class="panel-head">Enrichment <span class="muted">${c.enrichedAt ? esc(c.enrichedAt.slice(0, 10)) : 'not enriched'}</span></div><div class="panel-body">
					${dex ? `<dl class="dl">${row('TCGdex rarity', esc(dex.rarity))}${row('TCGdex mark', esc(dex.regulationMark))}${row('TCGdex stage', esc(dex.stage))}${row('TCGdex dex', esc((dex.dexId ?? []).join(', ')))}${row('TCGdex text', esc(dex.description))}</dl>` : '<div class="muted small">No TCGdex card matched.</div>'}
					${c.tcgplayerSet ? `<div class="small muted" style="margin-top:8px">TCGplayer group ${esc(c.tcgplayerSet)}</div>` : ''}
					${c.collector ? `<div class="small muted" style="margin-top:8px">TCG Collector: “${esc(c.collector.name)}” · ${esc(c.collector.cards ?? '?')} cards · ${esc(c.collector.variantCards ?? '?')} counting every variant</div>` : ''}</div></div>
				<div class="panel"><div class="panel-head">Variants <span class="muted">${c.variants?.length ?? 0}</span></div><div class="panel-body">${variants || '<div class="muted small">None yet. Run Enrich.</div>'}</div></div>
			</div></div></div></div>`
	const close = () => { root.remove(); document.removeEventListener('keydown', onKey) }
	const go = (d) => { const n = all[i + d]; if (n) { close(); openCard(n, n.imageFile ? `/asia-img/${n.imageFile.split('/').map(encodeURIComponent).join('/')}` : '', all) } }
	const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1) }
	root.addEventListener('click', (e) => {
		if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) close()
		const nav = e.target.closest('[data-nav]')
		if (nav) go(Number(nav.dataset.nav))
	})
	document.addEventListener('keydown', onKey)
	document.body.appendChild(root)
}

/** #/pokemon/asia/<source>/<code>: one product's cards as images, with the fields the portal gave. */
export async function renderAsiaSet(app, region, code, { closeStream, setTopbarStatus }) {
	closeStream(); setTopbarStatus('')
	app.innerHTML = `<div class="page"><div class="empty">Loading…</div></div>`
	const fetchCards = async () => (await fetch(`/api/asia/cards?region=${encodeURIComponent(region)}&code=${encodeURIComponent(code)}`)).json()
	let data = await fetchCards()
	if (data.error) { app.innerHTML = `<div class="page"><div class="empty">${esc(data.error)}</div></div>`; return }
	const sourceName = (await overview()).find((x) => x.id === region)?.name ?? region
	// what the page shows depends on this; when it changes (a card or image arrives, enrich finishes) the page is drawn again
	const signature = (d) => `${d.cards.length}|${d.cards.filter((c) => c.imageFile).length}|${d.cards.filter((c) => c.enrichedAt).length}|${d.cards.filter((c) => c.variants?.length).length}`
	const paint = () => {
	const { cards, expansion } = data
	const enriched = cards.map((c) => c.enrichedAt).filter(Boolean).sort().pop()
	const withVariants = cards.filter((c) => c.variants?.length).length
	const withTcgdex = cards.filter((c) => c.tcgdex).length
	const img = (c) => (c.imageFile ? `/asia-img/${c.imageFile.split('/').map(encodeURIComponent).join('/')}` : '')
	app.innerHTML = `<div class="page">
		<div class="page-head"><div>
			${crumbs({ label: 'Pokémon TCG' }, { label: 'Asia', href: base }, { label: sourceName, href: `${base}/${region}` }, { label: code })}
			<h1 class="page-title"><span class="mono">${esc(code)}</span> ${esc(expansion?.title ?? '')}${setEnglish(cards) ? ` <span class="muted">${esc(setEnglish(cards))}</span>` : ''}</h1>
			<div class="page-sub">${esc(data.language)}${expansion?.releaseDate ? ` · ${esc(expansion.releaseDate)}` : ''} · ${cards.length} cards · ${cards.filter((c) => c.imageFile).length} images</div></div>
			<div class="toolbar">
				<input class="search" id="asia-cq" type="search" placeholder="Filter by name or number…" autocomplete="off">
			</div></div>
		<div class="flow" id="asia-flow">
			<div class="flow-step ${cards.length ? 'done' : ''}"><span class="flow-n">1</span><div><b>Scrape</b><span class="flow-sub">${cards.length ? `${cards.length} cards · ${cards.filter((c) => c.imageFile).length} images` : 'not scraped'}</span></div>
				<button class="btn" id="asia-scrape">${cards.length ? 'Rescrape' : 'Scrape'}</button><button class="btn btn-ghost" id="asia-images">Images</button></div>
			<div class="flow-step ${enriched ? 'done' : ''}"><span class="flow-n">2</span><div><b>Enrich</b><span class="flow-sub">${enriched ? `${withVariants} with variants · ${withTcgdex} from TCGdex · ${esc(enriched.slice(0, 10))}` : 'TCGdex, finishes, provider ids'}</span></div>
				<button class="btn" id="asia-enrich" ${cards.length ? '' : 'disabled'}>${enriched ? 'Enrich again' : 'Enrich'}</button></div>
			<div class="flow-step"><span class="flow-n">3</span><div><b>Emit</b><span class="flow-sub">series, set and card files in the Experimental repo</span></div>
				<button class="btn" id="asia-dry" ${cards.length ? '' : 'disabled'}>Dry run</button><button class="btn btn-primary" id="asia-write" ${cards.length ? '' : 'disabled'}>Write files</button></div>
		</div>
		${cards.length ? `<div class="card-grid" id="asia-grid">${cards.map((c) => `<div class="card-tile" style="cursor:pointer" data-id="${esc(c.cardId)}" data-q="${esc((c.name + ' ' + (c.collectorNumber ?? '')).toLowerCase())}">
			${img(c) ? `<img class="card-img" loading="lazy" src="${img(c)}" alt="${esc(c.name)}">` : `<div class="card-img card-img-missing">no image</div>`}
			<div class="tile-meta">
				<div class="tile-head"><span class="tile-id">${esc(c.collectorNumber ?? '')}</span><span class="tile-name">${esc(c.name)}</span></div>
				<div class="tile-sub">${esc([c.rarity, c.hp ? c.hp + ' HP' : '', c.regulationMark, c.nameLanguage ? `${c.nameLanguage} name` : ''].filter(Boolean).join(' · '))}</div>
				<div class="tile-chips">${c.types.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}${c.variants?.length ? `<span class="chip ok" title="${esc(c.variants.map((v) => [v.type, v.foil].filter(Boolean).join(' ')).join('\n'))}"><span class="chip-dot"></span>${c.variants.length} variant${c.variants.length === 1 ? '' : 's'}</span>` : ''}<a class="chip" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">portal ↗</a></div>
			</div></div>`).join('')}</div>` : `<div class="empty">Nothing scraped for this product yet.</div>`}
	</div>`
	document.getElementById('asia-cq').addEventListener('input', (e) => {
		const n = e.target.value.trim().toLowerCase()
		document.querySelectorAll('#asia-grid .card-tile').forEach((t) => { t.hidden = !!n && !t.dataset.q.includes(n) })
	})
	// clicking a card opens everything known about it (the portal's fields, then what enrich added)
	document.getElementById('asia-grid')?.addEventListener('click', (e) => {
		if (e.target.closest('a')) return // the "portal" link opens the portal page
		const t = e.target.closest('.card-tile')
		const c = t && cards.find((x) => x.cardId === t.dataset.id)
		if (c) openCard(c, img(c), cards)
	})
	const run = (kind) => async (e) => { e.target.disabled = true; const r = await post(region, kind, [code]); e.target.textContent = r.started ? 'Started (see terminal)' : 'Already running' }
	document.getElementById('asia-scrape').addEventListener('click', run('scrape'))
	document.getElementById('asia-images').addEventListener('click', run('images'))
	document.getElementById('asia-enrich').addEventListener('click', run('enrich'))
	// the dry run scrapes and enriches what is missing and reports what would be written; "Write files" does write them
	document.getElementById('asia-dry').addEventListener('click', run('build'))
	document.getElementById('asia-write').addEventListener('click', (e) => {
		if (confirm(`Write ${code}'s series, set and card files into the Experimental repo?\n\nIt adds files; a card file that exists gets this language added to it.`)) run('write')(e)
	})
	}
	paint()
	// live: while the page is open, ask for the cards every 2 seconds and draw again only when something changed
	const timer = setInterval(async () => {
		if (!document.getElementById('asia-flow')) { clearInterval(timer); return } // another page replaced this one
		try {
			const next = await fetchCards()
			if (next.error || signature(next) === signature(data)) return
			const q = document.getElementById('asia-cq'), filter = q?.value ?? '', focused = document.activeElement === q, y = window.scrollY
			data = next
			paint()
			const nq = document.getElementById('asia-cq')
			if (filter) { nq.value = filter; nq.dispatchEvent(new Event('input')) }
			if (focused) nq.focus()
			window.scrollTo(0, y)
		} catch { /* the server is restarting: try again next time */ }
	}, 2000)
}

// Catalog: what is in the Experimental repo and what can be scraped, as dropdowns.
// Loaded by app.js; reads /api/catalog (src/ui/catalog.ts). Read-only.

const STATE_LABEL = { 'in-experimental': 'In Experimental', scraped: 'Scraped', ready: 'Ready to scrape', skipped: 'Cannot scrape' }
const STATE_CLASS = { 'in-experimental': 'ok', scraped: 'info', ready: 'warn', skipped: 'off' }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Draws the page into `app`. `closeStream` and `setTopbarStatus` are the app's, passed in so this file stands alone. */
export async function renderCatalog(app, { closeStream, setTopbarStatus }) {
	closeStream()
	setTopbarStatus('')
	app.innerHTML = `<div class="page">
		<div class="page-head">
			<div><h1 class="page-title">Catalog</h1><div class="page-sub" id="cat-sub">Loading…</div></div>
			<div class="toolbar">
				<input class="search" id="cat-q" type="search" placeholder="Filter sets, ids, series…" autocomplete="off">
				<button class="btn" id="cat-open">Expand all</button>
				<button class="btn btn-ghost" id="cat-close">Collapse all</button>
			</div>
		</div>
		<div class="cat-filters" id="cat-filters"></div>
		<div class="section-label">In the Experimental repo</div>
		<div id="cat-exp"></div>
		<div class="section-label" style="margin-top: 28px;">What can be scraped</div>
		<div id="cat-scrape"></div>
		<div class="empty" id="cat-none" hidden>Nothing matches.</div>
	</div>`
	const $ = (id) => document.getElementById(id)
	let data
	try { data = await fetch('/api/catalog').then((r) => r.json()) } catch (err) { $('cat-sub').textContent = `Could not load the catalog: ${err?.message ?? err}`; return }

	const all = data.series.flatMap((s) => s.sets)
	const inRepo = all.filter((s) => s.experimental !== null)
	const known = all.filter((s) => s.known)
	const count = (state) => known.filter((s) => s.state === state).length
	$('cat-sub').innerHTML = (data.repoValid ? '' : `<span class="cat-warn">Experimental repo not found at <span class="mono">${esc(data.repo)}</span>.</span> `)
		+ `<span><strong>${inRepo.length}</strong> in Experimental</span><span class="sep">·</span><span><strong>${known.length}</strong> in the registry</span>`
		+ `<span class="sep">·</span><span><strong>${all.filter((s) => s.scraped).length}</strong> scraped</span>`
		+ (data.registryGeneratedAt ? `<span class="sep">·</span><span>registry from ${esc(data.registryGeneratedAt.slice(0, 10))}</span>` : '<span class="sep">·</span><span>no registry: run <span class="mono">bun run registry</span></span>')

	let filter = ''
	const filters = [['', `All (${known.length})`], ...['in-experimental', 'scraped', 'ready', 'skipped'].map((k) => [k, `${STATE_LABEL[k]} (${count(k)})`])]
	$('cat-filters').innerHTML = filters.map(([k, label]) => `<button class="btn cat-chip" data-state="${k}" aria-pressed="${k === filter}">${esc(label)}</button>`).join('')

	const badge = (s) => `<span class="chip ${STATE_CLASS[s.state]}"><span class="chip-dot"></span>${STATE_LABEL[s.state]}</span>`
	const cards = (s) => s.official && s.total && s.official !== s.total ? `${s.official} + ${s.total - s.official}` : (s.total ?? s.official ?? '–')
	const group = (title, id, chips, table) => `<details class="cat-group" data-find="${esc((title + ' ' + id).toLowerCase())}">
		<summary><span class="cat-name">${esc(title)}</span><span class="muted small">${esc(id)}</span><span class="cat-grow"></span>${chips}</summary>
		<div class="cat-body">${table}</div></details>`

	// section 1: what is in the repo, by series
	const expSeries = data.series.map((s) => ({ ...s, sets: s.sets.filter((x) => x.experimental !== null) })).filter((s) => s.sets.length)
	$('cat-exp').innerHTML = expSeries.length ? expSeries.map((s) => group(s.name, s.id,
		`<span class="chip">${s.sets.length} sets</span><span class="chip">${s.sets.reduce((t, x) => t + x.experimental, 0)} cards</span>`,
		`<table class="variant-table cat-table"><thead><tr><th>Set</th><th>Id</th><th>Released</th><th class="num">Card files</th><th class="num">Expected</th></tr></thead><tbody>${s.sets.map((x) => {
			const short = x.total !== null && x.experimental < x.total
			return `<tr data-find="${esc((x.name + ' ' + x.id).toLowerCase())}"><td>${esc(x.name)}</td><td class="mono">${esc(x.id)}</td><td>${esc(x.releaseDate ?? '–')}</td><td class="num ${short ? 'cat-short' : ''}">${x.experimental}</td><td class="num">${x.total ?? '–'}</td></tr>`
		}).join('')}</tbody></table>`)).join('')
		: `<div class="empty">${data.repoValid ? 'No sets in the repo yet.' : 'Set the repo path on the Experimental tab.'}</div>`

	// section 2: everything the registry lists, by series, with where each stands
	const scrapeSeries = data.series.map((s) => ({ ...s, sets: s.sets.filter((x) => x.known) })).filter((s) => s.sets.length)
	$('cat-scrape').innerHTML = scrapeSeries.length ? scrapeSeries.map((s) => {
		const ready = s.sets.filter((x) => x.state === 'ready').length
		const chips = `<span class="chip">${s.sets.length} sets</span>${ready ? `<span class="chip warn"><span class="chip-dot"></span>${ready} to scrape</span>` : ''}`
		const rows = s.sets.map((x) => `<tr data-find="${esc((x.name + ' ' + x.id + ' ' + (x.slug ?? '')).toLowerCase())}" data-state="${x.state}">
			<td>${x.scraped ? `<a href="#/${encodeURIComponent(x.id)}">${esc(x.name)}</a>` : esc(x.name)}</td><td class="mono">${esc(x.id)}</td><td>${esc(x.releaseDate ?? '–')}</td><td class="num">${cards(x)}</td>
			<td class="mono">${x.slug ? esc(x.slug) : '<span class="muted">none</span>'}</td><td class="mono">${x.tcgplayerGroup ?? '<span class="muted">none</span>'}</td>
			<td>${badge(x)}${x.scraped ? ` <span class="muted small">${x.scraped} cached</span>` : ''}${x.skip ? `<div class="small muted">${esc(x.skip)}</div>` : ''}${x.notes.map((n) => `<div class="small muted">${esc(n)}</div>`).join('')}</td>
			<td class="cat-actions">${x.slug && !x.skip ? `<button class="btn cat-scrape" data-set="${esc(x.id)}" data-fresh="0" title="Scrape, reusing cached pages">Scrape</button><button class="btn cat-scrape" data-set="${esc(x.id)}" data-fresh="1" title="Scrape and download every page again, replacing the cache">Without cache</button><span class="small muted cat-run"></span>` : ''}</td></tr>`).join('')
		return group(s.name, s.id, chips, `<table class="variant-table cat-table"><thead><tr><th>Set</th><th>Id</th><th>Released</th><th class="num">Cards</th><th>pokemon.com</th><th>TCGplayer</th><th>Status</th><th>Scrape</th></tr></thead><tbody>${rows}</tbody></table>`)
	}).join('') : '<div class="empty">No registry. Run <code>bun run registry</code> to list every set that can be scraped.</div>'

	// the search text matches a row or its series; the status chip applies to the scrape table (the repo table is all "in Experimental")
	function apply() {
		const q = $('cat-q').value.trim().toLowerCase()
		const hit = (tr) => !q || tr.dataset.find.includes(q) || tr.closest('details').dataset.find.includes(q)
		for (const tr of app.querySelectorAll('tbody tr[data-find]')) {
			const inRepoTable = $('cat-exp').contains(tr)
			const stateOk = !filter || (inRepoTable ? filter === 'in-experimental' : tr.dataset.state === filter)
			tr.hidden = !(stateOk && hit(tr))
		}
		let shown = 0
		for (const d of app.querySelectorAll('details.cat-group')) {
			const visible = d.querySelector('tbody tr:not([hidden])') !== null
			d.hidden = !visible
			if (visible) shown++
			if ((q || filter) && visible) d.open = true
		}
		// a section heading with nothing under it is hidden too
		for (const id of ['cat-exp', 'cat-scrape']) $(id).previousElementSibling.hidden = !!(q || filter) && !$(id).querySelector('details.cat-group:not([hidden])')
		$('cat-none').hidden = shown > 0
	}
	$('cat-q').addEventListener('input', apply)
	$('cat-filters').addEventListener('click', (e) => {
		const b = e.target.closest('button[data-state]'); if (!b) return
		filter = b.dataset.state
		for (const x of $('cat-filters').children) x.setAttribute('aria-pressed', String(x.dataset.state === filter))
		apply()
	})
	$('cat-open').addEventListener('click', () => app.querySelectorAll('details.cat-group:not([hidden])').forEach((d) => { d.open = true }))
	$('cat-close').addEventListener('click', () => app.querySelectorAll('details.cat-group').forEach((d) => { d.open = false }))

	// Scrape buttons: start the job on the server, then watch it until it is done
	app.addEventListener('click', async (e) => {
		const b = e.target.closest('button.cat-scrape'); if (!b) return
		const cell = b.closest('td'), note = cell.querySelector('.cat-run'), id = b.dataset.set
		const buttons = cell.querySelectorAll('button')
		buttons.forEach((x) => { x.disabled = true })
		note.textContent = 'starting…'
		try {
			const r = await fetch('/api/catalog/scrape', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setId: id, fresh: b.dataset.fresh === '1' }) })
			const body = await r.json()
			if (!r.ok && r.status !== 409) throw new Error(body.error ?? 'could not start')
			note.textContent = (b.dataset.fresh === '1' ? 'scraping without cache…' : 'scraping…') + ' a browser window opens'
			// the status route says which jobs of the set are running; the log is in the server's terminal
			for (;;) {
				await new Promise((res) => setTimeout(res, 3000))
				const st = await fetch(`/api/sets/${encodeURIComponent(id)}/status`).then((x) => x.json())
				if (!st.running.includes('scrape')) break
			}
			const cached = (await fetch(`/api/sets/${encodeURIComponent(id)}/cards`).then((x) => x.json())).length
			note.textContent = `done: ${cached} cards cached`
		} catch (err) {
			note.textContent = `failed: ${err?.message ?? err}`
		} finally {
			buttons.forEach((x) => { x.disabled = false })
		}
	})
}

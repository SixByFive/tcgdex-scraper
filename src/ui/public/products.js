// Products: a set's sealed products as the scraper builds them, with where every id and line came from, so they can be checked and
// corrected before they are written to the Experimental repo. Loaded by app.js; talks to /api/products/* (src/ui/server.ts).
// A correction is saved in registry/product-fixes.json and applied on top of whatever the scraper builds next time.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const TYPES = ['booster-pack', 'booster-box', 'booster-bundle', 'elite-trainer-box', 'build-and-battle', 'theme-deck', 'tin', 'blister', 'collection', 'premium-collection', 'binder-collection', 'promo-pack', 'fun-pack', 'battle-deck']
const link = {
	tcgplayer: (id) => `https://www.tcgplayer.com/product/${id}`,
	cardmarket: (id) => `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${id}`
}
const variantKey = (v) => [v.exclusive, v.artwork].filter(Boolean).join('-') || 'standard'
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json())

export async function renderProducts(app, setId, { closeStream, setTopbarStatus }) {
	closeStream()
	setTopbarStatus('')
	app.innerHTML = `<div class="page page-full">
		<div class="page-head">
			<div><h1 class="page-title">Products</h1><div class="page-sub" id="pr-sub">Loading…</div></div>
			<div class="toolbar"><input class="search" id="pr-q" type="search" placeholder="Filter sets…" autocomplete="off"></div>
		</div>
		<div class="pr-layout">
			<div class="pr-sets" id="pr-sets"></div>
			<div class="pr-main" id="pr-main"><div class="empty">Choose a set.</div></div>
		</div>
	</div>`
	const $ = (id) => document.getElementById(id)
	let list
	try { list = await fetch('/api/products/sets').then((r) => r.json()) } catch (err) { $('pr-sub').textContent = `Could not load: ${err?.message ?? err}`; return }
	$('pr-sub').innerHTML = `Builds a set's sealed products from TCGTracking and Cardmarket, writes them to <span class="mono">${esc(list.repo)}</span>`

	const drawList = (q = '') => {
		const needle = q.trim().toLowerCase()
		$('pr-sets').innerHTML = list.sets.filter((s) => !needle || `${s.name} ${s.id} ${s.series}`.toLowerCase().includes(needle)).map((s) =>
			`<a class="pr-set" href="#/products/${encodeURIComponent(s.id)}" aria-current="${s.id === setId}"><span class="pr-set-name">${esc(s.name)}</span>
			<span class="muted small mono">${esc(s.id)}</span><span class="pr-set-chips">${s.written ? `<span class="chip ok"><span class="chip-dot"></span>${s.written} written</span>` : ''}${s.fixes ? `<span class="chip warn"><span class="chip-dot"></span>${s.fixes} fixes</span>` : ''}</span></a>`).join('')
	}
	drawList()
	$('pr-q').addEventListener('input', (e) => drawList(e.target.value))
	if (setId) await drawSet(setId)

	async function drawSet(id, refresh = false) {
		const main = $('pr-main')
		main.innerHTML = '<div class="empty">Building… (the first time this fetches TCGTracking and Cardmarket)</div>'
		let data
		try { data = await fetch(`/api/products/set/${encodeURIComponent(id)}${refresh ? '?refresh=1' : ''}`).then((r) => r.json()) } catch (err) { main.innerHTML = `<div class="empty">${esc(err?.message ?? err)}</div>`; return }
		if (data.error) { main.innerHTML = `<div class="empty">${esc(data.error)}</div>`; return }
		show(data)
	}

	function show(data) {
		const main = $('pr-main')
		const cardName = (id) => data.cardNames?.[id] ?? ''
		const reviewOf = (id) => data.review[id] ?? { members: [] }
		const unlinkedFor = (id) => data.promos.unlinked.filter((u) => u.startsWith(id + ':') || u.startsWith(id + ' '))
		const fixesFor = (id) => data.fixes.filter((f) => f.product === id)
		const leftOut = new Set(data.fixes.filter((f) => f.op === 'exclude').map((f) => f.product))
		const files = data.built // every product the scraper built, including those a fix leaves out
		const cmMissing = (id) => reviewOf(id).members.some((m) => !m.cardmarketId)
		const line = (c) => c.product ? `<span class="mono">${esc(c.product)}</span>` : c.card ? `<span class="mono">${esc(c.card)}</span> ${esc(cardName(c.card))}` : c.oneOf ? `one of ${c.oneOf.map((x) => `<span class="mono">${esc(x)}</span> ${esc(cardName(x))}`).join(' / ')}` : esc(c.item?.en ?? '')
		const chip = (cls, t) => `<span class="chip ${cls}"><span class="chip-dot"></span>${esc(t)}</span>`

		main.innerHTML = `
			<div class="pr-head">
				<div><h2 class="pr-title">${esc(data.set.name)} <span class="muted small mono">${esc(data.set.id)}</span></h2>
					<div class="muted small">${files.length} products built, ${data.inRepo.length} already in the repo · TCGTracking list fetched ${esc(data.fetchedAt.slice(0, 16).replace('T', ' '))}</div></div>
				<div class="toolbar"><button class="btn" id="pr-refresh">Refetch</button><button class="btn btn-primary" id="pr-write">Write ${data.files.length} to repo</button></div>
			</div>
			<div class="pr-notes">
				${data.skipped.length ? `<details><summary>${data.skipped.length} products have no type and are left out</summary><ul class="report-list">${data.skipped.map((s) => `<li>${esc(s.name)} <span class="muted small">TCGplayer ${s.id}</span></li>`).join('')}</ul></details>` : ''}
				${data.cardmarket.unmatched.length ? `<details><summary>${data.cardmarket.unmatched.length} products have no Cardmarket id</summary><ul class="report-list">${data.cardmarket.unmatched.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
				${data.cardmarket.conflicts.length ? `<details open><summary>${data.cardmarket.conflicts.length} Cardmarket ids where the sources disagree</summary><ul class="report-list">${data.cardmarket.conflicts.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
				${data.promos.unlinked.length ? `<details><summary>${data.promos.unlinked.length} promo cards not linked</summary><ul class="report-list">${data.promos.unlinked.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
			</div>
			<table class="variant-table pr-table"><thead><tr><th>Product</th><th>Type</th><th class="num">Variants</th><th class="num">Contents</th><th>Checks</th></tr></thead><tbody>
				${files.map((p) => `<tr class="pr-row" data-id="${esc(p.id)}"><td><div>${esc(p.name.en)}</div><div class="muted small mono">${esc(p.id)}</div></td><td>${esc(p.type)}</td>
					<td class="num">${p.variants.length}</td><td class="num">${p.contents?.length ?? 0}</td>
					<td>${leftOut.has(p.id) ? chip('off', 'left out') : ''}${fixesFor(p.id).filter((f) => f.op !== 'exclude').length ? chip('warn', 'fixed') : ''}${cmMissing(p.id) ? chip('warn', 'no Cardmarket id') : ''}${unlinkedFor(p.id).length ? chip('info', 'promo not linked') : ''}${data.inRepo.includes(p.id) ? chip('ok', 'in repo') : ''}</td></tr>
					<tr class="pr-detail" data-for="${esc(p.id)}" hidden><td colspan="5"></td></tr>`).join('')}
			</tbody></table>`

		$('pr-refresh').onclick = () => drawSet(data.set.id, true)
		$('pr-write').onclick = async (e) => {
			e.target.disabled = true
			const r = await fetch(`/api/products/set/${encodeURIComponent(data.set.id)}/write`, { method: 'POST' }).then((x) => x.json())
			e.target.textContent = r.error ? r.error : `Wrote ${r.written.length}`
			const l = await fetch('/api/products/sets').then((x) => x.json()); list = l; drawList($('pr-q').value)
		}
		main.querySelectorAll('.pr-row').forEach((row) => row.addEventListener('click', () => {
			const d = main.querySelector(`.pr-detail[data-for="${CSS.escape(row.dataset.id)}"]`)
			d.hidden = !d.hidden
			if (!d.hidden && !d.firstElementChild.firstElementChild) detail(d.firstElementChild, files.find((p) => p.id === row.dataset.id))
		}))

		/** Saves a correction, then rebuilds from the saved list (no refetch) so the page shows exactly what will be written. */
		async function fix(f, undo = false) {
			await post(undo ? '/api/products/unfix' : '/api/products/fix', { set: data.set.id, ...f })
			const open = [...main.querySelectorAll('.pr-detail:not([hidden])')].map((x) => x.dataset.for)
			const fresh = await fetch(`/api/products/set/${encodeURIComponent(data.set.id)}`).then((r) => r.json())
			show(fresh)
			for (const id of open) { const row = $('pr-main').querySelector(`.pr-row[data-id="${CSS.escape(id)}"]`); row?.click() }
		}

		function detail(cell, p) {
			const rev = reviewOf(p.id)
			const mine = fixesFor(p.id)
			const final = data.files.find((x) => x.id === p.id) ?? p // what is written, corrections applied
			cell.innerHTML = `<div class="pr-detail-body">
				<div class="pr-cols">
					<div>
						<div class="section-label">Variants and ids</div>
						<table class="variant-table"><thead><tr><th>Variant</th><th>TCGplayer</th><th>Cardmarket</th><th>CardTrader</th></tr></thead><tbody>
						${rev.members.map((m) => {
							const v = final.variants.find((x) => variantKey(x) === m.variant)
							const cm = v?.prices?.cardmarket, tp = v?.prices?.tcgplayer, ct = v?.prices?.cardtrader
							return `<tr><td class="mono">${esc(m.variant)}</td>
								<td>${tp ? `<a href="${link.tcgplayer(tp)}" target="_blank" rel="noreferrer" class="mono">${tp}</a>` : '–'}<div class="muted small">${esc(m.tcgplayerName)}</div><button class="btn btn-ghost pr-id" data-v="${esc(m.variant)}" data-p="tcgplayer">edit</button></td>
								<td>${cm ? `<a href="${link.cardmarket(cm)}" target="_blank" rel="noreferrer" class="mono">${cm}</a>` : '–'}${m.cardmarketId && cm === m.cardmarketId ? `<div class="muted small">${esc(m.cardmarketName ?? 'not in the catalogue')} · ${esc(m.cardmarketHow)}</div>` : ''}<button class="btn btn-ghost pr-id" data-v="${esc(m.variant)}" data-p="cardmarket">edit</button></td>
								<td>${ct ? `<span class="mono">${ct}</span>` : '–'}<button class="btn btn-ghost pr-id" data-v="${esc(m.variant)}" data-p="cardtrader">edit</button></td></tr>`
						}).join('')}</tbody></table>
						<div class="section-label" style="margin-top:14px">Contents${JSON.stringify(final.contents) === JSON.stringify(p.contents) ? '' : ' (corrected)'}</div>
						${final.contents?.length ? `<ul class="pr-contents">${final.contents.map((c) => `<li><span class="muted">${c.quantity}×</span> ${line(c)}</li>`).join('')}</ul>` : '<div class="muted small">None: the description has no list.</div>'}
						${final.variants.some((v) => v.contents) ? `<div class="muted small">Variants change these: ${final.variants.filter((v) => v.contents).map((v) => `${esc(variantKey(v))} → ${v.contents.filter((c) => c.quantity > 0).map(line).join(', ')}`).join('; ')}</div>` : ''}
						${unlinkedFor(p.id).map((u) => `<div class="muted small">⚠ ${esc(u)}</div>`).join('')}
						<details style="margin-top:8px"><summary class="muted small">Edit contents (JSON)</summary>
							<textarea class="input pr-json" rows="10" spellcheck="false">${esc(JSON.stringify(final.contents ?? [], null, 1))}</textarea>
							<div class="toolbar"><button class="btn btn-primary pr-save-contents">Save as a correction</button><span class="muted small pr-msg"></span></div></details>
					</div>
					<div>
						<div class="section-label">What the retailer says <span class="muted small">(${esc(rev.descriptionFrom ?? '')})</span></div>
						${rev.description ? `<div class="pr-desc">${rev.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').split('\n').map((l) => esc(l.trim())).filter(Boolean).join('<br>')}</div>` : '<div class="muted small">No description.</div>'}
						<div class="section-label" style="margin-top:14px">Product</div>
						<div class="pr-form">
							<label>Type <select class="input pr-type">${TYPES.map((t) => `<option ${t === final.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
							<label>Name <input class="input pr-name" value="${esc(final.name.en)}"></label>
							<div class="toolbar"><button class="btn pr-save-meta">Save type and name</button>
							<button class="btn ${leftOut.has(p.id) ? 'btn-primary' : ''} pr-exclude">${leftOut.has(p.id) ? 'Include again' : 'Leave this product out'}</button></div>
						</div>
						${mine.length ? `<div class="section-label" style="margin-top:14px">Corrections on this product</div><ul class="pr-fixes">${mine.map((f, i) => `<li><span class="mono">${esc(f.op)}${f.variant ? ' ' + esc(f.variant) + ' ' + esc(f.provider) : ''}</span> ${f.op === 'contents' ? '' : esc(JSON.stringify(f.value ?? ''))} <button class="btn btn-ghost pr-undo" data-i="${i}">undo</button></li>`).join('')}</ul>` : ''}
					</div>
				</div></div>`
			cell.querySelectorAll('.pr-id').forEach((b) => b.addEventListener('click', () => {
				const v = final.variants.find((x) => variantKey(x) === b.dataset.v)
				const now = v?.prices?.[b.dataset.p] ?? ''
				const input = window.prompt(`${b.dataset.p} id for ${p.id} (${b.dataset.v}). Empty removes it.`, String(now))
				if (input === null) return
				const value = input.trim() === '' ? null : Number(input)
				if (value !== null && !Number.isInteger(value)) return window.alert('An id is a whole number.')
				fix({ product: p.id, op: 'price', variant: b.dataset.v, provider: b.dataset.p, value })
			}))
			cell.querySelector('.pr-save-contents').addEventListener('click', () => {
				let value
				try { value = JSON.parse(cell.querySelector('.pr-json').value) } catch (err) { cell.querySelector('.pr-msg').textContent = `Not valid JSON: ${err.message}`; return }
				if (!Array.isArray(value) || value.some((c) => !c || typeof c.quantity !== 'number' || ['product', 'card', 'item', 'oneOf'].filter((k) => k in c).length !== 1)) { cell.querySelector('.pr-msg').textContent = 'Each line needs a quantity and exactly one of product, card, item or oneOf.'; return }
				fix({ product: p.id, op: 'contents', value })
			})
			cell.querySelector('.pr-save-meta').addEventListener('click', () => {
				const type = cell.querySelector('.pr-type').value, name = cell.querySelector('.pr-name').value.trim()
				if (type !== final.type) fix({ product: p.id, op: 'type', value: type })
				else if (name && name !== final.name.en) fix({ product: p.id, op: 'name', value: name })
			})
			cell.querySelector('.pr-exclude').addEventListener('click', () => fix({ product: p.id, op: 'exclude' }, leftOut.has(p.id)))
			cell.querySelectorAll('.pr-undo').forEach((b) => b.addEventListener('click', () => fix(mine[Number(b.dataset.i)], true)))
		}
	}
}

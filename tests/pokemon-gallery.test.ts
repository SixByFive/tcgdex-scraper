import { describe, expect, test } from 'bun:test'
import { galleryContentsText, parseLaunch, parseListing, parseProductPage } from '../src/sources/pokemon-gallery.ts'

// the shape of a product page on pokemon.com (Pitch Black Elite Trainer Box), trimmed
const page = `<html><head><meta property="og:image" content="https://www.pokemon.com/static-assets/x/me05-elite-trainer-box-169-en.png"></head><body><article>
<div class="content-block content-block-full">
<h1 class="us-title">Pokémon TCG: <em>Mega Evolution—Pitch Black</em> Elite Trainer Box</h1>
<div class="date generic-date">
    Launch: July 17, 2026
</div>
<div class="full-article-body">
<p>Twinkling city lights and a starry sky become obscured in darkness.</p>
<div style="text-align:center"><div><img src="/static-assets/x/inline/01-en.png" alt=""></div></div>
<p>The Pokémon TCG: <em>Mega Evolution—Pitch Black</em> Elite Trainer Box includes:</p>
<ul class="list">
<li><p>9 Pokémon TCG: <em>Mega Evolution—Pitch Black</em> booster packs</p></li>
<li><p>1 full-art foil promo card featuring Zarude</p></li>
<li><p>40 Pokémon TCG Energy cards</p></li>
<li><p>A code card for <a href="https://tcg.pokemon.com/en-us/tcgl/">Pokémon Trading Card Game Live</a></p></li>
</ul>
</div></div></article></body></html>`

describe('the product gallery', () => {
	test('a product page gives title, launch date, intro, list and images', () => {
		const p = parseProductPage(page, 'mega-evolution-pitch-black-elite-trainer-box', 2026)
		expect(p.title).toBe('Pokémon TCG: Mega Evolution—Pitch Black Elite Trainer Box')
		expect(p.launch).toBe('2026-07-17')
		expect(p.year).toBe(2026)
		expect(p.text).toHaveLength(2)
		expect(p.sections).toEqual([{
			heading: 'The Pokémon TCG: Mega Evolution—Pitch Black Elite Trainer Box includes:',
			items: ['9 Pokémon TCG: Mega Evolution—Pitch Black booster packs', '1 full-art foil promo card featuring Zarude', '40 Pokémon TCG Energy cards', 'A code card for Pokémon Trading Card Game Live']
		}])
		expect(p.images).toEqual(['https://www.pokemon.com/static-assets/x/me05-elite-trainer-box-169-en.png', 'https://www.pokemon.com/static-assets/x/inline/01-en.png'])
	})

	test('the includes list becomes the bulleted text the contents parser reads', () => {
		const text = galleryContentsText(parseProductPage(page, 's', 2026))
		expect(text.split('<br>')).toEqual(['• 9 Pokémon TCG: Mega Evolution—Pitch Black booster packs', '• 1 full-art foil promo card featuring Zarude', '• 40 Pokémon TCG Energy cards', '• A code card for Pokémon Trading Card Game Live'])
	})

	test('launch dates', () => {
		expect(parseLaunch('Launch: July 17, 2026')).toBe('2026-07-17')
		expect(parseLaunch('Launch: March 3, 2023')).toBe('2023-03-03')
		expect(parseLaunch('Launch: Soon')).toBeUndefined()
	})

	test('a listing gives product slugs, with or without a trailing slash, and not the year links', () => {
		const html = `<a href="/us/pokemon-tcg/product-gallery/2025">2025</a><a href="https://www.pokemon.com/us/pokemon-tcg/product-gallery/mew-v-box/">x</a>
			<a href="/us/pokemon-tcg/product-gallery/30th-celebration-mini-tin">y</a><a href="/us/pokemon-tcg/product-gallery/mew-v-box">dup</a><a href="/us/pokemon-tcg/product-gallery#">top</a>`
		expect(parseListing(html)).toEqual(['mew-v-box', '30th-celebration-mini-tin'])
	})
})

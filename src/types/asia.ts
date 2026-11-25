/** The Asia portal (asia.pokemon-card.com) serves one site per region, all on the same platform. */
export type AsiaRegion = 'tw' | 'hk' | 'th' | 'id' | 'ja' | 'ko' | 'zh-cn'

export interface AsiaExpansion {
	region: AsiaRegion
	/** the portal's expansion code, shared with the Japanese codes: M2a, SV2a, SV-P */
	code: string
	/** the title in the region's language */
	title: string
	/** the series heading the product sits under (超級進化, 朱＆紫, ...), in the region's language */
	series: string | null
	/** ISO date (YYYY-MM-DD); the portal prints MM-DD-YYYY */
	releaseDate: string | null
	productImage: string | null
	/** number of cards the listing reports; null until the cards were listed */
	cards: number | null
}

export interface AsiaSkill {
	/** the heading of the block the entry sat in (招式 attacks, 特性 ability, 物品卡 an Item trainer, ...), in the region's language */
	section: string | null
	name: string | null
	/** energy names from the cost icons, in order: Grass, Fire, Colorless, ... */
	cost: string[]
	damage: string | null
	effect: string | null
}

export interface AsiaCard {
	scrapedAt: string
	region: AsiaRegion
	expansionCode: string
	/** the portal's numeric id, the one in /detail/<id>/ (also the image's file name) */
	cardId: string
	sourceUrl: string
	name: string
	/** set when `name` is not in the region's language (Mainland China: English, from Bulbapedia) */
	nameLanguage?: string
	/** the evolution marker printed before the name (基礎, 1階進化, ...); absent on trainers and energy */
	stageLabel: string | null
	hp: number | null
	types: string[]
	skills: AsiaSkill[]
	weakness: { type: string; value: string | null }[]
	resistance: { type: string; value: string | null }[]
	retreat: number | null
	/** the letter before the number (a regulation mark), "" when there is none */
	regulationMark: string | null
	/** "001/193" as printed */
	collectorNumber: string | null
	number: number | null
	total: number | null
	/** rarity code as the portal's filter names it (C, U, R, RR, SAR, ...); null if no filter matched the card */
	rarity: string | null
	illustrator: string | null
	dexNumber: number | null
	species: string | null
	height: string | null
	weight: string | null
	flavorText: string | null
	evolution: string[]
	imageUrl: string | null
	symbolUrl: string | null
	/** set when `imageUrl` shows several cards side by side (a two-card Stadium): which of them this is, counted from the left */
	imagePart?: { index: number; of: number }
	/** path of the downloaded image, relative to the asia cache folder; absent until `images` ran */
	imageFile?: string
	/** added by `asia enrich`: when, and what the lookups found (never overwrites what the portal gave) */
	enrichedAt?: string
	/** TCGplayer group (Pokémon Japan, Japan only) the variants and provider ids came from */
	tcgplayerSet?: number
	/** the set's English name as that group has it ("Storm Emeralda" for "M6: Storm Emeralda") */
	tcgplayerSetName?: string
	/** Japan: what TCG Collector lists for the set (reference only): its English name, release date and card counts */
	collector?: { name: string; releaseDate: string | null; cards: number | null; variantCards: number | null }
	/** variants with their provider ids (Japan: TCGTracking) or without (TCGdex's finish list), in schema form */
	variants?: import('../emit/variants.ts').VariantOut[]
	/** what the TCGdex API has for the card in this language */
	tcgdex?: { regulationMark?: string; rarity?: string; description?: string; dexId?: number[]; stage?: string }
}

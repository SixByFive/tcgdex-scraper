export type Lang = 'en' | 'de' | 'fr' | 'it' | 'es' | 'pt'
export type AllLangs = Lang | 'es-mx'

export type EnergyTypes = 
    | 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic' 
    | 'Fighting' | 'Darkness' | 'Metal' | 'Dragon'
    | 'Colorless' | 'Fairy' | 'Free'
    
export interface ScrapedStructural {
    localId: string 
    number: number
    /** the number as printed before the slash: "67", "TG01", "GG01", "SV001" (absent in scrapes made before this existed) */
    printedNumber?: string | null
    total: number
    rarity: string | null
    hp: number | null
    types: EnergyTypes[]
    stage: string | null
    category: 'Pokemon' | 'Trainer' | 'Energy'
    trainerSubtype: string | null 
    evolvesFromKey: string | null
    pokedexSlug: string | null
    dexIds: number[]
    retreat: number | null
    weaknesses: { type: EnergyTypes; value: string }[]
    resistances: { type: EnergyTypes; value: string }[]
    illustrator: string | null 
    expansionSetCode: string | null 
    imageUrls: Partial<Record<Lang, string>>
}

export interface ScrapedLocaleBlock {
    name: string | null
    evolvesFromName: string | null 
    abilities: {
        kind: 'attack' | 'ability' | 'rule'
        cost: EnergyTypes[]
        name: string | null
        damage: string | null
        effect: string | null
    }[]
}

import type { VariantOut } from '../emit/variants.ts'
import type { CardExtras } from '../sources/tcgdex-cards.ts'

export interface ScrapedCard {
    scrapedAt: string
    sourceSlug: string
    structural: ScrapedStructural
    locales: Partial<Record<Lang, ScrapedLocaleBlock>>
    /** languages pokemon.com has no page for (404): a card that simply doesn't exist in them */
    absentLangs?: Lang[]
    /** languages whose page failed for another reason (bot wall, timeout): the card is incomplete until a re-scrape fills them in */
    failedLangs?: Lang[]
    /** added by `enrich-scraped`: when, and which TCGplayer group the variants came from */
    enrichedAt?: string
    tcgplayerSet?: number
    /** variants with their Cardmarket / TCGplayer / CardTrader ids (TCGTracking), in schema form */
    variants?: VariantOut[]
    /** flavor text and regulation mark (TCGdex API) */
    tcgdex?: CardExtras
}
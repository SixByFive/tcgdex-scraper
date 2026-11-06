export type Lang = 'en' | 'de' | 'fr' | 'it' | 'es' | 'pt'
export type AllLangs = Lang | 'es-mx'

export type EnergyTypes = 
    | 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic' 
    | 'Fighting' | 'Darkness' | 'Metal' | 'Dragon'
    | 'Colorless' | 'Fairy' | 'Free'
    
export interface ScrapedStructural {
    localId: string 
    number: number
    total: number
    rarity: string | null
    hp: number | null
    types: EnergyTypes[]
    stage: string | null
    category: 'Pokemon' | 'Trainer' | 'Energy'
    trainerSubtype: string | null 
    evolvesFromKey: string | null
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

export interface ScrapedCard {
    scrapedAt: string
    sourceSlug: string
    structural: ScrapedStructural
    locales: Partial<Record<Lang, ScrapedLocaleBlock>>
}
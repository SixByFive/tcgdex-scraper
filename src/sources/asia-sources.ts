import type { AsiaExpansion, AsiaRegion } from '../types/asia.ts'
import * as portal from './asia-portal.ts'
import { listJapan, scrapeJapan } from './asia-jp.ts'
import { listChina, scrapeChina } from './asia-cn.ts'
import { listKorea, scrapeKorea } from './asia-ko.ts'

/** One entry point for every Asia source: the portal's four regions, Japan, Korea (its list needs a browser) and Mainland China. */
export const SCRAPABLE: readonly AsiaRegion[] = ['tw', 'hk', 'th', 'id', 'ja', 'zh-cn']

export const isScrapable = (r: string): r is AsiaRegion => (SCRAPABLE as readonly string[]).includes(r)

export function listExpansions(region: AsiaRegion): Promise<AsiaExpansion[]> {
	if (region === 'ja') return listJapan()
	if (region === 'ko') return listKorea()
	if (region === 'zh-cn') return listChina()
	return portal.listExpansions(region)
}

export function scrapeExpansion(region: AsiaRegion, code: string, opts: { images?: boolean; rarities?: boolean } = {}) {
	if (region === 'ja') return scrapeJapan(code, opts)
	if (region === 'ko') return scrapeKorea(code, opts)
	if (region === 'zh-cn') return scrapeChina(code)
	return portal.scrapeExpansion(region, code, opts)
}

export const downloadImages = portal.downloadImages

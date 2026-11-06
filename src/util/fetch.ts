import { createHash } from 'node:crypto';
import { request } from 'undici';
import config from '../../config.json' with { type: 'json' }
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

export async function getCached(url: string): Promise<string> {
    const path = join(config.cacheDir, `${sha(url)}.html`)
    try {
        return await readFile(path, 'utf8')
    } catch {}
    const res = await request(url, { headers: { 'user-agent': config.userAgent } })
    if ( res.statusCode >= 400 ) throw new Error(`${res.statusCode} ${url}`)
        const body = await res.body.text()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    return body
}

/**
 * crawlSite — same-origin BFS crawler that collects forms from all pages.
 * Uses global fetch (Node 18+) with fallback to node-fetch, and linkedom for link extraction.
 */
import { parseFormsFromHtml, ExtractedForm } from './parser'
import { parseHTML } from 'linkedom'

export interface CrawlOptions {
  maxPages?: number // default 20
  sameOrigin?: boolean // default true
  timeoutMs?: number // per-fetch timeout, default 8000
  delayMs?: number // delay between fetches, default 100
}

export interface CrawledForm extends ExtractedForm {
  pageUrl: string // URL where form was found
}

function normalizeUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base)
    // skip non-http(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // strip fragment
    u.hash = ''
    return u.href
  } catch {
    return null
  }
}

export function extractLinks(html: string, baseUrl: string): string[] {
  try {
    const { document } = parseHTML(html)
    const anchors = document.querySelectorAll('a[href]')
    const out: string[] = []
    for (const a of anchors) {
      const raw = a.getAttribute('href')?.trim()
      if (!raw) continue
      if (raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue
      const norm = normalizeUrl(raw, baseUrl)
      if (norm) out.push(norm)
    }
    return [...new Set(out)] // de-dupe per page
  } catch {
    // fallback regex
    const regex = /<a[^>]+href=["']([^"']+)["']/gi
    const out: string[] = []
    let m: RegExpExecArray | null
    while ((m = regex.exec(html)) !== null) {
      const raw = m[1]?.trim()
      if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:')) continue
      const norm = normalizeUrl(raw, baseUrl)
      if (norm) out.push(norm)
    }
    return [...new Set(out)]
  }
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Prefer global fetch (Node 18+), fallback to node-fetch if needed
    let fetchFn: typeof fetch = (globalThis as any).fetch
    if (!fetchFn) {
      try {
        const mod: any = await import('node-fetch')
        fetchFn = mod.default || mod
      } catch {
        return null
      }
    }
    const res = await fetchFn(url, { signal: controller.signal, headers: { 'User-Agent': 'hunch-form2mcp/0.1 (+https://hunchbank.com)' } } as any)
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    // only crawl html
    if (ct && !/text\/html|application\/xhtml/.test(ct) && !ct.includes('text/html')) {
      // allow empty ct (some servers omit)
      if (ct.includes('application/json') || ct.includes('image/') || ct.includes('text/css') || ct.includes('javascript')) return null
    }
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function crawlSite(startUrl: string, opts: CrawlOptions = {}): Promise<CrawledForm[]> {
  const maxPages = opts.maxPages ?? 20
  const sameOrigin = opts.sameOrigin ?? true
  const timeoutMs = opts.timeoutMs ?? 8000
  const delayMs = opts.delayMs ?? 100

  let start: URL
  try {
    start = new URL(startUrl)
  } catch {
    throw new Error(`Invalid start URL: ${startUrl}`)
  }
  if (start.protocol !== 'http:' && start.protocol !== 'https:') {
    throw new Error(`Start URL must be http(s): ${startUrl}`)
  }

  const origin = start.origin
  const visited = new Set<string>()
  const queue: string[] = [start.href]
  const results: CrawledForm[] = []

  while (queue.length > 0 && visited.size < maxPages) {
    const url = queue.shift()!
    if (visited.has(url)) continue
    visited.add(url)

    const html = await fetchHtml(url, timeoutMs)
    if (!html) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      continue
    }

    // collect forms on this page
    const forms = parseFormsFromHtml(html)
    for (const f of forms) {
      results.push({ ...f, pageUrl: url })
    }

    if (visited.size >= maxPages) break

    // extract links for next BFS layer
    const links = extractLinks(html, url)
    for (const link of links) {
      if (visited.has(link) || queue.includes(link)) continue
      if (results.length >= maxPages && queue.length >= maxPages) break
      if (sameOrigin) {
        try {
          if (new URL(link).origin !== origin) continue
        } catch {
          continue
        }
      }
      // skip non-html extensions early
      if (/\.(png|jpe?g|gif|svg|ico|pdf|zip|mp4|mp3|woff2?|ttf|eot)(\?|$)/i.test(link)) continue
      if (queue.length + visited.size < maxPages) queue.push(link)
    }

    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
  }

  return results
}

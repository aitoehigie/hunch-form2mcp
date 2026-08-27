import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { crawlSite, extractLinks } from '../src/crawler'

function mockFetch(map: Record<string, { html: string; ct?: string; status?: number }>) {
  return vi.fn(async (url: string) => {
    const entry = map[url] || map[url.replace(/\/$/, '')] || map[new URL(url).href]
    if (!entry) return { ok: false, statusText: 'Not Found', headers: { get: () => null }, text: async () => '' } as any
    const status = entry.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? entry.ct ?? 'text/html' : null) },
      text: async () => entry.html,
    } as any
  })
}

describe('extractLinks', () => {
  it('resolves relative and absolute, de-dupes, skips fragments/mailto/javascript', () => {
    const html = `
      <a href="/page1">p1</a>
      <a href="https://example.com/page2">p2</a>
      <a href="/page1">dup</a>
      <a href="#frag">frag</a>
      <a href="mailto:a@b.com">mail</a>
      <a href="javascript:void(0)">js</a>
      <a href="tel:123">tel</a>
      <a href="https://other.com/x">other</a>
    `
    const links = extractLinks(html, 'https://example.com/')
    expect(links).toContain('https://example.com/page1')
    expect(links).toContain('https://example.com/page2')
    expect(links).toContain('https://other.com/x')
    expect(links).not.toContain('https://example.com/#frag')
    expect(links.filter((l) => l === 'https://example.com/page1')).toHaveLength(1)
  })

  it('handles no links and empty html', () => {
    expect(extractLinks('', 'https://example.com/')).toEqual([])
    expect(extractLinks('<p>hi</p>', 'https://example.com/')).toEqual([])
  })
})

describe('crawlSite', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('crawls single page when maxPages=1', async () => {
    const html = `<html><body><form><input name="email"><button>Subscribe</button></form><a href="/other">x</a></body></html>`
    vi.stubGlobal('fetch', mockFetch({ 'https://example.com/': { html } }))
    const forms = await crawlSite('https://example.com/', { maxPages: 1, delayMs: 0 })
    expect(forms).toHaveLength(1)
    expect(forms[0].pageUrl).toBe('https://example.com/')
    expect(forms[0].fields[0].name).toBe('email')
  })

  it('BFS across linked same-origin pages, skips external by default', async () => {
    const index = `<a href="/page1">p1</a><a href="https://other.com/ext">ext</a>`
    const p1 = `<form><input name="email"><button>Subscribe</button></form>`
    const ext = `<form><input name="x"><button>Go</button></form>`
    vi.stubGlobal(
      'fetch',
      mockFetch({
        'https://example.com/': { html: index },
        'https://example.com/page1': { html: p1 },
        'https://other.com/ext': { html: ext },
      }),
    )
    const forms = await crawlSite('https://example.com/', { maxPages: 5, delayMs: 0 })
    expect(forms).toHaveLength(1)
    expect(forms[0].pageUrl).toBe('https://example.com/page1')
  })

  it('respects sameOrigin=false to include external', async () => {
    const index = `<a href="https://other.com/ext">ext</a>`
    const ext = `<form><input name="x"><button>Go</button></form>`
    vi.stubGlobal(
      'fetch',
      mockFetch({
        'https://example.com/': { html: index },
        'https://other.com/ext': { html: ext },
      }),
    )
    const forms = await crawlSite('https://example.com/', { maxPages: 5, sameOrigin: false, delayMs: 0 })
    expect(forms).toHaveLength(1)
    expect(forms[0].pageUrl).toBe('https://other.com/ext')
  })

  it('respects maxPages and de-dupes visited (loop)', async () => {
    const index = `<a href="/a">a</a><a href="/b">b</a>`
    const a = `<a href="/b">to b</a><form><input name="a"><button>Go</button></form>`
    const b = `<a href="/a">to a</a><form><input name="b"><button>Go</button></form>`
    vi.stubGlobal(
      'fetch',
      mockFetch({
        'https://example.com/': { html: index },
        'https://example.com/a': { html: a },
        'https://example.com/b': { html: b },
      }),
    )
    const forms = await crawlSite('https://example.com/', { maxPages: 2, delayMs: 0 })
    // maxPages 2 = start + one more → only one form
    expect(forms.length).toBeLessThanOrEqual(1)
    const forms3 = await crawlSite('https://example.com/', { maxPages: 3, delayMs: 0 })
    expect(forms3).toHaveLength(2)
  })

  it('handles fetch failures gracefully and continues', async () => {
    const index = `<a href="/ok">ok</a><a href="/bad">bad</a>`
    const ok = `<form><input name="email"><button>Subscribe</button></form>`
    vi.stubGlobal(
      'fetch',
      mockFetch({
        'https://example.com/': { html: index },
        'https://example.com/ok': { html: ok },
        'https://example.com/bad': { html: '', status: 500 },
      }),
    )
    const forms = await crawlSite('https://example.com/', { maxPages: 5, delayMs: 0 })
    expect(forms).toHaveLength(1)
    expect(forms[0].pageUrl).toBe('https://example.com/ok')
  })

  it('attaches pageUrl per form and collects multiple forms per page', async () => {
    const html = `<form><input name="email"><button>Subscribe</button></form><form><input name="message"><button>Send</button></form>`
    vi.stubGlobal('fetch', mockFetch({ 'https://example.com/': { html } }))
    const forms = await crawlSite('https://example.com/', { maxPages: 1, delayMs: 0 })
    expect(forms).toHaveLength(2)
    expect(forms.every((f) => f.pageUrl === 'https://example.com/')).toBe(true)
  })

  it('skips non-html content-type', async () => {
    const index = `<a href="/img">img</a><a href="/page">page</a>`
    const page = `<form><input name="email"><button>Go</button></form>`
    vi.stubGlobal(
      'fetch',
      mockFetch({
        'https://example.com/': { html: index },
        'https://example.com/img': { html: 'fake png', ct: 'image/png' },
        'https://example.com/page': { html: page },
      }),
    )
    const forms = await crawlSite('https://example.com/', { maxPages: 5, delayMs: 0 })
    expect(forms).toHaveLength(1)
    expect(forms[0].pageUrl).toBe('https://example.com/page')
  })

  it('throws on invalid start URL', async () => {
    await expect(crawlSite('not-a-url' as any)).rejects.toThrow(/Invalid start URL/)
    await expect(crawlSite('ftp://example.com/')).rejects.toThrow(/http\(s\)/)
  })

  it('resolves relative links against base URL', async () => {
    const index = `<a href="page1">rel</a><a href="../other">up</a>`
    vi.stubGlobal(
      'fetch',
      mockFetch({
        'https://example.com/sub/': { html: index },
        'https://example.com/sub/page1': { html: '<form><input name="a"><button>Go</button></form>' },
        'https://example.com/other': { html: '<form><input name="b"><button>Go</button></form>' },
      }),
    )
    const forms = await crawlSite('https://example.com/sub/', { maxPages: 3, delayMs: 0 })
    expect(forms).toHaveLength(2)
    const urls = forms.map((f) => f.pageUrl).sort()
    expect(urls).toEqual(['https://example.com/other', 'https://example.com/sub/page1'])
  })
})

describe('CLI --crawl integration (local http server)', () => {
  async function runCliAsync(args: string[]): Promise<{ stdout: string; stderr: string; status: number | null }> {
    const { spawn } = await import('child_process')
    const path = await import('path')
    const dist = path.join(process.cwd(), 'dist/index.js')
    return new Promise((resolve, reject) => {
      const child = spawn('node', [dist, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d.toString()))
      child.stderr.on('data', (d) => (stderr += d.toString()))
      child.on('error', reject)
      child.on('close', (code) => resolve({ stdout, stderr, status: code }))
      setTimeout(() => {
        try {
          child.kill()
        } catch {}
        reject(new Error(`CLI timeout: ${args.join(' ')}\nstdout=${stdout}\nstderr=${stderr}`))
      }, 8000)
    })
  }

  it('crawls a real local site via dist/index.js --crawl', async () => {
    const http = await import('http')

    const pages: Record<string, string> = {
      '/': `<html><body><a href="/page1">p1</a><a href="/page2">p2</a></body></html>`,
      '/page1': `<html><body><form action="/api1"><input name="email" type="email"><button>Subscribe</button></form></body></html>`,
      '/page2': `<html><body><form><input name="message"><button>Send Message</button></form></body></html>`,
    }

    const server = http.createServer((req, res) => {
      const url = req.url?.split('?')[0] || '/'
      const html = pages[url]
      if (html) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      } else {
        res.writeHead(404)
        res.end('not found')
      }
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr: any = server.address()
    const base = `http://127.0.0.1:${addr.port}`

    try {
      const result = await runCliAsync(['--input', `${base}/`, '--crawl', '--max-pages', '3', '--format', 'json'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Crawling')
      expect(result.stdout).toContain('Crawl summary')
      expect(result.stdout).toContain('subscribe')
      expect(result.stdout).toContain('contactSales')
      expect(result.stdout).toContain(base)
    } finally {
      server.close()
    }
  })

  it('single-page fetch without --crawl only gets start page', async () => {
    const http = await import('http')

    const pages: Record<string, string> = {
      '/': `<html><body><a href="/page1">p1</a></body></html>`,
      '/page1': `<form><input name="email"><button>Subscribe</button></form>`,
    }

    const server = http.createServer((req, res) => {
      const url = req.url?.split('?')[0] || '/'
      const html = pages[url]
      if (html) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      } else {
        res.writeHead(404)
        res.end('not found')
      }
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const addr: any = server.address()
    const base = `http://127.0.0.1:${addr.port}`

    try {
      const withoutCrawl = await runCliAsync(['--input', `${base}/`, '--format', 'json'])
      expect(withoutCrawl.stdout).toContain('No forms found')

      const withCrawl = await runCliAsync(['--input', `${base}/`, '--crawl', '--max-pages', '2', '--format', 'json'])
      expect(withCrawl.stdout).toContain('subscribe')
    } finally {
      server.close()
    }
  })
})

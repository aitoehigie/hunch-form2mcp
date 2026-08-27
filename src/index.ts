import { parseFormsFromHtml } from './parser'
import { classifyIntent } from './classifier'
import { formatMcpOutput } from './mcpFormatter'
import { crawlSite } from './crawler'
import { program } from 'commander'

program
  .name('hunch-form2mcp')
  .description('Convert website HTML forms into MCP tool definitions and Hunch-compatible HTML attributes')
  .requiredOption('-i, --input <file|url>', 'HTML file path or URL to analyze')
  .option('--format <json|html|both>', 'Output format', 'both')
  .option('--llm-key <key>', 'Optional LLM API key for enhanced classification')
  .option('--crawl', 'Crawl same-origin site when input is a URL (BFS across linked pages)', false)
  .option('--max-pages <n>', 'Max pages to crawl when --crawl is set', '20')
  .parse()

const options = program.opts()

async function main() {
  const input = options.input

  if (!input) {
    console.error('Error: --input is required (HTML file path or URL)')
    process.exit(1)
  }

  const isUrl = input.startsWith('http://') || input.startsWith('https://')
  const doCrawl = Boolean(options.crawl)
  const maxPages = Math.max(1, parseInt(options.maxPages, 10) || 20)

  let forms: ReturnType<typeof parseFormsFromHtml> & Array<{ pageUrl?: string }> = [] as any
  let crawlInfo: { pagesVisited?: number } = {}

  try {
    if (isUrl) {
      if (doCrawl) {
        console.log(`Crawling ${input} (maxPages=${maxPages}, sameOrigin=true) ...`)
        const crawled = await crawlSite(input, { maxPages })
        forms = crawled as any
        crawlInfo.pagesVisited = new Set(crawled.map((f: any) => f.pageUrl)).size || crawled.length ? new Set(crawled.map((f: any) => f.pageUrl)).size : 0
        // fallback: if crawl found 0 pages due to fetch failure, try single fetch for better error
        if (crawled.length === 0) {
          // still show visited pages count; may be 1 with no forms
          const visitedCount = new Set(crawled.map((f: any) => f.pageUrl)).size
          if (visitedCount === 0) {
            // attempt single-page fetch to surface error
            let fetchFn: any = (globalThis as any).fetch
            if (!fetchFn) {
              const mod: any = await import('node-fetch')
              fetchFn = mod.default || mod
            }
            const res = await fetchFn(input)
            if (!res.ok) {
              console.error(`Error: Failed to fetch ${input}: ${res.statusText}`)
              process.exit(1)
            }
            const html = await res.text()
            forms = parseFormsFromHtml(html).map((f) => ({ ...f, pageUrl: input })) as any
          }
        }
        console.log(`Crawled ${new Set((forms as any).map((f: any) => f.pageUrl)).size} page(s), found ${forms.length} form(s).`)
      } else {
        // single-page fetch (no crawl)
        let fetchFn: any = (globalThis as any).fetch
        if (!fetchFn) {
          try {
            const mod: any = await import('node-fetch')
            fetchFn = mod.default || mod
          } catch {
            console.error('Error: fetch not available. Install node-fetch or use Node 18+ / --crawl with built-in fetch, or pass a local file.')
            process.exit(1)
          }
        }
        const response = await fetchFn(input)
        if (!response.ok) {
          console.error(`Error: Failed to fetch ${input}: ${response.statusText}`)
          process.exit(1)
        }
        const html = await response.text()
        forms = parseFormsFromHtml(html).map((f) => ({ ...f, pageUrl: input })) as any
      }
    } else {
      if (doCrawl) {
        console.warn('Warning: --crawl is only valid with a URL input; ignoring --crawl for file input.')
      }
      const fs = await import('fs')
      const html = fs.readFileSync(input, 'utf-8')
      forms = parseFormsFromHtml(html) as any
    }
  } catch (err) {
    console.error(`Error reading ${input}:`, err)
    process.exit(1)
  }

  if (forms.length === 0) {
    console.log('No forms found in the provided HTML.')
    if (isUrl && doCrawl) console.log(`(crawled ${crawlInfo.pagesVisited ?? 0} page(s))`)
    process.exit(0)
  }

  // Phase 2: Classify each form
  const tools = forms.map((form: any) =>
    classifyIntent({
      fields: form.fields,
      html: form.html,
      action: form.action,
      method: form.method,
      triggerText: form.triggerText,
    }),
  )

  // attach pageUrl from crawl (or single URL) to tool for output
  tools.forEach((t: any, i: number) => {
    const f: any = (forms as any)[i]
    if (f?.pageUrl) t.pageUrl = f.pageUrl
    // if file input, keep action-based pageUrl from classifier
  })

  // Phase 3: Format output
  const results = formatMcpOutput(tools, options.format, options.llmKey)

  // Print results
  if (options.format === 'json' || options.format === 'both') {
    console.log('\n=== MCP Tool Definitions ===')
    console.log(results.json)
  }

  if (options.format === 'html' || options.format === 'both') {
    console.log('\n=== Hunch HTML Attributes ===')
    console.log(results.html)
  }

  if (isUrl && doCrawl) {
    const pages = new Set((forms as any).map((f: any) => f.pageUrl)).size
    console.log(`\nCrawl summary: ${pages} page(s) visited, ${forms.length} form(s) → ${tools.length} tool(s).`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

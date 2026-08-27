# hunch-form2mcp

Convert website HTML forms into MCP tool definitions and Hunch-compatible HTML attributes — **single file or entire site.**

**No API key needed** — pure HTML parsing + rule-based classification. Works offline. Site crawler uses same-origin BFS with native `fetch`.

## Installation

```bash
# Global install (CLI) — npx works after 0.1.4 shebang fix
npm i -g hunch-form2mcp
npx hunch-form2mcp --help

# Or as a library
npm i hunch-form2mcp
```

## CLI Usage

```bash
# From an HTML file
hunch-form2mcp --input forms.html

# From a single URL (no crawl)
hunch-form2mcp --input https://example.com/contact

# Crawl entire site (new in 0.1.5) — BFS same-origin, max 20 pages default
hunch-form2mcp --input https://example.com --crawl
hunch-form2mcp --input https://example.com --crawl --max-pages 50

# Output formats
--format json    MCP tool definition JSON (for catalogs, Claude, Cursor, opencode)
--format html    WebMCP declarative HTML (toolname / toolparamdescription)
--format both    Both (default)

# Full example
hunch-form2mcp --input https://example.com --crawl --max-pages 20 --format both
```

**Crawl behavior:** `src/crawler.ts` — BFS queue, `linkedom` link extraction, `sameOrigin=true` (skips `https://other.com`, `mailto:`, `#`, `javascript:`), skips non-HTML `content-type` and `*.png|jpg|pdf|woff`, 100ms delay, `AbortController` timeout 8s. Each form keeps `pageUrl` where it was found (shown in `_hunch.pageUrl` and summary `Crawled N page(s)`).

## Output Examples

### MCP JSON (for MCP catalogs, Claude/Cursor/opencode) — also via `npx ... --format json`:

```json
{
  "name": "contactSales",
  "description": "Send a message or contact the team",
  "inputSchema": {
    "type": "object",
    "properties": {
      "email": {"type": "string", "format": "email", "description": "Your Email"},
      "message": {"type": "string", "description": "message"}
    },
    "required": ["email", "message"]
  },
  "_hunch": {
    "category": "contact",
    "triggerText": "Send Message",
    "pageUrl": "https://example.com/contact"
  }
}
```
Paste into `document.modelContext.registerTool({ name, description, inputSchema, execute })` — Chrome 146+ `#enable-webmcp-testing`.

### WebMCP Declarative HTML (`--format html`) — paste into your existing `<form>`, no JS:

```html
<form toolname="contactSales" tooldescription="Send a message or contact the team" toolautosubmit>
  <input name="email" type="email" toolparamdescription="Your Email" required />
  <input name="message" type="text" toolparamdescription="message" required />
  <button type="submit">Send Message</button>
</form>
<!-- select → <select toolparamdescription> with <option>s -->
```
Discovered via `document.modelContext.getTools()`. `toolautosubmit` auto-POSTs to form `action`.

When `--crawl` is used, each discovered form emits its own pair of blocks with `// Tool 1: contactSales — https://example.com/contact`.

## Supported Form Types

| Trigger Text / Fields | Detected Tool | Category |
|---|---|---|
| `Sign Up / register / create account` | `signup` | contact |
| `Sign In / log in` | `login` | contact |
| `Book / Schedule / Demo / Consult` | `booking` | booking |
| `Get Help / Support / Issue` | `contactSupport` | support |
| `Subscribe / Newsletter` | `subscribe` | contact |
| Form with `name="timeline_tool"` | `timeline` | contact |
| Form with `name="faq_tool"` | `faq` | contact |
| Generic form with email+password | `login` | contact |
| Generic form with message field | `contactSales` | contact |
| Form with few fields + email | `subscribe` | contact |

## Classification Logic (Rule-based, no LLM)

1. **Button text first** — most reliable user-visible signal
2. **Field types** — email+password = login/signup, message = contact/sales
3. **Form name attribute** — legacy designations
4. **Fallback** — generic `submitForm`

## Library Usage

```js
import { parseFormsFromHtml } from 'hunch-form2mcp/src/parser'
import { classifyIntent } from 'hunch-form2mcp/src/classifier'
import { formatMcpOutput } from 'hunch-form2mcp/src/mcpFormatter'
import { crawlSite } from 'hunch-form2mcp/src/crawler'

const forms = parseFormsFromHtml(html)
const tools = forms.map(f => classifyIntent(f))
formatMcpOutput(tools, 'both')

// site-wide
const crawled = await crawlSite('https://example.com', { maxPages: 20 })
```

## Development

```bash
npm run build   # esbuild --banner:js shebang → dist/index.js (chmod +x)
npm test        # vitest run — 104 tests (parser 23, classifier 24, formatter 14, integration 21, crawler 13, cli 9)
node dist/index.js --input /tmp/test.html --format both
node dist/index.js --input https://example.com --crawl --max-pages 5
```

## License

MIT

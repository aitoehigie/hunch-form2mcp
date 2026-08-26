# hunch-form2mcp

Convert website HTML forms into MCP tool definitions and Hunch-compatible HTML attributes.

**No API key needed** — pure HTML parsing + rule-based classification. Works entirely offline.

## Installation

```bash
# Global install (CLI)
npm i -g hunch-form2mcp

# Or as a library
npm i hunch-form2mcp
```

## CLI Usage

```bash
# From an HTML file
hunch-form2mcp forms.html

# From a URL (requires network)
hunch-form2mcp https://example.com/contact

# Output formats
--format json    MCP tool definition JSON
--format html    Hunch data attributes
--format both    Both (default)
```

## Output Examples

### MCP JSON (for MCP catalogs, MCP clients like Claude, Cursor, opencode):

```json
{
  "name": "contactSales",
  "description": "Send a message or contact the team",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {"type": "string", "description": "name"},
      "email": {"type": "string", "format": "email", "description": "email"},
      "subject": {"type": "string", "description": "subject"}
    },
    "required": ["name", "email"]
  },
  "category": "contact",
  "triggerText": "Send Message",
  "pageUrl": "/contact"
}
```

### Hunch HTML Attributes (paste directly into form HTML):

```html
<form data-modal="hunch-contactSales" data-mode="sales" 
      data-category="contact" data-tool-name="contactSales" 
      data-page-url="/contact" data-trigger-text="Send Message">
  <!-- Form fields go here -->
  <button type="submit">Submit</button>
</form>
```

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

## Development

```bash
# Build
npm run build

# Test
npm test

# Local development
node dist/index.js --input /path/to/form.html
```

## License

MIT
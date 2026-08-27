/**
 * formatMcpOutput — Generate strict WebMCP primitives from classified tools.
 *
 * Output formats:
 * - json: ModelContextTool JSON (WebMCP imperative shape: name, description, inputSchema) — copy into document.modelContext.registerTool()
 * - html: WebMCP declarative attributes (toolname, tooldescription, toolparamdescription, toolautosubmit) — paste into your <form>/<input> tags; discovered via document.modelContext.getTools()
 * - both: Both of the above (default)
 *
 * Spec: https://webmachinelearning.github.io/webmcp/ + https://developer.chrome.com/docs/ai/webmcp
 * Declarative: <form toolname tooldescription toolautosubmit><input toolparamdescription>
 */
import { classifyIntent } from './classifier'

export interface FormatResults {
  json: string
  html: string
}

/**
 * Strict WebMCP ModelContextTool JSON. Stringified inputSchema is JSON Schema 2020-12.
 * This is the shape passed to document.modelContext.registerTool({ name, description, inputSchema, execute })
 */
function formatWebMcpJson(tool: ReturnType<typeof classifyIntent>): string {
  // Keep only WebMCP-primitive fields; extra Hunch routing hints go in _hunch meta
  return JSON.stringify(
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      // non-standard hint for Hunch widget / debugging, not part of WebMCP spec
      _hunch: {
        category: tool.category,
        triggerText: tool.triggerText,
        pageUrl: tool.pageUrl,
      },
    },
    null,
    2,
  )
}

/**
 * Strict WebMCP declarative HTML. Paste the attributes into your existing form.
 * Browser synthesizes the same JSON Schema as above; no JS required.
 * See: https://developer.chrome.com/docs/ai/webmcp#declarative-api
 */
function formatWebMcpHtml(tool: ReturnType<typeof classifyIntent>): string {
  const esc = (s: string) => s.replace(/"/g, '&quot;')
  const formAttrs = [
    `toolname="${esc(tool.name)}"`,
    `tooldescription="${esc(tool.description)}"`,
    `toolautosubmit`,
  ]

  const fields = Object.entries(tool.inputSchema.properties).map(([key, prop]: [string, any]) => {
    const required = tool.inputSchema.required.includes(key) ? ' required' : ''
    const type = prop.format === 'email' ? 'email' : prop.type === 'number' ? 'number' : 'text'
    // Use description as toolparamdescription; fallback to key
    const paramDesc = esc(String(prop.description || key))
    return `  <input name="${esc(key)}" type="${type}" toolparamdescription="${paramDesc}"${required} />`
  })

  // If inputSchema had enum (select), emit as <select> with options for fidelity
  // Reconstruct from tool.inputSchema: enum lives on the property
  const selectFields: string[] = []
  for (const [key, prop] of Object.entries(tool.inputSchema.properties) as [string, any][]) {
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      const required = tool.inputSchema.required.includes(key) ? ' required' : ''
      const paramDesc = esc(String(prop.description || key))
      const opts = prop.enum.map((v: string) => `    <option value="${esc(v)}">${esc(v)}</option>`).join('\n')
      // Replace the generic <input> we already emitted for this key with a <select>
      const idx = fields.findIndex((f) => f.includes(`name="${key}"`))
      if (idx !== -1) {
        fields[idx] =
          `  <select name="${esc(key)}" toolparamdescription="${paramDesc}"${required}>\n${opts}\n  </select>`
      }
      void selectFields
    }
  }

  const lines = [
    `<!-- WebMCP declarative — paste these attributes into YOUR form. No JS needed. -->`,
    `<!-- Discovered by agents via document.modelContext.getTools() (Chrome 146+ #enable-webmcp-testing) -->`,
    `<form ${formAttrs.join(' ')}>`,
    ...fields,
    `  <button type="submit">${esc(tool.triggerText || 'Submit')}</button>`,
    `</form>`,
    ``,
    `<!-- Imperative alternative (same tool, JS): -->`,
    `<!-- document.modelContext.registerTool({ name: "${esc(tool.name)}", description: "${esc(tool.description)}", inputSchema: {/* see JSON output */}, execute: async (args) => { /* your form submit */ } }) -->`,
  ]
  return lines.join('\n')
}

export function formatMcpOutput(
  tools: ReturnType<typeof classifyIntent>[],
  format: 'json' | 'html' | 'both' = 'both',
  _llmKey?: string,
): {
  json: string
  html: string
} {
  const jsonLines: string[] = []
  const htmlLines: string[] = []

  tools.forEach((tool, i) => {
    jsonLines.push(`// Tool ${i + 1}: ${tool.name} — paste into document.modelContext.registerTool()`)
    jsonLines.push(formatWebMcpJson(tool))
    jsonLines.push('')

    htmlLines.push(`<!-- Tool ${i + 1}: ${tool.name} — WebMCP declarative (copy into your HTML) -->`)
    htmlLines.push(formatWebMcpHtml(tool))
    htmlLines.push('')
  })

  return {
    json: jsonLines.join('\n'),
    html: htmlLines.join('\n'),
  }
}

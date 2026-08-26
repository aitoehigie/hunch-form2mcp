/**
 * formatMcpOutput — Generate MCP tool definitions + HTML attributes from classified tools.
 * 
 * Output formats:
 * - json: MCP Tool Definition JSON (for MCP catalogs, MCP clients)
 * - html: Hunch-compatible data attributes (for embedding widget on websites)
 * - both: Both of the above
 */
import { classifyIntent } from './classifier'

export interface FormatResults {
  json: string
  html: string
}

/**
 * Generate MCP tool definition JSON from a classified tool.
 */
function formatMcpJson(tool: ReturnType<typeof classifyIntent>): string {
  return JSON.stringify(
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: tool.category,
      triggerText: tool.triggerText,
      pageUrl: tool.pageUrl,
    },
    null,
    2,
  )
}

/**
 * Generate Hunch-compatible HTML data attributes from a classified tool.
 * These can be pasted directly into form HTML to make forms discoverable
 * by the Hunch widget without any JavaScript configuration.
 */
function formatHunchHtml(tool: ReturnType<typeof classifyIntent>): string {
  const attrs: string[] = []

  // Core modal/popup attributes
  attrs.push(`data-modal="hunch-${tool.name}"`)

  // Mode attribute — inferred from category
  const modeMap: Record<string, string> = {
    contact: 'general',
    support: 'support',
    booking: 'sales',
    signup: 'general',
    login: 'general',
    subscribe: 'general',
  }
  attrs.push(`data-mode="${modeMap[tool.category] || 'general'}"`)

  // Trigger text if available
  if (tool.triggerText) {
    attrs.push(`data-trigger-text="${tool.triggerText}"`)
  }

  // Category as data attribute for widget routing
  attrs.push(`data-category="${tool.category}"`)

  // Name for widget tool resolution
  attrs.push(`data-tool-name="${tool.name}"`)

  // Page URL for redirect after submit
  if (tool.pageUrl) {
    attrs.push(`data-page-url="${tool.pageUrl}"`)
  }

  return attrs.join(' ')
}

/**
 * Main formatter — produces both JSON and HTML output.
 */
export function formatMcpOutput(
  tools: ReturnType<typeof classifyIntent>[],
  format: 'json' | 'html' | 'both' = 'both',
  llmKey?: string,
): {
  json: string
  html: string
} {
  const jsonLines: string[] = []
  const htmlLines: string[] = []

  tools.forEach((tool, i) => {
    // MCP JSON output
    jsonLines.push(`// Tool ${i + 1}: ${tool.name}`)
    jsonLines.push(formatMcpJson(tool))
    jsonLines.push('')

    // HTML attributes output
    htmlLines.push(`<!-- Tool ${i + 1}: ${tool.name} -->`)
    htmlLines.push(`<form ${formatHunchHtml(tool)}>`)
    htmlLines.push(`  <!-- Form fields go here -->`)
    htmlLines.push(`  <button type="submit">Submit</button>`)
    htmlLines.push(`</form>`)
    htmlLines.push('')
  })

  const result: {
    json: string
    html: string
  } = {
    json: jsonLines.join('\n'),
    html: htmlLines.join('\n'),
  }

  return result
}
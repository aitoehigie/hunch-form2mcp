import { parseFormsFromHtml } from './parser'
import { classifyIntent } from './classifier'
import { formatMcpOutput } from './mcpFormatter'
import { program } from 'commander'

program
  .name('hunch-form2mcp')
  .description('Convert website HTML forms into MCP tool definitions and Hunch-compatible HTML attributes')
  .requiredOption('-i, --input <file|url>', 'HTML file path or URL to analyze')
  .option('--format <json|html|both>', 'Output format', 'both')
  .option('--llm-key <key>', 'Optional LLM API key for enhanced classification')
  .parse()

const options = program.opts()

async function main() {
  const input = options.input

  if (!input) {
    console.error('Error: --input is required (HTML file path or URL)')
    process.exit(1)
  }

  let html: string

  try {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const fetchModule = await import('node-fetch')
      const fetch = fetchModule.default || fetchModule
      const response = await fetch(input)
      if (!response.ok) {
        console.error(`Error: Failed to fetch ${input}: ${response.statusText}`)
        process.exit(1)
      }
      html = await response.text()
    } else {
      const fs = await import('fs')
      html = fs.readFileSync(input, 'utf-8')
    }
  } catch (err) {
    console.error(`Error reading ${input}:`, err)
    process.exit(1)
  }

  // Phase 1: Extract forms from HTML
  const forms = parseFormsFromHtml(html)

  if (forms.length === 0) {
    console.log('No forms found in the provided HTML.')
    process.exit(0)
  }

  // Phase 2: Classify each form
  // Extract trigger text from form HTML inside the parser, pass it through
  const tools = forms.map((form) => classifyIntent({
    fields: form.fields,
    html: form.html,
    action: form.action,
    method: form.method,
    triggerText: form.triggerText,
  }))

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
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
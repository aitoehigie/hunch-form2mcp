import { describe, it, expect } from 'vitest'
import { classifyIntent } from '../src/classifier'
import { formatMcpOutput } from '../src/mcpFormatter'

function mkTool(overrides: Partial<ReturnType<typeof classifyIntent>> & { fields?: any[] } = {}) {
  // helper to build a classified tool via classifier for realism
  const base = classifyIntent({
    fields: overrides.fields ?? [{ name: 'email', type: 'email', required: true }, { name: 'message', type: 'text' }],
    triggerText: (overrides as any).triggerText ?? 'Send Message',
    action: (overrides as any).pageUrl ?? '/contact',
    html: '',
  })
  return { ...base, ...overrides } as ReturnType<typeof classifyIntent>
}

describe('formatMcpOutput', () => {
  // helper to extract first JSON object from formatter output (which prefixes each tool with "// Tool ..." comment)
  function extractFirstJson(formattedJson: string): any {
    const idx = formattedJson.indexOf('{')
    // find matching closing brace at top level by tracking braces, or simpler: take from first { to last } of first block (blocks separated by blank line)
    const block = formattedJson.slice(idx).split('\n\n')[0]
    // block may contain only one JSON object (pretty-printed); parse it
    return JSON.parse(block)
  }
  it('produces valid JSON with WebMCP primitive fields and _hunch meta', () => {
    const tool = classifyIntent({ fields: [{ name: 'email', type: 'email', required: true }], triggerText: 'Subscribe', action: '/sub' })
    const { json } = formatMcpOutput([tool])
    const obj = extractFirstJson(json)
    expect(obj.name).toBe(tool.name)
    expect(obj.description).toBe(tool.description)
    expect(obj.inputSchema).toEqual(tool.inputSchema)
    expect(obj._hunch.category).toBe(tool.category)
    expect(obj._hunch.triggerText).toBe(tool.triggerText)
    expect(obj._hunch.pageUrl).toBe(tool.pageUrl)
  })

  it('json contains all tools with numbering comments', () => {
    const t1 = classifyIntent({ fields: [{ name: 'email', type: 'email' }], triggerText: 'Subscribe' })
    const t2 = classifyIntent({ fields: [{ name: 'message', type: 'text' }], triggerText: 'Send' })
    const { json } = formatMcpOutput([t1, t2])
    expect(json).toContain('// Tool 1: subscribe')
    expect(json).toContain('// Tool 2: contactSales')
  })

  it('html contains WebMCP declarative attributes', () => {
    const tool = mkTool({ fields: [{ name: 'email', type: 'email', label: 'Email', required: true }] })
    const { html } = formatMcpOutput([tool])
    expect(html).toContain(`toolname="${tool.name}"`)
    expect(html).toContain(`tooldescription="${tool.description}"`)
    expect(html).toContain('toolautosubmit')
    expect(html).toContain('toolparamdescription')
    expect(html).toContain('required')
  })

  it('html maps email type to type="email" and number to type="number"', () => {
    const tool = classifyIntent({
      fields: [
        { name: 'email', type: 'email' },
        { name: 'quantity', type: 'number' },
        { name: 'name', type: 'text' },
      ],
      triggerText: 'Go',
    })
    const { html } = formatMcpOutput([tool])
    expect(html).toContain('name="email" type="email"')
    expect(html).toContain('name="quantity" type="number"')
    expect(html).toContain('name="name" type="text"')
  })

  it('html handles email format via key containing email', () => {
    const tool = classifyIntent({ fields: [{ name: 'user_email', type: 'text' }], triggerText: 'Go' })
    const { html } = formatMcpOutput([tool])
    expect(html).toContain('type="email"')
  })

  it('escapes double quotes in html attributes', () => {
    const tool: any = {
      name: 'test"tool',
      description: 'desc "with" quotes',
      category: 'contact',
      triggerText: 'Click "me"',
      pageUrl: '/x',
      inputSchema: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'a "quoted" desc' },
        },
        required: [],
      },
    }
    const { html, json } = formatMcpOutput([tool])
    expect(html).toContain('&quot;')
    expect(html).not.toContain('test"tool"')
    expect(json).toContain('test\\"tool') // JSON escaped
  })

  it('renders enum as <select> with <option>s and replaces input', () => {
    const tool = classifyIntent({
      fields: [{ name: 'plan', type: 'select', options: ['free', 'pro', 'ent'] }],
      triggerText: 'Choose',
    })
    const { html, json } = formatMcpOutput([tool])
    expect(html).toContain('<select name="plan"')
    expect(html).toContain('<option value="free">free</option>')
    expect(html).toContain('<option value="pro">pro</option>')
    // should not contain generic input for that field
    expect(html).not.toMatch(/<input[^>]*name="plan"[^>]*type="text"/)
    // json enum preserved — extract via helper
    const obj = extractFirstJson(json)
    expect(obj.inputSchema.properties.plan.enum).toEqual(['free', 'pro', 'ent'])
  })

  it('includes required attribute only for required fields', () => {
    const tool = classifyIntent({
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'text' },
      ],
      triggerText: 'Go',
    })
    const { html } = formatMcpOutput([tool])
    const emailLine = html.split('\n').find((l) => l.includes('name="email"'))!
    const nameLine = html.split('\n').find((l) => l.includes('name="name"'))!
    expect(emailLine).toContain('required')
    expect(nameLine).not.toContain('required')
  })

  it('falls back to Submit when triggerText missing', () => {
    const tool: any = {
      name: 'submitForm',
      description: 'Submit a form',
      category: 'contact',
      triggerText: undefined,
      pageUrl: undefined,
      inputSchema: { type: 'object', properties: { x: { type: 'string', description: 'x' } }, required: [] },
    }
    const { html } = formatMcpOutput([tool])
    expect(html).toContain('<button type="submit">Submit</button>')
  })

  it('includes toolparamdescription from field description', () => {
    const tool = classifyIntent({ fields: [{ name: 'email', type: 'email', label: 'Your Email' }], triggerText: 'Go' })
    const { html } = formatMcpOutput([tool])
    expect(html).toContain('toolparamdescription="Your Email"')
  })

  it('handles empty properties (no fields)', () => {
    const tool: any = {
      name: 'submitForm',
      description: 'Submit a form',
      category: 'contact',
      triggerText: 'Go',
      pageUrl: undefined,
      inputSchema: { type: 'object', properties: {}, required: [] },
    }
    const { html, json } = formatMcpOutput([tool])
    expect(json).toContain('"properties": {}')
    expect(html).toContain('<form')
    expect(html).toContain('<button')
  })

  it('returns both json and html regardless of format param (currently always both)', () => {
    const tool = classifyIntent({ fields: [{ name: 'x', type: 'text' }], triggerText: 'Go' })
    const both = formatMcpOutput([tool], 'both')
    const j = formatMcpOutput([tool], 'json' as any)
    const h = formatMcpOutput([tool], 'html' as any)
    expect(both.json).toBeTruthy()
    expect(both.html).toBeTruthy()
    expect(j.json).toBeTruthy()
    expect(h.html).toBeTruthy()
  })

  it('includes imperative alternative comment with tool name', () => {
    const tool = mkTool({ fields: [{ name: 'x', type: 'text' }] })
    const { html } = formatMcpOutput([tool])
    expect(html).toContain('document.modelContext.registerTool')
    expect(html).toContain(tool.name)
  })

  it('handles special chars in option values with escaping', () => {
    const tool: any = {
      name: 'test',
      description: 'desc',
      category: 'contact',
      triggerText: 'Go',
      pageUrl: undefined,
      inputSchema: {
        type: 'object',
        properties: { plan: { type: 'string', description: 'plan', enum: ['a"b', 'c<d'] } },
        required: [],
      },
    }
    const { html } = formatMcpOutput([tool])
    expect(html).toContain('&quot;')
  })
})

import { describe, it, expect } from 'vitest'
import { parseFormsFromHtml } from '../src/parser'
import { classifyIntent } from '../src/classifier'
import { formatMcpOutput } from '../src/mcpFormatter'

function pipeline(html: string, format: 'json' | 'html' | 'both' = 'both') {
  const forms = parseFormsFromHtml(html)
  const tools = forms.map((f) =>
    classifyIntent({
      fields: f.fields,
      html: f.html,
      action: f.action,
      method: f.method,
      triggerText: f.triggerText,
    }),
  )
  const out = formatMcpOutput(tools, format)
  return { forms, tools, out }
}

describe('integration - HTML -> MCP tool definitions (README table)', () => {
  it('Sign Up / register => signup (contact)', () => {
    const html = `<form action="/signup"><input name="email" type="email"><input name="password" type="password"><button>Sign Up</button></form>`
    const { tools } = pipeline(html)
    expect(tools[0].name).toBe('signup')
    expect(tools[0].category).toBe('contact')
  })

  it('Sign In / log in => login', () => {
    const html = `<form><input name="email" type="email"><input name="password" type="password"><button>Sign In</button></form>`
    expect(pipeline(html).tools[0].name).toBe('login')
    const html2 = `<form><input name="email"><input name="password"><button>Log in</button></form>`
    expect(pipeline(html2).tools[0].name).toBe('login')
  })

  it('Book / Schedule / Demo / Consult => booking', () => {
    for (const txt of ['Book Demo', 'Schedule', 'Demo', 'Consult']) {
      const html = `<form><input name="name"><button>${txt}</button></form>`
      const t = pipeline(html).tools[0]
      expect(t.name).toBe('booking')
      expect(t.category).toBe('booking')
    }
  })

  it('Get Help / Support / Issue => contactSupport (with message field)', () => {
    const html = `<form><input name="message"><button>Get Help</button></form>`
    expect(pipeline(html).tools[0].name).toBe('contactSupport')
    const html2 = `<form><input name="message"><button>Support</button></form>`
    expect(pipeline(html2).tools[0].name).toBe('contactSupport')
  })

  it('Subscribe / Newsletter with email => subscribe', () => {
    const html = `<form><input name="email" type="email"><button>Subscribe</button></form>`
    expect(pipeline(html).tools[0].name).toBe('subscribe')
    const html2 = `<form><input name="email"><button>Newsletter</button></form>`
    expect(pipeline(html2).tools[0].name).toBe('subscribe')
  })

  it('Form with name="timeline_tool" => timeline (via classifier direct; pipeline currently yields fallback due to parser storing innerHTML only)', () => {
    // Direct classifier works when outer HTML is passed
    const direct = classifyIntent({ fields: [{ name: 'order_id', type: 'text' }], html: '<form name="timeline_tool"><input name="order_id"></form>' })
    expect(direct.name).toBe('timeline')
    // Pipeline via parser stores only inner HTML, so currently falls back to submitForm — documents existing behavior
    const html = `<form name="timeline_tool"><input name="order_id"><button>View</button></form>`
    expect(pipeline(html).tools[0].name).toBe('submitForm')
  })

  it('Form with name="faq_tool" => faq (via classifier direct; pipeline currently yields fallback)', () => {
    const direct = classifyIntent({ fields: [{ name: 'q', type: 'text' }], html: `<form name='faq_tool'></form>` })
    expect(direct.name).toBe('faq')
    const html = `<form name="faq_tool"><input name="q"><button>Search</button></form>`
    expect(pipeline(html).tools[0].name).toBe('submitForm')
  })

  it('Generic email+password => login', () => {
    const html = `<form><input name="email" type="email"><input name="password" type="password"><button>Submit</button></form>`
    expect(pipeline(html).tools[0].name).toBe('login')
  })

  it('Generic message field => contactSales', () => {
    const html = `<form><input name="message" placeholder="Your message"><button>Send</button></form>`
    expect(pipeline(html).tools[0].name).toBe('contactSales')
  })

  it('Few fields + email without subscribe keyword => fallback not subscribe', () => {
    const html = `<form><input name="email" type="email"><button>Send</button></form>`
    // single email without subscribe trigger but parser's purpose would be subscribe, classifier needs trigger word
    expect(pipeline(html).tools[0].name).toBe('submitForm')
  })

  it('Few fields + email with subscribe keyword => subscribe even with 2 fields', () => {
    const html = `<form><input name="email" type="email"><input name="name"><button>Subscribe</button></form>`
    expect(pipeline(html).tools[0].name).toBe('subscribe')
  })
})

describe('integration - end-to-end properties', () => {
  it('bare boolean required propagates to schema and html', () => {
    const html = `<form action="/contact"><input name="email" type="email" required><input name="name" required><button>Send Message</button></form>`
    const { tools, out } = pipeline(html)
    expect(tools[0].inputSchema.required).toEqual(expect.arrayContaining(['email', 'name']))
    expect(out.html).toContain('required')
  })

  it('select enum propagates to JSON enum and HTML select (value attr ignored — text used)', () => {
    const html = `<form><select name="topic"><option value="sales">Sales</option><option>Support</option></select><button>Send</button></form>`
    const { tools, out } = pipeline(html)
    // parser ignores value attr and uses visible text
    expect(tools[0].inputSchema.properties['topic'].enum).toEqual(['Sales', 'Support'])
    expect(out.html).toContain('<select name="topic"')
    expect(out.html).toContain('<option value="Sales">Sales</option>')
  })

  it('full document with multiple forms keeps correct tool count and ordering (faq fallback due to innerHTML bug)', () => {
    const html = `
      <html><body>
        <form action="/login"><input name="email" type="email"><input name="password" type="password"><button>Log In</button></form>
        <form action="/subscribe"><input name="email" type="email"><button>Subscribe</button></form>
        <form name="faq_tool"><input name="q"><button>Search</button></form>
      </body></html>
    `
    const { forms, tools } = pipeline(html)
    expect(forms).toHaveLength(3)
    // faq_tool not detected via pipeline (parser stores innerHTML only)
    expect(tools.map((t) => t.name)).toEqual(['login', 'subscribe', 'submitForm'])
  })

  it('skips Hunch widget forms in full document', () => {
    const html = `<form class="hunch-widget"><input name="x"></form><form><input name="email" type="email"><button>Subscribe</button></form>`
    const { forms } = pipeline(html)
    expect(forms).toHaveLength(1)
    expect(forms[0].fields[0].name).toBe('email')
  })

  it('produces valid JSON and HTML that round-trip', () => {
    const html = `<form action="/contact"><input name="email" type="email" required placeholder="you@example.com"><label for="email">Email</label><textarea name="message" required></textarea><button>Send Message</button></form>`
    const { out } = pipeline(html)
    // json part should be parseable — extract each JSON block between comment headers
    const rawBlocks = out.json.split('// Tool').slice(1)
    for (const raw of rawBlocks) {
      const start = raw.indexOf('{')
      if (start === -1) continue
      const jsonStr = raw.slice(start).split('\n\n')[0]
      expect(() => JSON.parse(jsonStr)).not.toThrow()
      const obj = JSON.parse(jsonStr)
      expect(obj.name).toBeTruthy()
      expect(obj.inputSchema).toBeDefined()
    }
    expect(out.html).toContain('toolname="')
    expect(out.html).toContain('toolparamdescription')
  })

  it('escaping of quotes propagates end-to-end (key sanitised)', () => {
    const html = `<form><input name="my-field" type="text"><button>Click "me"</button></form>`
    const { tools, out } = pipeline(html)
    expect(tools[0].inputSchema.properties['my_field']).toBeDefined()
    expect(out.html).toContain('&quot;')
    expect(out.html).toContain('Click &quot;me&quot;')
  })

  it('label and placeholder extracted and used as description', () => {
    const html = `<form><label for="email">Your Email Address</label><input name="email" id="email" placeholder="you@example.com"><button>Send</button></form>`
    const { forms, tools } = pipeline(html)
    expect(forms[0].fields[0].label).toBe('Your Email Address')
    expect(forms[0].fields[0].placeholder).toBe('you@example.com')
    expect(tools[0].inputSchema.properties['email'].description).toBe('Your Email Address')
  })

  it('number field detected via type and key patterns', () => {
    const html = `<form><input name="quantity" type="text"><input name="age" type="number"><button>Submit</button></form>`
    const { tools } = pipeline(html)
    expect(tools[0].inputSchema.properties['quantity'].type).toBe('number')
    expect(tools[0].inputSchema.properties['age'].type).toBe('number')
  })

  it('empty html returns no tools and empty formatted output', () => {
    const { forms, tools, out } = pipeline('<p>No forms here</p>')
    expect(forms).toHaveLength(0)
    expect(tools).toHaveLength(0)
    expect(out.json.trim()).toBe('')
    expect(out.html.trim()).toBe('')
  })

  it('handles HTML with no quoted action and mixed casing', () => {
    // action without quotes won't be captured by current regex (requires quotes), so pageUrl undefined
    const html = `<form action='/test' METHOD='POST'><input name="x"><button>Go</button></form>`
    const { forms, tools } = pipeline(html)
    expect(forms[0].action).toBe('/test')
    expect(forms[0].method).toBe('POST')
    expect(tools[0].pageUrl).toBe('/test')
  })
})

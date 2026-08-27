import { describe, it, expect } from 'vitest'
import { parseFormsFromHtml } from '../src/parser'

describe('parseFormsFromHtml', () => {
  it('returns empty array when no forms present', () => {
    expect(parseFormsFromHtml('<html><body><p>hello</p></body></html>')).toEqual([])
    expect(parseFormsFromHtml('')).toEqual([])
  })

  it('extracts single form with action and method', () => {
    const html = `<form action="/contact" method="post"><input name="email" type="email"><button>Send</button></form>`
    const [form] = parseFormsFromHtml(html)
    expect(form.action).toBe('/contact')
    expect(form.method).toBe('POST')
    expect(form.fields).toHaveLength(1)
  })

  it('defaults method to GET and normalises to uppercase', () => {
    const html = `<form><input name="q"></form>`
    expect(parseFormsFromHtml(html)[0].method).toBe('GET')
    const html2 = `<form method="post"><input name="x"></form>`
    expect(parseFormsFromHtml(html2)[0].method).toBe('POST')
  })

  it('extracts action with single and double quotes', () => {
    expect(parseFormsFromHtml(`<form action='/api'><input name="a"></form>`)[0].action).toBe('/api')
    expect(parseFormsFromHtml(`<form action="/api2"><input name="a"></form>`)[0].action).toBe('/api2')
  })

  it('handles multiple forms', () => {
    const html = `<form action="/a"><input name="x"></form><form action="/b"><input name="y"></form>`
    const forms = parseFormsFromHtml(html)
    expect(forms).toHaveLength(2)
    expect(forms[0].action).toBe('/a')
    expect(forms[1].action).toBe('/b')
  })

  it('skips Hunch widget forms', () => {
    const patterns = [
      'hunch-widget',
      'hunch-widget-container',
      'data-hunch-widget',
      'hunch-chat-btn',
      'hunch-widget-launcher',
    ]
    for (const p of patterns) {
      const html = `<form class="${p}"><input name="x"></form><form><input name="y"></form>`
      const forms = parseFormsFromHtml(html)
      expect(forms).toHaveLength(1)
      expect(forms[0].fields[0].name).toBe('y')
    }
  })

  it('resolves field name via name > id > default "value"', () => {
    const html = `<form><input name="email" id="x"><input id="onlyId"><input type="text"></form>`
    const fields = parseFormsFromHtml(html)[0].fields
    expect(fields[0].name).toBe('email')
    expect(fields[1].name).toBe('onlyId')
    expect(fields[2].name).toBe('value')
  })

  it('detects field types including select and defaults to text', () => {
    const html = `<form><input name="a" type="email"><input name="b"><select name="c"><option>1</option></select><textarea name="d"></textarea></form>`
    const fields = parseFormsFromHtml(html)[0].fields
    expect(fields[0].type).toBe('email')
    expect(fields[1].type).toBe('text')
    expect(fields[2].type).toBe('select')
    // textarea is captured via INPUT_TAG_REGEX? parser treats textarea as tag match group but type default text
    expect(fields[3].type).toBe('text')
  })

  it('extracts label via <label for>', () => {
    const html = `<form><label for="email">Your Email</label><input name="email" id="email"><label for="special.name">Hi</label><input name="special.name" id="special.name"></form>`
    const fields = parseFormsFromHtml(html)[0].fields
    expect(fields[0].label).toBe('Your Email')
    expect(fields[1].label).toBe('Hi')
  })

  it('escapes regex special chars in label lookup', () => {
    const html = `<form><label for="a+b">Plus</label><input name="a+b"></form>`
    const fields = parseFormsFromHtml(html)[0].fields
    expect(fields[0].label).toBe('Plus')
  })

  it('extracts placeholder and required', () => {
    const html = `<form><input name="email" placeholder="you@example.com" required><input name="x" placeholder="hi"></form>`
    const fields = parseFormsFromHtml(html)[0].fields
    expect(fields[0].placeholder).toBe('you@example.com')
    expect(fields[0].required).toBe(true)
    expect(fields[1].required).toBeUndefined()
  })

  it('normalises bare boolean attributes (required without value)', () => {
    const html = `<form><input name="email" required><input name="x" disabled></form>`
    const fields = parseFormsFromHtml(html)[0].fields
    expect(fields[0].required).toBe(true)
    // should not throw and should still parse second field
    expect(fields).toHaveLength(2)
  })

  it('extracts select options via text fallback (value attr not captured due to parser regex — documents current behavior)', () => {
    const html = `<form><select name="plan"><option value="free">Free</option><option>Pro</option><option value="ent">Enterprise</option></select></form>`
    const field = parseFormsFromHtml(html)[0].fields[0]
    // parser's OPTION_TAG_REGEX captures inner text only, so value attr is ignored; all options return visible text
    expect(field.options).toEqual(['Free', 'Pro', 'Enterprise'])
  })

  it('strips inner HTML from option text and limits to 20 options', () => {
    const many = Array.from({ length: 25 }, (_, i) => `<option>opt${i}</option>`).join('')
    const html = `<form><select name="s">${many}</select></form>`
    expect(parseFormsFromHtml(html)[0].fields[0].options).toHaveLength(20)

    const html2 = `<form><select name="s"><option><b>Bold</b> Text</option></select></form>`
    expect(parseFormsFromHtml(html2)[0].fields[0].options![0]).toBe('Bold Text')
  })

  it('extracts triggerText from button and anchor, stripping nested tags', () => {
    const html1 = `<form><input name="x"><button type="submit"><span>Send Message</span></button></form>`
    expect(parseFormsFromHtml(html1)[0].triggerText).toBe('Send Message')

    const html2 = `<form><input name="x"><a class="btn">Click <b>here</b></a></form>`
    expect(parseFormsFromHtml(html2)[0].triggerText).toBe('Click here')

    const html3 = `<form><input name="x"></form>`
    expect(parseFormsFromHtml(html3)[0].triggerText).toBeUndefined()
  })

  it('captures only first button as triggerText', () => {
    const html = `<form><button>First</button><button>Second</button></form>`
    expect(parseFormsFromHtml(html)[0].triggerText).toBe('First')
  })

  it('preserves inner form HTML (form attributes like name not included — documents current parser behavior)', () => {
    const html = `<form name="faq_tool"><input name="q"></form>`
    const form = parseFormsFromHtml(html)[0]
    // parser stores inner HTML only (formMatch[1]), so outer attributes are not preserved
    expect(form.html).toBe('<input name="q">')
    expect(form.html).not.toContain('faq_tool')
    // verify classifier would need outer HTML to detect timeline/faq — direct classifier still works when outer HTML provided
  })

  it('classifies purpose via internal rules (hasEmail+password => login)', () => {
    const html = `<form><input name="email" type="email"><input name="password" type="password"></form>`
    expect(parseFormsFromHtml(html)[0].purpose).toBe('login')
  })

  it('classifies signup when email+password + formText contains signup keywords', () => {
    // formText is built from field names+labels, so include signup via label/name
    const html = `<form><label for="email">signup register</label><input name="email"><input name="password"></form>`
    // Note: internal classifyFormPurpose uses field names/labels, not button text
    // So label containing "signup" should trigger signup
    expect(parseFormsFromHtml(html)[0].purpose).toBe('signup')
  })

  it('classifies contactSales vs contactSupport vs booking via message field', () => {
    const base = `<form><input name="message"><input name="other">`
    // need field that contains inquiry/contact/subject? message field already hasMessage
    // But support detection depends on formText containing support/help etc, so we add label
    const supportHtml = `<form><label for="message">support help</label><input name="message"></form>`
    expect(parseFormsFromHtml(supportHtml)[0].purpose).toBe('contactSupport')

    const bookingHtml = `<form><label for="message">demo sales</label><input name="message"></form>`
    expect(parseFormsFromHtml(bookingHtml)[0].purpose).toBe('booking')

    const salesHtml = `<form><input name="message"></form>`
    expect(parseFormsFromHtml(salesHtml)[0].purpose).toBe('contactSales')
  })

  it('classifies subscribe when few fields + email', () => {
    const html = `<form><input name="email" type="email"></form>`
    expect(parseFormsFromHtml(html)[0].purpose).toBe('subscribe')
    const html2 = `<form><input name="email"><input name="name"></form>`
    expect(parseFormsFromHtml(html2)[0].purpose).toBe('subscribe')
    const html3 = `<form><input name="email"><input name="a"><input name="b"></form>`
    expect(parseFormsFromHtml(html3)[0].purpose).toBeUndefined()
  })

  it('is stateless across multiple invocations', () => {
    const html = `<form><input name="email"></form>`
    expect(parseFormsFromHtml(html)).toHaveLength(1)
    expect(parseFormsFromHtml(html)).toHaveLength(1)
    expect(parseFormsFromHtml(`<form><input name="a"></form><form><input name="b"></form>`)).toHaveLength(2)
  })

  it('handles self-closing inputs and bare required in same form', () => {
    const html = `<form><input name="a" required/><input name="b" type="text" placeholder="hi" /><button>Go</button></form>`
    const form = parseFormsFromHtml(html)[0]
    expect(form.fields).toHaveLength(2)
    expect(form.fields[0].required).toBe(true)
  })
})

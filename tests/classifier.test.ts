import { describe, it, expect } from 'vitest'
import { classifyIntent } from '../src/classifier'

const mkFields = (fields: any[]) => fields

describe('classifyIntent - inputSchema generation', () => {
  it('sanitises keys and falls back to "value"', () => {
    const tool = classifyIntent({ fields: [{ name: 'first-name', type: 'text' }, { name: '', type: 'text' }] })
    expect(tool.inputSchema.properties['first_name']).toBeDefined()
    expect(tool.inputSchema.properties['value']).toBeDefined()
  })

  it('sets email format via type=email and via key containing email', () => {
    const t1 = classifyIntent({ fields: [{ name: 'contact', type: 'email' }] })
    expect(t1.inputSchema.properties['contact'].format).toBe('email')
    const t2 = classifyIntent({ fields: [{ name: 'user_email', type: 'text' }] })
    expect(t2.inputSchema.properties['user_email'].format).toBe('email')
  })

  it('sets number type via type=number and via quantity/amount/price keys', () => {
    const t1 = classifyIntent({ fields: [{ name: 'age', type: 'number' }] })
    expect(t1.inputSchema.properties['age'].type).toBe('number')
    const t2 = classifyIntent({ fields: [{ name: 'quantity', type: 'text' }] })
    expect(t2.inputSchema.properties['quantity'].type).toBe('number')
    expect(classifyIntent({ fields: [{ name: 'total_amount', type: 'text' }] }).inputSchema.properties['total_amount'].type).toBe('number')
    expect(classifyIntent({ fields: [{ name: 'price', type: 'text' }] }).inputSchema.properties['price'].type).toBe('number')
  })

  it('maps enum from select options and slices to 8', () => {
    const opts = Array.from({ length: 12 }, (_, i) => `opt${i}`)
    const tool = classifyIntent({ fields: [{ name: 'plan', type: 'select', options: opts }] })
    expect(tool.inputSchema.properties['plan'].enum).toHaveLength(8)
    expect(tool.inputSchema.properties['plan'].enum[0]).toBe('opt0')
  })

  it('only marks required when field.required === true', () => {
    const tool = classifyIntent({
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'name', type: 'text' },
        { name: 'x', type: 'text', required: false },
      ],
    })
    expect(tool.inputSchema.required).toEqual(['email'])
  })

  it('uses label as description fallback to name', () => {
    const t1 = classifyIntent({ fields: [{ name: 'email', type: 'text', label: 'Your Email' }] })
    expect(t1.inputSchema.properties['email'].description).toBe('Your Email')
    const t2 = classifyIntent({ fields: [{ name: 'foo', type: 'text' }] })
    expect(t2.inputSchema.properties['foo'].description).toBe('foo')
  })
})

describe('classifyIntent - classification priority', () => {
  it('priority 1: triggerText signup keywords', () => {
    const cases = ['Sign Up', 'sign up', 'register', 'Create Account', 'join now', 'Start trial', 'Get Started']
    for (const text of cases) {
      const t = classifyIntent({ fields: [{ name: 'x', type: 'text' }], triggerText: text })
      expect(t.name).toBe('signup')
      expect(t.description).toMatch(/Create a new account/)
      expect(t.category).toBe('contact')
    }
  })

  it('priority 1: triggerText login keywords', () => {
    const cases = ['Log In', 'log in', 'Sign In', 'sign in', 'Welcome Back']
    for (const text of cases) {
      const t = classifyIntent({ fields: [{ name: 'x', type: 'text' }], triggerText: text })
      expect(t.name).toBe('login')
    }
  })

  it('trigger signup wins over other signals (email+password would be login but trigger says signup)', () => {
    const t = classifyIntent({
      fields: [
        { name: 'email', type: 'email' },
        { name: 'password', type: 'password' },
      ],
      triggerText: 'Sign Up',
    })
    expect(t.name).toBe('signup')
  })

  it('email+password without signup trigger => login', () => {
    const t = classifyIntent({
      fields: [
        { name: 'email', type: 'email' },
        { name: 'password', type: 'password' },
      ],
      triggerText: 'Submit',
    })
    expect(t.name).toBe('login')
  })

  it('email+password with signup keyword in trigger => signup (field-type branch)', () => {
    const t = classifyIntent({
      fields: [
        { name: 'email', type: 'email' },
        { name: 'password', type: 'password' },
      ],
      triggerText: 'Create account',
    })
    // first branch already returns signup, but even second branch would
    expect(t.name).toBe('signup')
  })

  it('hasMessage (field name message) => contactSales by default', () => {
    const t = classifyIntent({ fields: [{ name: 'message', type: 'text' }], triggerText: 'Send' })
    expect(t.name).toBe('contactSales')
    expect(t.category).toBe('contact')
  })

  it('hasMessage via triggerText contact/inquiry/subject keywords', () => {
    const t = classifyIntent({ fields: [{ name: 'foo', type: 'text' }], triggerText: 'contact us' })
    // fieldNames doesn't include message, but /contact/.test(triggerText) => hasMessage true
    expect(t.name).toBe('contactSales')
  })

  it('hasMessage + support keywords => contactSupport', () => {
    for (const kw of ['support', 'help', 'issue', 'problem', 'bug', 'technical']) {
      const t = classifyIntent({ fields: [{ name: 'message', type: 'text' }], triggerText: `Get ${kw}` })
      expect(t.name).toBe('contactSupport')
      expect(t.category).toBe('support')
    }
  })

  it('hasMessage + booking keywords => booking', () => {
    for (const kw of ['demo', 'sales', 'book', 'schedule', 'consult']) {
      const t = classifyIntent({ fields: [{ name: 'message', type: 'text' }], triggerText: `Book ${kw}` })
      expect(t.name).toBe('booking')
      expect(t.category).toBe('booking')
    }
  })

  it('subscribe via email + <=2 fields + subscribe/newsletter trigger', () => {
    const t = classifyIntent({ fields: [{ name: 'email', type: 'email' }], triggerText: 'Subscribe' })
    expect(t.name).toBe('subscribe')
    const t2 = classifyIntent({
      fields: [{ name: 'email', type: 'email' }, { name: 'name', type: 'text' }],
      triggerText: 'Newsletter',
    })
    expect(t2.name).toBe('subscribe')
  })

  it('does not classify subscribe when >2 fields or trigger lacks keyword', () => {
    const t = classifyIntent({
      fields: [{ name: 'email', type: 'email' }, { name: 'a', type: 'text' }, { name: 'b', type: 'text' }],
      triggerText: 'Subscribe',
    })
    expect(t.name).not.toBe('subscribe')
    const t2 = classifyIntent({ fields: [{ name: 'email', type: 'email' }], triggerText: 'Send' })
    // will fallback to submitForm because hasEmail but not subscribe keyword
    expect(t2.name).toBe('submitForm')
  })

  it('booking via trigger keywords without message field', () => {
    for (const kw of ['book', 'schedule', 'demo', 'consult', 'appointment']) {
      const t = classifyIntent({ fields: [{ name: 'name', type: 'text' }], triggerText: `Schedule ${kw}` })
      expect(t.name).toBe('booking')
      expect(t.category).toBe('booking')
    }
  })

  it('form name attribute fallback: timeline_tool and faq_tool', () => {
    const t1 = classifyIntent({ fields: [{ name: 'x', type: 'text' }], html: '<form name="timeline_tool"><input name="x"></form>' })
    expect(t1.name).toBe('timeline')
    const t2 = classifyIntent({ fields: [{ name: 'x', type: 'text' }], html: `<form name='faq_tool'></form>` })
    expect(t2.name).toBe('faq')
  })

  it('form name detection is case-insensitive via lowercasing', () => {
    const t = classifyIntent({ fields: [{ name: 'x', type: 'text' }], html: '<form name="TIMELINE_TOOL">' })
    expect(t.name).toBe('timeline')
  })

  it('fallback to submitForm', () => {
    const t = classifyIntent({ fields: [{ name: 'foo', type: 'text' }], triggerText: 'Go' })
    expect(t.name).toBe('submitForm')
    expect(t.category).toBe('contact')
  })

  it('passes through pageUrl from action and triggerText', () => {
    const t = classifyIntent({ fields: [{ name: 'x', type: 'text' }], action: '/submit', triggerText: 'Send Message' })
    expect(t.pageUrl).toBe('/submit')
    expect(t.triggerText).toBe('Send Message')
    const t2 = classifyIntent({ fields: [{ name: 'x', type: 'text' }], action: '' })
    expect(t2.pageUrl).toBeUndefined()
  })

  it('hasEmail/hasPassword detection via field names still works without trigger keyword', () => {
    const t = classifyIntent({ fields: [{ name: 'email', type: 'text' }, { name: 'password', type: 'password' }] })
    expect(t.name).toBe('login')
  })

  it('empty fields falls back to submitForm with empty schema', () => {
    const t = classifyIntent({ fields: [] })
    expect(t.name).toBe('submitForm')
    expect(t.inputSchema.properties).toEqual({})
    expect(t.inputSchema.required).toEqual([])
  })
})

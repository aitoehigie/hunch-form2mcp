/**
 * classifyIntent — Classify a form's intent into an MCP tool category.
 * 
 * Categories (mirroring HBV2's tool naming conventions):
 * - contactSales: "Send a message or contact the team"
 * - contactSupport: "Get help from the support team"  
 * - booking: "Book a demo or consultation"
 * - signup: "Create a new account or start a free trial"
 * - login: "Sign in to your account"
 * - subscribe: "Subscribe to updates or newsletter"
 * - other: Generic form
 * 
 * Classification priority:
 * 1. Button/trigger text (most reliable user-visible signal)
 * 2. Form field types (email+password = login/signup, message = contact/sales)
 * 3. Form name attribute
 * 4. Fallback to generic submit
 */
export interface ClassifiedTool {
  name: string
  description: string
  category: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
  triggerSelector?: string
  triggerText?: string
  pageUrl?: string
}

/**
 * Core classification logic — rule-based, no LLM required.
 * Maps form fields + HTML to MCP tool definitions.
 */
export interface ClassifyIntentInput {
  fields: any[]
  html?: string
  action?: string
  method?: string
  triggerText?: string
}

export function classifyIntent(input: ClassifyIntentInput): ClassifiedTool {
  const fields = input.fields || []
  const fieldNames = fields.map((f: any) => f.name.toLowerCase())
  const fieldTypes = fields.map((f: any) => f.type.toLowerCase())
  const formHtml = input.html || ''
  const triggerText = input.triggerText || ''
  const formTextLower = triggerText.toLowerCase()

  // Build properties from fields
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const field of fields) {
    const key = field.name.replace(/[^a-zA-Z0-9_]/g, '_') || 'value'
    const prop: any = { type: 'string', description: field.label || field.name }

    // Handle enum for select fields
    if (Array.isArray(field.options) && field.options.length > 0) {
      prop.enum = field.options.slice(0, 8)
    }

    // Handle email format
    if (field.type === 'email' || /email/.test(key)) {
      prop.format = 'email'
    }

    // Handle number type
    if (field.type === 'number' || /quantity|amount|price/.test(key)) {
      prop.type = 'number'
    }

    properties[key] = prop

    // Only mark as required if explicitly required attribute
    if (field.required === true) required.push(key)
  }

  // ---- Classification ----

  // 1. Check button/trigger text FIRST (most reliable signal)
  if (/sign.?\s?up|register|create.?account|join|trial|get.?started/i.test(triggerText)) {
    return {
      name: 'signup',
      description: 'Create a new account or start a free trial',
      category: 'contact',
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      triggerText,
      pageUrl: input.action || undefined,
    }
  }

  if (/log.?in|sign.?in|welcome back/i.test(triggerText)) {
    return {
      name: 'login',
      description: 'Sign in to your account',
      category: 'contact',
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      triggerText,
      pageUrl: input.action || undefined,
    }
  }

  // 2. Check form field types
  const hasEmail = fieldNames.includes('email') || /email/.test(triggerText)
  const hasPassword = fieldNames.includes('password') || /passwd/.test(triggerText)
  const hasMessage = fieldNames.includes('message') || /contact|inquiry|subject/.test(triggerText)
  const hasSelect = fields.some((f: any) => f.type === 'select')
  const hasOptions = fields.some((f: any) => f.options && f.options.length > 0)

  // 3. Login/Signup via field types
  if (hasPassword && hasEmail) {
    if (/sign.?\s?up|register|create.?account|join|trial|get.?started/i.test(triggerText)) {
      return {
        name: 'signup',
        description: 'Create a new account or start a free trial',
        category: 'contact',
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
        triggerText,
        pageUrl: input.action || undefined,
      }
    }
    return {
      name: 'login',
      description: 'Sign in to your account',
      category: 'contact',
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      triggerText,
      pageUrl: input.action || undefined,
    }
  }

  // 4. Contact/sales via message fields
  if (hasMessage) {
    if (/(support|help|issue|problem|bug|technical)/i.test(triggerText)) {
      return {
        name: 'contactSupport',
        description: 'Get help from the support team',
        category: 'support',
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
        triggerText,
        pageUrl: input.action || undefined,
      }
    }
    if (/(demo|sales|book|schedule|consult)/i.test(triggerText)) {
      return {
        name: 'booking',
        description: 'Book a demo or consultation',
        category: 'booking',
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
        triggerText,
        pageUrl: input.action || undefined,
      }
    }
    return {
      name: 'contactSales',
      description: 'Send a message or contact the team',
      category: 'contact',
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      triggerText,
      pageUrl: input.action || undefined,
    }
  }

  // 5. Subscribe via few fields + email
  if (hasEmail && fields.length <= 2) {
    if (/(subscribe|newsletter)/i.test(triggerText)) {
      return {
        name: 'subscribe',
        description: 'Subscribe to updates or newsletter',
        category: 'contact',
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
        triggerText,
        pageUrl: input.action || undefined,
      }
    }
  }

  // 6. Booking via trigger text keywords
  if (/(book|schedule|demo|consult|appointment)/i.test(triggerText)) {
    return {
      name: 'booking',
      description: 'Book a demo or consultation',
      category: 'booking',
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      triggerText,
      pageUrl: input.action || undefined,
    }
  }

  // 6. Form name attribute fallback
  const formNameMatch = formHtml.match(/name=["']([^"']*)["']/i)
  const formName = formNameMatch?.[1]?.toLowerCase() || ''

  if (formName === 'timeline_tool') {
    return {
      name: 'timeline',
      description: 'View order or ticket lifecycle timeline',
      category: 'contact',
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      triggerText,
      pageUrl: input.action || undefined,
    }
  }
  if (formName === 'faq_tool') {
    return {
      name: 'faq',
      description: 'Search and browse frequently asked questions',
      category: 'contact',
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
      triggerText,
      pageUrl: input.action || undefined,
    }
  }

  // 7. Fallback generic
  return {
    name: 'submitForm',
    description: 'Submit a form',
    category: 'contact',
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
    triggerText,
    pageUrl: input.action || undefined,
  }
}
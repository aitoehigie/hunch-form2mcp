/**
 * parseFormsFromHtml — Extract <form> tags and modal containers from HTML.
 * Pure HTML parsing, no LLM required. Uses linkodom (same as HBV2 crawler).
 * 
 * Returns array of form objects with fields, purpose classification, and trigger info.
 */
import { parseHTML } from 'linkedom'

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Regex for bare boolean attributes (same as HBV2 crawler)
const BARE_BOOLEAN_ATTRS =
  /(<[^>]*?[\s])(required|checked|selected|disabled|readonly|multiple|novalidate|hidden|autofocus|async|defer|autoplay|muted|loop|controls|playsinline|itemscope|download|open|reversed|formnovalidate)(?=[\s/>])/gi

function normalizeBareAttributes(html: string): string {
  return html.replace(BARE_BOOLEAN_ATTRS, '$1$2=""')
}

// Minimal tag regex for form extraction
const FORM_TAG_REGEX = /<form[^>]*>([\s\S]*?)<\/form>/gi
const INPUT_TAG_REGEX = /<(input|textarea|select)\b[^>]*\/?>/gi
const OPTION_TAG_REGEX = /<option\b[^>]*>([\s\S]*?)<\/option>/gi

export interface ExtractedField {
  name: string
  type: string
  label?: string
  placeholder?: string
  options?: string[]
  required?: boolean
}

export interface ExtractedForm {
  action: string
  method: string
  fields: ExtractedField[]
  purpose?: string
  triggerText?: string
  isModal?: boolean
  html: string // Added: full form HTML for classification
}

/**
 * Extract all <form> elements from HTML string.
 */
export function parseFormsFromHtml(html: string): ExtractedForm[] {
  // Normalize bare boolean attributes first
  const cleanedHtml = normalizeBareAttributes(html)

  const forms: ExtractedForm[] = []
  let formMatch: RegExpMatchArray | null

  while ((formMatch = FORM_TAG_REGEX.exec(cleanedHtml)) !== null) {
    const fullMatch = formMatch[0]
    const formHtml = formMatch[1] || ''

    // Extract action and method
    const actionMatch = fullMatch.match(/action=["']([^"']*)["']/i)
    const action = actionMatch?.[1] || ''
    const methodMatch = fullMatch.match(/method=["']([^"']*)["']/i)
    const method = methodMatch?.[1]?.toUpperCase() || 'GET'

    // Skip Hunch widget forms (same as HBV2)
    if (
      /hunch-widget|hunch-widget-container|data-hunch-widget|hunch-chat-btn|hunch-widget-launcher/.test(
        fullMatch,
      )
    ) {
      continue
    }

    // Extract fields: input, textarea, select
    const fields: ExtractedField[] = []
    let fieldMatch: RegExpMatchArray | null

    while ((fieldMatch = INPUT_TAG_REGEX.exec(formHtml)) !== null) {
      const tag = fieldMatch[0]
      const nameMatch = tag.match(/name=["']([^"']*)["']/i)
      const idMatch = tag.match(/id=["']([^"']*)["']/i)
      const name = (nameMatch?.[1] || idMatch?.[1] || '').toString() || 'value'
      const typeMatch = tag.match(/type=["']([^"']*)["']/i)
      const isSelect = fieldMatch[1] === 'select'
      const type = isSelect ? 'select' : (typeMatch?.[1] || 'text').toString()

      let field: ExtractedField = { name, type }

      if (isSelect) {
        // Extract <option> values
        const options: string[] = []
        const rest = formHtml.slice(fieldMatch.index)
        const close = rest.match(/<\/select>/i)
        if (close) {
          const block = rest.slice(0, close.index + close[0].length)
          let optMatch: RegExpMatchArray | null
          while ((optMatch = OPTION_TAG_REGEX.exec(block)) !== null) {
            const optVal = optMatch[1].match(/value=(["'])([^\1]*?)\1/)
            if (optVal?.[2]) options.push(optVal[2])
            else {
              const optText = optMatch[1].replace(/<[^>]*>/g, '').trim()
              if (optText) options.push(optText)
            }
          }
          if (options.length > 0) field.options = options.slice(0, 20)
        }
      } else {
        // Extract label, placeholder, required using regex on form HTML
        // tag is a string (raw HTML), can't use DOM methods on it
const labelFromHtml = formHtml.match(
          new RegExp(`<label[^>]*\\bfor=[\"']?${escapeRegex(name)}[\"']?[^>]*>([\\s\\S]*?)<\\/label>`, 'i'),
        )
        const label = (labelFromHtml?.[1] || '').trim() || ''

        if (label) field.label = label

        // Extract placeholder from the input tag itself
        const phMatch = tag.match(/placeholder=["']([^"']*)["']/i)
        if (phMatch?.[1]) field.placeholder = phMatch[1]

        // Check for required attribute in the original tag string
        if (/required/i.test(tag)) field.required = true
      }

      fields.push(field)
    }

    // Extract trigger text from button within the form HTML
    const triggerMatch = formHtml.match(/<(button|a)[^>]*>([\s\S]*?)<\/(button|a)>/i)
    const extractedTriggerText = triggerMatch ? triggerMatch[2].replace(/<[^>]*>/g, '').trim() : undefined

    // Classify purpose based on fields (rule-based, no LLM)
    const purpose = classifyFormPurpose(fields)

    forms.push({
      action,
      method,
      fields,
      purpose,
      html: formHtml,
      triggerText: extractedTriggerText,
    })
  }

  return forms
}

/**
 * classifyFormPurpose — Rule-based form purpose classification.
 * Mirrors HBV2's classifyToolIntent but simplified for CLI use.
 */
function classifyFormPurpose(fields: ExtractedField[]): string | undefined {
  const fieldNames = fields.map((f) => f.name.toLowerCase())
  const fieldLower = fields.map((f) => f.type.toLowerCase())
  const formText = fields
    .map((f) => f.name + ' ' + (f.label || ''))
    .join(' ')
    .toLowerCase()

  const hasEmail = fieldNames.includes('email') || /email/.test(formText)
  const hasPassword = fieldNames.includes('password') || /passwd/.test(formText)
  const hasMessage = fieldNames.includes('message') || /contact|inquiry|subject/.test(formText)
  const hasPhone = fieldNames.includes('phone') || /tel/.test(formText)
  const hasSelect = fields.some((f) => f.type === 'select')
  const hasOptions = fields.some((f) => f.options && f.options.length > 0)

  // Check form name attribute
  const formHtml = fields.map((f) => f.name).join(' ')

  // Login/Signup detection
  if (hasPassword && hasEmail) {
    if (/sign.?up|register|create.?account|join|trial|get.?started/.test(formText)) {
      return 'signup'
    }
    return 'login'
  }

  // Contact/sales detection
  if (hasMessage) {
    if (/support|help|issue|problem|bug|technical/.test(formText)) {
      return 'contactSupport'
    }
    if (/demo|sales|book|schedule|consult/.test(formText)) {
      return 'booking'
    }
    return 'contactSales'
  }

  // Subscribe/Newsletter detection
  if (hasEmail && fields.length <= 2) {
    return 'subscribe'
  }

  // Default: generic submit form
  return undefined
}
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const DIST = path.join(__dirname, '../dist/index.js')

function runCli(args: string[], opts: { cwd?: string } = {}) {
  const result = spawnSync('node', [DIST, ...args], {
    encoding: 'utf-8',
    cwd: opts.cwd,
    timeout: 8000,
  })
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    error: result.error,
  }
}

describe('CLI (dist/index.js)', () => {
  let tmpDir: string
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunch-test-'))
    execSync('npm run build', { stdio: 'ignore' })
  })
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('fails when --input is missing (commander requiredOption)', () => {
    const res = runCli([])
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/required option/i)
  })

  it('handles HTML file input and outputs both formats by default', () => {
    const html = `<form action="/contact"><input name="email" type="email" required><input name="message"><button>Send Message</button></form>`
    const file = path.join(tmpDir, 'contact.html')
    fs.writeFileSync(file, html, 'utf-8')
    const res = runCli(['--input', file])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('=== MCP Tool Definitions ===')
    expect(res.stdout).toContain('=== Hunch HTML Attributes ===')
    expect(res.stdout).toContain('contactSales')
  })

  it('supports --format json (only json section)', () => {
    const html = `<form><input name="email" type="email"><button>Subscribe</button></form>`
    const file = path.join(tmpDir, 'sub.html')
    fs.writeFileSync(file, html, 'utf-8')
    const res = runCli(['--input', file, '--format', 'json'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('=== MCP Tool Definitions ===')
    expect(res.stdout).not.toContain('=== Hunch HTML Attributes ===')
  })

  it('supports --format html (only html section)', () => {
    const html = `<form><input name="x"><button>Go</button></form>`
    const file = path.join(tmpDir, 'generic.html')
    fs.writeFileSync(file, html, 'utf-8')
    const res = runCli(['--input', file, '--format', 'html'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('=== Hunch HTML Attributes ===')
    expect(res.stdout).not.toContain('=== MCP Tool Definitions ===')
  })

  it('reports "No forms found" for HTML without forms', () => {
    const file = path.join(tmpDir, 'noforms.html')
    fs.writeFileSync(file, '<html><body><p>hello</p></body></html>', 'utf-8')
    const res = runCli(['--input', file])
    expect(res.stdout).toContain('No forms found')
    expect(res.status).toBe(0)
  })

  it('errors when file does not exist', () => {
    const res = runCli(['--input', path.join(tmpDir, 'missing.html')])
    // fs.readFileSync throws, caught and exit 1, message on stderr
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toMatch(/Error reading|ENOENT/i)
  })

  it('handles multiple forms and lists each tool', () => {
    const html = `
      <form><input name="email" type="email"><input name="password" type="password"><button>Log In</button></form>
      <form><input name="email" type="email"><button>Subscribe</button></form>
    `
    const file = path.join(tmpDir, 'multi.html')
    fs.writeFileSync(file, html, 'utf-8')
    const res = runCli(['--input', file])
    expect(res.stdout).toContain('login')
    expect(res.stdout).toContain('subscribe')
  })

  it('produces valid JSON that can be parsed (json format)', () => {
    const html = `<form><input name="email" type="email" required><button>Subscribe</button></form>`
    const file = path.join(tmpDir, 'validjson.html')
    fs.writeFileSync(file, html, 'utf-8')
    const res = runCli(['--input', file, '--format', 'json'])
    const jsonPart = res.stdout.split('=== MCP Tool Definitions ===')[1] || ''
    const rawBlocks = jsonPart.split('// Tool').slice(1)
    expect(rawBlocks.length).toBeGreaterThan(0)
    for (const raw of rawBlocks) {
      const start = raw.indexOf('{')
      if (start === -1) continue
      const jsonStr = raw.slice(start).split('\n\n')[0]
      if (jsonStr.trim()) {
        expect(() => JSON.parse(jsonStr)).not.toThrow()
        const obj = JSON.parse(jsonStr)
        expect(obj.name).toBeTruthy()
        expect(obj.inputSchema).toBeDefined()
      }
    }
  })

  it('produces declarative WebMCP html with required attributes', () => {
    const html = `<form><select name="plan"><option>free</option><option>pro</option></select><button>Choose</button></form>`
    const file = path.join(tmpDir, 'select.html')
    fs.writeFileSync(file, html, 'utf-8')
    const res = runCli(['--input', file, '--format', 'html'])
    expect(res.stdout).toContain('toolname=')
    expect(res.stdout).toContain('<select')
    expect(res.stdout).toContain('<option')
  })
})

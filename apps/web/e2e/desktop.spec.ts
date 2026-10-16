import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The desktop start screen, driven in a normal browser against a stand-in for the Tauri shell
// (window.__TAURI__): scan results, files by path, listen start/stop, and OTLP events.

const fixture = (p: string) => fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url))
const FIXTURES_DIR = fixture('')

const NOW = Date.now()
const SESSIONS = [
  { source: 'claude-code', path: fixture('claude-code/session.jsonl'), title: 'Fix the off-by-one in paginate', project: '/work/demo-app', mtimeMs: NOW - 12 * 60_000, size: 9_200 },
  { source: 'claude-code', path: fixture('openinference/travel-planner.collector-file.jsonl'), title: 'Refactor billing module', project: '/work/shop', mtimeMs: NOW - 3 * 3_600_000, size: 41_000 },
  { source: 'claude-code', path: '/work/api/s.jsonl', project: '/work/api', mtimeMs: NOW - 2 * 86_400_000, size: 700 },
]

async function shell(page: Page, opts: { sessions?: typeof SESSIONS; portBusy?: boolean } = {}) {
  await page.route('**/__file?*', async (route) => {
    const p = new URL(route.request().url()).searchParams.get('p')!
    if (!p.startsWith(FIXTURES_DIR)) return route.fulfill({ status: 404 })
    await route.fulfill({ body: readFileSync(p) })
  })
  await page.addInitScript(
    ({ sessions, portBusy }) => {
      const listeners: Record<string, (e: { payload: unknown }) => void> = {}
      const w = window as unknown as Record<string, unknown>
      w['__calls'] = [] as unknown[]
      w['__TAURI__'] = {
        core: {
          invoke: async (cmd: string, args?: unknown) => {
            ;(w['__calls'] as unknown[]).push([cmd, args])
            if (cmd === 'scan_sessions') return sessions
            if (cmd === 'listen_start') {
              if (portBusy) throw 'port 4318 is already in use'
              return 4318
            }
            return null
          },
          convertFileSrc: (p: string) => `/__file?p=${encodeURIComponent(p)}`,
        },
        event: { listen: async (name: string, cb: (e: { payload: unknown }) => void) => ((listeners[name] = cb), () => {}) },
      }
      w['__emit'] = (name: string, payload: unknown) => listeners[name]?.({ payload })
    },
    { sessions: opts.sessions ?? SESSIONS, portBusy: opts.portBusy ?? false },
  )
  await page.goto('/')
}

const emitBatch = (page: Page, file: string, contentType: string) =>
  page.evaluate(
    ([b64, ct]) => (window as unknown as { __emit: (n: string, p: unknown) => void }).__emit('tracey://otlp', { contentType: ct, encoding: '', bodyB64: b64 }),
    [readFileSync(fixture(file)).toString('base64'), contentType] as const,
  )
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls.map((c) => c[0]))

test.describe('desktop start screen', () => {
  test('lists the sessions found on the machine, newest first, with project and age', async ({ page }) => {
    await shell(page)
    const rows = page.locator('.dh-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Fix the off-by-one in paginate')
    await expect(rows.nth(0)).toContainText('/work/demo-app')
    await expect(rows.nth(0)).toContainText('12m ago')
    await expect(rows.nth(2)).toContainText('api') // no title: falls back to the project folder
    await expect(page.locator('.dh-src', { hasText: 'Claude Code' })).toContainText('3')
  })

  test('filters as you type and by source', async ({ page }) => {
    await shell(page)
    await page.getByLabel('Search sessions').fill('billing')
    await expect(page.locator('.dh-row')).toHaveCount(1)
    await page.getByLabel('Search sessions').fill('zzz')
    await expect(page.locator('.dh-empty')).toContainText('Nothing matches')
    await page.getByLabel('Search sessions').fill('')
    await page.locator('.dh-src', { hasText: 'Live' }).click()
    await expect(page.locator('.dh-empty')).toContainText('No live runs yet')
  })

  test('opens a session through the shell and returns home from the logo', async ({ page }) => {
    await shell(page)
    await page.locator('.dh-row', { hasText: 'Fix the off-by-one' }).click()
    await expect(page.locator('.chips')).toContainText('Claude Code')
    await expect(page.locator('.graph-canvas')).toBeVisible()
    await page.getByRole('button', { name: 'tracey home' }).click()
    await expect(page.locator('.dh-row')).toHaveCount(3)
    expect(await calls(page)).toContain('scan_sessions')
  })

  test('explains an empty machine and offers the sample', async ({ page }) => {
    await shell(page, { sessions: [] })
    await expect(page.locator('.dh-empty')).toContainText('No sessions found')
    await page.getByRole('button', { name: /try a sample/i }).click()
    await expect(page.locator('.chips')).toContainText('OpenInference')
  })

  test('has no horizontal scroll on a phone-width window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await shell(page)
    await expect(page.locator('.dh-row').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })
})

test.describe('listening from the desktop app', () => {
  test('toggles the receiver and shows the endpoint to export', async ({ page }) => {
    await shell(page)
    await page.getByRole('button', { name: /listen for a running agent/i }).click()
    await expect(page.getByRole('button', { name: /listening on :4318/i })).toBeVisible()
    await expect(page.locator('.dh-endpoint')).toContainText('OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318')
    await page.getByRole('button', { name: /listening on :4318/i }).click()
    await expect(page.getByRole('button', { name: /listen for a running agent/i })).toBeVisible()
    expect(await calls(page)).toEqual(expect.arrayContaining(['listen_start', 'listen_stop']))
  })

  test('shows a live run as spans arrive and grows the open view without leaving it', async ({ page }) => {
    await shell(page)
    await page.getByRole('button', { name: /listen for a running agent/i }).click()
    await emitBatch(page, 'otlp-protobuf/sample.pb', 'application/x-protobuf')
    const run = page.locator('.dh-row', { hasText: 'live run' })
    await expect(run).toContainText('5 spans')
    await expect(page.locator('.dh-src', { hasText: 'Live' })).toContainText('1')

    await run.click()
    await expect(page.locator('.chips')).toContainText('5 spans')
    await expect(page.locator('.verdict')).toContainText('First failure: search_flights')
    await page.waitForTimeout(400)

    await emitBatch(page, 'otlp-protobuf/sample.pb', 'application/x-protobuf') // same trace id: the run grows
    await expect(page.locator('.chips')).toContainText('10 spans')
    await expect(page.locator('.graph-canvas')).toBeVisible()
  })

  test('says so when the port is already taken', async ({ page }) => {
    await shell(page, { portBusy: true })
    await page.getByRole('button', { name: /listen for a running agent/i }).click()
    await expect(page.getByRole('alert')).toContainText('port 4318 is already in use')
    await expect(page.getByRole('button', { name: /listen for a running agent/i })).toBeVisible()
  })
})

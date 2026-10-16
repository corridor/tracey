import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const fixture = (p: string) => fileURLToPath(new URL(`../../../fixtures/${p}`, import.meta.url))

/** Fail the test on any uncaught error or console error. */
function watchErrors(page: Page): string[] {
  const errs: string[] = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  return errs
}

/** Number of non-transparent pixels on a canvas: proves something was actually drawn. */
const inkOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel)!
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++
    return n
  }, selector)

async function openSample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /try a sample/i }).click()
  await expect(page.locator('.graph-canvas')).toBeVisible()
}

async function uploadFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(path)
}

test.describe('landing', () => {
  test('shows the headline, drop target and sample button', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Drop a trace')
    await expect(page.getByRole('button', { name: /choose a trace file/i })).toBeVisible()
    await expect(page.getByText('Nothing is uploaded')).toBeVisible()
    expect(errs).toEqual([])
  })

  test('rejects a file it does not recognise with a readable message', async ({ page }) => {
    await uploadFile(page, fixture('claude-code/README.md'))
    await expect(page.getByRole('alert')).toContainText("doesn't look like a trace")
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('sample trace', () => {
  test('detects the source, lists findings and frames the first error', async ({ page }) => {
    const errs = watchErrors(page)
    await openSample(page)
    await expect(page.locator('.chips')).toContainText('OpenInference')
    await expect(page.locator('.chips')).toContainText('16 spans')
    await expect(page.locator('.chip.err')).toContainText('1')
    await expect(page.locator('.findings-float')).toContainText('search_flights failed 3×')
    await expect(page.locator('.inspector-float h2')).toHaveText('search_flights')
    await expect(page.locator('.inspector-float')).toContainText('flight API timed out')
    expect(errs).toEqual([])
  })

  test('draws the graph and the timeline strip', async ({ page }) => {
    await openSample(page)
    await page.waitForTimeout(500) // let the framing animation finish
    expect(await inkOf(page, '.graph-canvas')).toBeGreaterThan(5_000)
    expect(await inkOf(page, '.strip-canvas')).toBeGreaterThan(500)
  })

  test('clicking a finding selects its span', async ({ page }) => {
    await openSample(page)
    await page.locator('.findings-float .finding', { hasText: 'took 3.2s' }).click()
    await expect(page.locator('.inspector-float h2')).toHaveText('ChatCompletion')
  })

  test('arrow keys walk the tree', async ({ page }) => {
    await openSample(page)
    await page.locator('.graph-canvas').focus()
    await page.keyboard.press('ArrowLeft') // to the parent
    await expect(page.locator('.inspector-float h2')).toHaveText('planner')
    await page.keyboard.press('ArrowRight') // first child
    await expect(page.locator('.inspector-float h2')).toHaveText('ChatCompletion')
  })

  test('the inspector can be closed and comes back on the next selection', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: /close inspector/i }).click()
    await expect(page.locator('.inspector-float')).toHaveCount(0)
    await page.locator('.findings-float .finding').first().click()
    await expect(page.locator('.inspector-float')).toBeVisible()
  })

  test('the list view shows every span and selects on click', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'List' }).click()
    await expect(page.locator('.row')).toHaveCount(16)
    await page.locator('.row', { hasText: 'delegate_research' }).click()
    await expect(page.locator('.inspector h2')).toHaveText('delegate_research')
  })
})

test.describe('other formats', () => {
  const cases: [string, string, RegExp][] = [
    ['otel-genai/travel-planner.collector-file.jsonl', 'OpenTelemetry GenAI', /16 spans/],
    ['claude-code/session.jsonl', 'Claude Code', /spans/],
    ['frameworks/strands/otlp-default.json', 'OpenTelemetry GenAI', /spans/],
    ['frameworks/openai-agents/otlp-openinference.json', 'OpenInference', /spans/],
  ]
  for (const [file, source, spans] of cases) {
    test(`opens ${file}`, async ({ page }) => {
      const errs = watchErrors(page)
      await uploadFile(page, fixture(file))
      await expect(page.locator('.chips')).toContainText(source)
      await expect(page.locator('.chips')).toContainText(spans)
      await expect(page.locator('.graph-canvas')).toBeVisible()
      expect(errs).toEqual([])
    })
  }

  test('opens a pasted trace', async ({ page }) => {
    await page.goto('/')
    const text = readFileSync(fixture('otel-genai/travel-planner.collector-file.jsonl'), 'utf8')
    await page.evaluate((t) => {
      const dt = new DataTransfer()
      dt.setData('text', t)
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }))
    }, text)
    await expect(page.locator('.chips')).toContainText('OpenTelemetry GenAI')
  })
})

test.describe('theme', () => {
  test('cycles dark, light, auto and re-colours the canvas', async ({ page }) => {
    await openSample(page)
    const toggle = page.getByRole('button', { name: /^theme/i })
    await toggle.click() // auto -> dark
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.waitForTimeout(300)
    const dark = await page.locator('.graph-canvas').screenshot()
    await toggle.click() // -> light
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.waitForTimeout(300)
    const light = await page.locator('.graph-canvas').screenshot()
    expect(Buffer.compare(dark, light)).not.toBe(0)
    await toggle.click() // -> auto
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  })
})

test.describe('responsive', () => {
  for (const [name, width, height] of [['phone', 390, 800], ['tablet', 768, 1024], ['wide', 2560, 1300]] as const) {
    test(`${name} (${width}px) has no horizontal scroll and keeps the canvas visible`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await openSample(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      const box = await page.locator('.graph-canvas').boundingBox()
      expect(box!.width).toBeGreaterThan(width * 0.9)
      const inspector = await page.locator('.inspector-float').boundingBox()
      expect(inspector!.x).toBeGreaterThanOrEqual(0)
      expect(inspector!.x + inspector!.width).toBeLessThanOrEqual(width + 1)
    })
  }
})

test.describe('large traces', () => {
  test('a 20,000-span trace loads and draws quickly', async ({ page }) => {
    const spans: object[] = []
    const t0 = 1_700_000_000_000
    for (let i = 0; i < 20_000; i++) {
      spans.push({
        traceId: 'a'.repeat(32),
        spanId: i.toString(16).padStart(16, '0'),
        parentSpanId: i === 0 ? '' : (i % 50 === 0 ? 0 : i - 1).toString(16).padStart(16, '0'),
        name: i === 0 ? 'agent' : `step ${i % 40}`,
        kind: 1,
        startTimeUnixNano: String((t0 + i * 5) * 1_000_000),
        endTimeUnixNano: String((t0 + i * 5 + 4) * 1_000_000),
        status: i === 12_345 ? { code: 2, message: 'boom' } : {},
        attributes: [{ key: 'openinference.span.kind', value: { stringValue: i === 0 ? 'AGENT' : 'TOOL' } }],
      })
    }
    const body = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ scope: { name: 'big' }, spans }] }] })
    await page.goto('/')
    const started = Date.now()
    await page.locator('input[type=file]').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(body) })
    await expect(page.locator('.chips')).toContainText('20000 spans')
    await expect(page.locator('.findings-float')).toContainText('boom')
    expect(Date.now() - started).toBeLessThan(5_000)
    await page.waitForTimeout(400)
    expect(await inkOf(page, '.graph-canvas')).toBeGreaterThan(1_000)
  })
})

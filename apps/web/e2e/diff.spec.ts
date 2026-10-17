import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { variant } from './variant'


async function compare(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /try a sample/i }).click()
  await expect(page.locator('.graph-canvas')).toBeVisible()
  await page.getByTestId('compare-input').setInputFiles({ name: 'variant.jsonl', mimeType: 'application/json', buffer: variant() })
  await expect(page.getByLabel('Comparison', { exact: true })).toBeVisible()
}

test.describe('comparing two runs', () => {
  test('summarises what changed between the sample and an edited copy', async ({ page }) => {
    await compare(page)
    await expect(page.locator('.diff-summary')).toContainText('1 removed')
    await expect(page.locator('.diff-summary')).toContainText('1 changed')
    await expect(page.locator('.diff-runs')).toContainText('variant.jsonl')
  })

  test('lists only the changes by default and everything on request', async ({ page }) => {
    await compare(page)
    await expect(page.locator('.drow')).toHaveCount(2)
    await expect(page.locator('.drow.removed')).toContainText('search_flights')
    await expect(page.locator('.drow.changed')).toContainText('get_weather')
    await expect(page.locator('.drow.changed')).toContainText('input')
    await page.getByLabel('Only changes').uncheck()
    await expect(page.locator('.drow')).toHaveCount(16)
    await page.getByLabel('Only changes').check()
    await expect(page.locator('.drow')).toHaveCount(2)
  })

  test('shows a line diff of the changed input, with one line removed and one added', async ({ page }) => {
    await compare(page)
    await page.locator('.drow.changed').click()
    await expect(page.locator('.diff-detail h2')).toContainText('get_weather')
    const input = page.locator('.payload', { has: page.getByRole('heading', { name: /^input/ }) })
    await expect(input.locator('.tline.del')).toContainText('Paris')
    await expect(input.locator('.tline.add')).toContainText('Rome')
    await expect(input.locator('.tline.del')).toHaveCount(1)
    await expect(input.locator('.tline.add')).toHaveCount(1)
  })

  test('a removed step shows only the A side', async ({ page }) => {
    await compare(page)
    await page.locator('.drow.removed').click()
    await expect(page.locator('.diff-detail h2')).toContainText('removed')
    await expect(page.locator('.diff-detail .cmp')).toContainText('error')
  })

  test('closing the comparison returns to the graph of the first run', async ({ page }) => {
    await compare(page)
    await page.getByRole('button', { name: /close comparison/i }).click()
    await expect(page.locator('.graph-canvas')).toBeVisible()
    await expect(page.getByRole('button', { name: /compare/i })).toBeVisible()
  })

  test('an unrecognised second file explains itself and stays on the first run', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /try a sample/i }).click()
    await page.getByTestId('compare-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(page.locator('.graph-canvas')).toBeVisible()
    await expect(page.getByLabel('Comparison', { exact: true })).toHaveCount(0)
  })

  test('works on a phone: no horizontal scroll, list above the detail', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await compare(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await page.locator('.drow.changed').click()
    const list = await page.locator('.diff-list').boundingBox()
    const detail = await page.locator('.diff-detail').boundingBox()
    expect(detail!.y).toBeGreaterThanOrEqual(list!.y + list!.height - 1)
  })
})

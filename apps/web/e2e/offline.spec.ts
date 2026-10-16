import { expect, test } from '@playwright/test'

// Runs against the production build (port 4199), which registers the service worker.
test.use({ baseURL: 'http://localhost:4199' })

test('serves a valid web app manifest with icons', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel=manifest]').getAttribute('href')
  const res = await request.get(href!)
  expect(res.ok()).toBe(true)
  const m = await res.json()
  expect(m.name).toBe('tracey')
  expect(m.display).toBe('standalone')
  for (const icon of m.icons as { src: string }[]) expect((await request.get(icon.src)).ok()).toBe(true)
})

test('opens again with no network once it has been loaded', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // Wait until the worker controls the page and the assets have been cached.
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await page.waitForTimeout(500)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Drop a trace')
  await page.getByRole('button', { name: /try a sample/i }).click()
  await expect(page.locator('.graph-canvas')).toBeVisible()
  await expect(page.locator('.chips')).toContainText('OpenInference')
})

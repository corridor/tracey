import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'

// Regenerates the README screenshots: `SCREENSHOTS=1 pnpm --filter @ggx/tracey-web test:e2e screenshots`.
// Skipped in normal runs.
test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to regenerate docs/images')

const out = (name: string) => fileURLToPath(new URL(`../../../docs/images/${name}.png`, import.meta.url))

const shots: [string, number, number, 'dark' | 'light', boolean][] = [
  ['hero-dark', 1440, 860, 'dark', true],
  ['hero-light', 1440, 860, 'light', true],
  ['phone-dark', 390, 800, 'dark', true],
  ['landing-dark', 1440, 700, 'dark', false],
]

for (const [name, width, height, scheme, sample] of shots) {
  test(`screenshot ${name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.goto('/')
    if (sample) {
      await page.getByRole('button', { name: /try a sample/i }).click()
      await page.waitForSelector('.graph-canvas')
      await page.waitForTimeout(800)
    }
    await page.screenshot({ path: out(name) })
    await ctx.close()
  })
}

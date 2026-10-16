import { defineConfig } from '@playwright/test'

// Runs the real site in Chromium. `PLAYWRIGHT_BROWSERS_PATH` can point at an existing install;
// otherwise run `pnpm exec playwright install chromium` once.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5199', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm exec vite --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The production build, for the service worker and manifest (the dev server never registers one).
      command: 'pnpm exec vite build && pnpm exec vite preview --port 4199 --strictPort',
      url: 'http://localhost:4199',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})

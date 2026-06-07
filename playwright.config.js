// Minimal Playwright Config — Smoke-Test gegen localhost:3000
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  reporter: 'list',
  use: {
    headless: true,
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium-headless-shell',
      use: { browserName: 'chromium', channel: undefined, launchOptions: { args: ['--no-sandbox'] } },
    },
  ],
});

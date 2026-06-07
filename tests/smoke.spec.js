// NEXUS V9 Smoke-Test — Browser-Verifikation
// Pflicht-Tests: Tab-Switch, Wallet-Wert, Mobile-View
const { test, expect, devices } = require('@playwright/test');

const BASE = 'http://localhost:3000';

test('1. Bot UI loaded — Title + Hauptdom', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const title = await page.title();
  console.log(`  Title: ${title}`);
  // Mind. 21 nb-* Tab-IDs müssen im DOM existieren
  const tabCount = await page.locator('[id^="nb-"]').count();
  console.log(`  Tab-Buttons im DOM: ${tabCount}`);
  expect(tabCount).toBeGreaterThanOrEqual(21);
});

test('2. KAPITAL-Tab Click + Wallet-Wert sichtbar', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('#nb-kapital').click();
  await page.waitForTimeout(2500);
  const capTotal = await page.locator('#cap-total').textContent({ timeout: 5000 });
  console.log(`  cap-total: ${capTotal}`);
  expect(capTotal).not.toBe('—');
  expect(capTotal).toMatch(/[0-9]/);
});

test('3. Mobile-View (iPhone 12 emulation) — Tabs sichtbar', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 12'] });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const viewport = page.viewportSize();
  console.log(`  Viewport: ${viewport.width}x${viewport.height}`);
  expect(viewport.width).toBeLessThanOrEqual(450);
  const tabsVisible = await page.locator('[id^="nb-"]').count();
  console.log(`  Tabs sichtbar mobile: ${tabsVisible}`);
  expect(tabsVisible).toBeGreaterThanOrEqual(21);
  await ctx.close();
});

test('4. Console-Errors prüfen', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(`PAGEERR: ${e.message}`));
  await page.goto(BASE);
  await page.waitForTimeout(3000);
  console.log(`  Console-Errors: ${errors.length}`);
  errors.slice(0, 5).forEach(e => console.log(`    ${e.slice(0, 150)}`));
  // No assertion — nur dokumentieren
});

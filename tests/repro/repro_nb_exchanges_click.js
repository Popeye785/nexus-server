const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem('nx_proxy', 'http://localhost:3000'));
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('PAGEERR: ' + String(e)));
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);
  try { await page.click('#nb-exchanges', { timeout: 5000 }); await page.waitForTimeout(3000); } catch (e) {}
  await ctx.close(); await browser.close();
  console.log('PAGEERR count (real JS errors):', pageErrors.length);
  pageErrors.forEach((e, i) => console.log(`  [${i}]`, e.slice(0, 250)));
  process.exit(pageErrors.length > 0 ? 1 : 0);
})();

const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(4000);
  await ctx.close(); await browser.close();
  console.log('PageErrors collected:', pageErrors.length);
  pageErrors.forEach((e, i) => console.log(`  [${i}]`, e.slice(0, 200)));
  const nbRelated = pageErrors.filter(e => /nb-exchanges|exchanges|Cannot read|null/i.test(e));
  console.log('Related to nb-exchanges/null:', nbRelated.length);
  process.exit(nbRelated.length > 0 ? 1 : 0);
})();

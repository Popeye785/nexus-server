const { chromium } = require('@playwright/test');

(async () => {
  const errors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.click('#nb-bots');
    await page.waitForTimeout(4500);

    const slots = await page.locator('#pdb-slots').textContent();
    const botTypeCounts = await page.evaluate(() => ({
      single: document.getElementById('bt-count-SINGLE')?.textContent?.trim(),
      grid: document.getElementById('bt-count-GRID')?.textContent?.trim(),
      dca: document.getElementById('bt-count-DCA')?.textContent?.trim(),
      infgrid: document.getElementById('bt-count-INFGRID')?.textContent?.trim()
    }));

    console.log('pdb-slots:', slots && slots.trim());
    console.log('bot-type-counts:', JSON.stringify(botTypeCounts));
    console.log('console-errors:', errors.length ? errors.join(' | ') : 'none');

    if (!slots || slots.trim() === '--/--') process.exit(1);
    if (errors.some(e => e.includes('loadActiveBots') || e.includes('Cannot set properties of null'))) process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error('repro_bots_tab_dashboard failed:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

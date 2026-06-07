// Block G Item 5: i18n Sprach-Switch DE/EN/ES Test
const { test, expect, chromium } = require('@playwright/test');
const BASE = 'http://localhost:3000';

async function getCapLabels(page) {
  return await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('[data-i18n]'));
    return labels.map(el => ({ key: el.getAttribute('data-i18n'), text: el.textContent.trim() }));
  });
}

test('i18n DE/EN/ES Sprach-Switch — Kapital + KI-DASH', async () => {
  test.setTimeout(45000);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem('nx_proxy', 'http://localhost:3000'));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);

  // DE (default)
  await page.evaluate(() => { if (window.NEXUS_I18N) window.NEXUS_I18N.setLang('DE'); });
  await page.waitForTimeout(800);
  const de = await getCapLabels(page);
  console.log('\nDE:', JSON.stringify(de.filter(x => x.key && (x.key.startsWith('kapital.') || x.key === 'tab.kidash')).slice(0,8), null, 2));

  // EN
  await page.evaluate(() => { if (window.NEXUS_I18N) window.NEXUS_I18N.setLang('EN'); });
  await page.waitForTimeout(800);
  const en = await getCapLabels(page);
  console.log('\nEN:', JSON.stringify(en.filter(x => x.key && (x.key.startsWith('kapital.') || x.key === 'tab.kidash')).slice(0,8), null, 2));

  // ES
  await page.evaluate(() => { if (window.NEXUS_I18N) window.NEXUS_I18N.setLang('ES'); });
  await page.waitForTimeout(800);
  const es = await getCapLabels(page);
  console.log('\nES:', JSON.stringify(es.filter(x => x.key && (x.key.startsWith('kapital.') || x.key === 'tab.kidash')).slice(0,8), null, 2));

  await ctx.close();
  await browser.close();

  // Verify: at least one kapital-key has different text between DE and EN
  const deKap = de.find(x => x.key === 'kapital.title');
  const enKap = en.find(x => x.key === 'kapital.title');
  expect(deKap).toBeDefined();
  expect(enKap).toBeDefined();
  expect(deKap.text).not.toBe(enKap.text);  // mindestens 1 Übersetzung wirkt
  console.log(`\nSwitch verifiziert: DE="${deKap.text}" → EN="${enKap.text}"`);
});

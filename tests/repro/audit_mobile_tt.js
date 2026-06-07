const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width:375, height:812 }, isMobile:true, hasTouch:true });
  await ctx.addInitScript(() => localStorage.setItem('nx_proxy', 'http://localhost:3000'));
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);
  const failures = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, .btn, .btn-sm, .nb, .tog'));
    const f = [];
    all.forEach(el => {
      if (el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.height < 44 || r.width < 44) {
        f.push({cls: el.className.toString().slice(0,50), tag: el.tagName, h:Math.round(r.height), w:Math.round(r.width), id:el.id||'', txt: (el.textContent||'').trim().slice(0,30)});
      }
    });
    return f;
  });
  console.log('ALL failures (375x812):');
  failures.forEach(f => console.log(' ',f));
  await ctx.close(); await browser.close();
})();

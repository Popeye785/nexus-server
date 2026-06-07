const c = require('./modules/news_classifier.js');
const Database = require('better-sqlite3');
const db = new Database('./nexus.db', { readonly: true });
const rows = db.prepare("SELECT id, title FROM news_enriched WHERE ts > (strftime('%s','now') - 86400)*1000 AND is_spam=0").all();
const counts = {};
const suspects = [];
const realRegs = ['sec ','cftc','regulat','enforcement','lawsuit','court','sued','sanction','aml','kyc'];
rows.forEach(r => {
  const t = c.detectType(r.title).type;
  counts[t] = (counts[t]||0) + 1;
  if (t === 'REGULATORY') {
    const tl = r.title.toLowerCase();
    let hasReal = false;
    for (const p of realRegs) { if (tl.indexOf(p) >= 0) { hasReal = true; break; } }
    if (hasReal === false) suspects.push({id: r.id, title: r.title.substring(0,80)});
  }
});
console.log('=== TYPE-VERTEILUNG 24h ===');
Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(k+': '+v));
console.log('');
console.log('=== FALSE-POSITIVES (als REGULATORY ohne echtes Reg-Keyword) ===');
console.log('Anzahl: '+suspects.length);
suspects.slice(0,40).forEach(s => console.log(s.id+': '+s.title));
db.close();

const Database = require('better-sqlite3');
const NI = require('/Users/christianheilig/NEXUS_CLEAN/modules/news_intelligence.js');
const db = new Database('/Users/christianheilig/NEXUS_CLEAN/nexus.db');

console.log('Loading raw news_feed (140 days)...');
const rows = db.prepare(`SELECT id, ts, source, title, url, pub_date FROM news_feed
  WHERE COALESCE(pub_date, ts) BETWEEN strftime('%s','2025-12-29')*1000 AND strftime('%s','now')*1000
  ORDER BY COALESCE(pub_date, ts) ASC`).all();
console.log('Rows:', rows.length);

console.log('Enriching...');
const t0 = Date.now();
const enriched = rows.map(r => NI.enrichOne(r));
console.log('Enriched in', ((Date.now()-t0)/1000).toFixed(1)+'s');

console.log('Persisting...');
const written = NI.persistEnriched(db, enriched);
console.log('Written:', written);

// Per-day cluster aggregation
console.log('\nComputing daily clusters...');
const dayRows = db.prepare(`SELECT DISTINCT date(ts/1000,'unixepoch') AS d FROM news_enriched ORDER BY d ASC`).all();
let clustersWritten = 0;
const stmtCluster = db.prepare(`INSERT INTO news_clusters (ts, cluster_keywords, news_count, avg_sentiment, is_active) VALUES (?, ?, ?, ?, ?)`);
db.prepare('DELETE FROM news_clusters').run(); // reset
for (const d of dayRows) {
  const dayNews = db.prepare(`SELECT title, sentiment_score, is_spam FROM news_enriched WHERE date(ts/1000,'unixepoch')=?`).all(d.d);
  const clusters = NI.detectClusters(dayNews, 3);
  const dayTs = new Date(d.d + 'T12:00:00Z').getTime();
  for (const c of clusters) {
    const matched = dayNews.filter(n => !n.is_spam && c.keywords.split(' ').every(kw => (n.title||'').toLowerCase().includes(kw)));
    const avgSent = matched.length > 0 ? matched.reduce((s,n)=>s+n.sentiment_score,0)/matched.length : 0;
    stmtCluster.run(dayTs, c.keywords, c.count, avgSent, 1);
    clustersWritten++;
  }
}
console.log('Daily clusters written:', clustersWritten);

// Stats
const stats = db.prepare(`SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN is_spam=1 THEN 1 ELSE 0 END) AS spam,
  ROUND(AVG(CASE WHEN is_spam=0 THEN sentiment_score END), 4) AS avg_sent,
  date(MIN(ts)/1000,'unixepoch') AS first_day,
  date(MAX(ts)/1000,'unixepoch') AS last_day
FROM news_enriched`).get();
console.log('\nFinal Stats:', stats);

db.close();
console.log('\nDone.');

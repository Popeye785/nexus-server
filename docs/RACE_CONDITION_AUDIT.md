═══ Race-Condition Stress-Test ═══
Spawning 100 parallel requests to multiple endpoints...
Done in 3951ms. Status: 100 OK · 0 4xx · 0 5xx · 0 errors

── Drift-Consistency Check (alle /api/recon/check ergebnisse):
  20 responses, unique drifts: -100.27
  ✅ KONSISTENT — drift identisch über 20 parallele calls

── Wallet-Total Consistency:
  20 responses, unique totals: 1000.0000
  ✅ KONSISTENT

── Health-Check Spam (50 parallel):
  50/50 ok=true responses
  ✅ ROBUST

═══ Done ═══

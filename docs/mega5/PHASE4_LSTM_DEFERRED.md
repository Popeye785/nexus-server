# Phase 4 LSTM v5 Training — DEFERRED

**Datum:** 2026-05-20 16:48
**Entscheidung:** Option B — M1 reicht nicht für sicheres In-Bot-Training

## Realismus-Check
- M1 Mac mini, 8 GB RAM, 8 cores
- 54,203 BTC/ETH 1h-candles vorhanden ✅
- onnxruntime-node 1.26 → **NUR Inference**, kein Training
- LSTM(2L × 128u × seq=60) braucht ~2-4 GB RAM + GPU für realistisches Training
- Bot läuft parallel mit 150-250 MB — Memory-Pressure-Risiko bei in-process-Training

## Empfehlung: Cloud-Training
1. **Google Colab Free** (T4 GPU, 12h-Sessions, kostenlos): Notebook in PyTorch oder Keras
2. Feature-Pipeline aus `modules/feature_engineering.js` als Python-Skript portieren
3. ~6-8h Training auf 5y historische Candles
4. Export als ONNX → `models/lstm_crypto_v5.onnx`
5. `onnxruntime-node` lädt für Brain-Shadow-Inference

## Aktueller Zustand intakt
- `models/lstm_crypto_v1.onnx` (Surrogate) bleibt aktiv
- `lstm_v5_surrogate_BTCUSDT.json` als Placeholder
- v3, v4 in `models/_attempts/` archiviert (rejected acc < 52%)

## Nächste Schritte
- Eigene Mini-Pipeline "LSTM-Cloud-Training" mit Christian-F2
- Aufwand 8-12h Setup + Training + Validation
- ETA: nach Phase 5 (Reset Day Zero) und nach 30d-Validation-Phase

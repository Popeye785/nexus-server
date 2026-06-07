# LSTM ONNX Model — Training v3 (Roadmap)

## Aktueller Stand (15.05.2026)

`models/lstm_crypto_v1.onnx` ist eine **untrainierte** LSTM-Architektur:
- Eingabe: 60 normalisierte log-returns
- LSTM: 1 → 8 hidden
- Dense: 8 → 1 predicted-return
- Weights: deterministisch via `np.random.seed(42)` initialisiert

Predictions sind quasi-konstant (~+0.96%) weil die Weights random sind. Die Pipeline (`onnxruntime-node` → InferenceSession → Tensor → run()) ist trotzdem voll funktional, demonstriert Latenz <2ms, und ist drop-in-ersetzbar durch ein trainiertes Modell.

## v3 Roadmap — trainiertes Modell

### Schritt 1: Daten-Export
```bash
sqlite3 nexus.db <<EOF
.mode csv
.output data/btc_1h_history.csv
SELECT ts, open, high, low, close, volume
FROM candle_cache
WHERE symbol='BTCUSDT' AND granularity='1h'
ORDER BY ts ASC;
EOF
```

### Schritt 2: Python-Training
```python
# scripts/train_lstm.py
import torch
import torch.nn as nn
import numpy as np
import pandas as pd

df = pd.read_csv('data/btc_1h_history.csv')
closes = df['close'].values.astype(np.float32)
returns = np.diff(np.log(closes))[:, None]  # shape [N-1, 1]

# Sliding window: 60 inputs → 1 next return
SEQ_LEN = 60
X = np.stack([returns[i:i+SEQ_LEN] for i in range(len(returns)-SEQ_LEN)])
y = returns[SEQ_LEN:]

class LSTMModel(nn.Module):
    def __init__(self, hidden=8):
        super().__init__()
        self.lstm = nn.LSTM(1, hidden, batch_first=True)
        self.head = nn.Linear(hidden, 1)
    def forward(self, x):
        _, (h, _) = self.lstm(x)
        return self.head(h.squeeze(0))

model = LSTMModel(hidden=8)
opt = torch.optim.Adam(model.parameters(), lr=1e-3)
loss_fn = nn.MSELoss()

X_t = torch.from_numpy(X)
y_t = torch.from_numpy(y)

for epoch in range(100):
    pred = model(X_t)
    loss = loss_fn(pred, y_t)
    opt.zero_grad(); loss.backward(); opt.step()
    if epoch % 10 == 0: print(f"epoch {epoch} loss {loss.item():.6f}")

# Export to ONNX
dummy = torch.randn(1, SEQ_LEN, 1)
torch.onnx.export(model, dummy, 'models/lstm_crypto_v1.onnx',
    input_names=['input'], output_names=['output'],
    dynamic_axes={'input': {0: 'batch'}}, opset_version=17)
```

### Schritt 3: Validation gegen historische Predictions
- 1-Stunde-Forecast vs realized return
- Direction-Accuracy (Korrelation mit echtem Sign)
- Sharpe-Ratio einer simulierten Strategy basierend auf prediction-sign

### Schritt 4: Hot-Swap
Trainiertes Modell ersetzt `models/lstm_crypto_v1.onnx`. PM2-Restart lädt es automatisch.

## Risiken & Sicherungen

- Overfitting: train/test split (80/20), walk-forward validation
- Inference-Latenz: hard-cap 200ms via `CFG.LSTM_SHADOW_LATENCY_LIMIT_MS`
- Fallback: AR(2)+EMA-Momentum bleibt als Safety-Net im Code (`_predictSurrogate`)
- Shadow-Modus: `CFG.LSTM_SHADOW_ACTIVE_PREDICTION=false` → kein Trade-Effekt bis explizite F2

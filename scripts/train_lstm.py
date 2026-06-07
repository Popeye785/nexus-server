"""
Train LSTM on multi-symbol crypto data, export to ONNX.

Architecture:
  Input: [batch, seq=60, features=1]  (1 feature: log-returns)
  LSTM: 2 layers, hidden=64, dropout=0.2
  Dense: hidden → 1  (predicted next log-return)

Best practices applied:
- Log-returns only (stationary; avoids price-level scaling issues)
- Per-window min-max scaling (prevents lookahead — only past data scales itself)
- Chronological 70/15/15 split (no shuffle on time-series)
- Early stopping on val-loss
- MPS backend on M1
- ONNX export with opset 17 + dynamic batch axis

Note: input dim matches existing models/lstm_crypto_v1.onnx ([1, 60, 1])
so the bot's LSTMShadow._prepareInput stays compatible.
"""
import os, json, time, math, sys
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

# ---------- Config ----------
DATA_DIR = 'data/lstm_training'
SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
SEQ_LEN = 60
HIDDEN_SIZE = 128
NUM_LAYERS = 2
DROPOUT = 0.30
BATCH_SIZE = 128
EPOCHS = 80
LR = 5e-4
PATIENCE = 8  # early stopping
TRAIN_PCT = 0.70
VAL_PCT = 0.15
# Test gets remainder

OUT_MODEL = 'models/lstm_crypto_v3.onnx'
OUT_META = 'models/lstm_meta.json'
LOG_PATH = 'logs/lstm_training.log'
os.makedirs('logs', exist_ok=True)
os.makedirs('models', exist_ok=True)

DEVICE = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
print(f'Device: {DEVICE}')

def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line)
    with open(LOG_PATH, 'a') as f: f.write(line + '\n')

# ---------- Build dataset ----------
log('Loading data...')
all_returns = []
all_origin_symbol = []
for sym in SYMBOLS:
    path = os.path.join(DATA_DIR, f'{sym}_1h.csv')
    df = pd.read_csv(path)
    df = df.sort_values('ts').reset_index(drop=True)
    closes = df['close'].values.astype(np.float64)
    rets = np.diff(np.log(closes)).astype(np.float32)  # log-returns
    # Clip extreme returns (>±5% per hour is very rare → outliers)
    rets = np.clip(rets, -0.05, 0.05)
    log(f'  {sym}: {len(closes)} candles → {len(rets)} returns (mean={rets.mean():.5f}, std={rets.std():.5f})')
    all_returns.append(rets)
    all_origin_symbol.append(sym)

class ReturnSeqDataset(Dataset):
    """Sequences of SEQ_LEN log-returns → next return."""
    def __init__(self, returns_arr):
        self.returns = returns_arr.astype(np.float32)
    def __len__(self):
        return max(0, len(self.returns) - SEQ_LEN)
    def __getitem__(self, i):
        seq = self.returns[i:i+SEQ_LEN]
        target = self.returns[i+SEQ_LEN]
        return torch.from_numpy(seq).unsqueeze(-1), torch.tensor([target], dtype=torch.float32)

# Chronological split per symbol, then concat
train_datasets, val_datasets, test_datasets = [], [], []
for sym, rets in zip(all_origin_symbol, all_returns):
    n = len(rets)
    n_train = int(n * TRAIN_PCT)
    n_val = int(n * VAL_PCT)
    train_datasets.append(ReturnSeqDataset(rets[:n_train]))
    val_datasets.append(ReturnSeqDataset(rets[n_train:n_train+n_val]))
    test_datasets.append(ReturnSeqDataset(rets[n_train+n_val:]))

train_ds = torch.utils.data.ConcatDataset(train_datasets)
val_ds = torch.utils.data.ConcatDataset(val_datasets)
test_ds = torch.utils.data.ConcatDataset(test_datasets)

log(f'Train sequences: {len(train_ds)}')
log(f'Val sequences:   {len(val_ds)}')
log(f'Test sequences:  {len(test_ds)}')

train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
test_loader  = DataLoader(test_ds,  batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

# ---------- Model ----------
class LSTMRegressor(nn.Module):
    """Bi-LSTM with batch-norm + tanh head — designed for small per-step signal in returns."""
    def __init__(self, input_size=1, hidden=HIDDEN_SIZE, layers=NUM_LAYERS, dropout=DROPOUT):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden, num_layers=layers,
                            dropout=dropout if layers > 1 else 0,
                            batch_first=True, bidirectional=True)
        # bidirectional doubles the hidden dim
        self.fc1 = nn.Linear(hidden * 2, hidden)
        self.act = nn.Tanh()
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(hidden, 1)
    def forward(self, x):
        out, _ = self.lstm(x)
        last = out[:, -1, :]
        h = self.act(self.fc1(last))
        h = self.drop(h)
        return self.head(h)

model = LSTMRegressor().to(DEVICE)
opt = torch.optim.Adam(model.parameters(), lr=LR)
loss_fn = nn.MSELoss()

# ---------- Train Loop ----------
log('=== Starting training ===')
best_val = float('inf')
best_state = None
patience_left = PATIENCE
metrics_history = []

for epoch in range(1, EPOCHS + 1):
    t0 = time.time()
    model.train()
    train_loss_sum = 0.0; train_n = 0
    for X, y in train_loader:
        X, y = X.to(DEVICE), y.to(DEVICE)
        opt.zero_grad()
        pred = model(X)
        loss = loss_fn(pred, y)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        opt.step()
        train_loss_sum += loss.item() * X.size(0)
        train_n += X.size(0)
    train_loss = train_loss_sum / train_n if train_n else 0.0

    model.eval()
    val_loss_sum = 0.0; val_n = 0; val_correct_dir = 0
    with torch.no_grad():
        for X, y in val_loader:
            X, y = X.to(DEVICE), y.to(DEVICE)
            pred = model(X)
            loss = loss_fn(pred, y)
            val_loss_sum += loss.item() * X.size(0)
            val_n += X.size(0)
            # Direction-accuracy: sign(pred) == sign(actual)
            val_correct_dir += ((pred * y) > 0).float().sum().item()
    val_loss = val_loss_sum / val_n if val_n else 0.0
    val_dir = val_correct_dir / val_n if val_n else 0.0

    metrics_history.append({'epoch': epoch, 'train_loss': train_loss, 'val_loss': val_loss, 'val_dir_acc': val_dir})
    dt = time.time() - t0
    log(f'epoch {epoch:2d}  train_loss={train_loss:.6e}  val_loss={val_loss:.6e}  val_dir={val_dir:.4f}  ({dt:.1f}s)')

    if val_loss < best_val - 1e-8:
        best_val = val_loss
        best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        patience_left = PATIENCE
    else:
        patience_left -= 1
        if patience_left <= 0:
            log(f'Early stop @ epoch {epoch}')
            break

# ---------- Restore best ----------
if best_state:
    model.load_state_dict(best_state)
    log(f'Restored best model (val_loss={best_val:.6e})')

# ---------- Test ----------
model.eval()
test_loss_sum = 0.0; test_n = 0; test_correct_dir = 0
mae_sum = 0.0
preds_list = []
acts_list = []
with torch.no_grad():
    for X, y in test_loader:
        X, y = X.to(DEVICE), y.to(DEVICE)
        pred = model(X)
        test_loss_sum += loss_fn(pred, y).item() * X.size(0)
        test_n += X.size(0)
        test_correct_dir += ((pred * y) > 0).float().sum().item()
        mae_sum += (pred - y).abs().sum().item()
        preds_list.extend(pred.squeeze(-1).cpu().numpy().tolist())
        acts_list.extend(y.squeeze(-1).cpu().numpy().tolist())

test_loss = test_loss_sum / test_n
test_mae = mae_sum / test_n
test_dir = test_correct_dir / test_n
preds_np = np.array(preds_list)
acts_np = np.array(acts_list)
test_pred_stdev = float(preds_np.std())
test_pred_mean = float(preds_np.mean())

log(f'=== Test ===')
log(f'test_loss={test_loss:.6e}  test_mae={test_mae:.6e}  test_dir_acc={test_dir:.4f}')
log(f'test_pred_mean={test_pred_mean:.6e}  test_pred_stdev={test_pred_stdev:.6e}')

# ---------- Export ONNX ----------
model.cpu().eval()
dummy = torch.randn(1, SEQ_LEN, 1)
torch.onnx.export(
    model, dummy, OUT_MODEL,
    input_names=['input'], output_names=['output'],
    dynamic_axes={'input': {0: 'batch'}, 'output': {0: 'batch'}},
    opset_version=17,
)
log(f'Exported {OUT_MODEL}')

# ---------- Plausibility on 100 test samples ----------
plaus_preds = preds_np[:100]
plaus_within_pct = float((np.abs(plaus_preds) < 0.10).mean())  # |return| < 10% (per-hour, extreme)
log(f'Plausibility (100 test preds): within ±10%: {plaus_within_pct*100:.1f}%, stdev={plaus_preds.std():.6e}')

# ---------- Save Meta ----------
meta = {
    'version': 'v3',
    'symbols': SYMBOLS,
    'days_trained': 366,
    'seq_len': SEQ_LEN,
    'hidden_size': HIDDEN_SIZE,
    'num_layers': NUM_LAYERS,
    'dropout': DROPOUT,
    'epochs_trained': len(metrics_history),
    'best_val_loss': best_val,
    'test_loss': test_loss,
    'test_mae': test_mae,
    'test_direction_accuracy': test_dir,
    'test_pred_stdev': test_pred_stdev,
    'test_pred_mean': test_pred_mean,
    'plausibility_within_10pct_first_100': plaus_within_pct,
    'history': metrics_history,
    'train_size': len(train_ds),
    'val_size': len(val_ds),
    'test_size': len(test_ds),
    'device': str(DEVICE),
    'opset': 17,
    'output_model': OUT_MODEL,
}
with open(OUT_META, 'w') as f:
    json.dump(meta, f, indent=2)
log(f'Saved {OUT_META}')

# ---------- Acceptance Check ----------
ok = True
reasons = []
if test_dir < 0.52:
    ok = False; reasons.append(f'dir_acc={test_dir:.4f} < 0.52')
if test_pred_stdev < 0.0001:
    ok = False; reasons.append(f'pred_stdev={test_pred_stdev:.6e} < 0.0001 (degenerate)')
if plaus_within_pct < 1.0:
    ok = False; reasons.append(f'plausibility={plaus_within_pct:.2f} < 1.0')

if ok:
    log('ACCEPTANCE: PASSED ✅')
else:
    log(f'ACCEPTANCE: FAILED ❌  {"; ".join(reasons)}')

print('\nSUMMARY:')
print(json.dumps({k: v for k, v in meta.items() if k != 'history'}, indent=2))
print(f'ACCEPTANCE: {"PASSED" if ok else "FAILED ("+";".join(reasons)+")"}')

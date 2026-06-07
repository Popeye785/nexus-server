"""
LSTM v4 — Multi-Feature Direction Classification
Architektur-Wechsel von v3 (Regression):
  - 7 Features statt 1 (OHLCV-derived + cyclical time)
  - 3-class Classification (UP / FLAT / DOWN) statt Regression
  - Threshold ±0.3% / 60min für Klassen-Grenze
  - Softmax-Output + CrossEntropy-Loss

Multi-Feature (alle aus existierenden CSVs, KEINE neuen API-Calls):
  1. log-return (Standard)
  2. RSI(14) — normalisiert /100
  3. MACD-Histogram (normalisiert pro Symbol)
  4. Volume-Z-Score (rolling 30 candles)
  5. ATR/close ratio (volatility proxy)
  6. Hour-of-day sin
  7. Hour-of-day cos

Wenn dir_acc >= 55% → swap to v1 path
Wenn dir_acc < 55% → archive to _attempts, leave v1 surrogate

Sources (Recherche 15.05.2026):
- arxiv 2506.22055 LSTM+XGBoost
- NVIDIA Blog Cyclical Time Encoding
- DEV-Community Hand-Engineered Features beat raw OHLCV
- ResearchGate GRU/LSTM/biLSTM cryptocurrency comparison
"""
import os, sys, json, time, math
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

DATA_DIR = 'data/lstm_training'
SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
SEQ_LEN = 60
FEATURES = 7
HIDDEN_SIZE = 96
NUM_LAYERS = 2
DROPOUT = 0.30
BATCH_SIZE = 128
EPOCHS = 40
LR = 5e-4
PATIENCE = 6
DIR_THRESHOLD = 0.003  # ±0.3% threshold for FLAT class
TRAIN_PCT = 0.70
VAL_PCT = 0.15

OUT_MODEL = 'models/lstm_crypto_v4.onnx'
OUT_META = 'models/lstm_v4_meta.json'
LOG_PATH = 'logs/lstm_v4_training.log'
os.makedirs('logs', exist_ok=True)
os.makedirs('models', exist_ok=True)
os.makedirs('models/_attempts', exist_ok=True)

DEVICE = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')

def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line)
    with open(LOG_PATH, 'a') as f: f.write(line + '\n')

log(f'Device: {DEVICE}, target dir_acc >= 0.55')

# ---------- Feature engineering ----------
def rsi(closes, period=14):
    deltas = np.diff(closes)
    seed = deltas[:period]
    up = seed[seed >= 0].sum() / period
    down = -seed[seed < 0].sum() / period
    rs = up / (down + 1e-12)
    rsi_vals = np.zeros_like(closes)
    rsi_vals[:period] = 100 - 100 / (1 + rs)
    for i in range(period, len(closes)):
        delta = deltas[i-1]
        upval = max(delta, 0)
        downval = max(-delta, 0)
        up = (up * (period - 1) + upval) / period
        down = (down * (period - 1) + downval) / period
        rs = up / (down + 1e-12)
        rsi_vals[i] = 100 - 100 / (1 + rs)
    return rsi_vals

def ema(arr, period):
    alpha = 2 / (period + 1)
    out = np.zeros_like(arr, dtype=np.float64)
    out[0] = arr[0]
    for i in range(1, len(arr)):
        out[i] = alpha * arr[i] + (1 - alpha) * out[i-1]
    return out

def build_features(df):
    """df has columns ts, open, high, low, close, volume."""
    closes = df['close'].values.astype(np.float64)
    highs  = df['high'].values.astype(np.float64)
    lows   = df['low'].values.astype(np.float64)
    vols   = df['volume'].values.astype(np.float64)
    n = len(closes)

    # Feature 1: log-return
    lret = np.zeros(n)
    lret[1:] = np.log(closes[1:] / closes[:-1])
    lret = np.clip(lret, -0.05, 0.05)

    # Feature 2: RSI/100
    rsi_v = rsi(closes, 14) / 100.0

    # Feature 3: MACD-Hist normalized
    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)
    macd_line = ema12 - ema26
    signal = ema(macd_line, 9)
    macd_hist = (macd_line - signal) / closes  # relativ zum price

    # Feature 4: Volume-Z rolling 30
    vol_z = np.zeros(n)
    for i in range(n):
        start = max(0, i - 30)
        window = vols[start:i+1]
        m = window.mean()
        s = window.std()
        vol_z[i] = (vols[i] - m) / (s + 1e-9)
    vol_z = np.clip(vol_z, -5, 5)

    # Feature 5: ATR/close
    tr = np.zeros(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
    atr = ema(tr, 14)
    atr_ratio = atr / closes

    # Feature 6+7: Hour-of-day sin/cos (timestamp in ms)
    tss = df['ts'].values.astype(np.int64)
    hours = ((tss // 1000) % 86400) / 3600.0   # 0..24
    h_sin = np.sin(2 * np.pi * hours / 24)
    h_cos = np.cos(2 * np.pi * hours / 24)

    features = np.stack([lret, rsi_v, macd_hist, vol_z, atr_ratio, h_sin, h_cos], axis=1).astype(np.float32)
    return features, lret  # lret als ground truth

# ---------- Build dataset ----------
log('Building features...')
all_features = []
all_lrets = []
for sym in SYMBOLS:
    df = pd.read_csv(os.path.join(DATA_DIR, f'{sym}_1h.csv')).sort_values('ts').reset_index(drop=True)
    feats, lret = build_features(df)
    log(f'  {sym}: {len(df)} candles → features shape {feats.shape}, mean(feat0)={feats[:,0].mean():.5f}')
    all_features.append(feats)
    all_lrets.append(lret)

class DirectionDataset(Dataset):
    def __init__(self, features, lrets, seq_len, threshold):
        self.feats = features.astype(np.float32)
        self.lrets = lrets.astype(np.float32)
        self.seq_len = seq_len
        self.threshold = threshold
    def __len__(self):
        return max(0, len(self.feats) - self.seq_len)
    def __getitem__(self, i):
        seq = self.feats[i:i+self.seq_len]
        next_ret = self.lrets[i+self.seq_len]
        if next_ret > self.threshold:    label = 0  # UP
        elif next_ret < -self.threshold: label = 1  # DOWN
        else:                            label = 2  # FLAT
        return torch.from_numpy(seq), torch.tensor(label, dtype=torch.long)

train_datasets, val_datasets, test_datasets = [], [], []
for feats, lret in zip(all_features, all_lrets):
    n = len(feats)
    n_train = int(n * TRAIN_PCT)
    n_val = int(n * VAL_PCT)
    train_datasets.append(DirectionDataset(feats[:n_train], lret[:n_train], SEQ_LEN, DIR_THRESHOLD))
    val_datasets.append(DirectionDataset(feats[n_train:n_train+n_val], lret[n_train:n_train+n_val], SEQ_LEN, DIR_THRESHOLD))
    test_datasets.append(DirectionDataset(feats[n_train+n_val:], lret[n_train+n_val:], SEQ_LEN, DIR_THRESHOLD))

train_ds = torch.utils.data.ConcatDataset(train_datasets)
val_ds = torch.utils.data.ConcatDataset(val_datasets)
test_ds = torch.utils.data.ConcatDataset(test_datasets)

# Class distribution
def class_dist(ds):
    labels = [int(ds[i][1].item()) for i in range(0, len(ds), 10)]  # sample
    counts = [labels.count(c) for c in range(3)]
    return counts
log(f'Train sequences: {len(train_ds)} | class dist (UP/DOWN/FLAT, sampled): {class_dist(train_ds)}')
log(f'Val sequences:   {len(val_ds)} | class dist sampled: {class_dist(val_ds)}')
log(f'Test sequences:  {len(test_ds)} | class dist sampled: {class_dist(test_ds)}')

train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True)
val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False)
test_loader  = DataLoader(test_ds,  batch_size=BATCH_SIZE, shuffle=False)

# ---------- Model ----------
class LSTMDirectionClassifier(nn.Module):
    def __init__(self, input_size=FEATURES, hidden=HIDDEN_SIZE, layers=NUM_LAYERS, dropout=DROPOUT):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden, num_layers=layers,
                            dropout=dropout if layers > 1 else 0,
                            batch_first=True, bidirectional=True)
        self.fc1 = nn.Linear(hidden * 2, hidden)
        self.act = nn.Tanh()
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(hidden, 3)  # UP/DOWN/FLAT
    def forward(self, x):
        out, _ = self.lstm(x)
        last = out[:, -1, :]
        h = self.drop(self.act(self.fc1(last)))
        return self.head(h)   # raw logits, CE-Loss applies softmax

model = LSTMDirectionClassifier().to(DEVICE)
opt = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=1e-5)
loss_fn = nn.CrossEntropyLoss()

# ---------- Train ----------
log('=== Training ===')
best_val_acc = 0.0
best_state = None
patience_left = PATIENCE
history = []
for epoch in range(1, EPOCHS + 1):
    t0 = time.time()
    model.train()
    tr_loss = 0.0; tr_n = 0; tr_correct = 0
    for X, y in train_loader:
        X, y = X.to(DEVICE), y.to(DEVICE)
        opt.zero_grad()
        logits = model(X)
        loss = loss_fn(logits, y)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        opt.step()
        tr_loss += loss.item() * X.size(0); tr_n += X.size(0)
        tr_correct += (logits.argmax(1) == y).sum().item()
    tr_acc = tr_correct / tr_n

    model.eval()
    val_loss = 0.0; val_n = 0; val_correct = 0
    val_dir_correct = 0; val_dir_total = 0  # excluding FLAT class for "direction-accuracy"
    with torch.no_grad():
        for X, y in val_loader:
            X, y = X.to(DEVICE), y.to(DEVICE)
            logits = model(X)
            val_loss += loss_fn(logits, y).item() * X.size(0); val_n += X.size(0)
            preds = logits.argmax(1)
            val_correct += (preds == y).sum().item()
            # Direction-acc: nur UP/DOWN, ignoriere FLAT-Ground-Truth oder FLAT-Pred
            mask = (y != 2) & (preds != 2)
            val_dir_total += mask.sum().item()
            val_dir_correct += ((preds == y) & mask).sum().item()
    val_acc = val_correct / val_n
    val_dir_acc = val_dir_correct / max(1, val_dir_total)

    history.append({'epoch': epoch, 'tr_loss': tr_loss/tr_n, 'tr_acc': tr_acc,
                    'val_loss': val_loss/val_n, 'val_acc': val_acc, 'val_dir_acc': val_dir_acc})
    log(f'epoch {epoch:2d}  tr_loss={tr_loss/tr_n:.4f} tr_acc={tr_acc:.3f}  val_loss={val_loss/val_n:.4f} val_acc={val_acc:.3f} val_dir={val_dir_acc:.3f} ({time.time()-t0:.1f}s)')

    if val_acc > best_val_acc + 1e-5:
        best_val_acc = val_acc
        best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        patience_left = PATIENCE
    else:
        patience_left -= 1
        if patience_left <= 0:
            log(f'Early stop @ {epoch}')
            break

if best_state: model.load_state_dict(best_state)

# ---------- Test ----------
log('=== Test ===')
model.eval()
test_correct = 0; test_n = 0
test_dir_correct = 0; test_dir_total = 0
test_cm = np.zeros((3, 3), dtype=int)
all_preds = []
all_lbls = []
with torch.no_grad():
    for X, y in test_loader:
        X, y = X.to(DEVICE), y.to(DEVICE)
        logits = model(X)
        preds = logits.argmax(1)
        test_n += X.size(0)
        test_correct += (preds == y).sum().item()
        for tt in y.cpu().numpy().tolist():
            all_lbls.append(int(tt))
        for pp in preds.cpu().numpy().tolist():
            all_preds.append(int(pp))
        mask = (y != 2) & (preds != 2)
        test_dir_total += mask.sum().item()
        test_dir_correct += ((preds == y) & mask).sum().item()

for true_l, pred_l in zip(all_lbls, all_preds):
    test_cm[true_l, pred_l] += 1

test_acc_3class = test_correct / test_n
test_dir_acc = test_dir_correct / max(1, test_dir_total)
log(f'Test 3-class acc: {test_acc_3class:.4f}  test direction-acc (UP/DOWN only): {test_dir_acc:.4f}')
log(f'Confusion matrix (rows=true, cols=pred; 0=UP 1=DOWN 2=FLAT):')
log(f'  {test_cm.tolist()}')

# ---------- Plausibility-100-Samples ----------
sample_preds_probs = []
with torch.no_grad():
    cnt = 0
    for X, y in test_loader:
        if cnt >= 100: break
        X = X.to(DEVICE)
        prob = torch.softmax(model(X), dim=1).cpu().numpy()
        sample_preds_probs.extend(prob.tolist()[:100-cnt])
        cnt += X.size(0)
plaus_pred_distrib = np.array(sample_preds_probs)[:100]
class_counts_pred = [(plaus_pred_distrib.argmax(1) == c).sum() for c in range(3)]
log(f'Plausibility (100 preds): class distribution UP/DOWN/FLAT = {class_counts_pred}')

# ---------- Export ----------
model.cpu().eval()
dummy = torch.randn(1, SEQ_LEN, FEATURES)
torch.onnx.export(model, dummy, OUT_MODEL,
    input_names=['input'], output_names=['output'],
    dynamic_axes={'input': {0: 'batch'}, 'output': {0: 'batch'}},
    opset_version=17)
log(f'Exported {OUT_MODEL}')

# ---------- Meta ----------
meta = {
    'version': 'v4',
    'symbols': SYMBOLS,
    'features': ['lret','rsi/100','macd_hist_norm','vol_z30','atr_ratio','hour_sin','hour_cos'],
    'seq_len': SEQ_LEN,
    'hidden_size': HIDDEN_SIZE,
    'num_layers': NUM_LAYERS,
    'dropout': DROPOUT,
    'direction_threshold': DIR_THRESHOLD,
    'epochs_trained': len(history),
    'best_val_acc': best_val_acc,
    'test_3class_acc': test_acc_3class,
    'test_direction_acc': test_dir_acc,
    'confusion_matrix': test_cm.tolist(),
    'history': history,
    'device': str(DEVICE),
    'opset': 17,
    'train_size': len(train_ds), 'val_size': len(val_ds), 'test_size': len(test_ds),
    'pred_distrib_first_100': [int(x) for x in class_counts_pred],
    'output_model': OUT_MODEL,
}
with open(OUT_META, 'w') as f: json.dump(meta, f, indent=2)

# ---------- Acceptance ----------
ok = True; reasons = []
ACCEPT_DIR_ACC = 0.55
if test_dir_acc < ACCEPT_DIR_ACC:
    ok = False; reasons.append(f'test_direction_acc={test_dir_acc:.4f} < {ACCEPT_DIR_ACC}')
# Avoid degenerate (e.g. only predicting FLAT)
non_flat_preds = sum(1 for c in class_counts_pred[:2])
if non_flat_preds <= 1 or max(class_counts_pred) > 90:
    # Model is collapsed
    if max(class_counts_pred) > 90:
        ok = False; reasons.append(f'pred distribution collapsed (max class={max(class_counts_pred)}/100)')

if ok:
    log(f'\nACCEPTANCE: PASSED ✅  test_direction_acc={test_dir_acc:.4f}')
    print(json.dumps({'status':'PASSED','test_direction_acc':test_dir_acc,'meta':OUT_META}, indent=2))
else:
    # archive
    import shutil
    archive = f'models/_attempts/lstm_v4_rejected_{time.strftime("%Y%m%d_%H%M%S")}.onnx'
    shutil.move(OUT_MODEL, archive)
    log(f'\nACCEPTANCE: FAILED ❌  {"; ".join(reasons)}')
    log(f'Archived to {archive}')
    print(json.dumps({'status':'FAILED','reasons':reasons,'test_direction_acc':test_dir_acc,'archive':archive}, indent=2))

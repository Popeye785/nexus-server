"""
Build a small LSTM ONNX model for crypto-price next-return prediction.

Input shape:  [1, 60, 1]   (batch=1, sequence=60 normalized log-returns)
Output shape: [1, 1]       (predicted next log-return)

Weights are seeded deterministically so identical inputs give identical outputs.
This is NOT a trained model — it's a structurally valid LSTM that demonstrates
the pipeline end-to-end. Future Christian-Iteration: train on historical
Bitget candles with PyTorch and re-export.

Sources:
- ONNX LSTM op spec: https://onnx.ai/onnx/operators/onnx__LSTM.html
- onnxruntime-node README
"""
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

SEQ_LEN = 60
INPUT_SIZE = 1
HIDDEN_SIZE = 8

np.random.seed(42)

# LSTM weights:
#   W (input→gates) shape [num_directions=1, 4*hidden, input_size]
#   R (hidden→gates) shape [num_directions=1, 4*hidden, hidden]
#   B (bias)         shape [num_directions=1, 8*hidden]
W = (np.random.randn(1, 4 * HIDDEN_SIZE, INPUT_SIZE).astype(np.float32) * 0.1)
R = (np.random.randn(1, 4 * HIDDEN_SIZE, HIDDEN_SIZE).astype(np.float32) * 0.1)
B = (np.random.randn(1, 8 * HIDDEN_SIZE).astype(np.float32) * 0.05)

# Final Dense layer hidden→1
DENSE_W = (np.random.randn(HIDDEN_SIZE, 1).astype(np.float32) * 0.2)
DENSE_B = (np.random.randn(1).astype(np.float32) * 0.01)

# Inputs/outputs
inp = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, SEQ_LEN, INPUT_SIZE])
out = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 1])

# Initializers
init_W = numpy_helper.from_array(W, name="lstm_W")
init_R = numpy_helper.from_array(R, name="lstm_R")
init_B = numpy_helper.from_array(B, name="lstm_B")
init_dense_W = numpy_helper.from_array(DENSE_W, name="dense_W")
init_dense_B = numpy_helper.from_array(DENSE_B, name="dense_B")

# LSTM expects sequence input shaped [seq_len, batch, input_size] in ONNX.
# We add a Transpose node to reshape [batch, seq_len, input] → [seq_len, batch, input].
transpose_node = helper.make_node(
    "Transpose", ["input"], ["lstm_in"], perm=[1, 0, 2]
)

lstm_node = helper.make_node(
    "LSTM",
    inputs=["lstm_in", "lstm_W", "lstm_R", "lstm_B"],
    outputs=["lstm_y", "lstm_yh", "lstm_yc"],
    hidden_size=HIDDEN_SIZE,
    direction="forward",
)

# Take last hidden state [num_directions=1, batch=1, hidden_size]
# Squeeze to [batch, hidden_size] for dense
squeeze_axes = helper.make_tensor("squeeze_axes", TensorProto.INT64, [1], [0])
squeeze_node = helper.make_node(
    "Squeeze", ["lstm_yh", "squeeze_axes"], ["yh_squeezed"]
)

# Dense: yh_squeezed @ DENSE_W + DENSE_B
matmul_node = helper.make_node(
    "MatMul", ["yh_squeezed", "dense_W"], ["dense_out"]
)
add_node = helper.make_node(
    "Add", ["dense_out", "dense_B"], ["output"]
)

graph = helper.make_graph(
    nodes=[transpose_node, lstm_node, squeeze_node, matmul_node, add_node],
    name="LSTMCryptoV1",
    inputs=[inp],
    outputs=[out],
    initializer=[init_W, init_R, init_B, init_dense_W, init_dense_B, squeeze_axes],
)

# ONNX opset 17 is supported by onnxruntime 1.16+, including onnxruntime-node 1.26
model = helper.make_model(graph, producer_name="nexus-lstm-builder")
model.opset_import[0].version = 17
model.ir_version = 9

onnx.checker.check_model(model)
out_path = "models/lstm_crypto_v1.onnx"
onnx.save(model, out_path)
print(f"Saved {out_path}")
print(f"Params: LSTM(1→{HIDDEN_SIZE}) + Dense({HIDDEN_SIZE}→1)")
print(f"Total tensors: W={W.size} R={R.size} B={B.size} DenseW={DENSE_W.size} DenseB={DENSE_B.size}")

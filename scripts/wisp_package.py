"""Wisp v2's bot package (client/bots/wisp/) from its published source: its network converted to ONNX, its action table,
its licence, the manifest. Nothing of the original runs: its two TorchScript archives hold parameters alone (no forward
code; its model.py rebuilds the network by rule), read here by a whitelisting unpickler (the module stand-ins, the
tensor rebuild, FloatStorage, OrderedDict; any other global refused) and laid out as model.py rebuilds them (two
parameters with a 2-D weight: Linear; 1-D: LayerNorm with torch's default epsilon; none: ReLU, its config's activation).
The weights are copied unchanged (float32). The action table follows its action_parser.py's loops; the observation, the
mask and the mirror are ours in TypeScript (client/src/bots/wisp.ts). Provenance and parity: notes/bots-ml.md.

Usage: python -I scripts/wisp_package.py WISP_SOURCE_DIR [OUT_DIR]   (OUT_DIR: client/bots/wisp)
  WISP_SOURCE_DIR: the source at commit 58d4ab18 (verified(): every file read a regular one inside it, the archives' and
  LICENSE's sha256s pinned; each archive member's size capped before it's read); needs numpy and onnx.
  Its own checks: scripts/wisp_package_test.py.
"""
import hashlib
import io
import json
import pickle
import sys
import zipfile
from collections import OrderedDict
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

COMMIT = "58d4ab18fd0c92529b5ae6582ecf1713a6b1887a"
MODELS = {
    "src/models/SHARED_HEAD.lt": "3f7b6b363a72d7ceaba3cdb58bc13e1ae95e07b041b5e94a326c7045bebd7e42",
    "src/models/POLICY.lt": "1bd600a15f43106645de84b42379fe9ae404ecfb509dc21a2e309480ea17ebf7",
}
# Every file whose bytes are used, not only hashed: the archives, and LICENSE (copied into the shipped package, RV-1188)
PINNED = {**MODELS, "LICENSE": "0757ad3fb2d0b9ca85e173ddc22c4ba149c6d2816826af71416ac05468b45e23"}
# An archive member's size at most (the largest is 4 MiB): read only after its declared size is checked (RV-1189)
MAX_MEMBER = 16 << 20
# The files the port follows (their hashes recorded in the manifest)
PORTED = ["src/obs_builder.py", "src/eta.py", "src/utils.py", "src/arena_sdf.py", "src/action_parser.py", "src/bot.py", "src/config.py",
          "src/backend/model.py", "src/backend/gamestate/common_values.py"]
OBS_SIZE = 432
GROUND_ROWS = 24


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def regular(src: Path, rel: str) -> Path:
    """The source's file at `rel`: a regular file, no symlink, inside the source (else refused)"""
    path = src / rel
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(src.resolve()):
        raise SystemExit(f"{rel}: not a regular file inside the source")
    return path


def verified(src: Path) -> Path:
    """The source, once every pinned file is a regular one with its pinned sha256 (both scripts' gate)"""
    for rel, want in PINNED.items():
        if sha256(regular(src, rel)) != want:
            raise SystemExit(f"{rel}: not the file of {COMMIT[:8]}")
    return src


def member(archive: zipfile.ZipFile, name: str) -> bytes:
    """An archive member's bytes, its declared size checked first (zipfile reads no more than it declares)"""
    info = archive.getinfo(name)
    if info.file_size > MAX_MEMBER:
        raise SystemExit(f"{name}: {info.file_size} bytes, over {MAX_MEMBER}")
    return archive.read(info)


# --- the archives' parameters

class _Storage:
    """torch.FloatStorage's stand-in: a marker the persistent ids name"""


class _Module:
    """A TorchScript module's stand-in: its state kept as given"""

    def __setstate__(self, state):
        if not isinstance(state, dict):
            raise pickle.UnpicklingError("a module's state that isn't a dict")
        self.state = state


def _rebuild_tensor_v2(storage, offset, size, stride, requires_grad, backward_hooks, metadata=None):
    if not isinstance(storage, np.ndarray) or not all(isinstance(n, int) for n in (offset, *size, *stride)):
        raise pickle.UnpicklingError("a tensor's arguments of the wrong types")
    expected, acc = [], 1
    for n in reversed(size):
        expected.insert(0, acc)
        acc *= n
    if list(stride) != expected:
        raise pickle.UnpicklingError(f"a tensor that isn't contiguous: size {size}, stride {stride}")
    count = int(np.prod(size)) if size else 1
    if offset + count > storage.size:
        raise pickle.UnpicklingError("a tensor past its storage")
    return storage[offset:offset + count].reshape(size).copy()


class _Unpickler(pickle.Unpickler):
    def __init__(self, data: bytes, archive: zipfile.ZipFile):
        super().__init__(io.BytesIO(data))
        self._archive = archive
        self._classes = {}

    def find_class(self, module, name):
        if name == "Module" and (module == "__torch__" or module.startswith("__torch__.___torch_mangle_")):
            return self._classes.setdefault(module, type(f"Module_{len(self._classes)}", (_Module,), {}))
        if (module, name) == ("torch._utils", "_rebuild_tensor_v2"):
            return _rebuild_tensor_v2
        if (module, name) == ("torch", "FloatStorage"):
            return _Storage
        if (module, name) == ("collections", "OrderedDict"):
            return OrderedDict
        raise pickle.UnpicklingError(f"refused global {module}.{name}")

    def persistent_load(self, pid):
        if not (isinstance(pid, tuple) and len(pid) == 5 and pid[0] == "storage" and pid[1] is _Storage):
            raise pickle.UnpicklingError(f"refused persistent id {pid!r}")
        _, _, key, _location, numel = pid
        if not (isinstance(key, str) and key.isdigit() and isinstance(numel, int)):
            raise pickle.UnpicklingError(f"a storage id of the wrong form {pid!r}")
        raw = member(self._archive, f"archive/data/{key}")
        if len(raw) != numel * 4:
            raise pickle.UnpicklingError(f"storage {key}: {len(raw)} bytes for {numel} floats")
        return np.frombuffer(raw, dtype="<f4").copy()


def layers(path: Path) -> list:
    archive = zipfile.ZipFile(path)
    if member(archive, "archive/byteorder") != b"little":
        raise SystemExit(f"{path}: not little-endian")
    root = _Unpickler(member(archive, "archive/data.pkl"), archive).load()
    if not isinstance(root, _Module):
        raise SystemExit(f"{path}: the root isn't a module")
    out = []
    for key, child in root.state.items():
        if key == "training":
            continue
        if not isinstance(child, _Module):
            raise SystemExit(f"{path}: child {key} isn't a module")
        params = {k: a for k, a in child.state.items() if isinstance(a, np.ndarray)}
        if not params:
            out.append(("relu", None, None))
        elif set(params) == {"weight", "bias"}:
            w, b = params["weight"], params["bias"]
            if w.ndim == 2 and b.ndim == 1 and w.shape[0] == b.shape[0]:
                out.append(("linear", w, b))
            elif w.ndim == 1 and w.shape == b.shape:
                out.append(("layernorm", w, b))
            else:
                raise SystemExit(f"{path}: child {key}: shapes {w.shape} / {b.shape}")
        else:
            raise SystemExit(f"{path}: child {key}: parameters {sorted(params)}")
    return out


def policy_onnx(stack: list) -> tuple:
    nodes, inits, x, width = [], [], "obs", None
    first = stack[0][1].shape[1]
    for i, (kind, w, b) in enumerate(stack):
        y = f"x{i}"
        if kind == "linear":
            inits += [numpy_helper.from_array(w.astype(np.float32), f"w{i}"), numpy_helper.from_array(b.astype(np.float32), f"b{i}")]
            nodes.append(helper.make_node("Gemm", [x, f"w{i}", f"b{i}"], [y], transB=1))
            width = w.shape[0]
        elif kind == "layernorm":
            inits += [numpy_helper.from_array(w.astype(np.float32), f"g{i}"), numpy_helper.from_array(b.astype(np.float32), f"b{i}")]
            nodes.append(helper.make_node("LayerNormalization", [x, f"g{i}", f"b{i}"], [y], axis=-1, epsilon=1e-5))
        else:
            nodes.append(helper.make_node("Relu", [x], [y]))
        x = y
    nodes.append(helper.make_node("Identity", [x], ["logits"]))
    graph = helper.make_graph(nodes, "wisp_v2_policy", [helper.make_tensor_value_info("obs", TensorProto.FLOAT, [1, first])],
                              [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, width])], inits)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="carball wisp_package.py")
    model.ir_version = 8
    onnx.checker.check_model(model)
    params = sum(a.size for _, w, b in stack if w is not None for a in (w, b))
    return model, first, width, params


# --- action_parser.py's table: ground rows (throttle, steer, boost, handbrake; boost only at full throttle), then the
# aerial ones (pitch, yaw, roll, jump, boost; no jump with yaw, none of pitch, roll and jump being all 0; the handbrake with
# a jump that turns), each [throttle, steer, pitch, yaw, roll, jump, boost, handbrake]
def action_table() -> list:
    rows = []
    for throttle in (-1, 0, 1):
        for steer in (-1, 0, 1):
            for boost in (0, 1):
                for handbrake in (0, 1):
                    if boost == 1 and throttle != 1:
                        continue
                    rows.append([throttle, steer, 0, steer, 0, 0, boost, handbrake])
    assert len(rows) == GROUND_ROWS
    for pitch in (-1, 0, 1):
        for yaw in (-1, 0, 1):
            for roll in (-1, 0, 1):
                for jump in (0, 1):
                    for boost in (0, 1):
                        if jump == 1 and yaw != 0:
                            continue
                        if pitch == roll == jump == 0:
                            continue
                        handbrake = 1 if jump == 1 and (pitch != 0 or yaw != 0 or roll != 0) else 0
                        rows.append([boost, yaw, pitch, yaw, roll, jump, boost, handbrake])
    return rows


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "client/bots/wisp"
    verified(src)
    stack = layers(src / "src/models/SHARED_HEAD.lt") + layers(src / "src/models/POLICY.lt")
    model, first, width, params = policy_onnx(stack)
    table = action_table()
    if first != OBS_SIZE or width != len(table):
        raise SystemExit(f"a network of {first} in, {width} out")
    out.mkdir(parents=True, exist_ok=True)
    onnx.save(model, out / "policy.onnx")
    (out / "actions.json").write_text(json.dumps(table, separators=(",", ":")) + "\n")
    # (its LICENSE's ©, “ and ” were stored as U+FFFD: written back)
    licence = regular(src, "LICENSE").read_text(encoding="utf-8")
    licence = licence.replace("Copyright �", "Copyright ©").replace("�Software�", "“Software”").replace("�AS IS�", "“AS IS”")
    if "�" in licence:
        raise SystemExit("LICENSE: an unknown character")
    (out / "LICENSE.txt").write_text(licence.rstrip("\n") + "\n")
    manifest = {
        "format": 1,
        "id": "wisp",
        "name": "Wisp",
        "version": f"v2-75B ({COMMIT[:8]}; POLICY.lt sha256 {MODELS['src/models/POLICY.lt'][:8]}, SHARED_HEAD.lt sha256 {MODELS['src/models/SHARED_HEAD.lt'][:8]})",
        "authors": "Nicolaj 'Eastvillage' Jensen",
        "licence": "MIT",
        "licenceSpdx": "MIT",
        "licenceFile": "LICENSE.txt",
        "credit": "Wisp v2 by Nicolaj 'Eastvillage' Jensen, https://github.com/NicEastvillage, MIT. Its network converted to ONNX with its weights unchanged; its observation and actions re-implemented. No warranty.",
        "source": "https://github.com/NicEastvillage",
        "sourceCommit": COMMIT,
        "sourceFiles": [{"path": rel, "bytes": regular(src, rel).stat().st_size, "sha256": sha256(regular(src, rel))} for rel in [*MODELS, *PORTED]],
        "policy": {
            "opset": 17,
            "file": "policy.onnx",
            "sha256": sha256(out / "policy.onnx"),
            "parameters": int(params),
            "inputs": [{"name": "obs", "shape": [1, OBS_SIZE], "dtype": "float32"}],
            "outputs": [{"name": "logits", "shape": [1, width], "dtype": "float32"}],
            "pick": "argmax",
            "state": None,
        },
        "observation": {"builder": "wisp-v1", "size": OBS_SIZE},
        "action": {
            "parser": "lookup-v1",
            "table": "actions.json",
            "rows": len(table),
            "columns": ["throttle", "steer", "pitch", "yaw", "roll", "jump", "boost", "handbrake"],
            "mask": {"rule": "wisp-v1", "groundRows": GROUND_ROWS},
            "mirror": "wisp-x-v1",
        },
        "tickSkip": 8,
        "timing": {"schedule": "tick-skip-v1", "applyAtCounter": 7},
        "teamSizes": [1, 2, 3],
        "moments": "wisp-celebrate-v1",
    }
    (out / "bot.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{out}: {params} parameters, {len(table)} actions")


if __name__ == "__main__":
    main()

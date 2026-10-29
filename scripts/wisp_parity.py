"""Wisp v2's model parity: the TypeScript port's decisions (recorded by client/src/bots/wispRecord.test.ts, WISP_RECORD)
against the reference, the network as its model.py rebuilds it (Linear, LayerNorm with torch's default epsilon, ReLU) in
eager PyTorch with the weights read from its archives (scripts/wisp_package.py's gate and whitelisting unpickler: nothing
of the original runs), picked as its ModelSet.get_action does deterministically (the rows the mask leaves out at -1e10, none
allowed meaning all; argmax). For each decision: the port's logits (onnxruntime-web) against the reference's on the same
observation, the port's pick against the reference's, its row against the table's (or that row mirrored).

Usage: python -I scripts/wisp_parity.py WISP_SOURCE_DIR RECORD.ndjson   (needs numpy and torch)
"""
import base64
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wisp_package  # noqa: E402

torch.set_grad_enabled(False)


def reference(src: Path) -> torch.nn.Sequential:
    seq = torch.nn.Sequential()
    for kind, w, b in wisp_package.layers(src / "src/models/SHARED_HEAD.lt") + wisp_package.layers(src / "src/models/POLICY.lt"):
        if kind == "relu":
            seq.append(torch.nn.ReLU())
            continue
        m = torch.nn.Linear(w.shape[1], w.shape[0]) if kind == "linear" else torch.nn.LayerNorm(w.shape[0])
        m.load_state_dict({"weight": torch.from_numpy(w), "bias": torch.from_numpy(b)})
        seq.append(m)
    return seq.eval()


def pick(logits: np.ndarray, allowed: np.ndarray) -> int:
    t = torch.as_tensor(logits, dtype=torch.float32).clone()
    m = torch.as_tensor(allowed, dtype=torch.bool)
    if not m.any():
        m = torch.ones_like(m)
    if (~m).any():
        t[~m] = torch.tensor(-1e10, dtype=torch.float32)
    return int(torch.argmax(t).item())


def main() -> None:
    # (the source checked as the package's: its pinned files, RV-1189)
    src, record = wisp_package.verified(Path(sys.argv[1])), Path(sys.argv[2])
    model = reference(src)
    table = wisp_package.action_table()
    f32 = lambda s: np.frombuffer(base64.b64decode(s), dtype="<f4")  # noqa: E731
    rows = [r for r in (json.loads(line) for line in record.read_text().splitlines() if line) if r.get("kind") == "decision"]
    obs = np.stack([f32(r["obs"]) for r in rows])
    ours = np.stack([f32(r["logits"]) for r in rows])
    ref = model(torch.from_numpy(obs.copy())).numpy()
    diff = np.abs(ours - ref)
    picks = np.array([pick(ref[i], np.array(r["allowed"], dtype=bool)) for i, r in enumerate(rows)])
    port = np.array([r["pick"] for r in rows])
    masked = np.where(np.array([r["allowed"] for r in rows], dtype=bool), ref, -1e10)
    top2 = np.sort(masked, axis=1)[:, -2:]
    gaps = top2[:, 1] - top2[:, 0]
    rows_ok = sum(1 for r in rows if r["row"] in (table[r["pick"]], [table[r["pick"]][k] * (-1 if k in (1, 3, 4) else 1) for k in range(8)]) or [abs(x) for x in r["row"]] == [abs(x) for x in table[r["pick"]]])
    by = {}
    for r, ok in zip(rows, picks == port):
        key = f"{r['teamSize']}v{r['teamSize']}"
        n, k = by.get(key, (0, 0))
        by[key] = (n + 1, k + int(ok))
    print(json.dumps({
        "decisions": len(rows),
        "byTeamSize": {k: {"decisions": n, "samePick": k2} for k, (n, k2) in by.items()},
        "maxAbsLogitDiff": float(diff.max()),
        "meanAbsLogitDiff": float(diff.mean()),
        "samePick": int((picks == port).sum()),
        "smallestTop2Gap": float(gaps.min()),
        "picksWithGapUnder1e-4": int((gaps < 1e-4).sum()),
        "rowsFromTheirPick": rows_ok,
        "distinctPicks": int(len(set(port.tolist()))),
    }, indent=1))


if __name__ == "__main__":
    main()

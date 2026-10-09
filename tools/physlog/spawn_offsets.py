"""Where the game creates the player's car at each reset in a PhysLog recording (physlog_start, then
physlog_resetplayers a few times): its height at creation and how far ahead of the nearest kickoff spot it sits, along
its own forward axis (engine patch 80: CarConfig spawnZ / spawnForwardOffset; the Venom 38.94 uu and 5 uu ahead).

Usage: .venv/bin/python tools/physlog/spawn_offsets.py out/live/<recording>.csv
"""

import sys

import numpy as np
import pandas as pd

# The game's kickoff spots as blue's (x, y); orange's are the mirror
SPOTS = np.array([(-2048, -2560), (2048, -2560), (-256, -3840), (256, -3840), (0, -4608)], dtype=float)


def forward(qx: float, qy: float, qz: float, qw: float) -> np.ndarray:
    """The car's forward axis (its local x) from the recording's quaternion (the game's frame)."""
    return np.array([1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy)])


def main() -> None:
    rows = pd.read_csv(sys.argv[1], comment="#")
    with open(sys.argv[1]) as f:
        header = f.readline().strip()
    print(header[:160])
    pos = rows[["cx", "cy", "cz"]].to_numpy()
    jumps = np.nonzero(np.linalg.norm(np.diff(pos[:, :2], axis=0), axis=1) > 200)[0] + 1
    spots = np.vstack([SPOTS, -SPOTS])
    for i in jumps:
        # (the first rows after a reset hold the car at z 83 on the spot while its assets load: finding 43; its
        # creation is the first row after them)
        while i + 1 < len(rows) and abs(pos[i, 2] - 83) < 0.01:
            i += 1
        r = rows.iloc[i]
        p = pos[i]
        f = forward(r.cqx, r.cqy, r.cqz, r.cqw)
        spot = spots[np.argmin(np.linalg.norm(spots - p[:2], axis=1))]
        d = p[:2] - spot
        ahead = float(d @ f[:2] / max(np.linalg.norm(f[:2]), 1e-9))
        side = float(np.linalg.norm(d - ahead * f[:2] / max(np.linalg.norm(f[:2]), 1e-9)))
        print(f"tick {int(r.tick)}: created at z {p[2]:.2f}, spot ({spot[0]:.0f}, {spot[1]:.0f}), {ahead:.2f} uu ahead, {side:.2f} to the side")


if __name__ == "__main__":
    main()

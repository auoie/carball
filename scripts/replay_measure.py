"""Measure physics behaviour from replay states produced by replay_extract.

  cargo run --release --manifest-path scripts/replay_extract/Cargo.toml -- states.csv replays/*.replay
  python3 scripts/replay_measure.py states.csv

Reports:
  1. ball rest height on the floor (effective ball-to-plane contact distance)
  2. smallest ball-to-wall gaps during slow contact (side walls x=±4096, back walls y=±5120)
  3. throttle-only forward acceleration vs speed (flat ground, straight, no boost/handbrake)
Notes: angular velocities in the CSV are rad/s × 100. Car states replicate every ~0.067–0.1 s.
"""
import collections
import csv
import math
import statistics
import sys


def axes(r):
    x, y, z, w = (float(r[k]) for k in ("qx", "qy", "qz", "qw"))
    fwd = (1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y))
    up = (2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y))
    return fwd, up


def main(path):
    balls, cars = [], collections.defaultdict(list)
    for r in csv.DictReader(open(path)):
        if r["kind"] == "ball":
            balls.append(r)
        else:
            cars[(r["replay"], r["actor"])].append(r)

    # 1. ball rolling on the open floor
    zs = []
    for r in balls:
        x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
        vh = math.hypot(float(r["vx"]), float(r["vy"]))
        if r["sleeping"] == "0" and not (abs(x) < 1 and abs(y) < 1) and z < 120 \
                and abs(float(r["vz"])) < 1 and vh > 50 and abs(x) < 3500 and abs(y) < 4500:
            zs.append(z)
    print(f"ball on floor: n={len(zs)} median z={statistics.median(zs):.2f} "
          f"mode={collections.Counter(round(z, 2) for z in zs).most_common(1)[0]}")

    # 2. slow wall contact
    side, back = [], []
    for r in balls:
        x, y, z = abs(float(r["x"])), abs(float(r["y"])), float(r["z"])
        vx, vy, vz = float(r["vx"]), float(r["vy"]), float(r["vz"])
        sp = math.sqrt(vx * vx + vy * vy + vz * vz)
        if x > 3950 and 350 < z < 1500 and y < 3500 and abs(vx) < 15 and sp > 50:
            side.append(4096 - x)
        if y > 4950 and 350 < z < 1500 and 1200 < x < 3000 and abs(vy) < 15 and sp > 50:
            back.append(5120 - y)
    print("smallest side-wall gaps:", [round(v, 2) for v in sorted(side)[:6]])
    print("smallest back-wall gaps:", [round(v, 2) for v in sorted(back)[:6]])

    # 3. throttle-only acceleration
    bins = collections.defaultdict(list)
    for rs in cars.values():
        for a, b in zip(rs, rs[1:]):
            dt = float(b["time"]) - float(a["time"])
            if not 0.03 < dt < 0.12:
                continue
            if not all(r["throttle"] == "255" and r["boosting"] == "0" and r["handbrake"] == "0" for r in (a, b)):
                continue
            fa, ua = axes(a)
            fb, ub = axes(b)
            if ua[2] < 0.99 or ub[2] < 0.99 or not (15 < float(a["z"]) < 19 and 15 < float(b["z"]) < 19):
                continue
            va = sum(float(a[k]) * c for k, c in zip(("vx", "vy", "vz"), fa))
            vb = sum(float(b[k]) * c for k, c in zip(("vx", "vy", "vz"), fb))
            sa = math.sqrt(sum(float(a[k]) ** 2 for k in ("vx", "vy", "vz")))
            if va < 100 or abs(sa - va) > 10 or abs(int(a["steer"]) - 128) > 5 or abs(int(b["steer"]) - 128) > 5:
                continue
            bins[int((va + vb) / 2 // 100) * 100].append((vb - va) / dt)
    print("throttle-only accel (speed bin: n, median):")
    for k in sorted(bins):
        if k >= 100:
            v = sorted(bins[k])
            print(f"  {k:5d}: {len(v):5d} {v[len(v) // 2]:8.1f}")


if __name__ == "__main__":
    main(sys.argv[1])

"""Physics findings from engine/build/replay_validate's per-case output (notes/validation.md).

  python3 scripts/validation_report.py cases.csv

1. Car on flat ground, no touch: forward acceleration (coasting, full throttle) and lateral acceleration at full
   steer, the game (replay) vs our engine.
2. Car-ball touches on the ground: the ball's velocity error after the touch along the car-to-ball direction (a
   systematic positive value = our ball leaves the car faster: "bouncier") and vertically.
"""
import csv
import math
import random
import statistics as st
import sys


def ground_driving(rows):
    print("Car on flat ground, no touch (accelerations in uu/s^2; error = engine - game)")
    rows = [r for r in rows if r["category"] == "car ground/no touch"]
    flat = lambda r: float(r["car_z"]) < 20 and float(r["car_up_z"]) > 0.99 and r["handbrake"] == "0"
    secs = lambda r: int(r["car_ticks"]) / 120
    fwd = lambda r: float(r["v_fwd"])

    def report(label, rs, comp, sign=lambda r: 1):
        if not rs:
            return
        game = st.median(float(r[f"replay_acc_{comp}"]) * sign(r) for r in rs)
        err = st.median(float(r[f"dv_{comp}"]) * sign(r) / secs(r) for r in rs)
        print(f"  {label:42s} n={len(rs):4d}  game {game:8.1f}  error {err:7.1f}")

    coast = [r for r in rows if flat(r) and r["steer"] == "128" and r["throttle"] == "128" and r["boost"] == "0"]
    for lo, hi in ((100, 700), (700, 1300), (1300, 2300)):
        report(f"coasting, {lo}-{hi} uu/s", [r for r in coast if lo <= fwd(r) < hi], "fwd")
    thr = [r for r in rows if flat(r) and r["steer"] == "128" and r["throttle"] == "255" and r["boost"] == "0"]
    for lo, hi in ((0, 400), (400, 800), (800, 1200), (1200, 1400), (1400, 1600)):
        report(f"full throttle, {lo}-{hi} uu/s", [r for r in thr if lo <= fwd(r) < hi], "fwd")
    steer = [r for r in rows if flat(r) and r["steer"] in ("0", "255") and fwd(r) > 100]
    turn = lambda r: 1 if r["steer"] == "255" else -1
    for lo, hi in ((100, 500), (500, 1000), (1000, 1500), (1500, 2400)):
        report(f"full steer (towards the turn), {lo}-{hi} uu/s", [r for r in steer if lo <= fwd(r) < hi], "right", turn)


def median_ci(values, resamples=2000):
    """95% bootstrap interval of the median (the residuals have heavy tails, so no normal approximation)"""
    rng = random.Random(1)
    medians = sorted(st.median(rng.choices(values, k=len(values))) for _ in range(resamples))
    return medians[int(0.025 * resamples)], medians[int(0.975 * resamples)]


def touches(rows):
    print("Car-ball touches, car on the ground (ball velocity error after the touch, uu/s; engine - game)")
    rows = [r for r in rows if r["category"].startswith("car ground") and r["touch"] == "1"]

    def report(label, rs):
        if len(rs) < 5:
            return
        normal, vertical = [], []
        for r in rs:
            rel = [float(r[k]) for k in ("rel_x", "rel_y", "rel_z")]
            length = math.sqrt(sum(x * x for x in rel))
            dv = [float(r[k]) for k in ("dvx", "dvy", "dvz")]
            normal.append(sum(a * b / length for a, b in zip(dv, rel)))
            vertical.append(dv[2])
        mag = st.median(float(r["ball_vel"]) for r in rs)
        lo, hi = median_ci(normal)
        print(f"  {label:30s} n={len(rs):4d}  along car->ball: median {st.median(normal):6.2f} [95% {lo:5.2f}, {hi:5.2f}]"
              f"  vertical median {st.median(vertical):6.2f}  |error| median {mag:5.2f}")

    report("all", rows)
    report("ball on the roof (dribbles)", [r for r in rows if r["dribble"] == "1"])
    for lo, hi in ((0, 150), (150, 400), (400, 1000), (1000, 5000)):
        report(f"approach speed {lo}-{hi}", [r for r in rows if lo <= -float(r["relvel_n"]) < hi])


def main(path):
    rows = list(csv.DictReader(open(path)))
    ground_driving(rows)
    print()
    touches(rows)


if __name__ == "__main__":
    main(sys.argv[1])

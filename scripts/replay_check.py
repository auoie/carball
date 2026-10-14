#!/usr/bin/env python3
"""The physics against a fixed sample of the local replays, for every check batch (notes/validation.md).

Runs engine/build/replay_validate (its main pass and its car-car pass) on a fixed sample of out/replays/ (the first 10
1v1 and the first 6 2v2 replays by name; their states extracted once into out/replays/check/), groups its categories
into ball flight, driving, walls, air, hits and bumps, prints each group's median error, and flags any group worse
than the previous run's (out/replays/check/last.json). Local only: the replays aren't in the repo (player data).

Usage: .venv/bin/python scripts/replay_check.py [--repo DIR] [--no-save]
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd

SAMPLE_1V1 = 10
SAMPLE_2V2 = 6
# Worse: above the previous median by this much (relative) and this much (absolute)
WORSE_RELATIVE = 0.05
WORSE_ABSOLUTE = 0.001

# (group, what's measured, unit)
GROUPS = [
    ("ball flight", "ball position", "uu"),
    ("driving", "car position, flat floor", "uu"),
    ("walls", "car position, walls/curves/ceiling", "uu"),
    ("air", "car position, in the air", "uu"),
    ("hits", "ball velocity after car touches", "uu/s"),
    ("bumps", "car position, car-car contacts", "uu"),
]


def group_of(category: str) -> str | None:
    """A replay_validate category's group (None: not summarised)"""
    if category.startswith("ball/"):
        return "ball flight"
    if category.startswith("pinch/"):
        return "hits"
    alone = category.startswith("car alone/") or category.startswith("car alone input change/")
    if alone:
        if "air (no air control)" in category or " air " in category:
            return "air"
        if category.endswith("flat floor"):
            return "driving"
        if "walls/curves/ceiling" in category:
            return "walls"
        return None  # (in goal)
    if category.startswith("car ") and (category.endswith("/touch") or category.endswith("/dribble")):
        return "hits"
    return None


def sample(replays: Path) -> list[Path]:
    names = sorted(p for p in replays.glob("*.replay"))
    ones = [p for p in names if p.name.startswith("1v1_")][:SAMPLE_1V1]
    twos = [p for p in names if p.name.startswith("2v2_")][:SAMPLE_2V2]
    return ones + twos


def run(cmd: list[str], log: Path) -> None:
    with log.open("w") as out:
        result = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        sys.exit(f"replay check: {cmd[0]} failed (see {log})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--no-save", action="store_true", help="don't record this run as the next one's baseline")
    args = parser.parse_args()
    repo: Path = args.repo
    replays = repo / "out/replays"
    work = replays / "check"
    work.mkdir(parents=True, exist_ok=True)
    validate = repo / "engine/build/replay_validate"
    extract = repo / "scripts/replay_extract/target/release/replay_extract"

    picked = sample(replays)
    if len(picked) < SAMPLE_1V1 + SAMPLE_2V2:
        sys.exit(f"replay check: only {len(picked)} sample replays in {replays}")
    states, demos = work / "states.csv", work / "demos.csv"
    listing = work / "sample.txt"
    names = "\n".join(p.name for p in picked) + "\n"
    if not states.exists() or not listing.exists() or listing.read_text() != names:
        run([str(extract), "--demos", str(demos), str(states), *map(str, picked)], work / "extract.log")
        listing.write_text(names)

    started = time.time()
    run([str(validate), str(states), "--cases", str(work / "cases.csv")], work / "validate.log")
    run([str(validate), str(states), "--carcar", str(work / "carcar.csv"), "--demos", str(demos)], work / "carcar.log")
    seconds = time.time() - started

    cases = pd.read_csv(work / "cases.csv", usecols=["category", "ball_pos", "ball_vel", "car_pos"])
    cases["group"] = cases["category"].map(group_of)
    now: dict[str, dict[str, float]] = {}
    for group, column in [("ball flight", "ball_pos"), ("driving", "car_pos"), ("walls", "car_pos"), ("air", "car_pos"), ("hits", "ball_vel")]:
        values = cases.loc[cases["group"] == group, column]
        now[group] = {"n": int(values.size), "median": float(values.median()) if values.size else float("nan")}
    carcar = pd.read_csv(work / "carcar.csv", usecols=["a_err", "b_err"])
    pair = pd.concat([carcar["a_err"], carcar["b_err"]])
    now["bumps"] = {"n": int(carcar.shape[0]), "median": float(pair.median()) if pair.size else float("nan")}

    last_path = work / "last.json"
    last = json.loads(last_path.read_text()) if last_path.exists() else None
    print(f"replay check: {len(picked)} replays ({SAMPLE_1V1} 1v1, {SAMPLE_2V2} 2v2), {seconds:.0f} s")
    print(f"{'group':<12} {'n':>7}  {'median now':>12}  {'before':>10}  measure")
    worse = []
    for group, what, unit in GROUPS:
        m = now[group]
        before = last["groups"][group]["median"] if last and group in last.get("groups", {}) else None
        flag = ""
        if before is not None and m["median"] > before * (1 + WORSE_RELATIVE) + WORSE_ABSOLUTE:
            flag = "  WORSE"
            worse.append(group)
        shown_before = f"{before:10.4f}" if before is not None else f"{'-':>10}"
        print(f"{group:<12} {m['n']:>7}  {m['median']:>12.4f}  {shown_before}  {what} ({unit}){flag}")
    if worse:
        print(f"replay check: WORSE than the previous run: {', '.join(worse)}")
    else:
        print("replay check: no group worse than the previous run" if last else "replay check: first run (the baseline)")
    if not args.no_save:
        record = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "groups": now}
        last_path.write_text(json.dumps(record, indent=2) + "\n")
        with (work / "history.jsonl").open("a") as history:
            history.write(json.dumps(record) + "\n")


if __name__ == "__main__":
    main()

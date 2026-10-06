"""Copy recent replays on standard-collision maps out of the replay dataset zip (newest first).

  python3 scripts/replay_pull.py OUT_DIR [--1v1 N] [--2v2 N] [--3v3 N] [--since YYYY-MM]

The dataset (~120k replays, see notes/validation.md) stays zipped; only the chosen files are written, as
OUT_DIR/<mode>_<id>.replay. Keep OUT_DIR out of git (out/replays/ is ignored): replays hold player data.
"""
import argparse
import json
import os
import zipfile

DATASET = "/mnt/primary/home/arch/documents/rocket_league_replays/high-level-rocket-league-replay-dataset.zip"
# Maps known to use the standard soccar collision (our arena mesh)
MAPS = {
    "eurostadium_night_p", "stadium_10a_p", "cs_p", "stadium_p", "cs_day_p", "eurostadium_p", "eurostadium_dusk_p",
    "eurostadium_rainy_p", "park_p", "park_night_p", "park_rainy_p", "utopiastadium_p", "utopiastadium_dusk_p",
    "trainstation_p", "trainstation_night_p", "stadium_day_p",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--1v1", dest="n1", type=int, default=60)
    ap.add_argument("--2v2", dest="n2", type=int, default=30)
    ap.add_argument("--3v3", dest="n3", type=int, default=0)
    ap.add_argument("--since", default="2025-06")
    ap.add_argument("--dataset", default=DATASET)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    z = zipfile.ZipFile(a.dataset)
    names = set(z.namelist())
    total = 0
    for mode, want in (("1v1", a.n1), ("2v2", a.n2), ("3v3", a.n3)):
        rows = []
        with z.open(f"{mode}/metadata.jsonl") as f:
            for line in f:
                d = json.loads(line)["data"]
                if d.get("date", "") >= a.since and d.get("map_code") in MAPS:
                    rows.append((d["date"], d["id"]))
        rows.sort(reverse=True)
        n = 0
        for _, rid in rows:
            if n >= want:
                break
            src = f"{mode}/{rid}.replay"
            if src not in names:
                continue
            dst = os.path.join(a.out, f"{mode}_{rid}.replay")
            if not os.path.exists(dst):
                with z.open(src) as s, open(dst, "wb") as d:
                    d.write(s.read())
            n += 1
        total += n
    print(f"{total} replays in {a.out}")


if __name__ == "__main__":
    main()

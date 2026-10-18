#!/usr/bin/env python3
"""carball-api's mutation test: each mutant in mutants.json (one exact replacement in one file) applied to a copy of api/,
then `go test` of its packages with the throwaway database (internal/testdb). Killed: a test failed; survived: all passed
(a gap, or an equivalent mutant); build-error / no-match: the mutant itself is wrong (the code moved: re-anchor it).

    python3 api/mutants/run.py --out DIR [--dry-run] [ID ...]

DIR (new or empty) gets a copy per mutant, its test log and results.tsv; the copies are left for a look (they're
throwaway). --dry-run only checks every anchor matches once. Offline: the module cache (GOPROXY=off), as the build.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.path.dirname(HERE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("ids", nargs="*")
    args = parser.parse_args()
    mutants = json.load(open(os.path.join(HERE, "mutants.json"), encoding="utf-8"))["mutants"]
    if args.ids:
        mutants = [m for m in mutants if m["id"] in set(args.ids)]
    bad = []
    for m in mutants:
        n = open(os.path.join(API, m["file"]), encoding="utf-8").read().count(m["old"])
        if n != 1:
            bad.append((m["id"], n))
    for mid, n in bad:
        print(f"{mid}: its anchor occurs {n} times (re-anchor it)")
    if args.dry_run:
        print(f"{len(mutants)} mutants, {len(bad)} anchors off")
        return 1 if bad else 0
    if os.path.exists(args.out) and os.listdir(args.out):
        print(f"{args.out} isn't empty")
        return 2
    os.makedirs(args.out, exist_ok=True)
    env = dict(os.environ, CARBALL_API_REQUIRE_DB="1", GOFLAGS="-mod=readonly", GOPROXY="off", GOTOOLCHAIN="local")
    counts = {}
    with open(os.path.join(args.out, "results.tsv"), "w", encoding="utf-8") as results:
        for m in mutants:
            work = os.path.join(args.out, m["id"])
            shutil.copytree(API, work, ignore=shutil.ignore_patterns("mutants"))
            path = os.path.join(work, m["file"])
            text = open(path, encoding="utf-8").read()
            if text.count(m["old"]) != 1:
                verdict, failing = "NO-MATCH", []
            else:
                open(path, "w", encoding="utf-8").write(text.replace(m["old"], m["new"]))
                try:
                    proc = subprocess.run(["go", "test", "-count=1", *m["packages"]], cwd=work, env=env, capture_output=True, text=True, timeout=600)
                    out, code = proc.stdout + proc.stderr, proc.returncode
                except subprocess.TimeoutExpired:
                    out, code = "timeout", -1
                open(os.path.join(args.out, m["id"] + ".log"), "w", encoding="utf-8").write(out)
                if "[build failed]" in out or "[setup failed]" in out:
                    verdict = "BUILD-ERROR"
                else:
                    verdict = "SURVIVED" if code == 0 else "KILLED"
                failing = sorted({line.split()[2] for line in out.splitlines() if line.startswith("--- FAIL:")})
            counts[verdict] = counts.get(verdict, 0) + 1
            results.write(f"{m['id']}\t{verdict}\t{','.join(failing)}\n")
            results.flush()
            print(m["id"], verdict, ",".join(failing), flush=True)
    print(counts)
    return 0 if set(counts) <= {"KILLED"} else 1


if __name__ == "__main__":
    sys.exit(main())

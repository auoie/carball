"""Check PhysLog scenario files: every line has the number of values its command takes (the plugin stops a scenario
at a bad line, mid-run). Usage: check_scenarios.py [FILE...] (default: all of tools/physlog/scenarios)"""
import glob
import os
import sys

COUNTS = {"car": 13, "car2": 13, "ball": 9, "wait": 1, "input": 9, "input2": 8, "repeat": 1, "end": 0, "target": 1}


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(here, "scenarios", "*.txt")))
    bad = 0
    for path in files:
        for n, line in enumerate(open(path), 1):
            words = line.split("#", 1)[0].split()
            if not words:
                continue
            want = COUNTS.get(words[0])
            if want is None or len(words) - 1 != want:
                print(f"{path}:{n}: {line.rstrip()}  ({'unknown command' if want is None else f'{len(words) - 1} values, want {want}'})")
                bad += 1
    print(f"{len(files)} scenario files, {bad} bad lines")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Smooth a signal using a moving average filter.

Reads a CSV with index/value columns and applies a moving average
window to smooth the signal.

---
inputs:
  input_csv:
    type: csv
    description: Input CSV with noisy signal
outputs:
  --output:
    type: csv
    description: Output CSV with smoothed signal
args:
  --window-size:
    type: int
    default: 10
    description: Size of the moving average window
---
"""

import argparse
import csv
import os


def main():
    parser = argparse.ArgumentParser(description="Smooth signal with moving average")
    parser.add_argument("input_csv", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--window-size", type=int, default=10, help="Moving average window")
    args = parser.parse_args()

    # Read input
    with open(args.input_csv, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    values = [float(r["value"]) for r in rows]

    # Apply moving average
    smoothed = []
    for i in range(len(values)):
        start = max(0, i - args.window_size // 2)
        end = min(len(values), i + args.window_size // 2 + 1)
        avg = sum(values[start:end]) / (end - start)
        smoothed.append(round(avg, 4))

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["index", "value"])
        writer.writeheader()
        for i, val in enumerate(smoothed):
            writer.writerow({"index": i, "value": val})

    print(f"Smoothed {len(values)} samples (window={args.window_size}) -> {args.output}")


if __name__ == "__main__":
    main()

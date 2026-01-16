#!/usr/bin/env python3
"""Generate a noisy sine wave signal.

Creates a CSV with time and value columns.
The signal is a sine wave with configurable frequency and added Gaussian noise.

---
outputs:
  --output:
    type: csv
    description: CSV with time and value columns
args:
  --points:
    type: int
    default: 200
    description: Number of data points
  --noise:
    type: float
    default: 0.2
    description: Noise level (standard deviation)
  --frequency:
    type: float
    default: 2.0
    description: Signal frequency (cycles per series)
---
"""

import argparse
import csv
import math
import random


def main():
    parser = argparse.ArgumentParser(description="Generate noisy sine wave")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--points", type=int, default=200, help="Number of points")
    parser.add_argument("--noise", type=float, default=0.2, help="Noise level")
    parser.add_argument("--frequency", type=float, default=2.0, help="Frequency")
    args = parser.parse_args()

    random.seed(42)

    rows = []
    for i in range(args.points):
        t = i / args.points
        # Sine wave + noise
        clean = math.sin(2 * math.pi * args.frequency * t)
        noisy = clean + random.gauss(0, args.noise)
        rows.append({"time": round(t, 4), "value": round(noisy, 4)})

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["time", "value"])
        writer.writeheader()
        writer.writerows(rows)

    print(
        f"Generated {args.points} points (freq={args.frequency}, noise={args.noise}) -> {args.output}"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate a noisy test signal.

Creates a CSV with index and value columns containing a sine wave
with added noise and occasional spikes.

---
outputs:
  --output:
    type: csv
    description: Output CSV with noisy signal data
args:
  --samples:
    type: int
    default: 200
    description: Number of data points to generate
---
"""

import argparse
import csv
import math
import os
import random


def main():
    parser = argparse.ArgumentParser(description="Generate noisy test signal")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--samples", type=int, default=200, help="Number of samples")
    args = parser.parse_args()

    random.seed(42)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    rows = []
    for i in range(args.samples):
        # Base sine wave
        value = 10.0 * math.sin(2 * math.pi * i / 50)
        # Add noise
        value += random.gauss(0, 2.0)
        # Occasional spikes
        if random.random() < 0.05:
            value += random.uniform(5, 15) * random.choice([-1, 1])
        rows.append({"index": i, "value": round(value, 4)})

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["index", "value"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {args.samples} samples -> {args.output}")


if __name__ == "__main__":
    main()

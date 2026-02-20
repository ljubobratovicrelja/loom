#!/usr/bin/env python3
"""Filter outliers from a signal.

Reads a CSV with index/value columns and removes values that deviate
more than a threshold from the local mean. Outputs a cleaned CSV.

---
inputs:
  input_csv:
    type: csv
    description: Input CSV with signal data
outputs:
  --output:
    type: csv
    description: Output CSV with outliers removed
args:
  --threshold:
    type: float
    default: 3.0
    description: Outlier threshold (standard deviations from mean)
---
"""

import argparse
import csv
import math
import os


def main():
    parser = argparse.ArgumentParser(description="Filter signal outliers")
    parser.add_argument("input_csv", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--threshold", type=float, default=3.0, help="Outlier threshold")
    args = parser.parse_args()

    # Read input
    with open(args.input_csv, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    values = [float(r["value"]) for r in rows]

    # Compute stats
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std = math.sqrt(variance) if variance > 0 else 0

    # Filter outliers
    kept_rows = []
    removed = 0
    for i, v in enumerate(values):
        if abs(v - mean) <= args.threshold * std:
            kept_rows.append({"index": i, "value": round(v, 4)})
        else:
            removed += 1

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["index", "value"])
        writer.writeheader()
        writer.writerows(kept_rows)

    print(
        f"Filtered {len(values)} points (threshold={args.threshold}): "
        f"kept {len(kept_rows)}, removed {removed} -> {args.output}"
    )


if __name__ == "__main__":
    main()

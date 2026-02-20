#!/usr/bin/env python3
"""Summarize the final cleaned signal.

Reads a CSV with index/value columns and prints summary statistics.

---
inputs:
  input_csv:
    type: csv
    description: Final cleaned signal CSV
---
"""

import argparse
import csv
import math


def main():
    parser = argparse.ArgumentParser(description="Summarize cleaned signal")
    parser.add_argument("input_csv", help="Input CSV path")
    args = parser.parse_args()

    with open(args.input_csv, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    values = [float(r["value"]) for r in rows]
    mean = sum(values) / len(values) if values else 0
    variance = sum((v - mean) ** 2 for v in values) / len(values) if values else 0
    std = math.sqrt(variance) if variance > 0 else 0

    print("Signal summary after multi-pass refinement:")
    print(f"  Total points: {len(values)}")
    print(f"  Mean: {mean:.4f}")
    print(f"  Std: {std:.4f}")
    print(f"  Min: {min(values):.4f}")
    print(f"  Max: {max(values):.4f}")


if __name__ == "__main__":
    main()

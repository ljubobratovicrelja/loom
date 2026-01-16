#!/usr/bin/env python3
"""Smooth a signal using moving average.

Applies a simple moving average filter to reduce noise.

---
inputs:
  signal:
    type: csv
    description: Input signal CSV with time and value columns
outputs:
  --output:
    type: csv
    description: Smoothed signal CSV
args:
  --window:
    type: int
    default: 5
    description: Window size for moving average
---
"""

import argparse
import csv


def moving_average(values, window):
    """Compute moving average with given window size."""
    result = []
    for i in range(len(values)):
        start = max(0, i - window // 2)
        end = min(len(values), i + window // 2 + 1)
        avg = sum(values[start:end]) / (end - start)
        result.append(avg)
    return result


def main():
    parser = argparse.ArgumentParser(description="Smooth signal with moving average")
    parser.add_argument("signal", help="Input signal CSV")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--window", type=int, default=5, help="Window size")
    args = parser.parse_args()

    # Read signal
    times = []
    values = []
    with open(args.signal, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            times.append(float(row["time"]))
            values.append(float(row["value"]))

    # Smooth
    smoothed = moving_average(values, args.window)

    # Write output
    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["time", "value", "original"])
        writer.writeheader()
        for t, orig, smooth in zip(times, values, smoothed):
            writer.writerow({
                "time": round(t, 4),
                "value": round(smooth, 4),
                "original": round(orig, 4)
            })

    print(f"Smoothed {len(values)} points (window={args.window}) -> {args.output}")


if __name__ == "__main__":
    main()

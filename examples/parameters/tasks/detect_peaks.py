#!/usr/bin/env python3
"""Detect peaks in a signal.

Finds local maxima above a threshold value.

---
inputs:
  signal:
    type: csv
    description: Input signal CSV with time and value columns
outputs:
  --output:
    type: json
    description: JSON with detected peaks
args:
  --threshold:
    type: float
    default: 0.3
    description: Minimum value for peak detection
---
"""

import argparse
import csv
import json


def find_peaks(values, threshold):
    """Find indices of local maxima above threshold."""
    peaks = []
    for i in range(1, len(values) - 1):
        if values[i] > threshold:
            if values[i] > values[i - 1] and values[i] > values[i + 1]:
                peaks.append(i)
    return peaks


def main():
    parser = argparse.ArgumentParser(description="Detect peaks in signal")
    parser.add_argument("signal", help="Input signal CSV")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    parser.add_argument("--threshold", type=float, default=0.3, help="Peak threshold")
    args = parser.parse_args()

    # Read signal
    times = []
    values = []
    with open(args.signal, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            times.append(float(row["time"]))
            values.append(float(row["value"]))

    # Find peaks
    peak_indices = find_peaks(values, args.threshold)

    # Build result
    result = {
        "threshold": args.threshold,
        "total_points": len(values),
        "peak_count": len(peak_indices),
        "peaks": [
            {
                "index": i,
                "time": round(times[i], 4),
                "value": round(values[i], 4)
            }
            for i in peak_indices
        ]
    }

    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Found {len(peak_indices)} peaks (threshold={args.threshold}) -> {args.output}")


if __name__ == "__main__":
    main()

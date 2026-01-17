#!/usr/bin/env python3
"""Compute statistics from sensor readings.

Calculates min, max, mean, and standard deviation for numeric columns.

---
inputs:
  data:
    type: csv
    description: Input CSV with sensor readings
outputs:
  --output:
    type: json
    description: JSON file with computed statistics
---
"""

import argparse
import csv
import json
import math


def compute_column_stats(values):
    """Compute stats for a list of numeric values."""
    n = len(values)
    if n == 0:
        return {"count": 0}

    mean = sum(values) / n
    variance = sum((x - mean) ** 2 for x in values) / n
    std = math.sqrt(variance)

    return {
        "count": n,
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "mean": round(mean, 2),
        "std": round(std, 2),
    }


def main():
    parser = argparse.ArgumentParser(description="Compute statistics from CSV")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    # Read CSV and extract numeric columns
    temperatures = []
    humidities = []

    with open(args.data) as f:
        reader = csv.DictReader(f)
        for row in reader:
            temperatures.append(float(row["temperature"]))
            humidities.append(float(row["humidity"]))

    stats = {
        "temperature": compute_column_stats(temperatures),
        "humidity": compute_column_stats(humidities),
    }

    with open(args.output, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"Computed stats for {len(temperatures)} rows -> {args.output}")


if __name__ == "__main__":
    main()

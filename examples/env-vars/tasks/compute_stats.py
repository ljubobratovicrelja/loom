#!/usr/bin/env python3
"""Compute summary statistics for the generated signal.

---
inputs:
  data:
    type: csv
    description: Input CSV with the generated signal
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute signal statistics")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    values: list[float] = []
    with open(args.data) as f:
        rows = (line for line in f if not line.startswith("#"))
        reader = csv.DictReader(rows)
        for row in reader:
            values.append(float(row["value"]))

    n = len(values)
    mean = sum(values) / n if n else 0.0
    variance = sum((x - mean) ** 2 for x in values) / n if n else 0.0
    stats = {
        "count": n,
        "min": round(min(values), 4) if values else 0.0,
        "max": round(max(values), 4) if values else 0.0,
        "mean": round(mean, 4),
        "std": round(math.sqrt(variance), 4),
    }

    with open(args.output, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"Computed stats for {n} rows -> {args.output}")


if __name__ == "__main__":
    main()

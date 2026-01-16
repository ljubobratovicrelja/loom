#!/usr/bin/env python3
"""Compute statistics grouped by category.

Calculates count, min, max, mean for each category.

---
inputs:
  data:
    type: csv
    description: Input CSV with measurement data
outputs:
  --output:
    type: json
    description: JSON file with statistics per category
---
"""

import argparse
import csv
import json


def main():
    parser = argparse.ArgumentParser(description="Compute stats by category")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    # Group measurements by category
    by_category = {}
    with open(args.data, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cat = row["category"]
            val = float(row["measurement"])
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(val)

    # Compute stats for each category
    stats = {}
    for cat, values in sorted(by_category.items()):
        stats[cat] = {
            "count": len(values),
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "mean": round(sum(values) / len(values), 2),
            "sum": round(sum(values), 2)
        }

    # Overall stats
    all_values = [v for vals in by_category.values() for v in vals]
    stats["_overall"] = {
        "count": len(all_values),
        "min": round(min(all_values), 2),
        "max": round(max(all_values), 2),
        "mean": round(sum(all_values) / len(all_values), 2)
    }

    with open(args.output, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"Stats for {len(by_category)} categories -> {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Merge statistics with cleaned data into a final report.

Combines the stats JSON with row counts from clean data
to produce a comprehensive summary.

---
inputs:
  stats:
    type: json
    description: Statistics JSON from compute_stats
  clean_data:
    type: csv
    description: Cleaned CSV from filter_outliers
outputs:
  --output:
    type: json
    description: Combined final report
---
"""

import argparse
import csv
import json
from datetime import datetime


def main():
    parser = argparse.ArgumentParser(description="Merge stats and clean data")
    parser.add_argument("stats", help="Stats JSON path")
    parser.add_argument("clean_data", help="Clean CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    # Load stats
    with open(args.stats, "r") as f:
        stats = json.load(f)

    # Count clean data by category
    clean_counts = {}
    clean_rows = []
    with open(args.clean_data, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            clean_rows.append(row)
            cat = row["category"]
            clean_counts[cat] = clean_counts.get(cat, 0) + 1

    # Build report
    report = {
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "original_count": stats.get("_overall", {}).get("count", 0),
            "clean_count": len(clean_rows),
            "outliers_removed": stats.get("_overall", {}).get("count", 0) - len(clean_rows)
        },
        "by_category": {}
    }

    for cat in sorted(stats.keys()):
        if cat.startswith("_"):
            continue
        report["by_category"][cat] = {
            "original_stats": stats[cat],
            "clean_count": clean_counts.get(cat, 0),
            "outliers_removed": stats[cat]["count"] - clean_counts.get(cat, 0)
        }

    with open(args.output, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Final report -> {args.output}")
    print(f"  Original: {report['summary']['original_count']} rows")
    print(f"  Clean: {report['summary']['clean_count']} rows")
    print(f"  Removed: {report['summary']['outliers_removed']} outliers")


if __name__ == "__main__":
    main()

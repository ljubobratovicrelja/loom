#!/usr/bin/env python3
"""Filter outliers using the IQR method.

Removes rows where the measurement falls outside Q1 - threshold*IQR
to Q3 + threshold*IQR range, computed per category.

---
inputs:
  data:
    type: csv
    description: Input CSV with measurement data
outputs:
  --output:
    type: csv
    description: CSV with outliers removed
args:
  --threshold:
    type: float
    default: 1.5
    description: IQR multiplier for outlier bounds
---
"""

import argparse
import csv


def compute_iqr_bounds(values, threshold):
    """Compute IQR-based outlier bounds."""
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    q1 = sorted_vals[n // 4]
    q3 = sorted_vals[(3 * n) // 4]
    iqr = q3 - q1
    return q1 - threshold * iqr, q3 + threshold * iqr


def main():
    parser = argparse.ArgumentParser(description="Filter outliers using IQR")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--threshold", type=float, default=1.5, help="IQR multiplier")
    args = parser.parse_args()

    # Load data and group by category
    rows = []
    by_category = {}
    with open(args.data, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
            cat = row["category"]
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(float(row["measurement"]))

    # Compute bounds per category
    bounds = {}
    for cat, values in by_category.items():
        if len(values) >= 4:  # Need enough data for IQR
            bounds[cat] = compute_iqr_bounds(values, args.threshold)
        else:
            bounds[cat] = (float("-inf"), float("inf"))

    # Filter rows
    clean_rows = []
    removed = 0
    for row in rows:
        val = float(row["measurement"])
        lower, upper = bounds[row["category"]]
        if lower <= val <= upper:
            clean_rows.append(row)
        else:
            removed += 1
            print(f"  Outlier removed: id={row['id']} value={val} category={row['category']}")

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "measurement", "category"])
        writer.writeheader()
        writer.writerows(clean_rows)

    print(f"Removed {removed} outliers, kept {len(clean_rows)} rows -> {args.output}")


if __name__ == "__main__":
    main()

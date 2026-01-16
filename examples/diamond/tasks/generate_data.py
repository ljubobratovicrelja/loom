#!/usr/bin/env python3
"""Generate sample raw data for the diamond pipeline.

---
outputs:
  --output:
    type: csv
    description: Output CSV file with raw data
args:
  --rows:
    type: int
    default: 100
    description: Number of rows to generate
  --seed:
    type: int
    default: 42
    description: Random seed for reproducibility
---
"""

import argparse
import csv
import random


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("---")[0].strip())
    parser.add_argument("--output", "-o", required=True, help="Output CSV file")
    parser.add_argument("--rows", type=int, default=100, help="Number of rows")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    random.seed(args.seed)

    # Generate sample data with some outliers
    with open(args.output, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "measurement", "category"])

        categories = ["A", "B", "C"]

        for i in range(args.rows):
            # Most values between 10-100, some outliers
            if random.random() < 0.05:  # 5% outliers
                measurement = random.uniform(200, 500)
            else:
                measurement = random.gauss(50, 15)

            category = random.choice(categories)

            writer.writerow([i + 1, round(measurement, 2), category])

    print(f"Generated {args.rows} rows -> {args.output}")


if __name__ == "__main__":
    main()

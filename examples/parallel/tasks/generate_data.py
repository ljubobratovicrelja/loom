#!/usr/bin/env python3
"""Generate synthetic classification data.

Creates a CSV with features and a score column.
The score is a combination of features plus noise,
simulating a real classification scenario.

---
outputs:
  --output:
    type: csv
    description: CSV with features and scores
args:
  --samples:
    type: int
    default: 500
    description: Number of samples to generate
---
"""

import argparse
import csv
import random
import math


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic data")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--samples", type=int, default=500, help="Number of samples")
    args = parser.parse_args()

    random.seed(42)

    rows = []
    for i in range(args.samples):
        # Generate features
        feature_a = random.gauss(0, 1)
        feature_b = random.gauss(0, 1)

        # Score is a nonlinear combination of features + noise
        raw_score = 0.5 * feature_a + 0.3 * feature_b + 0.2 * feature_a * feature_b
        noise = random.gauss(0, 0.2)
        score = 1 / (1 + math.exp(-raw_score - noise))  # Sigmoid to [0, 1]

        # Ground truth: positive if original signal was positive
        true_label = 1 if raw_score > 0 else 0

        rows.append({
            "id": i,
            "feature_a": round(feature_a, 4),
            "feature_b": round(feature_b, 4),
            "score": round(score, 4),
            "true_label": true_label
        })

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "feature_a", "feature_b", "score", "true_label"])
        writer.writeheader()
        writer.writerows(rows)

    positive_rate = sum(r["true_label"] for r in rows) / len(rows)
    print(f"Generated {args.samples} samples (positive rate: {positive_rate:.1%}) -> {args.output}")


if __name__ == "__main__":
    main()

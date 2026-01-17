#!/usr/bin/env python3
"""Process data with configurable threshold.

Classifies samples as positive/negative based on score threshold.
Computes precision, recall, and F1 score against ground truth.

---
inputs:
  data:
    type: csv
    description: Input CSV with scores and true labels
outputs:
  --output:
    type: json
    description: JSON with classification results
args:
  --threshold:
    type: float
    default: 0.5
    description: Classification threshold
  --config-name:
    type: str
    default: default
    description: Name for this configuration
---
"""

import argparse
import csv
import json
import random
import time


def main():
    # Simulate varying processing time to demonstrate parallel execution
    delay = random.uniform(2, 5)
    print(f"Processing (will take {delay:.1f}s)...")
    time.sleep(delay)
    parser = argparse.ArgumentParser(description="Process with threshold")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    parser.add_argument("--threshold", type=float, default=0.5, help="Threshold")
    parser.add_argument("--config-name", default="default", help="Config name")
    args = parser.parse_args()

    # Read data
    rows = []
    with open(args.data) as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(
                {
                    "id": int(row["id"]),
                    "score": float(row["score"]),
                    "true_label": int(row["true_label"]),
                }
            )

    # Classify and compute metrics
    tp = fp = tn = fn = 0
    predictions = []

    for row in rows:
        predicted = 1 if row["score"] >= args.threshold else 0
        actual = row["true_label"]

        predictions.append(
            {
                "id": row["id"],
                "score": row["score"],
                "predicted": predicted,
                "actual": actual,
                "correct": predicted == actual,
            }
        )

        if predicted == 1 and actual == 1:
            tp += 1
        elif predicted == 1 and actual == 0:
            fp += 1
        elif predicted == 0 and actual == 0:
            tn += 1
        else:
            fn += 1

    # Compute metrics
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    accuracy = (tp + tn) / len(rows)

    result = {
        "config_name": args.config_name,
        "threshold": args.threshold,
        "total_samples": len(rows),
        "metrics": {
            "accuracy": round(accuracy, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
        },
        "confusion_matrix": {
            "true_positive": tp,
            "false_positive": fp,
            "true_negative": tn,
            "false_negative": fn,
        },
    }

    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Config '{args.config_name}' (threshold={args.threshold}):")
    print(f"  Accuracy:  {accuracy:.1%}")
    print(f"  Precision: {precision:.1%}")
    print(f"  Recall:    {recall:.1%}")
    print(f"  F1:        {f1:.4f}")
    print(f"  -> {args.output}")


if __name__ == "__main__":
    main()

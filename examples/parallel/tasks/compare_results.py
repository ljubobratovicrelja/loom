#!/usr/bin/env python3
"""Compare results from multiple configurations.

Aggregates results into a side-by-side comparison table.

---
inputs:
  result_low:
    type: json
    description: Results from low threshold config
  result_mid:
    type: json
    description: Results from mid threshold config
  result_high:
    type: json
    description: Results from high threshold config
outputs:
  --output:
    type: json
    description: JSON with comparison table
---
"""

import argparse
import json


def main():
    parser = argparse.ArgumentParser(description="Compare results")
    parser.add_argument("result_low", help="Low threshold results")
    parser.add_argument("result_mid", help="Mid threshold results")
    parser.add_argument("result_high", help="High threshold results")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    # Load all results
    results = []
    for path in [args.result_low, args.result_mid, args.result_high]:
        with open(path) as f:
            results.append(json.load(f))

    # Find best configuration by F1 score
    best = max(results, key=lambda r: r["metrics"]["f1_score"])

    # Build comparison
    comparison = {
        "configurations": [
            {"name": r["config_name"], "threshold": r["threshold"], **r["metrics"]} for r in results
        ],
        "best_config": {
            "name": best["config_name"],
            "threshold": best["threshold"],
            "f1_score": best["metrics"]["f1_score"],
        },
        "summary": {"total_configs": len(results), "metric_compared": "f1_score"},
    }

    with open(args.output, "w") as f:
        json.dump(comparison, f, indent=2)

    # Print comparison table
    print("\nConfiguration Comparison:")
    print("-" * 65)
    print(
        f"{'Config':<10} {'Threshold':>10} {'Accuracy':>10} {'Precision':>10} {'Recall':>10} {'F1':>10}"
    )
    print("-" * 65)

    for r in results:
        m = r["metrics"]
        marker = " *" if r["config_name"] == best["config_name"] else ""
        print(
            f"{r['config_name']:<10} {r['threshold']:>10.2f} {m['accuracy']:>10.1%} {m['precision']:>10.1%} {m['recall']:>10.1%} {m['f1_score']:>10.4f}{marker}"
        )

    print("-" * 65)
    print("* Best configuration by F1 score")
    print(f"\n-> {args.output}")


if __name__ == "__main__":
    main()

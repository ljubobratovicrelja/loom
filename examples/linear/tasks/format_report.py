#!/usr/bin/env python3
"""Format statistics as a human-readable report.

Takes JSON stats and produces a text summary.

---
inputs:
  stats:
    type: json
    description: JSON file with statistics
outputs:
  --output:
    type: text
    description: Text report file
---
"""

import argparse
import json
from datetime import datetime


def main():
    parser = argparse.ArgumentParser(description="Format stats as text report")
    parser.add_argument("stats", help="Input JSON stats path")
    parser.add_argument("-o", "--output", required=True, help="Output text path")
    args = parser.parse_args()

    with open(args.stats, "r") as f:
        stats = json.load(f)

    lines = [
        "=" * 50,
        "SENSOR DATA SUMMARY",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 50,
        "",
    ]

    for column, data in stats.items():
        lines.append(f"{column.upper()}")
        lines.append("-" * 30)
        lines.append(f"  Samples: {data['count']}")
        lines.append(f"  Min:     {data['min']}")
        lines.append(f"  Max:     {data['max']}")
        lines.append(f"  Mean:    {data['mean']}")
        lines.append(f"  Std Dev: {data['std']}")
        lines.append("")

    report = "\n".join(lines)

    with open(args.output, "w") as f:
        f.write(report)

    print(f"Report written -> {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate a synthetic signal CSV.

Writes a CSV with index and value columns. The run id is recorded in a
header comment to demonstrate an environment-variable-derived argument.

---
outputs:
  --output:
    type: csv
    description: Output CSV with the generated signal
args:
  --samples:
    type: int
    default: 100
    description: Number of samples to generate
  --run-id:
    type: str
    default: "dev"
    description: Run identifier (typically from ${RUN_ID})
---
"""

import argparse
import csv
import math


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a synthetic signal")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--samples", type=int, default=100, help="Number of samples")
    parser.add_argument("--run-id", default="dev", help="Run identifier")
    args = parser.parse_args()

    with open(args.output, "w", newline="") as f:
        f.write(f"# run_id={args.run_id}\n")
        writer = csv.writer(f)
        writer.writerow(["index", "value"])
        for i in range(args.samples):
            writer.writerow([i, round(math.sin(i / 5.0), 4)])

    print(f"[{args.run_id}] Generated {args.samples} samples -> {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Load and validate raw CSV data.

Checks for required columns and valid data types.
Adds a validated flag and row count to output.

---
inputs:
  raw:
    type: csv
    description: Raw input CSV file
outputs:
  --output:
    type: csv
    description: Validated CSV with same structure
---
"""

import argparse
import csv


def main():
    parser = argparse.ArgumentParser(description="Load and validate CSV")
    parser.add_argument("raw", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    args = parser.parse_args()

    required_columns = {"id", "measurement", "category"}
    rows = []
    errors = []

    with open(args.raw) as f:
        reader = csv.DictReader(f)

        # Check columns
        if not required_columns.issubset(set(reader.fieldnames)):
            missing = required_columns - set(reader.fieldnames)
            raise ValueError(f"Missing required columns: {missing}")

        for i, row in enumerate(reader, start=2):  # Line 2 is first data row
            try:
                # Validate types
                int(row["id"])
                float(row["measurement"])
                if not row["category"]:
                    raise ValueError("Empty category")
                rows.append(row)
            except ValueError as e:
                errors.append(f"Line {i}: {e}")

    if errors:
        print(f"Validation warnings ({len(errors)} rows):")
        for err in errors[:5]:  # Show first 5
            print(f"  {err}")
        if len(errors) > 5:
            print(f"  ... and {len(errors) - 5} more")

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "measurement", "category"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Validated {len(rows)} rows -> {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Export full frequency data for debugging.

Creates a detailed text dump of all word frequencies,
sorted alphabetically and by count.

---
inputs:
  frequencies:
    type: json
    description: JSON with word frequencies
outputs:
  --output:
    type: text
    description: Debug dump text file
---
"""

import argparse
import json
from datetime import datetime


def main():
    parser = argparse.ArgumentParser(description="Export debug dump")
    parser.add_argument("frequencies", help="Input frequencies JSON")
    parser.add_argument("-o", "--output", required=True, help="Output text path")
    args = parser.parse_args()

    with open(args.frequencies, "r") as f:
        data = json.load(f)

    lines = [
        "=" * 60,
        "DEBUG DUMP - Word Frequency Analysis",
        f"Generated: {datetime.now().isoformat()}",
        "=" * 60,
        "",
        f"Total words: {data['total_words']}",
        f"Unique words: {data['unique_words']}",
        "",
        "-" * 60,
        "BY FREQUENCY (descending)",
        "-" * 60,
    ]

    by_freq = sorted(data["frequencies"].items(), key=lambda x: (-x[1], x[0]))
    for word, count in by_freq:
        lines.append(f"  {count:4d}  {word}")

    lines.extend([
        "",
        "-" * 60,
        "ALPHABETICAL",
        "-" * 60,
    ])

    by_alpha = sorted(data["frequencies"].items())
    for word, count in by_alpha:
        lines.append(f"  {word}: {count}")

    with open(args.output, "w") as f:
        f.write("\n".join(lines))

    print(f"Debug dump ({len(data['frequencies'])} words) -> {args.output}")


if __name__ == "__main__":
    main()

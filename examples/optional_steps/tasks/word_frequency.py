#!/usr/bin/env python3
"""Count word frequencies in text.

Produces a JSON object with word counts.

---
inputs:
  text:
    type: text
    description: Normalized text file
outputs:
  --output:
    type: json
    description: JSON with word frequencies
---
"""

import argparse
import json
from collections import Counter


def main():
    parser = argparse.ArgumentParser(description="Count word frequencies")
    parser.add_argument("text", help="Input text file")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    with open(args.text) as f:
        text = f.read()

    words = text.split()
    counts = Counter(words)

    result = {
        "total_words": len(words),
        "unique_words": len(counts),
        "frequencies": dict(counts.most_common()),
    }

    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Counted {len(counts)} unique words from {len(words)} total -> {args.output}")


if __name__ == "__main__":
    main()

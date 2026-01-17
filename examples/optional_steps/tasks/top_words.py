#!/usr/bin/env python3
"""Extract the top N most frequent words.

---
inputs:
  frequencies:
    type: json
    description: JSON with word frequencies
outputs:
  --output:
    type: json
    description: JSON with top N words
args:
  --top:
    type: int
    default: 10
    description: Number of top words to extract
---
"""

import argparse
import json


def main():
    parser = argparse.ArgumentParser(description="Extract top N words")
    parser.add_argument("frequencies", help="Input frequencies JSON")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
    parser.add_argument("--top", type=int, default=10, help="Number of top words")
    args = parser.parse_args()

    with open(args.frequencies) as f:
        data = json.load(f)

    frequencies = data["frequencies"]
    sorted_words = sorted(frequencies.items(), key=lambda x: x[1], reverse=True)
    top = sorted_words[: args.top]

    result = {
        "top_n": args.top,
        "total_unique": data["unique_words"],
        "words": [{"word": w, "count": c} for w, c in top],
    }

    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Top {args.top} words -> {args.output}")
    for w, c in top[:5]:
        print(f"  {w}: {c}")


if __name__ == "__main__":
    main()

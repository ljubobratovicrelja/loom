#!/usr/bin/env python3
"""Load and normalize text for processing.

Converts to lowercase, removes punctuation, normalizes whitespace.

---
inputs:
  text:
    type: text
    description: Input text file
outputs:
  --output:
    type: text
    description: Normalized text file
---
"""

import argparse
import re


def main():
    parser = argparse.ArgumentParser(description="Load and normalize text")
    parser.add_argument("text", help="Input text file")
    parser.add_argument("-o", "--output", required=True, help="Output text path")
    args = parser.parse_args()

    with open(args.text, "r") as f:
        text = f.read()

    # Normalize
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)  # Remove punctuation
    text = re.sub(r"\s+", " ", text)      # Normalize whitespace
    text = text.strip()

    with open(args.output, "w") as f:
        f.write(text)

    word_count = len(text.split())
    print(f"Normalized text ({word_count} words) -> {args.output}")


if __name__ == "__main__":
    main()

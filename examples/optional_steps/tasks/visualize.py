#!/usr/bin/env python3
"""Create ASCII bar chart of top words.

---
inputs:
  top_words:
    type: json
    description: JSON with top words
outputs:
  --output:
    type: text
    description: ASCII bar chart
---
"""

import argparse
import json


def main():
    parser = argparse.ArgumentParser(description="Create ASCII bar chart")
    parser.add_argument("top_words", help="Input top words JSON")
    parser.add_argument("-o", "--output", required=True, help="Output text path")
    args = parser.parse_args()

    with open(args.top_words) as f:
        data = json.load(f)

    words = data["words"]
    if not words:
        print("No words to visualize")
        return

    max_count = max(w["count"] for w in words)
    max_word_len = max(len(w["word"]) for w in words)
    bar_width = 40

    lines = ["TOP WORDS", "=" * (max_word_len + bar_width + 10), ""]

    for item in words:
        word = item["word"]
        count = item["count"]
        bar_len = int((count / max_count) * bar_width)
        bar = "█" * bar_len
        lines.append(f"{word:>{max_word_len}} | {bar} {count}")

    lines.append("")
    lines.append("=" * (max_word_len + bar_width + 10))

    with open(args.output, "w") as f:
        f.write("\n".join(lines))

    print(f"Bar chart -> {args.output}")


if __name__ == "__main__":
    main()

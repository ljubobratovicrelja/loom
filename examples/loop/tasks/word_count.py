"""Count words and lines in a text file.

loom:
  description: Count words/lines of a text file into a JSON report
  inputs:
    text:
      description: Input text file
      type: txt
  outputs:
    --output:
      description: JSON report with word and line counts
      type: json
"""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Count words and lines in a text file")
    parser.add_argument("text", type=Path, help="Input text file")
    parser.add_argument("--output", type=Path, required=True, help="Output JSON report")
    args = parser.parse_args()

    content = args.text.read_text()
    report = {
        "file": args.text.name,
        "words": len(content.split()),
        "lines": len(content.splitlines()),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2))
    print(
        f"{args.text.name}: {report['words']} words, {report['lines']} lines → {args.output.name}"
    )


if __name__ == "__main__":
    main()

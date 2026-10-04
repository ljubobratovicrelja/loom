"""Write the first line of a text file to another file.

loom:
  description: Extract the first line of a text file
  inputs:
    text:
      description: Input text file
      type: txt
  outputs:
    --output:
      description: Output file containing the first line
      type: txt
"""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract the first line of a text file")
    parser.add_argument("text", type=Path, help="Input text file")
    parser.add_argument("--output", type=Path, required=True, help="Output text file")
    args = parser.parse_args()

    lines = args.text.read_text().splitlines()
    first = lines[0] if lines else ""

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(first + "\n")
    print(f"first line of {args.text.name} → {args.output.name}")


if __name__ == "__main__":
    main()

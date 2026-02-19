"""Convert a text file to uppercase with an optional prefix line.

loom:
  description: Uppercase the contents of a text file
  inputs:
    input:
      description: Input text file path
      type: txt
  outputs:
    --output:
      description: Output text file path
      type: txt
  args:
    --prefix:
      type: str
      default: null
      description: Optional prefix line to prepend to the output
"""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Uppercase a text file")
    parser.add_argument("input", type=Path, help="Input text file")
    parser.add_argument("--output", type=Path, required=True, help="Output text file")
    parser.add_argument("--prefix", default=None, help="Optional prefix line")
    args = parser.parse_args()

    text = args.input.read_text()
    result = text.upper()

    if args.prefix:
        result = f"[{args.prefix}]\n{result}"

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result)
    print(f"Processed: {args.input.name} → {args.output.name}")


if __name__ == "__main__":
    main()

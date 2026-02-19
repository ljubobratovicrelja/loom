"""Collect all processed text files into a single summary.

loom:
  description: Concatenate all text files in a folder into one summary file
  inputs:
    folder:
      description: Folder containing processed text files
      type: data_folder
  outputs:
    --output:
      description: Summary text file
      type: txt
"""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize processed text files")
    parser.add_argument("folder", type=Path, help="Folder of processed text files")
    parser.add_argument("--output", type=Path, required=True, help="Output summary file")
    args = parser.parse_args()

    files = sorted(args.folder.glob("*.txt"))
    if not files:
        print("No files found in folder")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text("(no files)\n")
        return

    sections = []
    for f in files:
        sections.append(f"=== {f.name} ===\n{f.read_text()}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n\n".join(sections) + "\n")
    print(f"Summarized {len(files)} files → {args.output.name}")


if __name__ == "__main__":
    main()

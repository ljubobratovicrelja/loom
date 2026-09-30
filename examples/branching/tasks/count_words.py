"""Count words across every .txt file in a folder.

---
inputs:
  folder:
    type: data_folder
    description: Folder containing .txt files to count
outputs:
  -o:
    type: json
    description: Word count report
---
"""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    parser.add_argument("-o", "--output", required=True)
    args = parser.parse_args()

    files = sorted(Path(args.folder).glob("*.txt"))
    words = sum(len(f.read_text().split()) for f in files)
    report = {"files": len(files), "words": words}

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2))
    print(f"counted {words} word(s) across {len(files)} file(s)")


if __name__ == "__main__":
    main()

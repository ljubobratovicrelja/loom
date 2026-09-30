"""Generate sample text files for the branching example.

---
outputs:
  -o:
    type: data_folder
    description: Folder to write the sample .txt files into
---
"""

import argparse
from pathlib import Path

SAMPLES = {
    "a.txt": "the quick brown fox jumps over the lazy dog\n",
    "b.txt": "loom weaves tasks into pipelines\n",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("-o", "--output", required=True)
    args = parser.parse_args()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    for name, content in SAMPLES.items():
        (out / name).write_text(content)
    print(f"wrote {len(SAMPLES)} file(s) to {out}")


if __name__ == "__main__":
    main()

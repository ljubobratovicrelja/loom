"""Write an empty word-count report (the switch's else branch).

---
inputs:
  folder:
    type: data_folder
    description: Payload from the switch; ignored, present only so the step is gated
outputs:
  -o:
    type: json
    description: Empty word count report
---
"""

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", nargs="?", default="")
    parser.add_argument("-o", "--output", required=True)
    args = parser.parse_args()

    report = {"files": 0, "words": 0}
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2))
    print("no input files found, wrote empty report")


if __name__ == "__main__":
    main()

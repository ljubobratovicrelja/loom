#!/usr/bin/env python3
"""Generate sample text data for the optional_steps pipeline.

---
outputs:
  --output:
    type: txt
    description: Output text file with sample content
args:
  --paragraphs:
    type: int
    default: 3
    description: Number of paragraphs to generate
---
"""

import argparse

SAMPLE_PARAGRAPHS = [
    "The quick brown fox jumps over the lazy dog. This classic pangram contains every letter of the alphabet. Pangrams are often used to test fonts and keyboards.",
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Software development involves writing code, testing, and debugging. Python is a popular programming language.",
    "Data pipelines process information through multiple stages. Each stage transforms the data in some way. The final output is often a report or visualization.",
    "Machine learning models learn patterns from data. Training requires large datasets and computational resources. The model can then make predictions on new data.",
    "Version control systems like Git track changes to code. Developers can collaborate on projects using branches and merges. This enables teamwork and code review.",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("---")[0].strip())
    parser.add_argument("--output", "-o", required=True, help="Output text file")
    parser.add_argument("--paragraphs", type=int, default=3, help="Number of paragraphs")
    args = parser.parse_args()

    paragraphs = SAMPLE_PARAGRAPHS[: args.paragraphs]

    with open(args.output, "w") as f:
        f.write("\n\n".join(paragraphs))

    print(f"Generated {args.paragraphs} paragraphs -> {args.output}")


if __name__ == "__main__":
    main()

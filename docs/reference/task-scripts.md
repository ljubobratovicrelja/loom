# Task Scripts

How to write Python scripts that work with Loom pipelines.

## Requirements

For a Python script to work as a pipeline task:

1. Use **argparse** for command-line arguments
2. Add **YAML frontmatter** in the docstring (optional but recommended)
3. Match argument names between frontmatter and argparse

## Basic Structure

```python
#!/usr/bin/env python3
"""Short description of what this task does.

Longer description with details about the algorithm,
expected inputs, and outputs.

---
inputs:
  data:
    type: csv
    description: Input data file
outputs:
  -o:
    type: json
    description: Output results file
args:
  --threshold:
    type: float
    default: 0.5
    description: Detection threshold
---
"""

import argparse


def main():
    parser = argparse.ArgumentParser()

    # Positional input (matches 'data' in frontmatter)
    parser.add_argument('data', help='Input data file')

    # Output flag (matches '-o' in frontmatter)
    parser.add_argument('-o', '--output', required=True, help='Output file')

    # Optional argument (matches '--threshold' in frontmatter)
    parser.add_argument('--threshold', type=float, default=0.5)

    args = parser.parse_args()

    # Your processing logic here
    # ...


if __name__ == '__main__':
    main()
```

## Frontmatter Schema

The YAML block between `---` markers defines the task interface.

### Inputs

Positional arguments that receive file paths:

```yaml
inputs:
  video:
    type: video
    description: Path to input video file
  gaze_csv:
    type: csv
    description: Path to gaze positions CSV
```

In argparse:

```python
parser.add_argument('video', help='Path to input video')
parser.add_argument('gaze_csv', help='Path to gaze CSV')
```

### Outputs

Flag arguments for output file paths:

```yaml
outputs:
  -o:
    type: csv
    description: Output CSV file
  --model:
    type: file
    description: Trained model file
```

In argparse:

```python
parser.add_argument('-o', '--output', required=True)
parser.add_argument('--model', required=True)
```

### Arguments

Additional configuration flags:

```yaml
args:
  --algorithm:
    type: str
    default: ivt
    choices: [ivt, idt]
    description: Detection algorithm
  --threshold:
    type: float
    default: 50.0
    description: Velocity threshold
  --verbose:
    type: bool
    description: Enable verbose output
```

In argparse:

```python
parser.add_argument('--algorithm', default='ivt', choices=['ivt', 'idt'])
parser.add_argument('--threshold', type=float, default=50.0)
parser.add_argument('--verbose', action='store_true')
```

## Field Reference

### Input/Output Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | No | Data type for validation |
| `description` | No | Help text shown in UI |

### Argument Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | No | `str`, `int`, `float`, or `bool` |
| `default` | No | Default value |
| `description` | No | Help text |
| `choices` | No | List of valid options |
| `required` | No | Whether argument is required (default: false) |

### Supported Types

For inputs/outputs (enables connection validation):

- `video`, `image`, `csv`, `json`, `txt`
- `image_directory`, `data_folder`

For arguments:

- `str`, `int`, `float`, `bool`

## Complete Example

```python
#!/usr/bin/env python3
"""Detect fixation events in gaze data.

Uses the I-VT (velocity threshold) or I-DT (dispersion threshold)
algorithm to identify fixation events from raw gaze positions.

---
inputs:
  gaze_csv:
    type: csv
    description: Path to gaze positions CSV (x, y, timestamp)
outputs:
  -o:
    type: csv
    description: Output CSV with detected fixations
args:
  --algorithm:
    type: str
    default: ivt
    choices: [ivt, idt]
    description: Detection algorithm to use
  --threshold:
    type: float
    default: 50.0
    description: Velocity threshold (px/frame) for I-VT
  --min-duration:
    type: float
    default: 0.1
    description: Minimum fixation duration (seconds)
  --verbose:
    type: bool
    description: Print progress information
---
"""

import argparse
import csv


def main():
    parser = argparse.ArgumentParser(
        description='Detect fixation events in gaze data'
    )

    # Input (positional)
    parser.add_argument('gaze_csv', help='Path to gaze positions CSV')

    # Output (flag)
    parser.add_argument('-o', '--output', required=True,
                        help='Output CSV path')

    # Optional arguments
    parser.add_argument('--algorithm', default='ivt',
                        choices=['ivt', 'idt'],
                        help='Detection algorithm')
    parser.add_argument('--threshold', type=float, default=50.0,
                        help='Velocity threshold')
    parser.add_argument('--min-duration', type=float, default=0.1,
                        help='Minimum fixation duration')
    parser.add_argument('--verbose', action='store_true',
                        help='Print progress')

    args = parser.parse_args()

    if args.verbose:
        print(f'Processing {args.gaze_csv}')
        print(f'Algorithm: {args.algorithm}, threshold: {args.threshold}')

    # Load gaze data
    with open(args.gaze_csv) as f:
        reader = csv.DictReader(f)
        gaze_data = list(reader)

    # Detect fixations (simplified)
    fixations = detect_fixations(
        gaze_data,
        algorithm=args.algorithm,
        threshold=args.threshold,
        min_duration=args.min_duration
    )

    # Write output
    with open(args.output, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['start', 'end', 'x', 'y'])
        writer.writeheader()
        writer.writerows(fixations)

    if args.verbose:
        print(f'Found {len(fixations)} fixations')
        print(f'Written to {args.output}')


def detect_fixations(data, algorithm, threshold, min_duration):
    # Your detection logic here
    return []


if __name__ == '__main__':
    main()
```

## Pipeline Usage

The script above would be used in a pipeline like:

```yaml
pipeline:
  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: $gaze_positions
    outputs:
      -o: $fixations_csv
    args:
      --algorithm: ivt
      --threshold: $velocity_threshold
      --verbose: true
```

Which generates:

```bash
python tasks/detect_fixations.py data/gaze.csv -o data/fixations.csv \
    --algorithm ivt --threshold 50.0 --verbose
```

## Tips

- **Keep scripts standalone** — They should work with or without Loom
- **Use argparse** — It's the standard and Loom parses it reliably
- **Add frontmatter** — It enables validation and better UI in the editor
- **Match names** — Frontmatter input/arg names must match argparse argument names
- **Use types** — Type hints enable connection validation in the editor

# Loom

Visual pipeline editor and runner for task automation.

Loom provides two tools for building and executing data processing pipelines:

- **loom-runner**: CLI tool for executing YAML-defined pipelines with dependency tracking
- **loom-editor**: Web-based visual editor for creating and editing pipelines

## Installation

```bash
# Core runner only
pip install loom

# With visual editor
pip install loom[editor]

# Development
pip install loom[dev]
```

## Quick Start

### Running Pipelines

```bash
# Run full pipeline
loom-runner pipeline.yml

# Run specific step
loom-runner pipeline.yml --step extract

# Run from a step onward
loom-runner pipeline.yml --from process

# Preview without executing
loom-runner pipeline.yml --dry-run

# Override parameters
loom-runner pipeline.yml --set threshold=0.8

# Override variables
loom-runner pipeline.yml --var input=other.mp4
```

### Visual Editor

```bash
# Edit existing pipeline
loom-editor pipeline.yml

# Create new pipeline
loom-editor --new

# Custom port
loom-editor pipeline.yml --port 8080
```

## Pipeline Format

Pipelines are defined in YAML with the following structure:

```yaml
# Typed data nodes (recommended)
data:
  video:
    type: video
    path: data/input.mp4
  output_csv:
    type: csv
    path: data/output.csv

# Configuration parameters
parameters:
  threshold: 50.0
  verbose: true

# Processing steps
pipeline:
  - name: extract
    task: tasks/extract.py
    inputs:
      video: $video
    outputs:
      --output: $output_csv
    args:
      --threshold: $threshold
      --verbose: $verbose
```

## Task Scripts

Task scripts are Python files with argparse-based CLIs. Add a YAML frontmatter in the docstring to describe the interface:

```python
"""Extract features from video.

---
inputs:
  video:
    type: video
    description: Input video file
outputs:
  --output:
    type: csv
    description: Output CSV file
args:
  --threshold:
    type: float
    default: 50.0
    description: Detection threshold
---
"""

import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--output", "-o", required=True)
    parser.add_argument("--threshold", type=float, default=50.0)
    args = parser.parse_args()
    # ... processing logic

if __name__ == "__main__":
    main()
```

## Documentation

- [TOOLS.md](docs/TOOLS.md) - Complete reference for loom-runner and loom-editor
- [PIPELINE_AUTHORING.md](docs/PIPELINE_AUTHORING.md) - Guide to creating pipelines

## Development

```bash
# Clone and install
git clone https://github.com/your-username/loom.git
cd loom
pip install -e ".[dev]"

# Run tests
pytest

# Format code
ruff format src/

# Lint
ruff check src/

# Type check
mypy src/
```

### Building the Frontend

The editor frontend requires Node.js 18+:

```bash
cd src/loom/editor/frontend
npm install
npm run build
```

## License

MIT License - see [LICENSE](LICENSE) for details.

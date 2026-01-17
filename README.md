![Loom Banner](media/banner.svg)

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://loom-examples.onrender.com/)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](.github/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-coming%20soon-lightgrey)](docs/)
[![PyPI](https://img.shields.io/badge/pypi-coming%20soon-lightgrey)](https://pypi.org/)

A lightweight visual pipeline runner for research.

Connect your Python scripts into a graph, tweak parameters, run experiments, see results — without setting up Airflow or learning a workflow framework.

**[Try the live demo](https://loom-examples.onrender.com/)** — no installation required. Browse and run the [example pipelines](examples/) in your browser. (First load may take ~30s to wake up.)

**What it is:**
- A visual graph editor for your existing Python scripts
- A CLI runner with dependency tracking
- A way to organize experiments as YAML files you can version control
- Simple enough to install in any project's virtualenv

**What it isn't:**
- Not a replacement for Airflow/Kubeflow/Prefect (those are for production pipelines)
- Not an experiment tracker like W&B or MLflow (though it can be made to complement them)

## Installation

```bash
# Core runner only
pip install loom-pipeline

# With visual editor
pip install loom-pipeline[ui]
```

That's it. No services to start, no configuration files to create.

## Quick Start

### 1. Point it at your scripts

Say you have some Python scripts that process data:

```
tasks/
  extract_features.py    # Takes video, outputs CSV
  train_model.py         # Takes CSV, outputs model
  evaluate.py            # Takes model + test data, outputs metrics
```

### 2. Describe the pipeline in YAML

```yaml
# experiment.yml
variables:
  video: data/raw/recording.mp4
  features: data/processed/features.csv
  model: models/classifier.pt
  metrics: results/metrics.json

parameters:
  learning_rate: 0.001
  epochs: 100

pipeline:
  - name: extract
    task: tasks/extract_features.py
    inputs:
      video: $video
    outputs:
      -o: $features

  - name: train
    task: tasks/train_model.py
    inputs:
      data: $features
    outputs:
      -o: $model
    args:
      --lr: $learning_rate
      --epochs: $epochs

  - name: evaluate
    task: tasks/evaluate.py
    inputs:
      model: $model
    outputs:
      -o: $metrics
```

### 3. Run it

```bash
# Run the full pipeline
loom experiment.yml

# Run just one step
loom experiment.yml --step train

# Run from a step onward
loom experiment.yml --from train

# Try different parameters
loom experiment.yml --set learning_rate=0.01 epochs=200

# Preview without executing
loom experiment.yml --dry-run

# Clean all data (move to trash) and re-run from scratch
loom experiment.yml --clean
loom experiment.yml

# Preview what would be cleaned
loom experiment.yml --clean-list
```

### 4. Or use the visual editor

```bash
loom-ui experiment.yml
```

This opens a browser-based editor where you can:
- See your pipeline as a visual graph
- Drag and drop to reorganize
- Run individual steps and see output in real-time
- Quickly see which outputs exist (green) vs missing (grey)

You can also point it at a directory to browse multiple pipelines:

```bash
loom-ui experiments/    # Browse all pipelines in a folder
```

Be mindful in this case, the folders structure has to be with a directory named as the pipeline, with the pipeline file stored within named `pipeline.yml`. See [examples](examples/) as an example on how to organize your project.

## How Scripts Work

Your scripts stay normal Python with argparse. Just add a YAML block in the docstring so Loom knows the interface:

```python
"""Extract features from video.

---
inputs:
  video:
    type: video
    description: Input video file
outputs:
  -o:
    type: csv
    description: Output features
args:
  --sample-rate:
    type: int
    default: 30
    description: Frames to sample per second
---
"""

import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("--sample-rate", type=int, default=30)
    args = parser.parse_args()
    # ... your code ...

if __name__ == "__main__":
    main()
```

The YAML frontmatter is optional but enables the editor to show input/output types and provide better validation.

## Use Cases

**Parameter exploration**: Create parallel branches in your pipeline to test different configurations side by side.

**Reproducible experiments**: The YAML file captures your entire experiment setup. Commit it to git alongside your code.

**Iterative development**: Run just the steps you're working on. Loom tracks dependencies so upstream steps run only when needed.

**Result organization**: Variables point to file paths, so your outputs are organized by experiment configuration.

## Philosophy

Loom is intentionally minimal:

- **No database** — Everything is files: your scripts, YAML configs, and outputs
- **No server** — The editor runs locally and shuts down when you close it
- **No lock-in** — Your scripts work with or without Loom
- **No magic** — Loom just builds shell commands and runs them

This makes it easy to adopt incrementally. Start with one experiment, see if it helps, expand from there.

## License

MIT License — see [LICENSE](LICENSE) for details.

---

*Built for researchers who want to see their experiments, not manage infrastructure.*

# Loom

A lightweight visual pipeline runner for research.

Connect your Python scripts into a graph, tweak parameters, run experiments, see results — without setting up Airflow or learning a workflow framework. Just `pip install` into your project's virtualenv and go.

**What it is:**
- A visual graph editor for your existing Python scripts
- A CLI runner with dependency tracking
- A way to organize experiments as YAML files you can version control
- Simple enough to install in any project's virtualenv

**What it isn't:**
- Not a replacement for Airflow/Kubeflow/Prefect (those are for production pipelines)
- Not an experiment tracker like W&B or MLflow (though it complements them)
- Not a framework that requires you to rewrite your scripts

## Installation

```bash
# Core runner only
pip install loom

# With visual editor
pip install loom[ui]
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

## Documentation

- [examples/](examples/) — Working examples you can run immediately
- [TOOLS.md](docs/TOOLS.md) — Complete CLI reference and editor features
- [PIPELINE_AUTHORING.md](docs/PIPELINE_AUTHORING.md) — Guide to writing pipelines and task scripts

## Philosophy

Loom is intentionally minimal:

- **No database** — Everything is files: your scripts, YAML configs, and outputs
- **No server** — The editor runs locally and shuts down when you close it
- **No lock-in** — Your scripts work with or without Loom
- **No magic** — Loom just builds shell commands and runs them

This makes it easy to adopt incrementally. Start with one experiment, see if it helps, expand from there.

## Development

```bash
git clone https://github.com/your-username/loom.git
cd loom
pip install -e ".[dev]"

# Run tests
pytest

# Build frontend (requires Node.js 18+)
cd src/loom/ui/frontend
npm install && npm run build
```

## License

MIT License — see [LICENSE](LICENSE) for details.

---

*Built for researchers who want to see their experiments, not manage infrastructure.*

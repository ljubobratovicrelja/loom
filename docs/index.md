# Loom

![Loom Banner](assets/banner.svg)

A lightweight visual pipeline runner for research.

Connect your Python scripts into a graph, tweak parameters, run experiments, see results — without setting up Airflow or learning a workflow framework.

<div class="grid cards" markdown>

-   :material-play-circle:{ .lg .middle } **Try it now**

    ---

    [**Open the live demo**](https://loom-examples.onrender.com/) — no installation required. Browse and run example pipelines in your browser.

    First load may take ~30s to wake up.

-   :material-download:{ .lg .middle } **Install**

    ---

    ```bash
    pip install loom-pipeline[ui]
    ```

    Add to any project's virtualenv and start building pipelines.

</div>

## Overview

Loom gives you a CLI runner and visual editor for pipelines defined in YAML. Your scripts stay as regular Python with argparse — no framework to learn, no rewrites needed.

It's designed for research workflows. For production orchestration, tools like Airflow or Kubeflow are better suited.

## Philosophy

Loom is intentionally minimal:

- **No database** — Everything is files: your scripts, YAML configs, and outputs
- **No external services** — The visual editor runs a local server that stops when you close it
- **No lock-in** — Your scripts work with or without Loom
- **No magic** — Loom just builds shell commands and runs them

This makes it easy to adopt incrementally. Start with one experiment, see if it helps, expand from there.

## Quick Example

```yaml
# experiment.yml
variables:
  video: data/raw/recording.mp4
  features: data/processed/features.csv
  model: models/classifier.pt

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
```

```bash
# Run the full pipeline
loom experiment.yml

# Or open in the visual editor
loom-ui experiment.yml
```

## Next Steps

- [Installation](getting-started/installation.md) — Get Loom installed
- [Your First Pipeline](getting-started/first-pipeline.md) — Run your first pipeline
- [Tutorials](tutorials/index.md) — Learn through hands-on examples

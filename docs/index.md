# Loom

![Loom Banner](assets/banner.svg)

A lightweight visual pipeline runner for research.

Connect your Python scripts into a graph, tweak parameters, run experiments, see results — without setting up Airflow or learning a workflow framework. Just `pip install` into your project's virtualenv and go.

## What it is

- A visual graph editor for your existing Python scripts
- A CLI runner with dependency tracking
- A way to organize experiments as YAML files you can version control
- Simple enough to install in any project's virtualenv

## What it isn't

- Not a replacement for Airflow/Kubeflow/Prefect (those are for production pipelines)
- Not an experiment tracker like W&B or MLflow (though it complements them)
- Not a framework that requires you to rewrite your scripts

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

# Or use the visual editor
loom-ui experiment.yml
```

## Philosophy

Loom is intentionally minimal:

- **No database** — Everything is files: your scripts, YAML configs, and outputs
- **No server** — The editor runs locally and shuts down when you close it
- **No lock-in** — Your scripts work with or without Loom
- **No magic** — Loom just builds shell commands and runs them

This makes it easy to adopt incrementally. Start with one experiment, see if it helps, expand from there.

## Next Steps

- [Installation](getting-started/installation.md) — Get Loom installed
- [Your First Pipeline](getting-started/first-pipeline.md) — Run your first pipeline
- [Tutorials](tutorials/index.md) — Learn through hands-on examples

# Scientific Workflow

**What you'll learn:** A complete scientific workflow — data generation, analysis, and visualization.

![Curve Fitting Pipeline Screenshot](../assets/screenshots/curve-fitting.png)

## Pipeline Diagram

```
generate_data ──► raw_data.csv ──┬──► plot_raw ──► raw_plot.png
                                 │
                                 ├──► fit_curve ──► fit_params.json
                                 │                        │
                                 └────────────────────────┴──► plot_fit ──► fit_plot.png
```

This example demonstrates non-linear curve fitting with visualization — a common pattern in scientific computing.

## Prerequisites

This example requires additional Python packages:

```bash
pip install loom-pipeline[examples]
# or: pip install numpy scipy matplotlib
```

## Run the Example

```bash
cd examples/curve-fitting
loom pipeline.yml
```

Check the outputs:

```bash
ls data/
# raw_data.csv    - Synthetic noisy data
# raw_plot.png    - Scatter plot of raw data
# fit_params.json - Fitted model parameters
# fit_plot.png    - Data with fitted curve overlay
```

## The Model

The pipeline fits an exponential decay model:

```
y = a * exp(-b * x) + c
```

True parameters used for data generation: `a=5.0, b=0.3, c=1.0`

## Understanding the Pipeline

```yaml
data:
  raw_data:
    type: csv
    path: data/raw_data.csv
  raw_plot:
    type: image
    path: data/raw_plot.png
  fit_params:
    type: json
    path: data/fit_params.json
  fit_plot:
    type: image
    path: data/fit_plot.png

parameters:
  num_samples: 50
  noise_level: 0.5

pipeline:
  # Step 1: Generate synthetic data with noise
  - name: generate_data
    task: tasks/generate_data.py
    outputs:
      --output: $raw_data
    args:
      --samples: $num_samples
      --noise: $noise_level

  # Step 2: Plot the raw noisy data
  - name: plot_raw
    task: tasks/plot_data.py
    inputs:
      data: $raw_data
    outputs:
      --output: $raw_plot

  # Step 3: Fit exponential decay model
  - name: fit_curve
    task: tasks/fit_curve.py
    inputs:
      data: $raw_data
    outputs:
      --output: $fit_params

  # Step 4: Create comparison plot with fitted curve
  - name: plot_fit
    task: tasks/plot_fit.py
    inputs:
      data: $raw_data
      params: $fit_params
    outputs:
      --output: $fit_plot
```

## Workflow Stages

### 1. Data Generation

`generate_data` creates synthetic data from a known model with added Gaussian noise:

```bash
# Generated CSV contains x,y pairs
head data/raw_data.csv
```

### 2. Visualization

`plot_raw` creates a scatter plot of the noisy data.

### 3. Model Fitting

`fit_curve` uses scipy's `curve_fit` to estimate model parameters:

```bash
cat data/fit_params.json
# {"a": 5.02, "b": 0.31, "c": 0.98, ...}
```

### 4. Results Visualization

`plot_fit` overlays the fitted curve on the original data.

## Experiment with Parameters

```bash
# Less noise → better fit
loom pipeline.yml --set noise_level=0.1

# More noise → worse fit
loom pipeline.yml --set noise_level=1.0

# More data points
loom pipeline.yml --set num_samples=200
```

## Key Patterns

### Multiple Outputs from Same Data

One data node (`raw_data`) feeds three different consumers:

- `plot_raw` — visualization
- `fit_curve` — analysis
- `plot_fit` — combined visualization

### Dependency on Multiple Inputs

`plot_fit` needs both the raw data and the fitted parameters:

```yaml
- name: plot_fit
  inputs:
    data: $raw_data      # Original data points
    params: $fit_params  # Fitted model parameters
```

## Try It

```bash
# Preview what will run
loom pipeline.yml --dry-run

# Run just the fitting step
loom pipeline.yml --step fit_curve

# Open in visual editor
loom-ui pipeline.yml
```

## Key Takeaways

- Pipelines naturally express scientific workflows
- Same data can feed multiple analysis branches
- Parameters make experiments reproducible and tweakable
- Version control the YAML alongside your code

## What's Next?

- [CLI Reference](../reference/cli.md) — All command-line options
- [Pipeline Schema](../reference/pipeline-schema.md) — Full YAML reference
- [Task Scripts](../reference/task-scripts.md) — Writing compatible scripts

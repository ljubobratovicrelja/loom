# Pipeline Schema

Complete reference for pipeline YAML configuration.

## Overview

A pipeline file has three main sections:

```yaml
data:        # File paths (variables or typed data nodes)
parameters:  # Configuration values
pipeline:    # Processing steps
```

## Data Section

The `data` section defines files in your pipeline. You can use either simple variables or typed data nodes.

### Simple Variables

```yaml
variables:
  input_file: data/input.csv
  output_file: data/output.csv
```

Reference with `$`: `$input_file` → `data/input.csv`

### Typed Data Nodes

```yaml
data:
  training_video:
    type: video
    path: data/videos/training.mp4
    description: Main training video

  gaze_positions:
    type: csv
    path: data/tracking/gaze.csv
    description: Extracted gaze coordinates
```

#### Supported Types

| Type | Description | Typical Extensions |
|------|-------------|-------------------|
| `video` | Video file | .mp4, .avi, .mov |
| `image` | Single image | .png, .jpg, .jpeg |
| `csv` | CSV data file | .csv |
| `json` | JSON data file | .json |
| `txt` | Text file | .txt |
| `image_directory` | Directory of images | folder |
| `data_folder` | Generic data directory | folder |

Types enable connection validation in the visual editor.

### URL Data Sources

You can use HTTP/HTTPS URLs instead of local paths. URLs are automatically downloaded and cached locally.

```yaml
data:
  source_image:
    type: image
    path: https://example.com/images/photo.png
    description: Image from URL
```

**How it works:**

1. URLs are detected by `http://` or `https://` prefix
2. On first access, the URL is downloaded to `.loom-url-cache/` in the pipeline directory
3. Subsequent runs use the cached file (fast)
4. Use `loom clean` to clear the cache and re-download

**Example:**

```yaml
data:
  lena_image:
    type: image
    path: https://upload.wikimedia.org/wikipedia/en/7/7d/Lenna_%28test_image%29.png
    name: Lena (Source)
```

### Visual Representation

In the editor:

- **Green** = file exists on disk or URL is reachable
- **Grey** = file doesn't exist or URL is unreachable
- **Link icon** = path is a URL

## Parameters Section

Parameters hold configuration values that can be shared across steps.

```yaml
parameters:
  # Numbers
  threshold: 50.0
  batch_size: 32

  # Strings
  model_name: "gpt-4"
  output_format: csv

  # Booleans
  verbose: true
  debug_mode: false
```

### Using Parameters

Reference with `$` in the `args` section:

```yaml
pipeline:
  - name: process
    args:
      --threshold: $threshold  # Becomes --threshold 50.0
      --verbose: $verbose      # Becomes --verbose (if true)
```

### Runtime Overrides

Override parameters from the command line:

```bash
loom pipeline.yml --set threshold=25.0 batch_size=64
```

## Pipeline Section

The `pipeline` section defines processing steps.

### Step Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the step |
| `task` | Yes | Path to the Python script |
| `inputs` | No | Named inputs mapped to variables |
| `outputs` | No | Output flags mapped to variables |
| `args` | No | Additional command-line arguments |
| `optional` | No | If `true`, skipped unless `--include`d |

### Basic Step

```yaml
pipeline:
  - name: process_data
    task: tasks/process.py
    inputs:
      data: $input_file
    outputs:
      --output: $output_file
```

### Step with Arguments

```yaml
pipeline:
  - name: train_model
    task: tasks/train.py
    inputs:
      data: $training_data
    outputs:
      --model: $model_file
    args:
      --epochs: 100
      --learning-rate: $learning_rate
      --verbose: true
```

### Optional Step

```yaml
pipeline:
  - name: visualize
    task: tasks/visualize.py
    optional: true  # Skipped unless --include visualize
    inputs:
      data: $results
    outputs:
      --output: $chart
```

Run with: `loom pipeline.yml --include visualize`

## Command Generation

Steps become shell commands:

```yaml
- name: detect_fixations
  task: tasks/detect_fixations.py
  inputs:
    gaze_csv: $gaze_positions
  outputs:
    -o: $fixations_csv
  args:
    --algorithm: ivt
    --threshold: $velocity_threshold
```

Becomes:

```bash
python tasks/detect_fixations.py data/gaze.csv -o data/fixations.csv --algorithm ivt --threshold 50.0
```

### Argument Order

1. **Inputs** — positional arguments in order listed
2. **Outputs** — flag arguments (e.g., `-o value`)
3. **Args** — additional arguments

## Execution Order

Loom determines execution order from dependencies:

1. Steps with no input dependencies run first
2. A step runs after all steps producing its inputs complete
3. Optional steps are skipped unless explicitly included

## Complete Example

```yaml
data:
  # Inputs
  source_video:
    type: video
    path: data/raw/video.mp4

  # Intermediates
  gaze_csv:
    type: csv
    path: data/processed/gaze.csv

  fixations_csv:
    type: csv
    path: data/processed/fixations.csv

  # Outputs
  final_report:
    type: json
    path: data/output/report.json

  debug_video:
    type: video
    path: data/output/debug.mp4

parameters:
  threshold: 50.0
  algorithm: ivt
  debug: false

pipeline:
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: $source_video
    outputs:
      -o: $gaze_csv

  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze: $gaze_csv
    outputs:
      -o: $fixations_csv
    args:
      --algorithm: $algorithm
      --threshold: $threshold

  - name: generate_report
    task: tasks/report.py
    inputs:
      fixations: $fixations_csv
    outputs:
      -o: $final_report

  - name: visualize
    task: tasks/visualize.py
    optional: true
    inputs:
      video: $source_video
      fixations: $fixations_csv
    outputs:
      -o: $debug_video
```

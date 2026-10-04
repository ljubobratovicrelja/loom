# Pipeline Schema

Complete reference for pipeline YAML configuration.

## Overview

A pipeline file has these sections:

```yaml
data:        # File paths (simple strings or typed data nodes)
parameters:  # Configuration values
pipeline:    # Processing steps
execution:   # Optional: parallel execution settings
```

## Data Section

The `data` section defines files in your pipeline. Each entry can be a simple path string or a typed data node.

### Simple Paths

```yaml
data:
  input_file: data/input.csv
  output_file: data/output.csv
```

Reference with `$`: `$input_file` → `data/input.csv`

### Typed Data Nodes

For better editor validation, use typed entries:

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

### Output Containment

Data written by a step (any data node used as a step output) is **produced**
data and must live under the pipeline-owned output tree, `output/` by default:

```yaml
output_dir: output   # pipeline-owned tree for produced data (default: output)

data:
  report:
    type: json
    path: output/report.json
```

This matters for `--clean`: it removes produced paths **entirely**, including
directory shells, so an interrupted run cannot leave an empty directory that the
editor would read as produced data. Keeping outputs inside one owned tree means
cleaning can never delete unrelated files.

- A produced path that resolves **outside the pipeline directory** is a hard
  error: `loom` refuses to run, because cleaning it could destroy unrelated
  files.
- A produced path inside the project but **outside `output_dir`** is a warning;
  move it under `output_dir`.
- To intentionally write elsewhere (shared model dirs, absolute mounts), opt out
  per node:

```yaml
data:
  shared_model:
    type: data_folder
    path: /mnt/models/shared
    allow_outside_pipeline: true
```

Inputs you place yourself (source data, not produced by any step) are protected
from cleaning by default and may live anywhere.

### Nested Data (Files Inside a Produced Directory)

A step often produces a whole directory, and a later step needs one specific
file from inside it. Loom cannot tell that a lone file path belongs to a
directory another step writes, so the file node would otherwise float detached
from the DAG. Declare the relationship explicitly with `nested_in`:

```yaml
data:
  processed_dir:
    type: data_folder
    path: output/processed
  report:
    type: json
    path: report.json          # relative to the container
    nested_in: $processed_dir  # report.json lives inside output/processed/
```

- `nested_in` takes a `$data` reference to a container data node and may chain
  (a file inside a subdirectory inside a produced directory).
- When `nested_in` is set, `path` is resolved **relative to the container**
  (an absolute `path` is used as-is).
- The nested node **inherits the container's producer step**. That closes the
  gap: the consuming step now waits for the producing step, the file counts as
  produced data (so it is cleaned with the container and must live under
  `output/`), and the editor draws an explicit `⊂ inside` edge from the
  container to the file.
- If the container is source data (not produced by any step), `nested_in` is a
  purely visual ownership hint and adds no dependency.
- A nested path that resolves *outside* its declared container is an error.
- If a source file sits inside a produced directory without declaring
  `nested_in`, Loom emits a warning (editor and CLI) suggesting you add it, so
  the gap is surfaced even before it is fixed.

The editor renders the relation as a dashed `⊂ inside` edge, and the data node
shows a `⊂ $container` badge, so the containment is visible at a glance.

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
4. Use `loom pipeline.yml --clean` to clear the cache and re-download

**Example:**

```yaml
data:
  lena_image:
    type: image
    path: https://upload.wikimedia.org/wikipedia/en/7/7d/Lenna_%28test_image%29.png
    description: Lena test image
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
| `inputs` | No | Named inputs mapped to data entries |
| `outputs` | No | Output flags mapped to data entries |
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

### Group Block

Group related steps visually in the editor by wrapping them in a `group:` block:

```yaml
pipeline:
  - group: preprocessing
    steps:
      - name: preprocess
        task: tasks/preprocess.py
        outputs:
          --output: $clean_data

      - name: normalize
        task: tasks/normalize.py
        inputs:
          data: $clean_data
        outputs:
          --output: $normalized_data

  - name: train
    task: tasks/train.py
    inputs:
      data: $normalized_data
```

Groups are **purely visual** — they don't affect execution order, dependency resolution, or
parallelism. In loom-ui, each group is drawn as a colored rectangle behind its member nodes.

Grouped and ungrouped steps can be mixed freely in the same pipeline.

### Logic Nodes: Conditions and Switches

Step entries default to `kind: task` (a subprocess). Two additional kinds make
up loom's small **logic board** and let you branch without writing a control-flow
script:

- **`condition`** turns data (or a parameter) into a **boolean**.
- **`switch`** routes a data payload by a boolean.

```yaml
pipeline:
  - name: has_input
    kind: condition
    predicate: count          # built-in predicate (see below)
    inputs:
      data: $input_dir        # the value the predicate receives
    args:
      pattern: "*.txt"
      op: ">="
      n: $min_files

  - name: input_gate
    kind: switch
    condition: $has_input      # boolean ref: a condition node or a bool parameter
    data: $input_dir           # payload passed through

  - name: count_words
    task: tasks/count_words.py
    inputs:
      folder: $input_gate.then # runs only if the "then" branch is taken
    outputs:
      -o: $word_report

  - name: empty_report
    task: tasks/empty_report.py
    inputs:
      folder: $input_gate.else # runs only if the "else" branch is taken
    outputs:
      -o: $empty_report
```

Key points:

- A condition's output ref is the node's `name`; a switch's branch aliases are
  `$<switch>.then` and `$<switch>.else`.
- The branch that is not taken is **skipped**, not failed (it does not make the
  run fail).
- `else` is optional — omit the else-branch steps for an `if` without `else`.
- The switch's `condition` may reference a **boolean parameter** instead of a
  condition node, giving you a manual feature flag overridable with `--set`.
- There are no joins yet: if/else branches are disjoint.

#### Built-in Condition Predicates

| Predicate | True when |
|-----------|-----------|
| `exists` | the path exists |
| `is_file` / `is_dir` | the path is a file / directory |
| `non_empty` | a file has size, or a directory has at least one entry |
| `count` | files matching `pattern` satisfy `op` `n` (e.g. `>="`, `3`) |
| `param` | the input value is truthy (booleans, numbers, `true/false/yes/no`) |

Add `negate: true` to invert any condition.

#### Custom Conditions

A custom condition is a Python script authored like a task, with a `kind:
condition` frontmatter and an `evaluate()` function:

```python
"""Pass if the metrics file clears the threshold.

---
kind: condition
inputs:
  data: {type: json}
args:
  threshold: {type: float, default: 0.5}
---

def evaluate(data, threshold=0.5):
    import json
    return json.load(open(data))["score"] >= threshold
"""
```

Reference it from a condition node with `script: tasks/my_condition.py` instead
of `predicate:`.

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

## Execution Section

Configure how the pipeline runs:

```yaml
execution:
  parallel: true      # Enable parallel execution
  max_workers: 4      # Maximum concurrent steps (default: CPU count)
```

| Field | Default | Description |
|-------|---------|-------------|
| `parallel` | `false` | Enable parallel step execution |
| `max_workers` | CPU count | Maximum concurrent workers |

Override from command line:

```bash
loom pipeline.yml --parallel --max-workers 2
loom pipeline.yml --sequential  # Force sequential
```

## Execution Order

Loom determines execution order from dependencies:

1. Steps with no input dependencies run first
2. A step runs after all steps producing its inputs complete
3. Independent steps can run in parallel (if enabled)
4. Optional steps are skipped unless explicitly included

## Complete Example

```yaml
output_dir: output

data:
  # Inputs (source data you provide)
  source_video:
    type: video
    path: data/raw/video.mp4

  # Intermediates (produced)
  gaze_csv:
    type: csv
    path: output/gaze.csv

  fixations_csv:
    type: csv
    path: output/fixations.csv

  # Outputs (produced)
  final_report:
    type: json
    path: output/report.json

  debug_video:
    type: video
    path: output/debug.mp4

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

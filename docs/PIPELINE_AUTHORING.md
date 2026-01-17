# Pipeline Authoring Guide

How to connect Python scripts into pipelines. Covers the YAML schema, task script format, and common patterns.

## Table of Contents

- [Quick Start](#quick-start)
- [Pipeline Schema Reference](#pipeline-schema-reference)
  - [Variables](#variables)
  - [Parameters](#parameters)
  - [Data Nodes](#data-nodes)
  - [Pipeline Steps](#pipeline-steps)
- [Task Script Requirements](#task-script-requirements)
- [Building a Pipeline from Scripts](#building-a-pipeline-from-scripts)
- [Connection Rules](#connection-rules)
- [Examples](#examples)
- [Best Practices](#best-practices)

---

## Quick Start

A minimal pipeline has three sections:

```yaml
variables:
  input_file: data/input.csv
  output_file: data/output.csv

pipeline:
  - name: process_data
    task: tasks/process.py
    inputs:
      data: $input_file
    outputs:
      -o: $output_file
```

**Key concepts:**
- **Variables** hold file paths (inputs, outputs, intermediates)
- **Pipeline steps** are Python scripts that transform data
- `$variable_name` references a variable's value
- Connections between steps are implicit through shared variables

---

## Pipeline Schema Reference

### Variables

Variables represent file paths in your pipeline. They serve as connection points between steps.

```yaml
variables:
  # Input files (typically exist before pipeline runs)
  source_video: data/raw/video.mp4

  # Intermediate files (produced and consumed by steps)
  extracted_data: data/processed/extracted.csv

  # Output files (final results)
  final_report: data/output/report.csv
```

**Rules:**
- Variable names should be descriptive (`gaze_positions`, not `file1`)
- Paths are relative to the config file location
- Variables are referenced with `$` prefix: `$source_video`

**Visual representation in editor:**
- Green node = file exists on disk
- Grey node = file doesn't exist yet
- Variables can connect to step inputs or receive step outputs

### Parameters

Parameters are configuration values that can be shared across multiple steps.

```yaml
parameters:
  # Numeric parameters
  threshold: 50.0
  batch_size: 32

  # String parameters
  model_name: "gpt-4"
  output_format: csv

  # Boolean parameters
  verbose: true
  debug_mode: false
```

**Rules:**
- Parameters are also referenced with `$` prefix: `$threshold`
- Parameters can be numbers, strings, or booleans
- Unlike variables, parameters don't represent files
- Parameters are passed to step `args`, not `inputs`

**When to use parameters vs hardcoded values:**
- Use parameters when: the value might change between runs, or is shared by multiple steps
- Use hardcoded values when: the value is step-specific and unlikely to change

### Data Nodes

Data nodes are typed file/directory references with semantic meaning. They provide type validation for connections.

```yaml
data:
  training_video:
    type: video
    path: data/videos/training.mp4
    description: Main training video footage

  gaze_positions:
    type: csv
    path: data/tracking/gaze.csv
    description: Extracted gaze coordinates

  frame_images:
    type: image_directory
    path: data/frames/
    pattern: "*.png"
    description: Extracted video frames
```

**Supported types:**
| Type | Description | Typical Extensions |
|------|-------------|-------------------|
| `image` | Single image file | .png, .jpg, .jpeg |
| `video` | Video file | .mp4, .avi, .mov |
| `csv` | CSV data file | .csv |
| `json` | JSON data file | .json |
| `image_directory` | Directory of images | folder with images |
| `data_folder` | Generic data directory | any folder |

**Type validation:**
When connecting a data node to a step, the editor validates that the data type matches the step's declared input/output type (if specified in the task schema).

### Pipeline Steps

Steps are the processing units that transform data.

```yaml
pipeline:
  - name: extract_gaze           # Unique step identifier
    task: tasks/extract_gaze.py  # Path to Python script
    inputs:                       # Map input names to variable refs
      video: $source_video
    outputs:                      # Map output flags to variable refs
      -o: $gaze_csv
    args:                         # Additional arguments
      --threshold: $threshold
      --verbose: true
    optional: false               # If true, skipped by default
```

**Step fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the step |
| `task` | Yes | Path to the task script |
| `inputs` | No | Named inputs mapped to variables |
| `outputs` | No | Output flags mapped to variables |
| `args` | No | Additional command-line arguments |
| `optional` | No | If true, step is skipped unless explicitly included |

**How steps become commands:**

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

---

## Task Script Requirements

For a Python script to work as a pipeline task, it needs:

### 1. Frontmatter Schema

Define inputs, outputs, and arguments in a YAML block within the docstring:

```python
#!/usr/bin/env python3
"""Short description of what this task does.

Longer description with details about the algorithm,
expected inputs, and outputs.

---
inputs:
  video:
    type: video
    description: Path to input video file
  gaze_csv:
    type: csv
    description: Path to gaze positions CSV
outputs:
  -o:
    type: csv
    description: Output CSV file with results
args:
  --algorithm:
    type: str
    default: ivt
    choices: [ivt, idt]
    description: Detection algorithm to use
  --threshold:
    type: float
    default: 50.0
    description: Velocity threshold in pixels/frame
  --verbose:
    type: bool
    description: Enable verbose output
---
"""
```

### 2. Argparse Setup

The script must use argparse with arguments matching the frontmatter:

```python
import argparse

def main():
    parser = argparse.ArgumentParser()

    # Positional arguments for inputs (in order listed in frontmatter)
    parser.add_argument('video', help='Path to input video')
    parser.add_argument('gaze_csv', help='Path to gaze CSV')

    # Output flag
    parser.add_argument('-o', '--output', required=True, help='Output path')

    # Optional arguments
    parser.add_argument('--algorithm', default='ivt', choices=['ivt', 'idt'])
    parser.add_argument('--threshold', type=float, default=50.0)
    parser.add_argument('--verbose', action='store_true')

    args = parser.parse_args()
    # ... processing logic ...

if __name__ == '__main__':
    main()
```

### 3. Type Annotations (Optional but Recommended)

Adding types to inputs/outputs enables connection validation in the editor:

```yaml
inputs:
  video:
    type: video              # Validates connections from video data nodes
    description: Input video
outputs:
  -o:
    type: csv                # Validates connections to csv data nodes
    description: Output CSV
```

---

## Building a Pipeline from Scripts

### Step 1: Inventory Your Scripts

List all scripts and understand their inputs/outputs:

| Script | Inputs | Outputs | Purpose |
|--------|--------|---------|---------|
| `extract_gaze.py` | video | csv | Extract gaze positions |
| `detect_fixations.py` | csv | csv | Detect fixation events |
| `classify.py` | video, csv | csv | Classify fixations |

### Step 2: Identify Data Flow

Draw the data flow between scripts:

```
video.mp4 ──► extract_gaze ──► gaze.csv ──► detect_fixations ──► fixations.csv
                                   │                                   │
                                   └───────────► classify ◄────────────┘
                                                    │
                                                    ▼
                                              classified.csv
```

### Step 3: Define Variables

Create a variable for each unique file:

```yaml
variables:
  # Inputs
  video: data/videos/input.mp4

  # Intermediates
  gaze_csv: data/tracking/gaze.csv
  fixations_csv: data/tracking/fixations.csv

  # Outputs
  classified_csv: data/tracking/classified.csv
```

### Step 4: Define Steps

Map each script to a step, connecting via variables:

```yaml
pipeline:
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: $video
    outputs:
      -o: $gaze_csv

  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: $gaze_csv
    outputs:
      -o: $fixations_csv

  - name: classify
    task: tasks/classify.py
    inputs:
      video: $video
      fixations_csv: $fixations_csv
    outputs:
      -o: $classified_csv
```

### Step 5: Extract Shared Configuration

Identify values that might change or are shared:

```yaml
parameters:
  velocity_threshold: 50.0
  min_fixation_duration: 0.1
  classification_model: gpt-4

pipeline:
  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: $gaze_csv
    outputs:
      -o: $fixations_csv
    args:
      --velocity-threshold: $velocity_threshold
      --min-duration: $min_fixation_duration
```

---

## Connection Rules

### Valid Connections

| From | To | Valid? | Notes |
|------|----|--------|-------|
| Variable | Step input | Yes | Main data flow pattern |
| Step output | Variable | Yes | Step produces variable |
| Data node | Step input | Yes | With type validation |
| Step output | Data node | Yes | With type validation |
| Parameter | Step arg | Yes | Via drag-drop in editor |
| Variable | Variable | No | Use steps to transform |
| Data node | Data node | No | Not allowed |
| Parameter | Data node | No | Parameters are config, not data |

### Type Validation

When tasks have typed inputs/outputs, the editor validates connections:

```yaml
# Task schema
inputs:
  video:
    type: video
    description: Input video file

# Pipeline - VALID (types match)
data:
  source:
    type: video
    path: data/video.mp4

pipeline:
  - name: process
    inputs:
      video: $source  # video -> video: OK
```

```yaml
# Pipeline - INVALID (type mismatch)
data:
  source:
    type: csv        # csv type
    path: data/data.csv

pipeline:
  - name: process
    inputs:
      video: $source  # csv -> video: ERROR
```

### Dependency Resolution

Steps execute in dependency order based on variable connections:

1. Steps with no input dependencies run first
2. A step runs after all steps producing its inputs complete
3. Optional steps are skipped unless explicitly included

---

## Examples

### Example 1: Linear Pipeline

```yaml
# Simple A -> B -> C pipeline
variables:
  raw_data: data/raw.csv
  cleaned_data: data/cleaned.csv
  analyzed_data: data/analyzed.csv

pipeline:
  - name: clean
    task: tasks/clean_data.py
    inputs:
      data: $raw_data
    outputs:
      -o: $cleaned_data

  - name: analyze
    task: tasks/analyze.py
    inputs:
      data: $cleaned_data
    outputs:
      -o: $analyzed_data
```

### Example 2: Diamond Pipeline (Multiple Inputs)

```yaml
# A produces B and C, D consumes both
variables:
  source: data/source.mp4
  audio: data/audio.wav
  video_only: data/video_only.mp4
  combined: data/combined.mp4

pipeline:
  - name: extract_audio
    task: tasks/extract_audio.py
    inputs:
      video: $source
    outputs:
      -o: $audio

  - name: process_video
    task: tasks/process_video.py
    inputs:
      video: $source
    outputs:
      -o: $video_only

  - name: combine
    task: tasks/combine.py
    inputs:
      video: $video_only
      audio: $audio
    outputs:
      -o: $combined
```

### Example 3: With Parameters and Optional Steps

```yaml
variables:
  input_video: data/video.mp4
  gaze_csv: data/gaze.csv
  fixations_csv: data/fixations.csv
  debug_video: data/debug.mp4

parameters:
  threshold: 50.0
  algorithm: ivt
  debug: false

pipeline:
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: $input_video
    outputs:
      -o: $gaze_csv

  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: $gaze_csv
    outputs:
      -o: $fixations_csv
    args:
      --algorithm: $algorithm
      --threshold: $threshold

  - name: visualize
    task: tasks/visualize.py
    optional: true  # Only runs with --include visualize
    inputs:
      video: $input_video
      fixations: $fixations_csv
    outputs:
      -o: $debug_video
```

### Example 4: With Typed Data Nodes

```yaml
variables:
  intermediate_csv: data/temp.csv

data:
  source_video:
    type: video
    path: data/videos/input.mp4
    description: Source footage for analysis

  results:
    type: csv
    path: data/output/results.csv
    description: Final analysis results

parameters:
  model: gpt-4

pipeline:
  - name: extract
    task: tasks/extract.py
    inputs:
      video: $source_video
    outputs:
      -o: $intermediate_csv

  - name: analyze
    task: tasks/analyze.py
    inputs:
      data: $intermediate_csv
    outputs:
      -o: $results
    args:
      --model: $model
```

---

## Best Practices

### Naming Conventions

```yaml
# Variables: noun_noun format describing the data
variables:
  input_video: ...        # Good
  gaze_positions_csv: ... # Good
  file1: ...              # Bad - not descriptive

# Steps: verb or verb_noun format describing the action
pipeline:
  - name: extract_gaze    # Good
  - name: detect_fixations # Good
  - name: step1           # Bad - not descriptive

# Parameters: adjective_noun or noun format
parameters:
  velocity_threshold: ... # Good
  min_duration: ...       # Good
  x: ...                  # Bad - not descriptive
```

### Organization

1. **Group related variables** with comments
2. **Order steps** by execution dependency
3. **Extract shared values** to parameters
4. **Use optional steps** for debugging/visualization

```yaml
variables:
  # === Inputs ===
  source_video: data/raw/video.mp4

  # === Intermediates ===
  gaze_csv: data/processed/gaze.csv
  fixations_csv: data/processed/fixations.csv

  # === Outputs ===
  final_report: data/output/report.csv
  debug_video: data/output/debug.mp4

parameters:
  # === Processing Settings ===
  threshold: 50.0
  algorithm: ivt

  # === Model Settings ===
  model: gpt-4
  batch_size: 32
```

### Debugging Tips

1. **Add visualization steps** as optional for debugging
2. **Use intermediate variables** to inspect data flow
3. **Run individual steps** from the editor to isolate issues
4. **Check variable existence** (green = exists, grey = missing)

### Performance

1. **Avoid redundant computation** - reuse variables
2. **Use optional steps** for expensive debugging operations
3. **Run independent steps in parallel** via editor's parallel mode

---

## For AI Assistants

When asked to create or modify a pipeline:

1. **Understand the scripts first**: Read frontmatter to understand inputs, outputs, and args
2. **Map the data flow**: Identify which scripts produce data that others consume
3. **Create variables for all files**: Every unique file path needs a variable
4. **Connect steps through variables**: Use the same variable name for producer's output and consumer's input
5. **Extract shared configuration**: Values used by multiple steps become parameters
6. **Validate types**: If scripts have typed inputs/outputs, ensure data node types match

**Checklist for pipeline creation:**
- [ ] All input files have variables
- [ ] All output files have variables
- [ ] All intermediate files have variables
- [ ] Steps are connected via shared variables
- [ ] Shared configuration values are parameters
- [ ] Step names are unique and descriptive
- [ ] Optional steps are marked appropriately
- [ ] Data types match (if using typed data nodes)

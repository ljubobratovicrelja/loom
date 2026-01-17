# Branching (Diamond)

**What you'll learn:** Branching, merging, and handling multiple inputs.

![Diamond Pipeline Screenshot](../assets/screenshots/diamond.png)

## Pipeline Diagram

```
                ┌─► compute_stats ──► stats.json ───┐
load_data ──────┤                                   ├──► merge_results
                └─► filter_outliers ──► clean.csv ──┘
```

This "diamond" pattern is common when you need to process the same data in different ways, then combine the results.

## Run the Example

```bash
cd examples/diamond
loom pipeline.yml
```

Check the outputs:

```bash
cat data/validated.csv      # Input after validation
cat data/stats.json         # Statistics (path A)
cat data/clean.csv          # Outliers removed (path B)
cat data/final_report.json  # Combined results
```

## Understanding the Pipeline

```yaml
data:
  raw_csv:
    type: csv
    path: data/raw.csv
  validated_csv:
    type: csv
    path: data/validated.csv
  stats_json:
    type: json
    path: data/stats.json
  clean_csv:
    type: csv
    path: data/clean.csv
  final_report:
    type: json
    path: data/final_report.json

parameters:
  outlier_threshold: 1.5

pipeline:
  - name: load_data
    task: tasks/load_data.py
    inputs:
      raw: $raw_csv
    outputs:
      --output: $validated_csv

  # Path A: compute statistics
  - name: compute_stats
    task: tasks/compute_stats.py
    inputs:
      data: $validated_csv
    outputs:
      --output: $stats_json

  # Path B: filter outliers
  - name: filter_outliers
    task: tasks/filter_outliers.py
    inputs:
      data: $validated_csv
    outputs:
      --output: $clean_csv
    args:
      --threshold: $outlier_threshold

  # Merge both paths
  - name: merge_results
    task: tasks/merge_results.py
    inputs:
      stats: $stats_json
      clean_data: $clean_csv
    outputs:
      --output: $final_report
```

## Key Concepts

### Branching

One data node can feed multiple steps:

```yaml
# Both steps read from $validated_csv
- name: compute_stats
  inputs:
    data: $validated_csv

- name: filter_outliers
  inputs:
    data: $validated_csv
```

### Merging

A step can accept multiple inputs:

```yaml
- name: merge_results
  inputs:
    stats: $stats_json        # From compute_stats
    clean_data: $clean_csv    # From filter_outliers
```

### Execution Order

Loom handles dependencies automatically:

1. `load_data` runs first (no dependencies)
2. `compute_stats` and `filter_outliers` can run after `load_data`
3. `merge_results` waits for both paths to complete

## Try It

```bash
# Run from a specific step
loom pipeline.yml --from filter_outliers

# See the diamond shape in the editor
loom-ui pipeline.yml
```

## Key Takeaways

- **One output** can feed **multiple steps** (branching)
- **One step** can consume **multiple inputs** (merging)
- Loom resolves dependencies automatically

## Next Tutorial

[Using Parameters →](parameters.md) — Learn how to configure pipelines with parameters.

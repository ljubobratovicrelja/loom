# Parallel Execution

**What you'll learn:** Running the same task with different configurations to compare results.

![Parallel Pipeline Screenshot](../assets/screenshots/parallel.png)

## Pipeline Diagram

```
                    ┌─► process (low)  ─► results_low.json  ──┐
generate_data ──────┼─► process (mid)  ─► results_mid.json  ──┼─► compare_results
                    └─► process (high) ─► results_high.json ──┘
```

This pattern is common for hyperparameter search: generate data once, process with different settings, then compare.

## Run the Example

```bash
cd examples/parallel
loom pipeline.yml
```

Check the outputs:

```bash
cat data/dataset.csv        # Generated data
cat data/results_low.json   # Threshold 0.3
cat data/results_mid.json   # Threshold 0.5
cat data/results_high.json  # Threshold 0.7
cat data/comparison.json    # Side-by-side comparison
```

## Understanding the Pipeline

```yaml
data:
  dataset:
    type: csv
    path: data/dataset.csv
  results_low:
    type: json
    path: data/results_low.json
  results_mid:
    type: json
    path: data/results_mid.json
  results_high:
    type: json
    path: data/results_high.json
  comparison:
    type: json
    path: data/comparison.json

parameters:
  num_samples: 500
  threshold_low: 0.3
  threshold_mid: 0.5
  threshold_high: 0.7

pipeline:
  - name: generate_data
    task: tasks/generate_data.py
    outputs:
      --output: $dataset
    args:
      --samples: $num_samples

  - name: process_config_low
    task: tasks/process.py
    inputs:
      data: $dataset
    outputs:
      --output: $results_low
    args:
      --threshold: $threshold_low
      --config-name: low

  - name: process_config_mid
    task: tasks/process.py
    inputs:
      data: $dataset
    outputs:
      --output: $results_mid
    args:
      --threshold: $threshold_mid
      --config-name: mid

  - name: process_config_high
    task: tasks/process.py
    inputs:
      data: $dataset
    outputs:
      --output: $results_high
    args:
      --threshold: $threshold_high
      --config-name: high

  - name: compare_results
    task: tasks/compare_results.py
    inputs:
      result_low: $results_low
      result_mid: $results_mid
      result_high: $results_high
    outputs:
      --output: $comparison
```

## Key Concepts

### Same Task, Different Configs

The three `process_config_*` steps use the **same task script** but with different parameters:

```yaml
# All three use tasks/process.py
- name: process_config_low
  task: tasks/process.py
  args:
    --threshold: $threshold_low  # 0.3

- name: process_config_mid
  task: tasks/process.py
  args:
    --threshold: $threshold_mid  # 0.5

- name: process_config_high
  task: tasks/process.py
  args:
    --threshold: $threshold_high # 0.7
```

### Each Branch Has Its Own Output

Each configuration writes to a different file:

```yaml
- name: process_config_low
  outputs:
    --output: $results_low  # data/results_low.json

- name: process_config_mid
  outputs:
    --output: $results_mid  # data/results_mid.json
```

### Aggregation Step

The final step collects all results:

```yaml
- name: compare_results
  inputs:
    result_low: $results_low
    result_mid: $results_mid
    result_high: $results_high
```

## The Hyperparameter Search Pattern

1. **One input source** feeds **multiple processing branches**
2. Each branch has **different parameters** but the **same task**
3. Results are **aggregated** for comparison

Use this for:

- Trying different model hyperparameters
- Comparing algorithm variants
- A/B testing processing approaches

## Extending the Pattern

To add another configuration:

1. Add a new data node for the output
2. Copy a `process_config_*` step and change the threshold
3. Add the new result to `compare_results` inputs

## Try It

```bash
# Run just one configuration
loom pipeline.yml --step process_config_low

# See the parallel structure in the editor
loom-ui pipeline.yml
```

## Key Takeaways

- Use the **same task** with different parameters for comparison
- Each branch needs its own **output data node**
- An **aggregation step** collects results for analysis

## Next Tutorial

[Optional Steps →](optional-steps.md) — Add debug and visualization steps that run only when needed.

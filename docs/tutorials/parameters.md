# Using Parameters

**What you'll learn:** Configuration values and runtime overrides with `--set`.

![Parameters Pipeline Screenshot](../assets/screenshots/parameters.png)

## Pipeline Diagram

```
generate_signal → signal.csv → smooth_signal → smoothed.csv → detect_peaks → peaks.json
```

## Run the Example

```bash
cd examples/parameters
loom pipeline.yml
```

Check the outputs:

```bash
cat data/signal.csv     # Raw noisy signal
cat data/smoothed.csv   # After smoothing
cat data/peaks.json     # Detected peaks
```

## Understanding the Pipeline

```yaml
data:
  signal_csv:
    type: csv
    path: data/signal.csv
  smoothed_csv:
    type: csv
    path: data/smoothed.csv
  peaks_json:
    type: json
    path: data/peaks.json

parameters:
  # Signal generation
  num_points: 200
  noise_level: 0.2
  frequency: 2.0

  # Processing
  window_size: 5
  threshold: 0.3

pipeline:
  - name: generate_signal
    task: tasks/generate_signal.py
    outputs:
      --output: $signal_csv
    args:
      --points: $num_points
      --noise: $noise_level
      --frequency: $frequency

  - name: smooth_signal
    task: tasks/smooth_signal.py
    inputs:
      signal: $signal_csv
    outputs:
      --output: $smoothed_csv
    args:
      --window: $window_size

  - name: detect_peaks
    task: tasks/detect_peaks.py
    inputs:
      signal: $smoothed_csv
    outputs:
      --output: $peaks_json
    args:
      --threshold: $threshold
```

## Key Concepts

### Parameters vs Data Nodes

| | Parameters | Data Nodes |
|--|-----------|------------|
| What they hold | Configuration values | File paths |
| Where used | `args` section | `inputs`/`outputs` sections |
| Examples | thresholds, counts, flags | CSVs, images, models |

### Defining Parameters

```yaml
parameters:
  num_points: 200      # Number
  noise_level: 0.2     # Float
  model_name: "gpt-4"  # String
  verbose: true        # Boolean
```

### Using Parameters

Reference them with `$` in the `args` section:

```yaml
- name: generate_signal
  args:
    --points: $num_points    # Becomes --points 200
    --noise: $noise_level    # Becomes --noise 0.2
```

### Runtime Overrides

Override any parameter from the command line:

```bash
# Change one parameter
loom pipeline.yml --set threshold=0.5

# Change multiple parameters
loom pipeline.yml --set window_size=10 threshold=0.5

# Different noise level
loom pipeline.yml --set noise_level=0.5
```

## Try It

```bash
# Preview with different parameters
loom pipeline.yml --set window_size=20 --dry-run

# Run with high noise, different threshold
loom pipeline.yml --set noise_level=0.5 threshold=0.4

# Open in editor
loom-ui pipeline.yml
```

## When to Use Parameters

Use **parameters** when:

- The value might change between runs
- Multiple steps share the same value
- You want to experiment with different settings

Use **hardcoded values** when:

- The value is specific to one step
- It's unlikely to change

## Key Takeaways

- **Parameters** are configuration values (numbers, strings, booleans)
- Reference with `$` in the `args` section
- Override at runtime with `--set key=value`
- Keep parameters for values you'll want to tweak

## Next Tutorial

[Parallel Execution →](parallel.md) — Run the same task with different configurations.

# Optional Steps

**What you'll learn:** Conditional execution with `optional: true` and `--include`.

![Optional Steps Pipeline Screenshot](../assets/screenshots/optional-steps.png)

## Pipeline Diagram

```
generate_text → load_text → word_frequency → top_words ──┬──► [export_debug] (optional)
                                                         └──► [visualize] (optional)
```

Optional steps are perfect for debugging and visualization that you don't always need.

## Run the Example

```bash
cd examples/optional_steps
loom pipeline.yml
```

By default, optional steps are skipped:

```
[RUNNING] generate_text
[SUCCESS] generate_text
[RUNNING] load_text
[SUCCESS] load_text
[RUNNING] word_frequency
[SUCCESS] word_frequency
[RUNNING] top_words
[SUCCESS] top_words
# Note: export_debug and visualize skipped
```

## Include Optional Steps

```bash
# Include the debug export
loom pipeline.yml --include export_debug
cat data/debug_dump.txt

# Include visualization
loom pipeline.yml --include visualize
cat data/chart.txt

# Include both
loom pipeline.yml --include export_debug --include visualize
```

## Understanding the Pipeline

```yaml
data:
  input_txt:
    type: txt
    path: data/sample.txt
  frequencies_json:
    type: json
    path: data/frequencies.json
  top_words_json:
    type: json
    path: data/top_words.json
  debug_dump:
    type: txt
    path: data/debug_dump.txt
  chart_txt:
    type: txt
    path: data/chart.txt

parameters:
  top_n: 10

pipeline:
  - name: load_text
    task: tasks/load_text.py
    inputs:
      text: $input_txt
    outputs:
      --output: $normalized_txt

  - name: word_frequency
    task: tasks/word_frequency.py
    inputs:
      text: $normalized_txt
    outputs:
      --output: $frequencies_json

  - name: top_words
    task: tasks/top_words.py
    inputs:
      frequencies: $frequencies_json
    outputs:
      --output: $top_words_json
    args:
      --top: $top_n

  # Optional: detailed debug output
  - name: export_debug
    task: tasks/export_debug.py
    optional: true
    inputs:
      frequencies: $frequencies_json
    outputs:
      --output: $debug_dump

  # Optional: ASCII visualization
  - name: visualize
    task: tasks/visualize.py
    optional: true
    inputs:
      top_words: $top_words_json
    outputs:
      --output: $chart_txt
```

## Key Concepts

### Marking Steps Optional

Add `optional: true` to skip a step by default:

```yaml
- name: export_debug
  task: tasks/export_debug.py
  optional: true  # Skipped unless explicitly included
  inputs:
    frequencies: $frequencies_json
```

### Including Optional Steps

Use `--include` to run optional steps:

```bash
loom pipeline.yml --include export_debug
loom pipeline.yml --include visualize
loom pipeline.yml --include export_debug --include visualize
```

### Visual Indicator

In the visual editor, optional steps are shown with dashed borders to distinguish them from regular steps.

## When to Use Optional Steps

Good candidates for optional steps:

- **Debug output** — Detailed logs or data dumps
- **Visualization** — Charts, plots, previews
- **Validation** — Extra checks for debugging
- **Expensive operations** — Resource-intensive steps you don't always need

## Try It

```bash
# Run main pipeline only
loom pipeline.yml

# Add debugging
loom pipeline.yml --include export_debug

# See optional steps in the editor (dashed borders)
loom-ui pipeline.yml
```

## Key Takeaways

- `optional: true` skips a step by default
- `--include <step_name>` runs the optional step
- Use for debugging, visualization, and expensive operations

## Next Tutorial

[Scientific Workflow →](curve-fitting.md) — A complete scientific workflow example.

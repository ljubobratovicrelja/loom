# Multi-Pass Refinement

Repeat the same steps across multiple passes with different parameters, where
each pass's output chains into the next pass's input.

```
generate_signal
      |
      v
[ refine                                                       ]
[ smooth_coarse -> filter_coarse -> smooth_medium -> filter_medium -> smooth_fine -> filter_fine ]
      |
      v
  summarize
```

## What It Does

`multi_pass` is a group-level construct that expands a set of template steps
into concrete per-pass steps at parse time. Each pass can override parameters
and chain outputs from the previous pass as inputs to the next.

This example generates a noisy signal and then applies three refinement passes
with progressively tighter filtering:

| Pass | Window Size | Threshold |
|------|-------------|-----------|
| Coarse | 20 | 5.0 |
| Medium | 10 | 2.0 |
| Fine | 5 | 1.0 |

Each pass smooths the signal and filters outliers. The `chain:` section
connects `filter_signal`'s output to `smooth_signal`'s warm-start input in
the next pass, so each pass refines the previous pass's output.

## Run It

```bash
# Run from the command line
loom pipeline.yml

# Open in the visual editor to see the expanded passes
loom-ui pipeline.yml
```

## The Multi-Pass Block

```yaml
pipeline:
  - group: refine
    multi_pass:
      passes:
        - name: coarse
          params:
            window_size: 20
            threshold: 5.0
        - name: medium
          params:
            window_size: 10
            threshold: 2.0
        - name: fine
          params:
            window_size: 5
            threshold: 1.0
      chain:
        filter_signal.--output: smooth_signal.--warm-start
    steps:
      - name: smooth_signal
        task: tasks/smooth_signal.py
        inputs:
          input_csv: $input_signal
        outputs:
          --output: $smoothed_signal
        args:
          --window-size: $window_size

      - name: filter_signal
        task: tasks/filter_signal.py
        inputs:
          input_csv: $smoothed_signal
        outputs:
          --output: $cleaned_signal
        args:
          --threshold: $threshold
```

## Key Concepts

- **`passes:`** — Ordered list of passes, each with a `name` and `params` that
  shadow global parameters for that pass.
- **`chain:`** — Maps an output flag of one step to an input flag of another step.
  For pass N+1, the chained input receives the path from pass N's output. The
  first pass does not receive chained inputs.
- **Data suffixing** — Output variables are automatically suffixed with the pass
  name (e.g., `$smoothed_signal` becomes `results/smoothed_coarse.csv`,
  `results/smoothed_medium.csv`, `results/smoothed_fine.csv`).
- **Last-pass alias** — The unsuffixed variable (`$cleaned_signal`) points to
  the last pass's output, so downstream steps (like `summarize`) don't need
  to know about passes.

## How It Expands

The `multi_pass` block is expanded at parse time into concrete flat steps:

| Expanded Step | Pass | Group |
|---------------|------|-------|
| `smooth_signal_coarse` | coarse | refine |
| `filter_signal_coarse` | coarse | refine |
| `smooth_signal_medium` | medium | refine |
| `filter_signal_medium` | medium | refine |
| `smooth_signal_fine` | fine | refine |
| `filter_signal_fine` | fine | refine |

In loom-ui, all expanded steps appear inside the `refine` group bounding box
with their suffixed data nodes and chain edges visible.

## Files

- `pipeline.yml` — Pipeline with `multi_pass:` group
- `tasks/generate_signal.py` — Generates a noisy test signal
- `tasks/smooth_signal.py` — Applies moving average smoothing
- `tasks/filter_signal.py` — Filters outliers and produces a cleaned CSV
- `tasks/summarize.py` — Prints summary statistics of the final cleaned signal

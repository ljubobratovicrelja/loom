# Parallel Pipeline (Hyperparameter Search)

Running the same processing with different parameter configurations to compare results.

```
                    ┌─► process (config A) ─► results_a.json ──┐
generate_data ──────┼─► process (config B) ─► results_b.json ──┼─► compare_results
                    └─► process (config C) ─► results_c.json ──┘
```

## What It Does

This pattern is common in research: generate data once, then run the same analysis with different hyperparameters to find the best configuration.

1. **generate_data**: Creates synthetic classification data
2. **process_config_a/b/c**: Three parallel runs with different thresholds
3. **compare_results**: Aggregates all results into a comparison table

Each "process" step uses a different threshold parameter, producing separate outputs.

## Run It

```bash
# Run full pipeline (all three configs run in parallel)
loom-runner pipeline.yml

# Check outputs
cat data/dataset.csv           # Generated data
cat data/results_low.json      # Threshold 0.3
cat data/results_mid.json      # Threshold 0.5
cat data/results_high.json     # Threshold 0.7
cat data/comparison.json       # Side-by-side comparison

# Run just one configuration branch
loom-runner pipeline.yml --step process_config_low

# Open in editor to see the parallel structure
loom-editor pipeline.yml
```

## Pattern: Hyperparameter Search

The key pattern here is:
1. **One input source** feeds **multiple processing branches**
2. Each branch has **different parameters** but the **same task script**
3. Results are **aggregated** at the end for comparison

This is useful for:
- Trying different model hyperparameters
- Comparing algorithm variants
- A/B testing processing approaches

## Extending This Pattern

To add more configurations:
1. Add a new variable for the output: `results_d: data/results_d.json`
2. Copy one of the `process_config_*` steps, rename it, change the threshold
3. Add the new result to `compare_results` inputs

## Files

- `pipeline.yml` — Pipeline with parallel branches
- `tasks/generate_data.py` — Creates synthetic data
- `tasks/process.py` — Classifies data with configurable threshold
- `tasks/compare_results.py` — Aggregates results for comparison

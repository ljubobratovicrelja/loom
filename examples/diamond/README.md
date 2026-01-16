# Diamond Pipeline

![screenshot](media/screenshot.png)

Branching and merging: one input feeds two parallel processing paths that combine at the end.

```
                ┌─► compute_stats ──► stats.json ───┐
load_data ──────┤                                   ├──► merge_results
                └─► filter_outliers ──► clean.csv ──┘
```

## What It Does

1. **load_data**: Reads raw measurements and validates the format
2. **compute_stats**: Calculates statistics on the raw data (parallel path A)
3. **filter_outliers**: Removes outliers from the data (parallel path B)
4. **merge_results**: Combines stats with cleaned data into a final report

This pattern is common when you need to both analyze and clean data, then combine the results.

## Run It

```bash
# Full pipeline (parallel steps run in dependency order)
loom pipeline.yml

# Check the outputs
cat data/raw.csv           # Input data
cat data/validated.csv     # After validation
cat data/stats.json        # Statistics (path A)
cat data/clean.csv         # Outliers removed (path B)
cat data/final_report.json # Combined results

# Run from a specific step
loom pipeline.yml --from filter_outliers

# Open in editor to see the diamond shape
loom-ui pipeline.yml
```

## Files

- `pipeline.yml` — Pipeline configuration
- `tasks/load_data.py` — Validates and loads raw CSV
- `tasks/compute_stats.py` — Computes statistics
- `tasks/filter_outliers.py` — Removes outliers using IQR method
- `tasks/merge_results.py` — Combines stats and clean data
- `data/raw.csv` — Input data with some outliers

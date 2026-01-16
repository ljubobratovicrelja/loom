# Linear Pipeline

The simplest pipeline pattern: A → B → C.

```
generate_data → compute_stats → format_report
```

## What It Does

1. **generate_data**: Creates a CSV with random sensor readings (timestamp, temperature, humidity)
2. **compute_stats**: Calculates min, max, mean for each column
3. **format_report**: Converts stats to a human-readable text report

## Run It

```bash
# Full pipeline
loom pipeline.yml

# Check the outputs
cat data/readings.csv      # Raw generated data
cat data/stats.json        # Computed statistics
cat data/report.txt        # Final report

# Run just one step
loom pipeline.yml --step compute_stats

# Open in editor
loom-ui pipeline.yml
```

## Files

- `pipeline.yml` — Pipeline configuration
- `tasks/generate_data.py` — Generates synthetic sensor data
- `tasks/compute_stats.py` — Computes statistics from CSV
- `tasks/format_report.py` — Formats stats as text report
- `data/` — Input/output directory

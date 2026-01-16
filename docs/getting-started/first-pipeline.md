# Your First Pipeline

Let's run an example pipeline to see Loom in action.

## Run the Linear Example

Loom comes with example pipelines. Run the simplest one:

```bash
loom examples/linear/pipeline.yml
```

You should see output like:

```
[RUNNING] generate_data
[SUCCESS] generate_data
[RUNNING] compute_stats
[SUCCESS] compute_stats
[RUNNING] format_report
[SUCCESS] format_report
```

## What Just Happened?

The pipeline executed three steps in sequence:

```
generate_data → compute_stats → format_report
```

1. **generate_data** — Created a CSV with random sensor readings
2. **compute_stats** — Calculated statistics (min, max, mean)
3. **format_report** — Converted stats to a human-readable report

## Check the Outputs

```bash
cat examples/linear/data/readings.csv   # Raw data
cat examples/linear/data/stats.json     # Statistics
cat examples/linear/data/report.txt     # Final report
```

## Open in the Visual Editor

Now let's see the same pipeline visually:

```bash
loom-ui examples/linear/pipeline.yml
```

This opens a browser window where you can:

- See your pipeline as a visual graph
- Click nodes to view their properties
- Run individual steps by clicking the play button
- See output in the terminal panel at the bottom

## Useful Commands

```bash
# Preview without executing
loom examples/linear/pipeline.yml --dry-run

# Run just one step
loom examples/linear/pipeline.yml --step compute_stats

# Run from a step onward
loom examples/linear/pipeline.yml --from compute_stats

# Clean outputs and re-run
loom examples/linear/pipeline.yml --clean -y
loom examples/linear/pipeline.yml
```

## Browse All Examples

Open the visual editor in workspace mode to browse all examples:

```bash
loom-ui examples/
```

A pipeline browser appears in the sidebar — double-click to switch between pipelines.

## Next Steps

- [Tutorials](../tutorials/index.md) — Learn Loom concepts through hands-on examples
- [CLI Commands](../reference/cli.md) — Full CLI reference

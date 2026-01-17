# Optional Steps Example

![screenshot](media/screenshot.png)

Using optional steps for debug output and visualization that you don't always need.

## What It Does

A text processing pipeline that:
1. **load_text**: Reads input text file
2. **word_frequency**: Counts word occurrences
3. **top_words**: Extracts most common words
4. **export_debug** (optional): Dumps full frequency data for debugging
5. **visualize** (optional): Creates ASCII bar chart of top words

Optional steps are skipped by default but can be included with `--include`.

## Run It

```bash
# Run main pipeline (skips optional steps)
loom pipeline.yml

# Check outputs
cat data/frequencies.json    # Word counts
cat data/top_words.json      # Top 10 words

# Include the debug export
loom pipeline.yml --include export_debug
cat data/debug_dump.txt

# Include visualization
loom pipeline.yml --include visualize
cat data/chart.txt

# Include both optional steps
loom pipeline.yml --include export_debug --include visualize

# Open in editor (optional steps shown with dashed borders)
loom-ui pipeline.yml
```

## Files

- `pipeline.yml` — Pipeline with optional steps marked
- `tasks/load_text.py` — Loads and normalizes text
- `tasks/word_frequency.py` — Counts word occurrences
- `tasks/top_words.py` — Extracts top N words
- `tasks/export_debug.py` — (Optional) Full debug dump
- `tasks/visualize.py` — (Optional) ASCII bar chart
- `data/sample.txt` — Sample input text

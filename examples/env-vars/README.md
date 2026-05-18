# Environment Variables

Make a pipeline portable across machines by referencing the system environment
instead of hard-coding paths.

```
generate_signal → compute_stats
```

## Syntax

- `${ENV_VAR}` — substituted from the process environment. May be embedded
  anywhere in a string and used multiple times
  (`${SCRATCH}/loom-out/${RUN_ID}/stats.json`).
- `$name` — unchanged: an exact-match reference to a `data` node or
  `parameter`. A data-node path may itself contain `${ENV_VAR}` (composition).
- Names follow POSIX rules: `[A-Za-z_][A-Za-z0-9_]*`.
- An unset variable fails fast with an error naming the variable and where it
  was referenced — no subprocess is started.

## Required Environment Variables

| Variable    | Used for                                  |
|-------------|-------------------------------------------|
| `DATA_ROOT` | Root for the input signal CSV             |
| `SCRATCH`   | Root for pipeline outputs                 |
| `RUN_ID`    | Per-run output subdirectory and a step arg |

## Run It

```bash
DATA_ROOT=/tmp/loom SCRATCH=/tmp RUN_ID=r1 loom pipeline.yml

# Preview expanded commands without executing
DATA_ROOT=/tmp/loom SCRATCH=/tmp RUN_ID=r1 loom pipeline.yml --dry-run

# Missing a variable → fails fast, nothing runs
SCRATCH=/tmp RUN_ID=r1 loom pipeline.yml
# environment variable 'DATA_ROOT' is not set (referenced in data node 'signal_csv')
```

## Files

- `pipeline.yml` — Pipeline configuration using `${ENV_VAR}` references
- `tasks/generate_data.py` — Generates a synthetic signal CSV
- `tasks/compute_stats.py` — Computes summary statistics

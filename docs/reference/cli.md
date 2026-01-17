# CLI Commands

Reference for `loom` and `loom-ui` command-line tools.

## loom

The headless pipeline runner for batch execution and automation.

### Basic Usage

```bash
# Run full pipeline
loom pipeline.yml

# Preview commands without executing
loom pipeline.yml --dry-run
```

### Command Reference

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview commands without executing |
| `--step NAME [NAME ...]` | Run specific step(s) only |
| `--from NAME` | Run from a step onward (includes all subsequent steps) |
| `--include NAME` | Include optional step(s) |
| `--set KEY=VALUE [...]` | Override parameter values |
| `--var KEY=VALUE [...]` | Override variable values |
| `--extra "ARGS"` | Pass extra arguments to a step |
| `--clean` | Move all output data to trash before running |
| `--clean-list` | List files that would be cleaned (without deleting) |
| `-y, --yes` | Skip confirmation prompts |

### Examples

```bash
# Run full pipeline
loom pipeline.yml

# Preview without executing
loom pipeline.yml --dry-run

# Run specific steps
loom pipeline.yml --step extract classify

# Run from a step onward
loom pipeline.yml --from classify

# Include optional steps
loom pipeline.yml --include debug_visualize

# Override parameters
loom pipeline.yml --set backend=local threshold=25.0

# Override variables
loom pipeline.yml --var video=other.mp4

# Pass extra arguments to a step
loom pipeline.yml --step extract --extra "--debug --verbose"

# Clean all data and re-run
loom pipeline.yml --clean -y
loom pipeline.yml

# Preview what would be cleaned
loom pipeline.yml --clean-list
```

## loom-ui

The visual editor for building and running pipelines interactively.

### Basic Usage

```bash
# Open a pipeline
loom-ui pipeline.yml

# Browse pipelines in a directory
loom-ui experiments/

# Create a new pipeline
loom-ui --new
```

### Command Reference

| Option | Description |
|--------|-------------|
| `--port PORT` | Server port (default: 8000) |
| `--host HOST` | Server host (default: 127.0.0.1) |
| `--no-browser` | Don't auto-open browser |
| `--new` | Create a new empty pipeline |
| `--tasks-dir DIR` | Custom tasks directory |

### Examples

```bash
# Open existing pipeline
loom-ui pipeline.yml

# Browse all pipelines in a folder
loom-ui experiments/

# Custom port and host
loom-ui pipeline.yml --port 8080 --host 0.0.0.0

# Headless mode (no auto-open)
loom-ui pipeline.yml --no-browser

# Create new pipeline
loom-ui --new
```

### Workspace Mode

When pointing `loom-ui` at a directory, it enters **workspace mode**:

```bash
loom-ui experiments/
```

A pipeline browser appears in the sidebar, letting you:

- Browse all `.yml` pipelines in the directory
- Double-click to switch between pipelines
- Get prompted to save unsaved changes before switching

## Environment

Both tools require:

- **Python 3.9+**
- **Node.js 18+** (for `loom-ui` only)

Pipelines are executed from the directory containing the YAML file, so relative paths in your config resolve correctly.

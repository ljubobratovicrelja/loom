# Examples

Working examples to help you understand Loom. Each example is self-contained and runnable.

## Running Examples

```bash
# Run a pipeline
loom-runner examples/linear/pipeline.yml

# Open in visual editor
loom-editor examples/linear/pipeline.yml

# Preview commands without executing
loom-runner examples/linear/pipeline.yml --dry-run
```

## Examples

| Example | Description |
|---------|-------------|
| [linear](linear/) | Sequential A → B → C pipeline. Start here. |
| [diamond](diamond/) | Branching and merging: one input feeds two paths that combine at the end. |
| [parameters](parameters/) | Using parameters for configuration and `--set` for overrides. |
| [optional_steps](optional_steps/) | Optional debug/visualization steps with `--include`. |
| [parallel](parallel/) | Hyperparameter search: same pipeline with different configs producing multiple outputs. |

## Structure

Each example contains:

```
example_name/
├── README.md      # What it demonstrates, how to run
├── pipeline.yml   # The pipeline configuration
├── tasks/         # Python scripts (simple, no dependencies)
└── data/          # Input files and where outputs go
```

All scripts are self-contained Python with no external dependencies beyond the standard library. They generate real data you can inspect.

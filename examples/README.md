# Examples

Working examples to help you understand Loom. Each example is self-contained and runnable.

## Running Examples

The easiest way to explore the examples is with the visual editor:

```bash
# Browse all examples in the visual editor
loom-ui examples/
```

This opens a pipeline browser in the sidebar where you can switch between examples with a double-click.

You can also run individual examples from the command line:

```bash
# Run a pipeline
loom examples/linear/pipeline.yml

# Open a specific pipeline in the editor
loom-ui examples/linear/pipeline.yml

# Preview commands without executing
loom examples/linear/pipeline.yml --dry-run

# Clean all data and re-run from scratch
loom examples/linear/pipeline.yml --clean -y
loom examples/linear/pipeline.yml

# List what data would be cleaned
loom examples/linear/pipeline.yml --clean-list

# Run all examples (with cleanup)
./scripts/run-examples.sh
```

## Examples

| Example | Description |
|---------|-------------|
| [linear](linear/) | Sequential A → B → C pipeline. Start here. |
| [diamond](diamond/) | Branching and merging: one input feeds two paths that combine at the end. |
| [parameters](parameters/) | Using parameters for configuration and `--set` for overrides. |
| [optional_steps](optional_steps/) | Optional debug/visualization steps with `--include`. |
| [parallel](parallel/) | Hyperparameter search: same pipeline with different configs producing multiple outputs. |
| [loop](loop/) | Iterate over files in a directory with `loop:` blocks. |
| [groups](groups/) | Visual grouping: organize steps under named `group:` blocks. |
| [image-processing](image-processing/) | Image pipeline with URL data sources and automatic downloads. |
| [curve-fitting](curve-fitting/) | Scientific workflow: generate data, fit a model, visualize results. |

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

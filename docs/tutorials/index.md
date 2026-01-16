# Tutorials

Learn Loom through hands-on examples. Each tutorial builds on the previous one, introducing new concepts progressively.

## Prerequisites

Make sure you have [Loom installed](../getting-started/installation.md) and have [run your first pipeline](../getting-started/first-pipeline.md).

## Tutorial Progression

| Tutorial | What You'll Learn |
|----------|-------------------|
| [Linear Pipeline](linear.md) | Core concepts: data nodes, steps, inputs/outputs |
| [Branching (Diamond)](diamond.md) | Branching, merging, multiple inputs |
| [Using Parameters](parameters.md) | Config values and `--set` overrides |
| [Parallel Execution](parallel.md) | Same task with different configs |
| [Optional Steps](optional-steps.md) | Conditional execution with `--include` |
| [Scientific Workflow](curve-fitting.md) | A complete scientific workflow example |

## Running Examples

Each tutorial uses a self-contained example from the `examples/` directory:

```bash
# Run any example
loom examples/<name>/pipeline.yml

# Open in visual editor
loom-ui examples/<name>/pipeline.yml

# Browse all examples
loom-ui examples/
```

## Start Here

[Linear Pipeline →](linear.md)

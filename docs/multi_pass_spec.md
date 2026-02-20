# Feature Spec: `multi_pass` — Iterative Multi-Pass Step Groups

## Motivation

In iterative optimization pipelines, a common pattern is **coarse-to-fine refinement**: run the same group of steps multiple times with progressively tuned parameters, where each pass's output feeds into the next pass's input.

The concrete use case driving this feature is a **pyramidal non-rigid ICP** pipeline in a 3D face reconstruction project ([Vega](https://github.com/ljubobratovicrelja/vega)). The pipeline has two steps that need to repeat across pyramid levels:

1. **`build_graph`** — samples control nodes on a mesh and builds a deformation graph
2. **`nonrigid_icp`** — optimizes the graph's deformation parameters to fit a dense point cloud

At each pyramid level, the graph gets denser and the optimizer gets less regularized:

| Level | Nodes | Support Scale | ARAP Weight | P2S Max Distance |
|-------|-------|---------------|-------------|------------------|
| Coarse | 50 | 0.2 | 1.0 | 10mm |
| Medium | 100 | 0.1 | 0.5 | 5mm |
| Fine | 200 | 0.05 | 0.1 | 3mm |

### Generality

This pattern appears in many domains:
- **Progressive training schedules** (learning rate / loss weight annealing across stages)
- **Multi-resolution processing** (process at 256px, then 512px, then 1024px)
- **Iterative refinement** (run the same solver with tightening tolerances)
- **Curriculum learning** (easy examples first, then harder)

### Why existing loom features don't cover this

**`loop:`** on a step iterates over files in a folder with fixed parameters. It can't:
- Vary parameters per iteration
- Chain iterations sequentially (iteration N's output feeding iteration N+1)
- Create per-iteration data nodes with distinct paths

**Manual unrolling** works but doesn't scale — 2 steps × 3 passes = 6 step nodes, 6 data nodes, 12 parameters. The graph becomes unreadable.

---

## Design Overview

### Core concept: runtime iteration, not parse-time unrolling

Template steps appear **once** in the graph and YAML. The executor runs them in a loop at runtime. A **feedback connection** carries state from one iteration to the next. The graph stays compact regardless of iteration count.

```
         ┌──────────── refine (multi_pass: 3) ────────────────┐
         │                                                     │
 input ──┤→  smooth_signal  ──→  filter_signal  ──→ output    │
         │       ↑                      │                      │
         │       └── feedback ──────────┘                      │
         │           (3 iterations)                            │
         └─────────────────────────────────────────────────────┘
```

2 step nodes instead of 6. One feedback edge with a label. Downstream steps consume the final output.

---

## YAML Syntax

### Example: explicit per-iteration parameters (`schedule:`)

```yaml
pipeline:
  - group: refine
    multi_pass:
      # Explicit per-iteration parameters. Count inferred from list length.
      schedule:
        - {window_size: 20, threshold: 5.0}
        - {window_size: 10, threshold: 2.0}
        - {window_size: 5, threshold: 1.0}
      feedback:
        filter_signal.--output: smooth_signal.--warm-start
    steps:
      - name: smooth_signal
        task: tasks/smooth_signal.py
        inputs:
          input_csv: $input_signal
        outputs:
          --output: $smoothed_signal
        args:
          --window-size: $window_size

      - name: filter_signal
        task: tasks/filter_signal.py
        inputs:
          input_csv: $smoothed_signal
        outputs:
          --output: $cleaned_signal
        args:
          --threshold: $threshold
```

### Example: dynamic expressions (`expressions:`)

```yaml
pipeline:
  - group: refine
    multi_pass:
      count: 10
      # Dynamic parameter expressions. `iter` is the 0-based iteration index.
      expressions:
        window_size: "max(5, 20 - iter * 2)"
        threshold: "5.0 / (2 ** iter)"
      # Optional break condition. Python expression, must return bool.
      # In scope: `iter`, current parameter values.
      until: "iter >= 3 and threshold < 0.5"
      feedback:
        filter_signal.--output: smooth_signal.--warm-start
    steps:
      - name: smooth_signal
        ...
      - name: filter_signal
        ...
```

### Example: Vega pyramidal NRICP

```yaml
pipeline:
  - group: nricp_pyramid
    multi_pass:
      schedule:
        - graph_n_nodes: 50
          graph_support_scale: 0.2
          nricp_w_arap: 1.0
          nricp_p2s_max_distance: 0.01
        - graph_n_nodes: 100
          graph_support_scale: 0.1
          nricp_w_arap: 0.5
          nricp_p2s_max_distance: 0.005
        - graph_n_nodes: 200
          graph_support_scale: 0.05
          nricp_w_arap: 0.1
          nricp_p2s_max_distance: 0.003
      feedback:
        nonrigid_icp.--output-graph-npz: build_graph.--warm-start-graph
    steps:
      - name: build_graph
        task: tasks/build_graph.py
        inputs:
          initial_fit_mesh: $trimmed_mesh
          initial_fit_params: $trimmed_params
          fused_ply: $meshed_ply
        outputs:
          --output-npz: $deformation_graph
        args:
          --n-nodes: $graph_n_nodes
          --support-scale: $graph_support_scale

      - name: nonrigid_icp
        task: tasks/nonrigid_icp.py
        inputs:
          initial_fit_params: $trimmed_params
          graph_npz: $deformation_graph
          fused_ply: $fused_ply
          landmarks_json: $landmarks_json
        outputs:
          --output-graph-npz: $nricp_graph
          --output-ply: $nricp_mesh
        args:
          --w-arap: $nricp_w_arap
          --p2s-max-distance: $nricp_p2s_max_distance
```

---

## YAML Schema

### `multi_pass:` block (on a group)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedule` | list[dict] | One of `schedule` or `count` | Explicit per-iteration parameter overrides. Iteration count inferred from list length. |
| `count` | int | Required with `expressions` | Number of iterations when using dynamic expressions. |
| `expressions` | dict[str, str] | Optional | Python expressions for parameter values. `iter` (0-based index) is in scope. |
| `until` | str | Optional | Python expression returning bool. Loop terminates when true. `iter` and current param values are in scope. |
| `feedback` | dict[str, str] | Optional | Maps `step.--output-flag` to `step.--input-flag`. Connects iteration N's output to iteration N+1's input. |

**Validation rules:**
- `schedule` and `expressions` are mutually exclusive
- If `expressions` is present, `count` is required
- If `schedule` is present, `count` is ignored (inferred)
- `schedule` list must be non-empty
- `count` must be >= 1
- `until` expression must be valid Python syntax (checked at parse time with `compile()`)
- `feedback` source must reference an `outputs:` flag of a step in the group
- `feedback` target must reference a valid arg on a step in the group

---

## Semantics

### Iteration execution

Iterations execute **sequentially** in order (0, 1, 2, ...). Within each iteration, steps follow normal dependency resolution (same as a regular `group:`).

### Parameter resolution

For each iteration, parameter values are computed and **shadow** the global `parameters:` section:

- **`schedule` mode**: iteration `i` uses `schedule[i]` as parameter overrides
- **`expressions` mode**: each expression is evaluated with `iter = i` (and other param values in scope) via Python `eval()`

Parameters not listed in `schedule`/`expressions` fall through to global values. Steps reference params as usual (e.g., `$window_size`) — the multi_pass mechanism injects per-iteration values.

### Feedback (chaining between iterations)

The `feedback:` section defines how consecutive iterations connect:

```yaml
feedback:
  filter_signal.--output: smooth_signal.--warm-start
```

- **Iteration 0**: the feedback arg (`--warm-start`) is **omitted entirely**. The task script must handle its absence (e.g., argparse `default=None`).
- **Iteration N (N > 0)**: the feedback arg receives the path from iteration N-1's output.

### Break condition (`until:`)

After each iteration completes, `until` is evaluated. If it returns `True`, the loop terminates early. The final output is from the last completed iteration.

**v1 scope for `until:` eval():**
- `iter`: 0-based iteration index (of the just-completed iteration)
- All current parameter values by name (e.g., `threshold`, `window_size`)

Future: expose step-written metrics for convergence-based stopping.

**Safety**: expressions are compiled at parse time with `compile()` to catch syntax errors. At runtime, eval is called in a restricted namespace (only `iter`, param values, and safe builtins like `min`, `max`, `abs`).

### Output storage

Internal output variables (those in `outputs:` of template steps) are stored per-iteration with `_iter{N}` suffixes:

```
results/cleaned_iter0.csv    ← iteration 0
results/cleaned_iter1.csv    ← iteration 1
results/cleaned_iter2.csv    ← iteration 2 (final)
results/cleaned.csv          ← copy of / symlink to final iteration
```

The unsuffixed variable (`$cleaned_signal`) resolves to the final iteration's output. Downstream steps never need to know about iterations.

Data nodes for **external inputs** (produced outside the group) are not suffixed — they're constant across all iterations.

### External dependencies

Steps inside the multi_pass group can reference data nodes produced outside the group (like `$input_signal`). These resolve normally and don't get suffixed.

---

## UI Representation

### Graph structure

Template steps appear **once** in the graph, enclosed in the group bounding box. Data nodes that are outputs of multi-pass steps exist as normal data nodes.

### Feedback edge

The feedback connection is a visible edge in the graph, going from the output data node back to the input of a step within the same group (creating a visual cycle). This edge has a **label** displayed on the curve showing:
- Iteration count (e.g., "3 iterations")
- Exit condition if present (e.g., `until threshold < 0.5`)

The cycle is the visual signal that multi-pass iteration is happening.

### Data node indicators

Data nodes that are internal to a multi-pass group should have a visual indicator (badge, icon, or border treatment) showing they store per-iteration outputs in series.

### Interaction

- **Clicking the feedback edge label** opens the multi-pass properties in the right sidebar: iteration count, schedule/expressions, exit condition
- **Creating a feedback connection**: when a user drags a connection from a data node back to a step input within the same group (creating a cycle), the UI detects this and prompts to configure multi-pass iteration settings
- **Validation/linting** is built into the UI:
  - Detect potentially infinite loops (no `count` and no `until`)
  - Validate `until` expression syntax
  - Verify feedback source/target are valid step flags
  - Verify `schedule` length matches across all params

### Dry-run display

```
[DRY RUN] refine (multi_pass: 3 iterations)
  iteration 0:
    smooth_signal: python tasks/smooth_signal.py input.csv -o results/smoothed_iter0.csv --window-size 20
    filter_signal: python tasks/filter_signal.py results/smoothed_iter0.csv -o results/cleaned_iter0.csv --threshold 5.0
  iteration 1:
    smooth_signal: python tasks/smooth_signal.py input.csv -o results/smoothed_iter1.csv --window-size 10 --warm-start results/cleaned_iter0.csv
    filter_signal: python tasks/filter_signal.py results/smoothed_iter1.csv -o results/cleaned_iter1.csv --threshold 2.0
  iteration 2:
    smooth_signal: python tasks/smooth_signal.py input.csv -o results/smoothed_iter2.csv --window-size 5 --warm-start results/cleaned_iter1.csv
    filter_signal: python tasks/filter_signal.py results/smoothed_iter2.csv -o results/cleaned_iter2.csv --threshold 1.0
```

---

## Implementation Scope

### Config parsing (`config.py` + `multi_pass.py`)

- `MultiPassConfig` dataclass: `schedule`, `count`, `expressions`, `until`, `feedback`
- Validation: mutual exclusivity, syntax checking for `until` and `expressions`
- Identify internal output variables for per-iteration suffixing
- Register the unsuffixed variable as alias for the final iteration's output
- No parse-time unrolling — config preserves the template structure

### Executor (`executor.py`)

- `run_multi_pass_group()`: the core iteration loop
  - For each iteration: compute param values, resolve output paths with `_iter{N}`, apply feedback from previous iteration, execute template steps
  - After each iteration: evaluate `until` condition if present
  - After loop: copy/symlink final iteration outputs to unsuffixed paths
- Iteration 0: omit feedback args
- Iteration N > 0: inject feedback paths from iteration N-1
- Steps within one iteration can run in parallel if independent; iterations are strictly sequential

### Dependency tracking

- Multi-pass group as a whole depends on external inputs
- The unsuffixed output variable is the group's "final output" for downstream dependency resolution
- `loom clean` removes all `_iter{N}` suffixed files

### Graph / UI (`graph.py`, frontend)

- `yaml_to_graph()`: create template step nodes once, create feedback edges (cycles allowed within multi-pass groups)
- Feedback edge carries `multiPass` metadata (iteration count, schedule/expressions, until)
- `graph_to_yaml()`: reconstruct `multi_pass:` block from feedback edges and metadata
- Frontend: render feedback edge label, sidebar panel for multi-pass properties
- Validation: cycle detection exemption for multi-pass groups, expression syntax checking

### Tests

- Config parsing: `schedule` vs `expressions`, validation errors, `until` syntax checking
- Expression evaluation: `iter` in scope, param values, safe builtins
- Executor: iteration loop, feedback injection, output suffixing, break condition, first iteration bootstrap
- Graph round-trip: feedback edges, multi-pass metadata preservation
- Example pipeline: end-to-end execution

---

## Relationship to existing `loop:` on steps

The existing `loop:` keyword on individual steps (iterate over files in a data folder) is unrelated. A step inside a multi-pass group can have its own `loop:` for file iteration within each pass — there is no conflict since `multi_pass:` lives on the group, not the step.

---

## Future extensions

- **Metrics-based `until:`** — steps write metrics to a JSON sidecar, `until` can reference `metrics['convergence']`
- **Per-feedback-edge transforms** — e.g., downsample an output before feeding it back
- **Nested multi-pass** — multi-pass group inside another multi-pass group (pyramid within pyramid)
- **Partial re-execution** — resume from iteration N if iterations 0..N-1 outputs exist

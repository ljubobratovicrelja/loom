# Feature Spec: `multi_pass` — Sequential Multi-Pass Step Groups

## Motivation

In iterative optimization pipelines, a common pattern is **coarse-to-fine refinement**: run the same group of steps multiple times with progressively tuned parameters, where each pass's output feeds into the next pass's input.

The concrete use case driving this feature is a **pyramidal non-rigid ICP** pipeline in a 3D face reconstruction project ([Vega](https://github.com/ljubobratovicrelja/vega)). The pipeline has two steps that need to repeat across pyramid levels:

1. **`build_graph`** — samples control nodes on a mesh and builds a deformation graph (node positions, edges, interpolation weights)
2. **`nonrigid_icp`** — optimizes the graph's deformation parameters (rotation, scale, translation per node) to fit a dense point cloud

At each pyramid level, the graph gets denser and the optimizer gets less regularized:

| Level | Nodes | Support Scale | ARAP Weight | P2S Max Distance |
|-------|-------|---------------|-------------|------------------|
| Coarse | 50 | 0.2 | 1.0 | 10mm |
| Medium | 100 | 0.1 | 0.5 | 5mm |
| Fine | 200 | 0.05 | 0.1 | 3mm |

The coarse level captures gross shape deformation. Each subsequent level builds a new, finer graph on the **deformed mesh from the previous level** and captures progressively finer detail.

### Why existing loom features don't cover this

**`loop:`** iterates over files in a folder with fixed parameters. It can't:
- Vary parameters per iteration (all iterations get the same args)
- Chain iterations sequentially (iteration N's output feeding iteration N+1)
- Create per-iteration data nodes with distinct paths

**Manual unrolling** (duplicating steps as `build_graph_L0`, `nricp_L0`, `build_graph_L1`, `nricp_L1`, ...) works but is verbose: 2 extra steps + 2 data nodes + ~4 parameters per level. For 3 levels that's 6 steps, 6 data nodes, 12 parameters, with the same task scripts repeated. Adding or removing levels requires manual pipeline surgery.

### Generality

This pattern appears in many domains beyond this specific use case:
- **Progressive training schedules** (learning rate / loss weight annealing across stages)
- **Multi-resolution processing** (process at 256px, then 512px, then 1024px)
- **Iterative refinement** (run the same solver with tightening tolerances)
- **Curriculum learning** (easy examples first, then harder)

## Proposed Design

### YAML Syntax

```yaml
pipeline:
  - group: nricp_pyramid
    multi_pass:
      passes:
        - name: coarse
          params:
            graph_n_nodes: 50
            graph_support_scale: 0.2
            nricp_w_arap: 1.0
            nricp_p2s_max_distance: 0.01
        - name: medium
          params:
            graph_n_nodes: 100
            graph_support_scale: 0.1
            nricp_w_arap: 0.5
            nricp_p2s_max_distance: 0.005
        - name: fine
          params:
            graph_n_nodes: 200
            graph_support_scale: 0.05
            nricp_w_arap: 0.1
            nricp_p2s_max_distance: 0.003
      chain:
        # Maps: step_name.output_flag -> step_name.input_name
        # Connects pass N's output to pass N+1's input
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

### Semantics

#### Pass execution

Passes execute **sequentially** in declaration order. Within each pass, steps follow normal dependency resolution (same as a regular `group:`).

#### Parameter resolution

Each pass's `params:` block **shadows** the global `parameters:` section for the duration of that pass. Parameters not listed in `params:` fall through to the global values. This means steps can reference `$graph_n_nodes` as usual — the multi_pass mechanism injects the per-pass value.

#### Data node suffixing

Data nodes referenced in `outputs:` are automatically suffixed with the pass name to avoid collisions:

- Pass `coarse`: `$deformation_graph` resolves to `results/deformation_graph_coarse.npz`
- Pass `medium`: `$deformation_graph` resolves to `results/deformation_graph_medium.npz`
- Pass `fine`: `$deformation_graph` resolves to `results/deformation_graph_fine.npz`

The **last pass owns the unsuffixed name**. So `$nricp_graph` after all passes = `$nricp_graph_fine`, which is what downstream steps (like `photometric_fit`) consume without any changes.

Suffixed data nodes should be auto-registered so they appear in dependency tracking and `--clean`.

#### Chaining

The `chain:` section defines how consecutive passes connect. Each entry maps an output flag of one step to an input (positional or flag) of another step:

```yaml
chain:
  nonrigid_icp.--output-graph-npz: build_graph.--warm-start-graph
```

This means: for pass N+1, the value that `build_graph` receives for `--warm-start-graph` is the path that `nonrigid_icp` wrote to `--output-graph-npz` in pass N.

For the **first pass**, chained inputs are simply absent (not passed). The task script should treat them as optional arguments (e.g., `argparse` with `default=None`).

#### Step naming

Steps within the multi_pass group get prefixed with the pass name for display and logging:

```
[RUNNING] nricp_pyramid/coarse/build_graph
[RUNNING] nricp_pyramid/coarse/nonrigid_icp
[RUNNING] nricp_pyramid/medium/build_graph
...
```

#### External dependencies

Steps inside the multi_pass group can reference data nodes produced by steps outside the group (like `$trimmed_mesh`, `$fused_ply`). These resolve normally and don't get suffixed — they're external inputs, constant across all passes.

Only data nodes that appear in `outputs:` of steps **inside** the group get per-pass suffixing.

### Dry-run output

```
[DRY RUN] nricp_pyramid (multi_pass: 3 passes)
  pass coarse:
    build_graph: python tasks/build_graph.py ... --n-nodes 50 --support-scale 0.2
    nonrigid_icp: python tasks/nonrigid_icp.py ... --w-arap 1.0 --p2s-max-distance 0.01
  pass medium:
    build_graph: python tasks/build_graph.py ... --n-nodes 100 --warm-start-graph results/nricp_graph_coarse.npz
    nonrigid_icp: python tasks/nonrigid_icp.py ... --w-arap 0.5 --p2s-max-distance 0.005
  pass fine:
    build_graph: python tasks/build_graph.py ... --n-nodes 200 --warm-start-graph results/nricp_graph_medium.npz
    nonrigid_icp: python tasks/nonrigid_icp.py ... --w-arap 0.1 --p2s-max-distance 0.003
```

### UI considerations

In loom-ui, a multi_pass group could be rendered as:
- A collapsible container node showing the pass names
- Or: expanded as the full unrolled graph (with pass-prefixed step names and suffixed data nodes)

The expanded view is probably simpler to implement and more useful for debugging.

## Implementation Scope

### Config parsing (`config.py`)

- New `MultiPassConfig` dataclass: `passes` (list of `{name, params}`), `chain` (dict), `steps` (list of step configs)
- Extend `PipelineConfig` to recognize `multi_pass:` on groups
- Suffix logic for data node path resolution

### Executor (`executor.py`)

- `run_multi_pass_group()`: iterate over passes sequentially
- Per-pass: create a parameter overlay, resolve data node paths with suffix, apply chain bindings
- First pass: skip chained inputs (or pass None)
- Error handling: stop on first failed pass (like sequential steps)

### Dependency tracking

- Register all suffixed output data nodes as produced by the multi_pass group
- The unsuffixed name (= last pass) is the group's "final output" for downstream deps

### Tests

- Unit tests for config parsing (multi_pass YAML variants)
- Integration test: simple two-step, two-pass pipeline (e.g., process -> refine, with chaining)
- Edge cases: single pass (degenerates to normal group), empty chain, missing params

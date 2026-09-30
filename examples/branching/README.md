# Conditional Branching Example

Route a pipeline down one of two paths depending on whether an input is present.

## What It Does

A small text-processing pipeline that demonstrates loom's **logic board** — the
`condition` and `switch` nodes:

1. **generate_input** (task): writes sample `.txt` files into `output/input`.
2. **has_input** (condition): checks `output/input` with the built-in `count`
   predicate — "are there at least `min_files` `.txt` files?". A condition turns
   data into a boolean.
3. **input_gate** (switch): routes the `output/input` payload by that boolean. It
   only cares about the boolean, and it can be driven by a condition node **or**
   a boolean parameter.
4. **count_words** (then branch): counts words across every `.txt` file and
   writes `output/word_report.json`.
5. **empty_report** (else branch): writes a zeroed `output/empty_report.json`.

The branch that is not taken is **skipped**, not failed. There are no joins in
this first version.

## No data means no decision

`output/input` is produced by the pipeline. Before it runs (e.g. on a clean
pipeline) there is no data feeding the switch, so **the switch does not decide
at all and both branches are drawn normally** — nothing is faded. Once
`generate_input` has run and the data exists, the switch commits to a branch and
the other one is faded out.

Generated data lives under `output/`, the pipeline-owned tree. `--clean` purges
that whole tree (directory shells included), so a failed or interrupted run
cannot leave an empty directory that the editor would read as produced data.

In the editor this is preview-driven: a data node is teal with a ✓ when it
exists and grey when it does not, and the branch decision follows that. Source
inputs (files you commit) always exist, so a pipeline gated on committed data
will always decide.

## Run It

```bash
# Clean: remove generated data, then run from scratch
loom pipeline.yml --clean -y
loom pipeline.yml
cat output/word_report.json

# Force the "else" branch by raising the threshold parameter
loom pipeline.yml --set min_files=999
cat output/empty_report.json

# Open in the visual editor, press TAB and type "if" to add a switch
loom-ui pipeline.yml
```

The condition's `n` argument references the `min_files` parameter, so
`--set min_files=999` flips the branch without editing the pipeline.

## The Logic Nodes

```yaml
- name: has_input
  kind: condition
  predicate: count          # built-in: exists, is_file, is_dir, non_empty, count, param
  inputs:
    data: $input_dir
  args:
    pattern: "*.txt"
    op: ">="
    n: $min_files

- name: input_gate
  kind: switch
  condition: $has_input      # boolean ref (condition node or parameter)
  data: $input_dir           # payload to pass through

- name: count_words
  task: tasks/count_words.py
  inputs:
    folder: $input_gate.then # gated on the "then" branch
  outputs:
    -o: $word_report

- name: empty_report
  task: tasks/empty_report.py
  inputs:
    folder: $input_gate.else # gated on the "else" branch
  outputs:
    -o: $empty_report
```

Condition kinds can also be authored as scripts, just like tasks:

```python
"""Pass if the metrics file clears the threshold.

---
kind: condition
inputs:
  data: {type: json}
args:
  threshold: {type: float, default: 0.5}
---

def evaluate(data, threshold=0.5):
    import json
    return json.load(open(data))["score"] >= threshold
"""
```

## Files

- `pipeline.yml` — Pipeline with a condition node and a switch node
- `tasks/generate_input.py` — Writes the sample `.txt` files
- `tasks/count_words.py` — (then) Counts words across a folder
- `tasks/empty_report.py` — (else) Writes a zeroed report

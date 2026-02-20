"""Tests for multi_pass v2 — runtime iteration with feedback edges."""

from pathlib import Path

import pytest

from loom.runner.config import PipelineConfig
from loom.runner.executor import PipelineExecutor
from loom.runner.multi_pass import (
    _suffix_path,
    parse_multi_pass_config,
)


class TestSuffixPath:
    """Tests for _suffix_path helper."""

    def test_file_with_extension(self) -> None:
        assert _suffix_path("results/graph.npz", "iter0") == "results/graph_iter0.npz"

    def test_file_without_extension(self) -> None:
        assert _suffix_path("results/mesh", "iter2") == "results/mesh_iter2"

    def test_directory_path(self) -> None:
        assert _suffix_path("data/output/", "iter1") == "data/output_iter1/"

    def test_nested_path(self) -> None:
        assert _suffix_path("a/b/c.txt", "iter0") == "a/b/c_iter0.txt"

    def test_dotfile(self) -> None:
        assert _suffix_path("a.b/file.csv", "iter1") == "a.b/file_iter1.csv"

    def test_empty_path(self) -> None:
        assert _suffix_path("", "iter0") == "_iter0"

    def test_just_filename(self) -> None:
        assert _suffix_path("output.json", "iter2") == "output_iter2.json"


class TestParseMultiPassConfig:
    """Tests for parse_multi_pass_config validation."""

    @pytest.fixture
    def template_steps(self) -> list[dict]:
        return [
            {
                "name": "process",
                "task": "tasks/process.py",
                "inputs": {"input_data": "$source_data"},
                "outputs": {"--output": "$processed"},
                "args": {"--quality": "$quality_level"},
            },
            {
                "name": "refine",
                "task": "tasks/refine.py",
                "inputs": {"data": "$processed"},
                "outputs": {"--output": "$refined"},
                "args": {"--tolerance": "$tolerance"},
            },
        ]

    @pytest.fixture
    def data_section(self) -> dict:
        return {
            "source_data": {"type": "csv", "path": "data/source.csv"},
            "processed": {"type": "csv", "path": "results/processed.csv"},
            "refined": {"type": "json", "path": "results/refined.json"},
        }

    def test_schedule_basic(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [
                {"quality_level": 1, "tolerance": 5.0},
                {"quality_level": 3, "tolerance": 1.0},
            ],
            "feedback": {"refine.--output": "process.--warm-start"},
        }
        config = parse_multi_pass_config("grp", mp_data, template_steps, data_section)
        assert config.iteration_count == 2
        assert config.schedule is not None
        assert len(config.schedule) == 2
        assert config.expressions is None
        assert config.feedback == {"refine.--output": "process.--warm-start"}

    def test_expressions_basic(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "count": 5,
            "expressions": {
                "quality_level": "iter + 1",
                "tolerance": "5.0 / (2 ** iter)",
            },
        }
        config = parse_multi_pass_config("grp", mp_data, template_steps, data_section)
        assert config.iteration_count == 5
        assert config.expressions is not None
        assert config.schedule is None

    def test_schedule_expressions_mutually_exclusive(
        self, template_steps: list, data_section: dict
    ) -> None:
        mp_data = {
            "schedule": [{"x": 1}],
            "expressions": {"x": "iter"},
            "count": 1,
        }
        with pytest.raises(ValueError, match="mutually exclusive"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_expressions_requires_count(self, template_steps: list, data_section: dict) -> None:
        mp_data = {"expressions": {"x": "iter"}}
        with pytest.raises(ValueError, match="count.*required"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_empty_schedule_raises(self, template_steps: list, data_section: dict) -> None:
        mp_data: dict = {"schedule": []}
        with pytest.raises(ValueError, match="non-empty"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_count_must_be_positive(self, template_steps: list, data_section: dict) -> None:
        mp_data = {"count": 0, "expressions": {"x": "iter"}}
        with pytest.raises(ValueError, match="count.*>= 1"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_until_syntax_check(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [{"x": 1}],
            "until": "this is not valid python +++",
        }
        with pytest.raises(ValueError, match="Invalid syntax.*until"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_expression_syntax_check(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "count": 1,
            "expressions": {"bad": "def foo():"},
        }
        with pytest.raises(ValueError, match="Invalid syntax.*expressions"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_feedback_source_step_not_found(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [{"x": 1}],
            "feedback": {"nonexistent.--output": "process.--warm"},
        }
        with pytest.raises(ValueError, match="source step.*not found"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_feedback_source_flag_not_found(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [{"x": 1}],
            "feedback": {"refine.--nonexistent": "process.--warm"},
        }
        with pytest.raises(ValueError, match="source flag.*not found"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_feedback_target_step_not_found(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [{"x": 1}],
            "feedback": {"refine.--output": "nonexistent.--warm"},
        }
        with pytest.raises(ValueError, match="target step.*not found"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_internal_outputs_detected(self, template_steps: list, data_section: dict) -> None:
        mp_data = {"schedule": [{"x": 1}]}
        config = parse_multi_pass_config("grp", mp_data, template_steps, data_section)
        assert "processed" in config.internal_outputs
        assert "refined" in config.internal_outputs
        assert "source_data" not in config.internal_outputs

    def test_valid_until(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [{"x": 1}],
            "until": "iter >= 3 and tolerance < 0.5",
        }
        config = parse_multi_pass_config("grp", mp_data, template_steps, data_section)
        assert config.until == "iter >= 3 and tolerance < 0.5"


class TestMultiPassPipelineConfig:
    """Tests for full YAML parsing with multi_pass via PipelineConfig."""

    @pytest.fixture
    def pipeline_yaml(self, tmp_path: Path) -> Path:
        yaml_content = """
data:
  source:
    type: csv
    path: data/source.csv
  output:
    type: json
    path: results/output.json

parameters:
  global_param: 42

pipeline:
  - name: prepare
    task: tasks/prepare.py
    outputs:
      --out: $source

  - group: refine
    multi_pass:
      schedule:
        - {level: 1}
        - {level: 3}
      feedback:
        process.--out: process.--warm-start
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --out: $output
        args:
          --level: $level
          --global: $global_param

  - name: finalize
    task: tasks/finalize.py
    inputs:
      result: $output
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        return config_file

    def test_synthetic_step_created(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        names = [s.name for s in config.steps]
        # Should have: prepare, refine (synthetic), finalize
        assert names == ["prepare", "refine", "finalize"]

    def test_synthetic_step_has_group(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        refine = config.get_step_by_name("refine")
        assert refine.group == "refine"
        assert refine.script == "__multi_pass__"

    def test_multi_pass_group_stored(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        assert "refine" in config.multi_pass_groups
        mp = config.multi_pass_groups["refine"]
        assert mp.iteration_count == 2
        assert mp.schedule is not None

    def test_external_inputs_on_synthetic(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        refine = config.get_step_by_name("refine")
        # $source is an external input (produced by prepare, not by the group)
        assert "data" in refine.inputs
        assert refine.inputs["data"] == "$source"

    def test_outputs_on_synthetic(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        refine = config.get_step_by_name("refine")
        # $output is an internal output of the group
        assert "--out" in refine.outputs
        assert refine.outputs["--out"] == "$output"

    def test_dependency_tracking(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        # refine depends on prepare (via $source)
        refine = config.get_step_by_name("refine")
        deps = config.get_step_dependencies(refine)
        assert "prepare" in deps

    def test_finalize_depends_on_synthetic(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        finalize = config.get_step_by_name("finalize")
        deps = config.get_step_dependencies(finalize)
        assert "refine" in deps

    def test_mixed_pipeline_with_regular_groups(self, tmp_path: Path) -> None:
        """Multi-pass groups and regular groups can coexist."""
        yaml_content = """
data:
  src:
    type: csv
    path: data/src.csv
  out:
    type: csv
    path: results/out.csv

pipeline:
  - group: preprocessing
    steps:
      - name: preprocess
        task: tasks/preprocess.py
        outputs:
          --out: $src

  - group: refine
    multi_pass:
      schedule:
        - {val: 10}
    steps:
      - name: step
        task: tasks/step.py
        inputs:
          data: $src
        outputs:
          --out: $out
        args:
          --val: $val
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        names = [s.name for s in config.steps]
        assert names == ["preprocess", "refine"]
        assert config.steps[0].group == "preprocessing"
        assert config.steps[1].group == "refine"
        assert "refine" in config.multi_pass_groups


class TestMultiPassExecution:
    """Tests for executor iteration loop."""

    @pytest.fixture
    def pipeline_yaml(self, tmp_path: Path) -> Path:
        # Create task scripts
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        # Simple echo-like task that creates an output file
        (tasks_dir / "process.py").write_text(
            "import sys, os, argparse\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('input')\n"
            "parser.add_argument('-o', '--output', required=True)\n"
            "parser.add_argument('--level', type=int, default=1)\n"
            "parser.add_argument('--warm-start', default=None)\n"
            "args = parser.parse_args()\n"
            "os.makedirs(os.path.dirname(args.output), exist_ok=True)\n"
            "with open(args.output, 'w') as f:\n"
            "    f.write(f'level={args.level} warm={args.warm_start}\\n')\n"
        )

        # Create input data
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "source.csv").write_text("index,value\n0,1\n")

        yaml_content = """
data:
  source:
    type: csv
    path: data/source.csv
  output:
    type: csv
    path: results/output.csv

pipeline:
  - group: refine
    multi_pass:
      schedule:
        - {level: 1}
        - {level: 3}
      feedback:
        process.--output: process.--warm-start
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
        args:
          --level: $level
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        return config_file

    def test_dry_run_output(self, pipeline_yaml: Path, capsys: pytest.CaptureFixture) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        executor = PipelineExecutor(config, dry_run=True)
        executor.run_multi_pass_group("refine")
        output = capsys.readouterr().out
        assert "multi_pass: 2 iterations" in output
        assert "iteration 0" in output
        assert "iteration 1" in output
        assert "--level 1" in output
        assert "--level 3" in output
        # No warm-start in iteration 0
        assert "--warm-start" not in output.split("iteration 0")[1].split("iteration 1")[0]
        # Warm-start in iteration 1
        assert "--warm-start" in output.split("iteration 1")[1]

    def test_execution_creates_outputs(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        executor = PipelineExecutor(config, dry_run=False)
        success = executor.run_multi_pass_group("refine")
        assert success

        # Check iteration outputs exist
        results_dir = pipeline_yaml.parent / "results"
        assert (results_dir / "output_iter0.csv").exists()
        assert (results_dir / "output_iter1.csv").exists()
        # Check final output was copied
        assert (results_dir / "output.csv").exists()

    def test_feedback_injection(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        executor = PipelineExecutor(config, dry_run=False)
        success = executor.run_multi_pass_group("refine")
        assert success

        # Check that iteration 1 received warm-start from iteration 0
        results_dir = pipeline_yaml.parent / "results"
        content = (results_dir / "output_iter1.csv").read_text()
        assert "warm=" in content
        assert "iter0" in content  # warm-start path should reference iter0

    def test_expressions_mode(self, tmp_path: Path) -> None:
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "process.py").write_text(
            "import sys, os, argparse\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('input')\n"
            "parser.add_argument('-o', '--output', required=True)\n"
            "parser.add_argument('--level', type=int, default=1)\n"
            "args = parser.parse_args()\n"
            "os.makedirs(os.path.dirname(args.output), exist_ok=True)\n"
            "with open(args.output, 'w') as f:\n"
            "    f.write(f'level={args.level}\\n')\n"
        )

        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "source.csv").write_text("x\n")

        yaml_content = """
data:
  source:
    type: csv
    path: data/source.csv
  output:
    type: csv
    path: results/output.csv

pipeline:
  - group: refine
    multi_pass:
      count: 3
      expressions:
        level: "iter * 2 + 1"
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
        args:
          --level: $level
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=True)
        executor.run_multi_pass_group("refine")
        # Just verify it doesn't crash — dry_run prints commands

    def test_until_condition(self, tmp_path: Path) -> None:
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "process.py").write_text(
            "import sys, os, argparse\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('input')\n"
            "parser.add_argument('-o', '--output', required=True)\n"
            "parser.add_argument('--level', type=int, default=1)\n"
            "args = parser.parse_args()\n"
            "os.makedirs(os.path.dirname(args.output), exist_ok=True)\n"
            "with open(args.output, 'w') as f:\n"
            "    f.write(f'level={args.level}\\n')\n"
        )

        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "source.csv").write_text("x\n")

        yaml_content = """
data:
  source:
    type: csv
    path: data/source.csv
  output:
    type: csv
    path: results/output.csv

pipeline:
  - group: refine
    multi_pass:
      count: 10
      expressions:
        level: "iter + 1"
      until: "iter >= 2"
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
        args:
          --level: $level
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=False)
        success = executor.run_multi_pass_group("refine")
        assert success

        # Should stop after iteration 2 (index 2, since until: "iter >= 2")
        results_dir = tmp_path / "results"
        assert (results_dir / "output_iter0.csv").exists()
        assert (results_dir / "output_iter1.csv").exists()
        assert (results_dir / "output_iter2.csv").exists()
        # Should NOT have iteration 3+
        assert not (results_dir / "output_iter3.csv").exists()


class TestMultiPassGraph:
    """Tests for graph round-trip with multi_pass."""

    def test_template_steps_appear_as_nodes(self) -> None:
        from loom.ui.server.graph import yaml_to_graph

        yaml_data = {
            "data": {
                "input": {"type": "csv", "path": "input.csv"},
                "output": {"type": "csv", "path": "output.csv"},
            },
            "parameters": {},
            "pipeline": [
                {
                    "group": "refine",
                    "multi_pass": {
                        "schedule": [{"x": 1}, {"x": 2}],
                        "feedback": {"step_b.--out": "step_a.--warm"},
                    },
                    "steps": [
                        {
                            "name": "step_a",
                            "task": "tasks/a.py",
                            "inputs": {"data": "$input"},
                            "outputs": {"--out": "$output"},
                            "args": {"--x": "$x"},
                        },
                        {
                            "name": "step_b",
                            "task": "tasks/b.py",
                            "inputs": {"data": "$output"},
                            "outputs": {"--out": "$output"},
                        },
                    ],
                }
            ],
        }
        graph = yaml_to_graph(yaml_data)

        # Template steps appear as individual nodes
        step_nodes = [n for n in graph.nodes if n.type == "step"]
        step_names = {n.data["name"] for n in step_nodes}
        assert "step_a" in step_names
        assert "step_b" in step_names
        # No unrolled steps like step_a_0, step_a_1
        assert not any("_0" in n or "_1" in n for n in step_names)

    def test_feedback_edge_created(self) -> None:
        from loom.ui.server.graph import yaml_to_graph

        yaml_data = {
            "data": {
                "src": {"type": "csv", "path": "src.csv"},
                "out": {"type": "csv", "path": "out.csv"},
            },
            "parameters": {},
            "pipeline": [
                {
                    "group": "grp",
                    "multi_pass": {
                        "schedule": [{"x": 1}],
                        "feedback": {"step.--out": "step.--warm"},
                    },
                    "steps": [
                        {
                            "name": "step",
                            "task": "t.py",
                            "inputs": {"data": "$src"},
                            "outputs": {"--out": "$out"},
                        }
                    ],
                }
            ],
        }
        graph = yaml_to_graph(yaml_data)

        feedback_edges = [e for e in graph.edges if e.type == "feedback"]
        assert len(feedback_edges) == 1
        assert feedback_edges[0].data is not None
        assert feedback_edges[0].data["feedback"] is True

    def test_round_trip_preserves_multi_pass(self) -> None:
        from loom.ui.server.graph import graph_to_yaml, yaml_to_graph

        yaml_data = {
            "data": {
                "src": {"type": "csv", "path": "src.csv"},
                "out": {"type": "csv", "path": "out.csv"},
            },
            "parameters": {},
            "pipeline": [
                {
                    "group": "grp",
                    "multi_pass": {
                        "schedule": [{"x": 1}, {"x": 2}],
                        "feedback": {"step.--out": "step.--warm"},
                    },
                    "steps": [
                        {
                            "name": "step",
                            "task": "t.py",
                            "inputs": {"data": "$src"},
                            "outputs": {"--out": "$out"},
                        }
                    ],
                }
            ],
        }
        graph = yaml_to_graph(yaml_data)
        result = graph_to_yaml(graph)

        # The multi_pass block should be preserved
        pipeline = result["pipeline"]
        assert len(pipeline) == 1
        assert pipeline[0]["group"] == "grp"
        assert "multi_pass" in pipeline[0]
        assert pipeline[0]["multi_pass"]["schedule"] == [{"x": 1}, {"x": 2}]
        assert pipeline[0]["multi_pass"]["feedback"] == {"step.--out": "step.--warm"}

    def test_feedback_targets_injected_into_step_data(self) -> None:
        from loom.ui.server.graph import yaml_to_graph

        yaml_data = {
            "data": {
                "src": {"type": "csv", "path": "src.csv"},
                "out": {"type": "csv", "path": "out.csv"},
            },
            "parameters": {},
            "pipeline": [
                {
                    "group": "grp",
                    "multi_pass": {
                        "schedule": [{"x": 1}],
                        "feedback": {"step.--out": "step.--warm"},
                    },
                    "steps": [
                        {
                            "name": "step",
                            "task": "t.py",
                            "inputs": {"data": "$src"},
                            "outputs": {"--out": "$out"},
                        }
                    ],
                }
            ],
        }
        graph = yaml_to_graph(yaml_data)

        step_node = next(n for n in graph.nodes if n.id == "step")
        assert step_node.data["feedbackTargets"] == ["--warm"]

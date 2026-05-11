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

    def test_condition_basic(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [{"quality_level": 1}],
            "condition": {
                "script": "conditions/has_converged.py",
                "inputs": {"cleaned_csv": "$refined"},
                "args": {"tolerance": 0.01},
            },
        }
        config = parse_multi_pass_config("grp", mp_data, template_steps, data_section)
        assert config.condition is not None
        assert config.condition.script == "conditions/has_converged.py"
        assert config.condition.inputs == {"cleaned_csv": "$refined"}
        assert config.condition.args == {"tolerance": 0.01}

    def test_condition_missing_script_raises(
        self, template_steps: list, data_section: dict
    ) -> None:
        mp_data = {
            "schedule": [{"quality_level": 1}],
            "condition": {"inputs": {"csv": "$refined"}},
        }
        with pytest.raises(ValueError, match="must have a 'script' key"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_condition_must_be_dict(self, template_steps: list, data_section: dict) -> None:
        mp_data = {
            "schedule": [{"quality_level": 1}],
            "condition": "conditions/check.py",
        }
        with pytest.raises(ValueError, match="must be a dict"):
            parse_multi_pass_config("grp", mp_data, template_steps, data_section)

    def test_no_condition_by_default(self, template_steps: list, data_section: dict) -> None:
        mp_data = {"schedule": [{"quality_level": 1}]}
        config = parse_multi_pass_config("grp", mp_data, template_steps, data_section)
        assert config.condition is None

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
        process.--out: process.data
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

        # Task that writes its positional input path and level to output
        (tasks_dir / "process.py").write_text(
            "import sys, os, argparse\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('input')\n"
            "parser.add_argument('-o', '--output', required=True)\n"
            "parser.add_argument('--level', type=int, default=1)\n"
            "args = parser.parse_args()\n"
            "os.makedirs(os.path.dirname(args.output), exist_ok=True)\n"
            "with open(args.output, 'w') as f:\n"
            "    f.write(f'level={args.level} input={args.input}\\n')\n"
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
        process.--output: process.data
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
        # Iteration 0 uses original source input
        iter0_section = output.split("iteration 0")[1].split("iteration 1")[0]
        assert "source.csv" in iter0_section
        # Iteration 1 uses feedback path (iter0 output) as positional input
        iter1_section = output.split("iteration 1")[1]
        assert "iter0" in iter1_section

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

        # Check iteration 1 received iter0's output as its input
        results_dir = pipeline_yaml.parent / "results"
        content = (results_dir / "output_iter1.csv").read_text()
        assert "input=" in content
        assert "iter0" in content  # input path should reference iter0 output

    def test_feedback_targets_input(self, tmp_path: Path) -> None:
        """Feedback targeting an input injects into new_inputs, not new_args."""
        from loom.runner.multi_pass import MultiPassGroupConfig

        step_dict = {
            "name": "step_a",
            "task": "tasks/a.py",
            "inputs": {"data": "$source"},
            "outputs": {"--output": "$result"},
            "args": {"--level": "$level"},
        }

        mp = MultiPassGroupConfig(
            group_name="grp",
            template_step_dicts=[step_dict],
            schedule=[{"level": 1}, {"level": 2}],
            feedback={"step_a.--output": "step_a.data"},
            internal_outputs={"result"},
        )

        # Create minimal config for executor
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "source.csv").write_text("x\n")
        yaml_content = """
data:
  source:
    type: csv
    path: data/source.csv
  result:
    type: csv
    path: results/result.csv
parameters:
  level: 1
pipeline:
  - name: placeholder
    task: tasks/a.py
    inputs:
      data: $source
    outputs:
      --output: $result
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=True)

        # Iteration 0: no feedback, original input preserved
        iter_step_0 = executor._build_iter_step(step_dict, mp, 0, {"level": 1}, {})
        assert iter_step_0.inputs["data"] == "$source"
        assert "--data" not in iter_step_0.args
        assert "data" not in iter_step_0.args

        # Iteration 1: feedback injects into inputs, not args
        iter_step_1 = executor._build_iter_step(
            step_dict, mp, 1, {"level": 2}, {"step_a.--output": "/tmp/result_iter0.csv"}
        )
        assert iter_step_1.inputs["data"] == "/tmp/result_iter0.csv"
        assert "data" not in iter_step_1.args

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

    def test_condition_stops_early(self, tmp_path: Path) -> None:
        """Condition returning True stops iteration; only iter0 output exists."""
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

        # Condition that always returns True (stop immediately after first iter)
        cond_dir = tmp_path / "conditions"
        cond_dir.mkdir()
        (cond_dir / "always_stop.py").write_text("def evaluate(**kwargs):\n    return True\n")

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
      count: 5
      expressions:
        level: "iter + 1"
      condition:
        script: conditions/always_stop.py
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

        # Should stop after iteration 0
        results_dir = tmp_path / "results"
        assert (results_dir / "output_iter0.csv").exists()
        assert not (results_dir / "output_iter1.csv").exists()

    def test_condition_exception_is_failure(self, tmp_path: Path) -> None:
        """Exception in condition script causes run_multi_pass_group to return False."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "process.py").write_text(
            "import sys, os, argparse\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('input')\n"
            "parser.add_argument('-o', '--output', required=True)\n"
            "args = parser.parse_args()\n"
            "os.makedirs(os.path.dirname(args.output), exist_ok=True)\n"
            "with open(args.output, 'w') as f:\n"
            "    f.write('ok\\n')\n"
        )

        cond_dir = tmp_path / "conditions"
        cond_dir.mkdir()
        (cond_dir / "bad.py").write_text(
            "def evaluate(**kwargs):\n    raise RuntimeError('boom')\n"
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
      condition:
        script: conditions/bad.py
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=False)
        success = executor.run_multi_pass_group("refine")
        assert not success

    def test_condition_not_found(self, tmp_path: Path) -> None:
        """Missing script file causes failure."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "process.py").write_text(
            "import argparse\nparser = argparse.ArgumentParser()\nargs = parser.parse_args()\n"
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
      count: 2
      condition:
        script: conditions/nonexistent.py
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=False)
        success = executor.run_multi_pass_group("refine")
        assert not success

    def test_condition_missing_evaluate(self, tmp_path: Path) -> None:
        """Script without evaluate() function causes failure."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "process.py").write_text(
            "import argparse\nparser = argparse.ArgumentParser()\nargs = parser.parse_args()\n"
        )

        cond_dir = tmp_path / "conditions"
        cond_dir.mkdir()
        (cond_dir / "no_eval.py").write_text("x = 1\n")

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
      count: 2
      condition:
        script: conditions/no_eval.py
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=False)
        success = executor.run_multi_pass_group("refine")
        assert not success

    def test_condition_dry_run(self, tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
        """Dry run prints condition info but doesn't call it."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "process.py").write_text(
            "import argparse\nparser = argparse.ArgumentParser()\nargs = parser.parse_args()\n"
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
      count: 2
      condition:
        script: conditions/check.py
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=True)
        executor.run_multi_pass_group("refine")
        output = capsys.readouterr().out
        assert "[condition: conditions/check.py]" in output

    def test_condition_with_args(self, tmp_path: Path) -> None:
        """Condition args are passed as kwargs to evaluate()."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "process.py").write_text(
            "import sys, os, argparse\n"
            "parser = argparse.ArgumentParser()\n"
            "parser.add_argument('input')\n"
            "parser.add_argument('-o', '--output', required=True)\n"
            "args = parser.parse_args()\n"
            "os.makedirs(os.path.dirname(args.output), exist_ok=True)\n"
            "with open(args.output, 'w') as f:\n"
            "    f.write('ok\\n')\n"
        )

        cond_dir = tmp_path / "conditions"
        cond_dir.mkdir()
        # Condition that stops when threshold is met (threshold passed as arg)
        (cond_dir / "check_threshold.py").write_text(
            "call_count = 0\n"
            "def evaluate(threshold=10):\n"
            "    global call_count\n"
            "    call_count += 1\n"
            "    return threshold < 5\n"
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
      count: 5
      condition:
        script: conditions/check_threshold.py
        args:
          threshold: 1
    steps:
      - name: process
        task: tasks/process.py
        inputs:
          data: $source
        outputs:
          --output: $output
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config, dry_run=False)
        success = executor.run_multi_pass_group("refine")
        assert success

        # threshold=1 < 5, so condition returns True, stops after iter 0
        results_dir = tmp_path / "results"
        assert (results_dir / "output_iter0.csv").exists()
        assert not (results_dir / "output_iter1.csv").exists()

    def test_schedule_plus_condition(self, tmp_path: Path) -> None:
        """Schedule + condition: runs up to schedule length, stops early."""
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

        cond_dir = tmp_path / "conditions"
        cond_dir.mkdir()
        # Stops after being called twice (iter 0 -> False, iter 1 -> True)
        (cond_dir / "stop_at_iter1.py").write_text(
            "calls = 0\n"
            "def evaluate(**kwargs):\n"
            "    global calls\n"
            "    calls += 1\n"
            "    return calls >= 2\n"
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
      schedule:
        - {level: 1}
        - {level: 2}
        - {level: 3}
      condition:
        script: conditions/stop_at_iter1.py
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

        # Schedule has 3 entries but condition stops at iter 1
        results_dir = tmp_path / "results"
        assert (results_dir / "output_iter0.csv").exists()
        assert (results_dir / "output_iter1.csv").exists()
        assert not (results_dir / "output_iter2.csv").exists()


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

    def test_feedback_edge_targets_existing_input(self) -> None:
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
                        "feedback": {"step.--out": "step.data"},
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

        # feedbackTargets should NOT be injected into step data
        step_node = next(n for n in graph.nodes if n.id == "step")
        assert "feedbackTargets" not in step_node.data

        # Feedback edge targetHandle should match an existing input key
        feedback_edges = [e for e in graph.edges if e.type == "feedback"]
        assert len(feedback_edges) == 1
        target_handle = feedback_edges[0].targetHandle
        assert target_handle == "data"
        assert target_handle in step_node.data.get("inputs", {})

    def test_group_name_in_feedback_edge_data(self) -> None:
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
        assert feedback_edges[0].data["groupName"] == "grp"

    def test_update_yaml_writes_multi_pass_changes(self) -> None:
        from typing import Any

        from loom.ui.server.graph import update_yaml_from_graph, yaml_to_graph

        yaml_data: dict[str, Any] = {
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

        # Modify the multi_pass schedule in the graph
        graph.multiPassGroups["grp"]["multi_pass"]["schedule"] = [
            {"x": 10},
            {"x": 20},
            {"x": 30},
        ]

        # Apply changes in-place
        update_yaml_from_graph(yaml_data, graph)

        # Verify the YAML was updated
        pipeline = yaml_data["pipeline"]
        assert len(pipeline) == 1
        mp = pipeline[0]["multi_pass"]
        assert mp["schedule"] == [{"x": 10}, {"x": 20}, {"x": 30}]
        assert mp["feedback"] == {"step.--out": "step.--warm"}

    def test_new_feedback_mapping_round_trip(self) -> None:
        from typing import Any

        from loom.ui.server.graph import update_yaml_from_graph, yaml_to_graph

        yaml_data: dict[str, Any] = {
            "data": {
                "src": {"type": "csv", "path": "src.csv"},
                "mid": {"type": "csv", "path": "mid.csv"},
                "out": {"type": "csv", "path": "out.csv"},
            },
            "parameters": {},
            "pipeline": [
                {
                    "group": "grp",
                    "multi_pass": {
                        "schedule": [{"x": 1}],
                        "feedback": {"step_a.--out": "step_a.--warm"},
                    },
                    "steps": [
                        {
                            "name": "step_a",
                            "task": "t.py",
                            "inputs": {"data": "$src"},
                            "outputs": {"--out": "$mid"},
                        },
                        {
                            "name": "step_b",
                            "task": "t2.py",
                            "inputs": {"data": "$mid"},
                            "outputs": {"--out": "$out"},
                        },
                    ],
                }
            ],
        }
        graph = yaml_to_graph(yaml_data)

        # Add a new feedback mapping via the graph
        graph.multiPassGroups["grp"]["multi_pass"]["feedback"]["step_b.--out"] = "step_a.--init"

        # Save back
        update_yaml_from_graph(yaml_data, graph)

        # Verify the new feedback mapping appears in YAML
        mp = yaml_data["pipeline"][0]["multi_pass"]
        assert "step_b.--out" in mp["feedback"]
        assert mp["feedback"]["step_b.--out"] == "step_a.--init"
        # Original mapping still present
        assert mp["feedback"]["step_a.--out"] == "step_a.--warm"

    def test_condition_round_trip(self) -> None:
        """Condition config survives yaml→graph→yaml."""
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
                        "schedule": [{"x": 1}],
                        "condition": {
                            "script": "conditions/check.py",
                            "inputs": {"csv": "$out"},
                            "args": {"tol": 0.01},
                        },
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

        mp = result["pipeline"][0]["multi_pass"]
        assert "condition" in mp
        assert mp["condition"]["script"] == "conditions/check.py"
        assert mp["condition"]["inputs"] == {"csv": "$out"}
        assert mp["condition"]["args"] == {"tol": 0.01}

    def test_until_stripped_on_load(self) -> None:
        """Old YAML with 'until' gets it removed during graph conversion."""
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
                        "schedule": [{"x": 1}],
                        "until": "iter >= 3",
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

        # until should be stripped from the multiPassGroups
        mp = graph.multiPassGroups["grp"]["multi_pass"]
        assert "until" not in mp

        # Round-trip should also not have until
        result = graph_to_yaml(graph)
        mp_result = result["pipeline"][0]["multi_pass"]
        assert "until" not in mp_result

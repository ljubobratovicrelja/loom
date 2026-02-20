"""Tests for multi_pass expansion feature."""

from pathlib import Path

import pytest

from loom.runner.config import PipelineConfig
from loom.runner.multi_pass import (
    MultiPassConfig,
    PassConfig,
    _suffix_path,
    expand_multi_pass,
)


class TestPassConfig:
    """Tests for PassConfig dataclass."""

    def test_basic_pass(self) -> None:
        p = PassConfig(name="coarse", params={"n_nodes": 50})
        assert p.name == "coarse"
        assert p.params == {"n_nodes": 50}

    def test_empty_params(self) -> None:
        p = PassConfig(name="pass1")
        assert p.params == {}


class TestMultiPassConfig:
    """Tests for MultiPassConfig parsing."""

    def test_from_dict_basic(self) -> None:
        data = {
            "passes": [
                {"name": "coarse", "params": {"n": 50}},
                {"name": "fine", "params": {"n": 200}},
            ],
            "chain": {"step_a.--out": "step_b.--in"},
        }
        config = MultiPassConfig.from_dict(data)
        assert len(config.passes) == 2
        assert config.passes[0].name == "coarse"
        assert config.passes[0].params == {"n": 50}
        assert config.passes[1].name == "fine"
        assert config.chain == {"step_a.--out": "step_b.--in"}

    def test_from_dict_no_chain(self) -> None:
        data = {"passes": [{"name": "only"}]}
        config = MultiPassConfig.from_dict(data)
        assert config.chain == {}

    def test_from_dict_missing_passes_raises(self) -> None:
        with pytest.raises(KeyError, match="passes"):
            MultiPassConfig.from_dict({"chain": {}})

    def test_from_dict_empty_passes_raises(self) -> None:
        with pytest.raises(ValueError, match="at least one pass"):
            MultiPassConfig.from_dict({"passes": []})

    def test_from_dict_pass_missing_name_raises(self) -> None:
        with pytest.raises(ValueError, match="name"):
            MultiPassConfig.from_dict({"passes": [{"params": {"n": 1}}]})

    def test_from_dict_pass_without_params(self) -> None:
        data = {"passes": [{"name": "solo"}]}
        config = MultiPassConfig.from_dict(data)
        assert config.passes[0].params == {}


class TestSuffixPath:
    """Tests for _suffix_path helper."""

    def test_file_with_extension(self) -> None:
        assert _suffix_path("results/graph.npz", "coarse") == "results/graph_coarse.npz"

    def test_file_without_extension(self) -> None:
        assert _suffix_path("results/mesh", "medium") == "results/mesh_medium"

    def test_directory_path(self) -> None:
        assert _suffix_path("data/output/", "fine") == "data/output_fine/"

    def test_nested_path(self) -> None:
        assert _suffix_path("a/b/c.txt", "v1") == "a/b/c_v1.txt"

    def test_dotfile(self) -> None:
        # Dot in directory component, extension in filename
        assert _suffix_path("a.b/file.csv", "pass1") == "a.b/file_pass1.csv"

    def test_empty_path(self) -> None:
        assert _suffix_path("", "coarse") == "_coarse"

    def test_just_filename(self) -> None:
        assert _suffix_path("output.json", "fine") == "output_fine.json"


class TestExpandMultiPass:
    """Tests for expand_multi_pass function."""

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

    @pytest.fixture
    def multi_pass_data(self) -> dict:
        return {
            "passes": [
                {"name": "coarse", "params": {"quality_level": 1, "tolerance": 5.0}},
                {"name": "fine", "params": {"quality_level": 3, "tolerance": 1.0}},
            ],
            "chain": {"refine.--output": "process.--warm-start"},
        }

    def test_step_names_are_suffixed(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        names = [s["name"] for s in result.steps]
        assert names == [
            "process_coarse",
            "refine_coarse",
            "process_fine",
            "refine_fine",
        ]

    def test_all_steps_have_group(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        for step in result.steps:
            assert step["group"] == "grp"

    def test_outputs_are_suffixed(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        # process_coarse should output $processed_coarse
        assert result.steps[0]["outputs"]["--output"] == "$processed_coarse"
        # refine_coarse should output $refined_coarse
        assert result.steps[1]["outputs"]["--output"] == "$refined_coarse"
        # process_fine should output $processed_fine
        assert result.steps[2]["outputs"]["--output"] == "$processed_fine"

    def test_internal_inputs_are_suffixed(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        # refine_coarse consumes $processed -> $processed_coarse
        assert result.steps[1]["inputs"]["data"] == "$processed_coarse"

    def test_external_inputs_unchanged(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        # process_coarse still has external input $source_data
        assert result.steps[0]["inputs"]["input_data"] == "$source_data"

    def test_parameter_shadowing(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        # process_coarse: quality_level should be inlined as 1
        assert result.steps[0]["args"]["--quality"] == 1
        # refine_coarse: tolerance should be inlined as 5.0
        assert result.steps[1]["args"]["--tolerance"] == 5.0
        # process_fine: quality_level should be inlined as 3
        assert result.steps[2]["args"]["--quality"] == 3
        # refine_fine: tolerance should be inlined as 1.0
        assert result.steps[3]["args"]["--tolerance"] == 1.0

    def test_chain_absent_in_first_pass(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        # process_coarse should NOT have the chain input
        assert "warm_start" not in result.steps[0].get("inputs", {})
        assert "--warm-start" not in result.steps[0].get("args", {})

    def test_chain_present_in_subsequent_passes(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        # process_fine should have chain input from refine_coarse's output
        process_fine = result.steps[2]
        assert "--warm-start" in process_fine["args"]
        assert process_fine["args"]["--warm-start"] == "$refined_coarse"

    def test_extra_variables_registered(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        assert "processed_coarse" in result.extra_variables
        assert result.extra_variables["processed_coarse"] == "results/processed_coarse.csv"
        assert "refined_fine" in result.extra_variables
        assert result.extra_variables["refined_fine"] == "results/refined_fine.json"

    def test_extra_data_types_registered(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        assert result.extra_data_types["processed_coarse"] == "csv"
        assert result.extra_data_types["refined_fine"] == "json"

    def test_last_pass_alias(
        self, multi_pass_data: dict, template_steps: list, data_section: dict
    ) -> None:
        result = expand_multi_pass("grp", multi_pass_data, template_steps, data_section)
        # Unsuffixed vars should point to last pass's suffixed path
        assert result.variable_overrides["processed"] == "results/processed_fine.csv"
        assert result.variable_overrides["refined"] == "results/refined_fine.json"

    def test_single_pass_no_chain(self) -> None:
        """Single pass should work without chain (degenerates to normal group)."""
        template = [
            {
                "name": "step1",
                "task": "t.py",
                "outputs": {"--out": "$output"},
            }
        ]
        data = {"output": {"type": "csv", "path": "out.csv"}}
        mp_data = {"passes": [{"name": "only"}]}

        result = expand_multi_pass("g", mp_data, template, data)
        assert len(result.steps) == 1
        assert result.steps[0]["name"] == "step1_only"
        assert result.steps[0]["outputs"]["--out"] == "$output_only"
        assert result.variable_overrides["output"] == "out_only.csv"

    def test_three_passes_chain_propagation(self) -> None:
        """Chain should connect each pass to the next."""
        template = [
            {
                "name": "step",
                "task": "t.py",
                "inputs": {"src": "$ext_input"},
                "outputs": {"--out": "$result"},
            }
        ]
        data = {"result": {"type": "json", "path": "results/r.json"}}
        mp_data = {
            "passes": [
                {"name": "p1"},
                {"name": "p2"},
                {"name": "p3"},
            ],
            "chain": {"step.--out": "step.--warm"},
        }

        result = expand_multi_pass("g", mp_data, template, data)
        assert len(result.steps) == 3

        # p1: no chain
        assert "--warm" not in result.steps[0].get("args", {})
        # p2: chain from p1
        assert result.steps[1]["args"]["--warm"] == "$result_p1"
        # p3: chain from p2
        assert result.steps[2]["args"]["--warm"] == "$result_p2"


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
      passes:
        - name: coarse
          params:
            level: 1
        - name: fine
          params:
            level: 3
      chain:
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

    def test_steps_are_expanded(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        names = [s.name for s in config.steps]
        assert names == ["prepare", "process_coarse", "process_fine", "finalize"]

    def test_expanded_steps_have_group(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        assert config.steps[1].group == "refine"
        assert config.steps[2].group == "refine"

    def test_suffixed_variables_registered(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        assert "output_coarse" in config.variables
        assert config.variables["output_coarse"] == "results/output_coarse.json"
        assert "output_fine" in config.variables
        assert config.variables["output_fine"] == "results/output_fine.json"

    def test_last_pass_overrides_unsuffixed(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        # $output should resolve to the last pass's path
        assert config.variables["output"] == "results/output_fine.json"

    def test_output_producers_track_suffixed(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        assert config._output_producers["output_coarse"] == "process_coarse"
        assert config._output_producers["output_fine"] == "process_fine"

    def test_dependency_tracking(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        # process_fine depends on process_coarse via chain
        process_fine = config.get_step_by_name("process_fine")
        deps = config.get_step_dependencies(process_fine)
        assert "process_coarse" in deps

    def test_finalize_depends_on_last_pass(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        finalize = config.get_step_by_name("finalize")
        deps = config.get_step_dependencies(finalize)
        assert "process_fine" in deps

    def test_parameter_inlining(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        coarse = config.get_step_by_name("process_coarse")
        assert coarse.args["--level"] == 1
        fine = config.get_step_by_name("process_fine")
        assert fine.args["--level"] == 3

    def test_global_param_preserved(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        coarse = config.get_step_by_name("process_coarse")
        # Global param should remain as $reference (not inlined)
        assert coarse.args["--global"] == "$global_param"

    def test_data_types_for_suffixed(self, pipeline_yaml: Path) -> None:
        config = PipelineConfig.from_yaml(pipeline_yaml)
        assert config.data_types["output_coarse"] == "json"
        assert config.data_types["output_fine"] == "json"

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
      passes:
        - name: pass1
          params:
            val: 10
      chain: {}
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
        assert names == ["preprocess", "step_pass1"]
        assert config.steps[0].group == "preprocessing"
        assert config.steps[1].group == "refine"

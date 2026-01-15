"""Tests for loom.runner.config module."""

import tempfile
from pathlib import Path

import pytest

from loom.runner.config import PipelineConfig, StepConfig


class TestStepConfig:
    """Tests for StepConfig dataclass."""

    def test_from_dict_minimal(self):
        """Test creating StepConfig with minimal required fields."""
        data = {"name": "step1", "script": "scripts/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.name == "step1"
        assert step.script == "scripts/step1.py"
        assert step.inputs == {}
        assert step.outputs == {}
        assert step.args == {}
        assert step.optional is False

    def test_from_dict_full(self):
        """Test creating StepConfig with all fields."""
        data = {
            "name": "process",
            "script": "scripts/process.py",
            "inputs": {"input_file": "$source"},
            "outputs": {"-o": "$output"},
            "args": {"--verbose": True, "--threshold": 0.5},
            "optional": True,
        }
        step = StepConfig.from_dict(data)

        assert step.name == "process"
        assert step.script == "scripts/process.py"
        assert step.inputs == {"input_file": "$source"}
        assert step.outputs == {"-o": "$output"}
        assert step.args == {"--verbose": True, "--threshold": 0.5}
        assert step.optional is True

    def test_from_dict_optional_defaults_to_false(self):
        """Test that optional defaults to False when not specified."""
        data = {"name": "step", "script": "script.py"}
        step = StepConfig.from_dict(data)
        assert step.optional is False


class TestPipelineConfig:
    """Tests for PipelineConfig dataclass."""

    @pytest.fixture
    def sample_yaml_content(self) -> str:
        """Sample YAML content for testing."""
        return """
variables:
  video: data/video.mp4
  output_csv: data/output.csv
  viz_output: data/viz.mp4

parameters:
  threshold: 0.5
  verbose: true
  width: 1920

pipeline:
  - name: extract
    script: scripts/extract.py
    inputs:
      video: $video
    outputs:
      -o: $output_csv
    args:
      --threshold: $threshold

  - name: visualize
    script: scripts/visualize.py
    optional: true
    inputs:
      csv_file: $output_csv
    outputs:
      -o: $viz_output
"""

    @pytest.fixture
    def config_file(self, sample_yaml_content: str) -> Path:
        """Create a temporary config file."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as f:
            f.write(sample_yaml_content)
            return Path(f.name)

    def test_from_yaml_loads_variables(self, config_file: Path):
        """Test that YAML loading correctly parses variables."""
        config = PipelineConfig.from_yaml(config_file)

        assert config.variables["video"] == "data/video.mp4"
        assert config.variables["output_csv"] == "data/output.csv"
        assert config.variables["viz_output"] == "data/viz.mp4"

    def test_from_yaml_loads_parameters(self, config_file: Path):
        """Test that YAML loading correctly parses parameters."""
        config = PipelineConfig.from_yaml(config_file)

        assert config.parameters["threshold"] == 0.5
        assert config.parameters["verbose"] is True
        assert config.parameters["width"] == 1920

    def test_from_yaml_loads_steps(self, config_file: Path):
        """Test that YAML loading correctly parses pipeline steps."""
        config = PipelineConfig.from_yaml(config_file)

        assert len(config.steps) == 2
        assert config.steps[0].name == "extract"
        assert config.steps[1].name == "visualize"
        assert config.steps[1].optional is True

    def test_from_yaml_empty_file(self):
        """Test loading an empty YAML file."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as f:
            f.write("")
            config = PipelineConfig.from_yaml(Path(f.name))

        assert config.variables == {}
        assert config.parameters == {}
        assert config.steps == []


class TestPipelineConfigResolveValue:
    """Tests for PipelineConfig.resolve_value method."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a config for testing resolve_value."""
        return PipelineConfig(
            variables={"video": "data/video.mp4", "output": "data/out.csv"},
            parameters={"threshold": 0.5, "verbose": True},
            steps=[],
        )

    def test_resolve_variable_reference(self, config: PipelineConfig):
        """Test resolving a variable reference."""
        assert config.resolve_value("$video") == "data/video.mp4"
        assert config.resolve_value("$output") == "data/out.csv"

    def test_resolve_parameter_reference(self, config: PipelineConfig):
        """Test resolving a parameter reference."""
        assert config.resolve_value("$threshold") == 0.5
        assert config.resolve_value("$verbose") is True

    def test_resolve_non_reference_string(self, config: PipelineConfig):
        """Test that non-reference strings are returned as-is."""
        assert config.resolve_value("plain_string") == "plain_string"
        assert config.resolve_value("data/file.csv") == "data/file.csv"

    def test_resolve_non_string_values(self, config: PipelineConfig):
        """Test that non-string values are returned as-is."""
        assert config.resolve_value(42) == 42
        assert config.resolve_value(3.14) == 3.14
        assert config.resolve_value(True) is True
        assert config.resolve_value(None) is None

    def test_resolve_unknown_reference_raises(self, config: PipelineConfig):
        """Test that unknown references raise ValueError."""
        with pytest.raises(ValueError, match="Unknown reference: \\$unknown"):
            config.resolve_value("$unknown")

    def test_variable_takes_precedence_over_parameter(self):
        """Test that variable is resolved before parameter with same name."""
        config = PipelineConfig(
            variables={"name": "from_variable"},
            parameters={"name": "from_parameter"},
            steps=[],
        )
        assert config.resolve_value("$name") == "from_variable"


class TestPipelineConfigStepLookup:
    """Tests for step lookup methods."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a config with multiple steps."""
        return PipelineConfig(
            variables={},
            parameters={},
            steps=[
                StepConfig(name="step1", script="s1.py"),
                StepConfig(name="step2", script="s2.py"),
                StepConfig(name="step3", script="s3.py", optional=True),
            ],
        )

    def test_get_step_by_name_existing(self, config: PipelineConfig):
        """Test getting an existing step by name."""
        step = config.get_step_by_name("step2")
        assert step.name == "step2"
        assert step.script == "s2.py"

    def test_get_step_by_name_unknown_raises(self, config: PipelineConfig):
        """Test that unknown step name raises ValueError."""
        with pytest.raises(ValueError, match="Unknown step: nonexistent"):
            config.get_step_by_name("nonexistent")


class TestPipelineConfigDependencies:
    """Tests for dependency tracking."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a config with steps that have dependencies."""
        return PipelineConfig(
            variables={"video": "v.mp4", "csv1": "1.csv", "csv2": "2.csv"},
            parameters={},
            steps=[
                StepConfig(
                    name="extract",
                    script="extract.py",
                    inputs={"video": "$video"},
                    outputs={"-o": "$csv1"},
                ),
                StepConfig(
                    name="process",
                    script="process.py",
                    inputs={"input": "$csv1"},
                    outputs={"-o": "$csv2"},
                ),
                StepConfig(
                    name="visualize",
                    script="viz.py",
                    inputs={"csv": "$csv2", "video": "$video"},
                ),
            ],
        )

    def test_output_producers_built_correctly(self, config: PipelineConfig):
        """Test that output producer mapping is built correctly."""
        assert config._output_producers["csv1"] == "extract"
        assert config._output_producers["csv2"] == "process"

    def test_get_step_dependencies_no_deps(self, config: PipelineConfig):
        """Test step with no dependencies."""
        extract = config.get_step_by_name("extract")
        deps = config.get_step_dependencies(extract)
        assert deps == set()

    def test_get_step_dependencies_single_dep(self, config: PipelineConfig):
        """Test step with a single dependency."""
        process = config.get_step_by_name("process")
        deps = config.get_step_dependencies(process)
        assert deps == {"extract"}

    def test_get_step_dependencies_multiple_inputs(self, config: PipelineConfig):
        """Test step with multiple inputs (only one is a dep)."""
        visualize = config.get_step_by_name("visualize")
        deps = config.get_step_dependencies(visualize)
        # video is not produced by any step, only csv2 is
        assert deps == {"process"}


class TestPipelineConfigOverrides:
    """Tests for override methods."""

    def test_override_variables(self):
        """Test overriding variable values."""
        config = PipelineConfig(
            variables={"a": "original_a", "b": "original_b"},
            parameters={},
            steps=[],
        )
        config.override_variables({"a": "new_a", "c": "new_c"})

        assert config.variables["a"] == "new_a"
        assert config.variables["b"] == "original_b"
        assert config.variables["c"] == "new_c"

    def test_override_parameters(self):
        """Test overriding parameter values."""
        config = PipelineConfig(
            variables={},
            parameters={"x": 1, "y": 2},
            steps=[],
        )
        config.override_parameters({"x": 10, "z": 30})

        assert config.parameters["x"] == 10
        assert config.parameters["y"] == 2
        assert config.parameters["z"] == 30


class TestPipelineConfigDataSection:
    """Tests for loading data section into variables."""

    @pytest.fixture
    def data_section_yaml_content(self) -> str:
        """Sample YAML content with data section instead of variables."""
        return """
data:
  video:
    type: video
    path: data/videos/test.mp4
    description: Input video file
  gaze_csv:
    type: csv
    path: data/tracking/gaze.csv
  output_dir:
    type: data_folder
    path: data/output/

parameters:
  threshold: 0.5

pipeline:
  - name: extract
    task: scripts/extract.py
    inputs:
      video: $video
    outputs:
      -o: $gaze_csv
    args:
      --threshold: $threshold
"""

    @pytest.fixture
    def data_section_config_file(self, data_section_yaml_content: str) -> Path:
        """Create a temporary config file with data section."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as f:
            f.write(data_section_yaml_content)
            return Path(f.name)

    def test_from_yaml_loads_data_section_as_variables(self, data_section_config_file: Path):
        """Test that data section entries are loaded into variables."""
        config = PipelineConfig.from_yaml(data_section_config_file)

        assert "video" in config.variables
        assert "gaze_csv" in config.variables
        assert "output_dir" in config.variables

    def test_from_yaml_extracts_paths_from_data_entries(self, data_section_config_file: Path):
        """Test that path values are extracted from data entries."""
        config = PipelineConfig.from_yaml(data_section_config_file)

        assert config.variables["video"] == "data/videos/test.mp4"
        assert config.variables["gaze_csv"] == "data/tracking/gaze.csv"
        assert config.variables["output_dir"] == "data/output/"

    def test_from_yaml_resolves_data_references(self, data_section_config_file: Path):
        """Test that $references to data entries can be resolved."""
        config = PipelineConfig.from_yaml(data_section_config_file)

        assert config.resolve_value("$video") == "data/videos/test.mp4"
        assert config.resolve_value("$gaze_csv") == "data/tracking/gaze.csv"

    def test_from_yaml_data_and_variables_merged(self, tmp_path: Path):
        """Test that data section and variables section are merged."""
        yaml_content = """
variables:
  extra_var: some/path.txt

data:
  video:
    type: video
    path: data/video.mp4

pipeline: []
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        # Both should be accessible
        assert config.variables["extra_var"] == "some/path.txt"
        assert config.variables["video"] == "data/video.mp4"

    def test_from_yaml_data_section_string_fallback(self, tmp_path: Path):
        """Test that string values in data section are handled as paths."""
        yaml_content = """
data:
  simple_path: data/simple.csv

pipeline: []
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        assert config.variables["simple_path"] == "data/simple.csv"

    def test_from_yaml_data_section_empty_path(self, tmp_path: Path):
        """Test that data entries without path get empty string."""
        yaml_content = """
data:
  incomplete:
    type: csv

pipeline: []
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        assert config.variables["incomplete"] == ""


class TestStepConfigTaskField:
    """Tests for task field support in StepConfig."""

    def test_from_dict_with_task_field(self):
        """Test creating StepConfig with 'task' field (new format)."""
        data = {"name": "step1", "task": "tasks/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.name == "step1"
        assert step.script == "tasks/step1.py"

    def test_from_dict_with_script_field(self):
        """Test creating StepConfig with 'script' field (legacy format)."""
        data = {"name": "step1", "script": "scripts/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.name == "step1"
        assert step.script == "scripts/step1.py"

    def test_from_dict_task_takes_precedence(self):
        """Test that 'task' field takes precedence over 'script'."""
        data = {"name": "step1", "task": "tasks/step1.py", "script": "scripts/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.script == "tasks/step1.py"

    def test_from_dict_missing_task_and_script_raises(self):
        """Test that missing both 'task' and 'script' raises KeyError."""
        data = {"name": "step1"}
        with pytest.raises(KeyError, match="task.*script"):
            StepConfig.from_dict(data)

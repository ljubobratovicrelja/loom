"""Tests for loom.runner.config module."""

import tempfile
from pathlib import Path

import pytest

from loom.runner.config import LoopConfig, PipelineConfig, StepConfig


class TestStepConfig:
    """Tests for StepConfig dataclass."""

    def test_from_dict_minimal(self) -> None:
        """Test creating StepConfig with minimal required fields."""
        data = {"name": "step1", "script": "scripts/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.name == "step1"
        assert step.script == "scripts/step1.py"
        assert step.inputs == {}
        assert step.outputs == {}
        assert step.args == {}
        assert step.optional is False

    def test_from_dict_full(self) -> None:
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

    def test_from_dict_optional_defaults_to_false(self) -> None:
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
data:
  video:
    type: video
    path: data/video.mp4
  output_csv:
    type: csv
    path: data/output.csv
  viz_output:
    type: video
    path: data/viz.mp4

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

    def test_from_yaml_loads_data_as_variables(self, config_file: Path) -> None:
        """Test that YAML loading correctly parses data section into variables."""
        config = PipelineConfig.from_yaml(config_file)

        assert config.variables["video"] == "data/video.mp4"
        assert config.variables["output_csv"] == "data/output.csv"
        assert config.variables["viz_output"] == "data/viz.mp4"

    def test_from_yaml_loads_parameters(self, config_file: Path) -> None:
        """Test that YAML loading correctly parses parameters."""
        config = PipelineConfig.from_yaml(config_file)

        assert config.parameters["threshold"] == 0.5
        assert config.parameters["verbose"] is True
        assert config.parameters["width"] == 1920

    def test_from_yaml_loads_steps(self, config_file: Path) -> None:
        """Test that YAML loading correctly parses pipeline steps."""
        config = PipelineConfig.from_yaml(config_file)

        assert len(config.steps) == 2
        assert config.steps[0].name == "extract"
        assert config.steps[1].name == "visualize"
        assert config.steps[1].optional is True

    def test_from_yaml_empty_file(self) -> None:
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

    def test_resolve_variable_reference(self, config: PipelineConfig) -> None:
        """Test resolving a variable reference."""
        assert config.resolve_value("$video") == "data/video.mp4"
        assert config.resolve_value("$output") == "data/out.csv"

    def test_resolve_parameter_reference(self, config: PipelineConfig) -> None:
        """Test resolving a parameter reference."""
        assert config.resolve_value("$threshold") == 0.5
        assert config.resolve_value("$verbose") is True

    def test_resolve_non_reference_string(self, config: PipelineConfig) -> None:
        """Test that non-reference strings are returned as-is."""
        assert config.resolve_value("plain_string") == "plain_string"
        assert config.resolve_value("data/file.csv") == "data/file.csv"

    def test_resolve_non_string_values(self, config: PipelineConfig) -> None:
        """Test that non-string values are returned as-is."""
        assert config.resolve_value(42) == 42
        assert config.resolve_value(3.14) == 3.14
        assert config.resolve_value(True) is True
        assert config.resolve_value(None) is None

    def test_resolve_unknown_reference_raises(self, config: PipelineConfig) -> None:
        """Test that unknown references raise ValueError."""
        with pytest.raises(ValueError, match="Unknown reference: \\$unknown"):
            config.resolve_value("$unknown")

    def test_variable_takes_precedence_over_parameter(self) -> None:
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

    def test_get_step_by_name_existing(self, config: PipelineConfig) -> None:
        """Test getting an existing step by name."""
        step = config.get_step_by_name("step2")
        assert step.name == "step2"
        assert step.script == "s2.py"

    def test_get_step_by_name_unknown_raises(self, config: PipelineConfig) -> None:
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

    def test_output_producers_built_correctly(self, config: PipelineConfig) -> None:
        """Test that output producer mapping is built correctly."""
        assert config._output_producers["csv1"] == "extract"
        assert config._output_producers["csv2"] == "process"

    def test_get_step_dependencies_no_deps(self, config: PipelineConfig) -> None:
        """Test step with no dependencies."""
        extract = config.get_step_by_name("extract")
        deps = config.get_step_dependencies(extract)
        assert deps == set()

    def test_get_step_dependencies_single_dep(self, config: PipelineConfig) -> None:
        """Test step with a single dependency."""
        process = config.get_step_by_name("process")
        deps = config.get_step_dependencies(process)
        assert deps == {"extract"}

    def test_get_step_dependencies_multiple_inputs(self, config: PipelineConfig) -> None:
        """Test step with multiple inputs (only one is a dep)."""
        visualize = config.get_step_by_name("visualize")
        deps = config.get_step_dependencies(visualize)
        # video is not produced by any step, only csv2 is
        assert deps == {"process"}


class TestPipelineConfigOverrides:
    """Tests for override methods."""

    def test_override_variables(self) -> None:
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

    def test_override_parameters(self) -> None:
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

    def test_from_yaml_loads_data_section_as_variables(
        self, data_section_config_file: Path
    ) -> None:
        """Test that data section entries are loaded into variables."""
        config = PipelineConfig.from_yaml(data_section_config_file)

        assert "video" in config.variables
        assert "gaze_csv" in config.variables
        assert "output_dir" in config.variables

    def test_from_yaml_extracts_paths_from_data_entries(
        self, data_section_config_file: Path
    ) -> None:
        """Test that path values are extracted from data entries."""
        config = PipelineConfig.from_yaml(data_section_config_file)

        assert config.variables["video"] == "data/videos/test.mp4"
        assert config.variables["gaze_csv"] == "data/tracking/gaze.csv"
        assert config.variables["output_dir"] == "data/output/"

    def test_from_yaml_resolves_data_references(self, data_section_config_file: Path) -> None:
        """Test that $references to data entries can be resolved."""
        config = PipelineConfig.from_yaml(data_section_config_file)

        assert config.resolve_value("$video") == "data/videos/test.mp4"
        assert config.resolve_value("$gaze_csv") == "data/tracking/gaze.csv"

    def test_from_yaml_rejects_variables_section(self, tmp_path: Path) -> None:
        """Test that variables section is rejected with an error."""
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

        with pytest.raises(ValueError, match="variables.*deprecated"):
            PipelineConfig.from_yaml(config_file)

    def test_from_yaml_data_section_string_fallback(self, tmp_path: Path) -> None:
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

    def test_from_yaml_data_section_empty_path(self, tmp_path: Path) -> None:
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


class TestPipelineConfigPathResolution:
    """Tests for path resolution relative to pipeline file."""

    def test_base_dir_set_from_yaml_path(self, tmp_path: Path) -> None:
        """Test that base_dir is set to the pipeline file's directory."""
        subdir = tmp_path / "project" / "pipelines"
        subdir.mkdir(parents=True)
        config_file = subdir / "pipeline.yml"
        config_file.write_text("pipeline: []")

        config = PipelineConfig.from_yaml(config_file)

        assert config.base_dir == subdir.resolve()

    def test_resolve_path_makes_relative_paths_absolute(self, tmp_path: Path) -> None:
        """Test that resolve_path makes relative paths absolute."""
        subdir = tmp_path / "project"
        subdir.mkdir()
        config_file = subdir / "pipeline.yml"
        config_file.write_text("""
data:
  output:
    type: csv
    path: data/output.csv
pipeline: []
""")
        config = PipelineConfig.from_yaml(config_file)

        resolved = config.resolve_path("$output")

        assert resolved.is_absolute()
        assert resolved == subdir / "data" / "output.csv"

    def test_resolve_path_preserves_absolute_paths(self, tmp_path: Path) -> None:
        """Test that resolve_path doesn't modify absolute paths."""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text("""
data:
  output:
    type: csv
    path: /absolute/path/output.csv
pipeline: []
""")
        config = PipelineConfig.from_yaml(config_file)

        resolved = config.resolve_path("$output")

        assert resolved == Path("/absolute/path/output.csv")

    def test_resolve_path_with_parameter_reference(self, tmp_path: Path) -> None:
        """Test that resolve_path works with parameter references."""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text("""
parameters:
  model_name: bert
data:
  output:
    type: json
    path: models/$model_name/weights.pt
pipeline: []
""")
        config = PipelineConfig.from_yaml(config_file)

        # Note: $model_name in data path value won't be expanded by resolve_path
        # since path values are literal strings. This tests the path resolution.
        resolved = config.resolve_path("$output")

        assert resolved.is_absolute()
        assert "models" in str(resolved)

    def test_resolve_script_path_relative(self, tmp_path: Path) -> None:
        """Test that resolve_script_path makes relative script paths absolute."""
        subdir = tmp_path / "project"
        subdir.mkdir()
        config_file = subdir / "pipeline.yml"
        config_file.write_text("pipeline: []")

        config = PipelineConfig.from_yaml(config_file)

        resolved = config.resolve_script_path("tasks/process.py")

        assert resolved.is_absolute()
        assert resolved == subdir / "tasks" / "process.py"

    def test_resolve_script_path_absolute(self, tmp_path: Path) -> None:
        """Test that resolve_script_path preserves absolute paths."""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text("pipeline: []")

        config = PipelineConfig.from_yaml(config_file)

        resolved = config.resolve_script_path("/usr/local/bin/script.py")

        assert resolved == Path("/usr/local/bin/script.py")

    def test_base_dir_default_is_cwd(self) -> None:
        """Test that base_dir defaults to cwd when not loading from file."""
        config = PipelineConfig(variables={}, parameters={}, steps=[])

        assert config.base_dir == Path.cwd()

    def test_resolve_path_with_data_section(self, tmp_path: Path) -> None:
        """Test path resolution with data section entries."""
        subdir = tmp_path / "project"
        subdir.mkdir()
        config_file = subdir / "pipeline.yml"
        config_file.write_text("""
data:
  video:
    type: video
    path: data/input.mp4
pipeline: []
""")
        config = PipelineConfig.from_yaml(config_file)

        resolved = config.resolve_path("$video")

        assert resolved.is_absolute()
        assert resolved == subdir / "data" / "input.mp4"


class TestStepConfigTaskField:
    """Tests for task field support in StepConfig."""

    def test_from_dict_with_task_field(self) -> None:
        """Test creating StepConfig with 'task' field (new format)."""
        data = {"name": "step1", "task": "tasks/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.name == "step1"
        assert step.script == "tasks/step1.py"

    def test_from_dict_with_script_field(self) -> None:
        """Test creating StepConfig with 'script' field (legacy format)."""
        data = {"name": "step1", "script": "scripts/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.name == "step1"
        assert step.script == "scripts/step1.py"

    def test_from_dict_task_takes_precedence(self) -> None:
        """Test that 'task' field takes precedence over 'script'."""
        data = {"name": "step1", "task": "tasks/step1.py", "script": "scripts/step1.py"}
        step = StepConfig.from_dict(data)

        assert step.script == "tasks/step1.py"

    def test_from_dict_missing_task_and_script_raises(self) -> None:
        """Test that missing both 'task' and 'script' raises KeyError."""
        data = {"name": "step1"}
        with pytest.raises(KeyError, match="task.*script"):
            StepConfig.from_dict(data)


class TestPipelineConfigParallelSettings:
    """Tests for parallel execution settings in PipelineConfig."""

    def test_parallel_defaults(self) -> None:
        """Test that parallel settings have correct defaults."""
        config = PipelineConfig(variables={}, parameters={}, steps=[])

        assert config.parallel is False
        assert config.max_workers is None

    def test_from_yaml_loads_parallel_settings(self, tmp_path: Path) -> None:
        """Test that from_yaml loads parallel execution settings."""
        yaml_content = """
execution:
  parallel: true
  max_workers: 4

pipeline: []
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        assert config.parallel is True
        assert config.max_workers == 4

    def test_from_yaml_parallel_defaults(self, tmp_path: Path) -> None:
        """Test that missing execution section uses defaults."""
        yaml_content = """
pipeline: []
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        assert config.parallel is False
        assert config.max_workers is None

    def test_from_yaml_partial_execution_settings(self, tmp_path: Path) -> None:
        """Test that partial execution section uses defaults for missing fields."""
        yaml_content = """
execution:
  parallel: true

pipeline: []
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        assert config.parallel is True
        assert config.max_workers is None


class TestLoopConfig:
    """Tests for LoopConfig dataclass."""

    def test_from_dict_minimal(self) -> None:
        """Test creating LoopConfig with required fields only."""
        data = {"over": "$raw_images", "into": "$processed_images"}
        loop = LoopConfig.from_dict(data)

        assert loop.over == "$raw_images"
        assert loop.into == "$processed_images"
        assert loop.parallel is None
        assert loop.filter is None

    def test_from_dict_full(self) -> None:
        """Test creating LoopConfig with all fields."""
        data = {
            "over": "$raw_images",
            "into": "$processed_images",
            "parallel": True,
            "filter": "*.jpg",
        }
        loop = LoopConfig.from_dict(data)

        assert loop.over == "$raw_images"
        assert loop.into == "$processed_images"
        assert loop.parallel is True
        assert loop.filter == "*.jpg"

    def test_from_dict_missing_over_raises(self) -> None:
        """Test that missing 'over' raises KeyError."""
        with pytest.raises(KeyError, match="over"):
            LoopConfig.from_dict({"into": "$processed"})

    def test_from_dict_missing_into_raises(self) -> None:
        """Test that missing 'into' raises KeyError."""
        with pytest.raises(KeyError, match="into"):
            LoopConfig.from_dict({"over": "$raw"})


class TestStepConfigLoop:
    """Tests for loop field in StepConfig."""

    def test_from_dict_without_loop(self) -> None:
        """Test StepConfig without loop field."""
        data = {"name": "step1", "task": "task.py"}
        step = StepConfig.from_dict(data)
        assert step.loop is None

    def test_from_dict_with_loop(self) -> None:
        """Test StepConfig with loop field."""
        data = {
            "name": "resize_each",
            "task": "tasks/resize.py",
            "loop": {
                "over": "$raw_images",
                "into": "$processed_images",
                "parallel": True,
                "filter": "*.jpg",
            },
            "inputs": {"image": "$loop_item"},
            "outputs": {"--output": "$loop_output"},
        }
        step = StepConfig.from_dict(data)

        assert step.loop is not None
        assert step.loop.over == "$raw_images"
        assert step.loop.into == "$processed_images"
        assert step.loop.parallel is True
        assert step.loop.filter == "*.jpg"
        assert step.inputs == {"image": "$loop_item"}
        assert step.outputs == {"--output": "$loop_output"}


class TestLoopDependencyTracking:
    """Tests for loop step dependency and producer tracking."""

    @pytest.fixture
    def loop_config(self) -> PipelineConfig:
        """Config with a loop step."""
        return PipelineConfig(
            variables={
                "raw": "data/raw",
                "processed": "data/processed",
                "summary": "data/summary.json",
            },
            parameters={},
            steps=[
                StepConfig(
                    name="prepare",
                    script="prepare.py",
                    outputs={"-o": "$raw"},
                ),
                StepConfig(
                    name="process_each",
                    script="process.py",
                    inputs={"image": "$loop_item"},
                    outputs={"--output": "$loop_output"},
                    loop=LoopConfig(over="$raw", into="$processed"),
                ),
                StepConfig(
                    name="summarize",
                    script="summarize.py",
                    inputs={"folder": "$processed"},
                    outputs={"-o": "$summary"},
                ),
            ],
        )

    def test_loop_into_registered_as_produced(self, loop_config: PipelineConfig) -> None:
        """Test that loop.into is registered as produced by the loop step."""
        assert loop_config._output_producers["processed"] == "process_each"

    def test_loop_over_creates_dependency(self, loop_config: PipelineConfig) -> None:
        """Test that loop.over creates a dependency on the step producing it."""
        process_step = loop_config.get_step_by_name("process_each")
        deps = loop_config.get_step_dependencies(process_step)
        assert "prepare" in deps

    def test_downstream_step_depends_on_loop(self, loop_config: PipelineConfig) -> None:
        """Test that a step consuming loop.into depends on the loop step."""
        summarize = loop_config.get_step_by_name("summarize")
        deps = loop_config.get_step_dependencies(summarize)
        assert "process_each" in deps

    def test_loop_step_from_yaml(self, tmp_path: Path) -> None:
        """Test loading a pipeline with a loop step from YAML."""
        yaml_content = """
data:
  raw_images:
    type: image_directory
    path: data/raw
  processed_images:
    type: image_directory
    path: data/processed

parameters:
  width: 512

pipeline:
  - name: resize_each
    task: tasks/resize.py
    loop:
      over: $raw_images
      into: $processed_images
      parallel: true
      filter: "*.jpg"
    inputs:
      image: $loop_item
    outputs:
      --output: $loop_output
    args:
      --width: $width
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)
        config = PipelineConfig.from_yaml(config_file)

        step = config.get_step_by_name("resize_each")
        assert step.loop is not None
        assert step.loop.over == "$raw_images"
        assert step.loop.into == "$processed_images"
        assert step.loop.parallel is True
        assert step.loop.filter == "*.jpg"
        assert config._output_producers["processed_images"] == "resize_each"


class TestResolveValueWithLoop:
    """Tests for PipelineConfig.resolve_value_with_loop method."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Config for testing loop resolution."""
        return PipelineConfig(
            variables={"src_dir": "data/source"},
            parameters={"width": 512},
            steps=[],
        )

    def test_resolves_loop_binding_first(self, config: PipelineConfig) -> None:
        """Test that loop bindings take priority over variables."""
        bindings = {"loop_item": "/data/raw/foo.jpg", "loop_output": "/data/processed/foo.jpg"}
        assert config.resolve_value_with_loop("$loop_item", bindings) == "/data/raw/foo.jpg"
        assert config.resolve_value_with_loop("$loop_output", bindings) == "/data/processed/foo.jpg"

    def test_falls_back_to_regular_resolution(self, config: PipelineConfig) -> None:
        """Test that non-loop refs fall back to resolve_value."""
        bindings = {"loop_item": "/data/raw/foo.jpg"}
        assert config.resolve_value_with_loop("$src_dir", bindings) == "data/source"
        assert config.resolve_value_with_loop("$width", bindings) == 512

    def test_non_reference_returned_as_is(self, config: PipelineConfig) -> None:
        """Test that non-reference values are returned unchanged."""
        bindings = {"loop_item": "/data/raw/foo.jpg"}
        assert config.resolve_value_with_loop("plain_string", bindings) == "plain_string"
        assert config.resolve_value_with_loop(42, bindings) == 42

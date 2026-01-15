"""Tests for loom.editor.execution module.

Tests the bridge between the editor server and the runner module
for building commands from pipeline YAML files.
"""

import sys
from pathlib import Path

import pytest

from loom.editor.execution import (
    build_parallel_commands,
    build_pipeline_commands,
    build_step_command,
    get_step_output_dirs,
    validate_parallel_execution,
)

# Sample YAML with data section (modern format)
SAMPLE_YAML_WITH_DATA = """\
data:
  video:
    type: video
    path: data/videos/test.mp4
  gaze_csv:
    type: csv
    path: data/tracking/gaze.csv
  fixations_csv:
    type: csv
    path: data/tracking/fixations.csv

parameters:
  threshold: 50.0
  verbose: true

pipeline:
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: $video
    outputs:
      --output: $gaze_csv
    args:
      --threshold: $threshold

  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: $gaze_csv
    outputs:
      --output: $fixations_csv
    args:
      --verbose: $verbose

  - name: visualize
    task: tasks/visualize.py
    optional: true
    inputs:
      video: $video
      fixations: $fixations_csv
    outputs:
      --output: data/viz/output.mp4
"""

# Sample YAML with variables section (legacy format)
SAMPLE_YAML_WITH_VARIABLES = """\
variables:
  video: data/videos/test.mp4
  output_csv: data/output.csv

parameters:
  threshold: 0.5

pipeline:
  - name: process
    script: scripts/process.py
    inputs:
      video: $video
    outputs:
      -o: $output_csv
    args:
      --threshold: $threshold
"""


@pytest.fixture
def data_section_config(tmp_path: Path) -> Path:
    """Create a config file with data section."""
    config_file = tmp_path / "pipeline.yml"
    config_file.write_text(SAMPLE_YAML_WITH_DATA)
    return config_file


@pytest.fixture
def variables_section_config(tmp_path: Path) -> Path:
    """Create a config file with variables section."""
    config_file = tmp_path / "pipeline.yml"
    config_file.write_text(SAMPLE_YAML_WITH_VARIABLES)
    return config_file


class TestBuildStepCommand:
    """Tests for build_step_command function."""

    def test_build_command_with_data_section(self, data_section_config: Path):
        """Test building command from config with data section."""
        cmd = build_step_command(data_section_config, "extract_gaze")

        assert cmd[0] == sys.executable
        assert cmd[1] == "tasks/extract_gaze.py"
        assert "data/videos/test.mp4" in cmd
        assert "--output" in cmd
        assert "data/tracking/gaze.csv" in cmd
        assert "--threshold" in cmd
        assert "50.0" in cmd

    def test_build_command_with_variables_section(self, variables_section_config: Path):
        """Test building command from config with variables section."""
        cmd = build_step_command(variables_section_config, "process")

        assert cmd[0] == sys.executable
        assert cmd[1] == "scripts/process.py"
        assert "data/videos/test.mp4" in cmd
        assert "-o" in cmd
        assert "data/output.csv" in cmd

    def test_build_command_resolves_boolean_flags(self, data_section_config: Path):
        """Test that boolean True args add the flag without value."""
        cmd = build_step_command(data_section_config, "detect_fixations")

        assert "--verbose" in cmd
        # Should not have "True" as a value after --verbose
        verbose_idx = cmd.index("--verbose")
        if verbose_idx + 1 < len(cmd):
            assert cmd[verbose_idx + 1] != "True"

    def test_build_command_unknown_step_raises(self, data_section_config: Path):
        """Test that unknown step name raises ValueError."""
        with pytest.raises(ValueError, match="Unknown step"):
            build_step_command(data_section_config, "nonexistent_step")

    def test_build_command_step_with_spaces_in_name(self, tmp_path: Path):
        """Test building command for step with spaces in name."""
        yaml_content = """\
data:
  input:
    type: csv
    path: data/input.csv

pipeline:
  - name: Extract Gaze
    task: tasks/extract.py
    inputs:
      data: $input
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)

        cmd = build_step_command(config_file, "Extract Gaze")

        assert cmd[0] == sys.executable
        assert cmd[1] == "tasks/extract.py"
        assert "data/input.csv" in cmd


class TestBuildPipelineCommands:
    """Tests for build_pipeline_commands function."""

    def test_mode_all_returns_non_optional_steps(self, data_section_config: Path):
        """Test that 'all' mode returns all non-optional steps."""
        commands = build_pipeline_commands(data_section_config, "all")

        step_names = [name for name, _ in commands]
        assert "extract_gaze" in step_names
        assert "detect_fixations" in step_names
        assert "visualize" not in step_names  # Optional step excluded

    def test_mode_step_returns_single_step(self, data_section_config: Path):
        """Test that 'step' mode returns only the specified step."""
        commands = build_pipeline_commands(
            data_section_config, "step", step_name="detect_fixations"
        )

        assert len(commands) == 1
        assert commands[0][0] == "detect_fixations"

    def test_mode_from_step_returns_step_and_subsequent(self, data_section_config: Path):
        """Test that 'from_step' mode returns step and all subsequent."""
        commands = build_pipeline_commands(
            data_section_config, "from_step", step_name="detect_fixations"
        )

        step_names = [name for name, _ in commands]
        assert "extract_gaze" not in step_names
        assert "detect_fixations" in step_names

    def test_mode_to_variable_returns_required_steps(self, tmp_path: Path):
        """Test that 'to_variable' mode returns steps needed to produce variable."""
        # Use tmp_path for outputs so they definitely don't exist
        yaml_content = f"""\
data:
  video:
    type: video
    path: data/videos/test.mp4
  gaze_csv:
    type: csv
    path: {tmp_path}/gaze.csv
  fixations_csv:
    type: csv
    path: {tmp_path}/fixations.csv

pipeline:
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: $video
    outputs:
      --output: $gaze_csv

  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: $gaze_csv
    outputs:
      --output: $fixations_csv
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)

        commands = build_pipeline_commands(
            config_file, "to_variable", variable_name="fixations_csv"
        )

        step_names = [name for name, _ in commands]
        # Should include steps that produce fixations_csv and its dependencies
        assert "extract_gaze" in step_names
        assert "detect_fixations" in step_names

    def test_mode_step_requires_step_name(self, data_section_config: Path):
        """Test that 'step' mode raises if step_name not provided."""
        with pytest.raises(ValueError, match="step_name required"):
            build_pipeline_commands(data_section_config, "step")

    def test_mode_to_variable_requires_variable_name(self, data_section_config: Path):
        """Test that 'to_variable' mode raises if variable_name not provided."""
        with pytest.raises(ValueError, match="variable_name required"):
            build_pipeline_commands(data_section_config, "to_variable")

    def test_commands_have_correct_structure(self, data_section_config: Path):
        """Test that returned commands are tuples of (name, cmd_list)."""
        commands = build_pipeline_commands(data_section_config, "all")

        for name, cmd in commands:
            assert isinstance(name, str)
            assert isinstance(cmd, list)
            assert len(cmd) >= 2  # At least python executable and script
            assert cmd[0] == sys.executable


class TestValidateParallelExecution:
    """Tests for validate_parallel_execution function."""

    def test_no_conflicts_is_valid(self, data_section_config: Path):
        """Test that steps with no output conflicts are valid."""
        # extract_gaze and detect_fixations have different outputs
        is_valid, error = validate_parallel_execution(
            data_section_config, ["extract_gaze", "detect_fixations"]
        )

        assert is_valid is True
        assert error == ""

    def test_output_conflict_is_invalid(self, tmp_path: Path):
        """Test that steps with output conflicts are invalid."""
        yaml_content = """\
data:
  output:
    type: csv
    path: data/output.csv

pipeline:
  - name: step1
    task: tasks/step1.py
    outputs:
      -o: $output
  - name: step2
    task: tasks/step2.py
    outputs:
      -o: $output
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)

        is_valid, error = validate_parallel_execution(config_file, ["step1", "step2"])

        assert is_valid is False
        assert "Output conflict" in error
        assert "$output" in error


class TestBuildParallelCommands:
    """Tests for build_parallel_commands function."""

    def test_returns_commands_for_specified_steps(self, data_section_config: Path):
        """Test that parallel commands are built for specified steps."""
        commands = build_parallel_commands(
            data_section_config, ["extract_gaze", "detect_fixations"]
        )

        assert len(commands) == 2
        step_names = [name for name, _ in commands]
        assert "extract_gaze" in step_names
        assert "detect_fixations" in step_names

    def test_includes_optional_steps_when_specified(self, data_section_config: Path):
        """Test that optional steps can be included in parallel execution."""
        commands = build_parallel_commands(data_section_config, ["extract_gaze", "visualize"])

        step_names = [name for name, _ in commands]
        assert "visualize" in step_names


class TestGetStepOutputDirs:
    """Tests for get_step_output_dirs function."""

    def test_returns_parent_directories(self, data_section_config: Path):
        """Test that parent directories of outputs are returned."""
        dirs = get_step_output_dirs(data_section_config, "extract_gaze")

        # Output is data/tracking/gaze.csv, parent is data/tracking
        dir_strs = [str(d) for d in dirs]
        assert any("data/tracking" in d for d in dir_strs)

    def test_returns_unique_directories(self, tmp_path: Path):
        """Test that duplicate directories are not returned."""
        yaml_content = """\
data:
  out1:
    type: csv
    path: data/output/file1.csv
  out2:
    type: csv
    path: data/output/file2.csv

pipeline:
  - name: multi_output
    task: tasks/multi.py
    outputs:
      --out1: $out1
      --out2: $out2
"""
        config_file = tmp_path / "pipeline.yml"
        config_file.write_text(yaml_content)

        dirs = get_step_output_dirs(config_file, "multi_output")

        # Both outputs are in same directory, should only appear once
        assert len(dirs) == 1

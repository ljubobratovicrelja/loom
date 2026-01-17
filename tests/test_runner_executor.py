"""Tests for loom.runner.executor module."""

import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from loom.runner.config import PipelineConfig, StepConfig
from loom.runner.executor import PipelineExecutor, parse_key_value_args


class TestParseKeyValueArgs:
    """Tests for parse_key_value_args function."""

    def test_parse_string_value(self) -> None:
        """Test parsing string values."""
        result = parse_key_value_args(["name=hello"])
        assert result == {"name": "hello"}

    def test_parse_integer_value(self) -> None:
        """Test parsing integer values."""
        result = parse_key_value_args(["count=42"])
        assert result == {"count": 42}

    def test_parse_float_value(self) -> None:
        """Test parsing float values."""
        result = parse_key_value_args(["threshold=0.75"])
        assert result == {"threshold": 0.75}

    def test_parse_boolean_true(self) -> None:
        """Test parsing boolean true values."""
        result = parse_key_value_args(["enabled=true", "active=True", "on=TRUE"])
        assert result == {"enabled": True, "active": True, "on": True}

    def test_parse_boolean_false(self) -> None:
        """Test parsing boolean false values."""
        result = parse_key_value_args(["disabled=false", "off=False"])
        assert result == {"disabled": False, "off": False}

    def test_parse_multiple_values(self) -> None:
        """Test parsing multiple key=value pairs."""
        result = parse_key_value_args(["a=1", "b=hello", "c=3.14", "d=true"])
        assert result == {"a": 1, "b": "hello", "c": 3.14, "d": True}

    def test_parse_value_with_equals_sign(self) -> None:
        """Test parsing values that contain equals signs."""
        result = parse_key_value_args(["expr=a=b"])
        assert result == {"expr": "a=b"}

    def test_parse_empty_list(self) -> None:
        """Test parsing empty list."""
        result = parse_key_value_args([])
        assert result == {}

    def test_parse_invalid_format_raises(self) -> None:
        """Test that invalid format raises ValueError."""
        with pytest.raises(ValueError, match="Invalid format: invalid"):
            parse_key_value_args(["invalid"])


class TestPipelineExecutorBuildCommand:
    """Tests for PipelineExecutor.build_command method."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a config for testing command building."""
        return PipelineConfig(
            variables={"video": "data/video.mp4", "output": "data/out.csv"},
            parameters={"threshold": 0.5, "verbose": True, "count": 10},
            steps=[],
        )

    def test_build_command_basic(self, config: PipelineConfig) -> None:
        """Test building a basic command with script only."""
        step = StepConfig(name="test", script="scripts/test.py")
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step)

        assert cmd[0] == sys.executable
        # Script path is resolved relative to base_dir (cwd by default)
        assert Path(cmd[1]).name == "test.py"

    def test_build_command_with_inputs(self, config: PipelineConfig) -> None:
        """Test building command with positional inputs."""
        step = StepConfig(
            name="test",
            script="scripts/test.py",
            inputs={"video": "$video"},
        )
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step)

        # Input paths are resolved to absolute
        assert Path(cmd[2]).is_absolute()
        assert Path(cmd[2]).name == "video.mp4"

    def test_build_command_with_outputs(self, config: PipelineConfig) -> None:
        """Test building command with output flags."""
        step = StepConfig(
            name="test",
            script="scripts/test.py",
            outputs={"-o": "$output"},
        )
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step)

        assert "-o" in cmd
        idx = cmd.index("-o")
        # Output paths are resolved to absolute
        assert Path(cmd[idx + 1]).is_absolute()
        assert Path(cmd[idx + 1]).name == "out.csv"

    def test_build_command_with_args(self, config: PipelineConfig) -> None:
        """Test building command with various argument types."""
        step = StepConfig(
            name="test",
            script="scripts/test.py",
            args={"--threshold": "$threshold", "--count": "$count"},
        )
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step)

        assert "--threshold" in cmd
        assert "0.5" in cmd
        assert "--count" in cmd
        assert "10" in cmd

    def test_build_command_with_boolean_flag_true(self, config: PipelineConfig) -> None:
        """Test that boolean True args add the flag."""
        step = StepConfig(
            name="test",
            script="scripts/test.py",
            args={"--verbose": "$verbose"},
        )
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step)

        assert "--verbose" in cmd
        # Should not have a value after --verbose
        idx = cmd.index("--verbose")
        if idx + 1 < len(cmd):
            assert not cmd[idx + 1].startswith("True")

    def test_build_command_with_boolean_flag_false(self, config: PipelineConfig) -> None:
        """Test that boolean False args don't add the flag."""
        config.parameters["disabled"] = False
        step = StepConfig(
            name="test",
            script="scripts/test.py",
            args={"--disabled": "$disabled"},
        )
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step)

        assert "--disabled" not in cmd

    def test_build_command_with_extra_args(self, config: PipelineConfig) -> None:
        """Test building command with extra arguments."""
        step = StepConfig(name="test", script="scripts/test.py")
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step, extra_args="--start 10 --count 5")

        assert "--start" in cmd
        assert "10" in cmd
        assert "--count" in cmd
        assert "5" in cmd

    def test_build_command_full(self, config: PipelineConfig) -> None:
        """Test building a complete command with all components."""
        step = StepConfig(
            name="full",
            script="scripts/process.py",
            inputs={"video": "$video"},
            outputs={"-o": "$output"},
            args={"--threshold": "$threshold", "--verbose": "$verbose"},
        )
        executor = PipelineExecutor(config)
        cmd = executor.build_command(step)

        # Check order: executable, script, inputs, outputs, args
        assert cmd[0] == sys.executable
        assert Path(cmd[1]).name == "process.py"  # script (resolved)
        assert Path(cmd[2]).name == "video.mp4"  # input (resolved)
        assert "-o" in cmd  # output flag
        assert "--threshold" in cmd  # args
        assert "--verbose" in cmd


class TestPipelineExecutorPathResolution:
    """Tests for path resolution in build_command from a YAML file."""

    def test_build_command_resolves_paths_from_yaml(self, tmp_path: Path) -> None:
        """Test that build_command resolves all paths relative to pipeline file."""
        # Create a pipeline in a subdirectory
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        config_file = project_dir / "pipeline.yml"
        config_file.write_text("""
data:
  input_video:
    type: video
    path: data/input.mp4
  output_csv:
    type: csv
    path: data/output.csv

pipeline:
  - name: extract
    task: tasks/extract.py
    inputs:
      video: $input_video
    outputs:
      --output: $output_csv
""")
        config = PipelineConfig.from_yaml(config_file)
        executor = PipelineExecutor(config)
        step = config.get_step_by_name("extract")
        cmd = executor.build_command(step)

        # Script path should be absolute, relative to pipeline dir
        script_path = Path(cmd[1])
        assert script_path.is_absolute()
        assert script_path == project_dir / "tasks" / "extract.py"

        # Input path should be absolute, relative to pipeline dir
        input_path = Path(cmd[2])
        assert input_path.is_absolute()
        assert input_path == project_dir / "data" / "input.mp4"

        # Output path should be absolute, relative to pipeline dir
        output_idx = cmd.index("--output")
        output_path = Path(cmd[output_idx + 1])
        assert output_path.is_absolute()
        assert output_path == project_dir / "data" / "output.csv"

    def test_build_command_from_different_cwd(self, tmp_path: Path) -> None:
        """Test that paths are correct even when cwd differs from pipeline dir."""
        import os

        # Create pipeline in subdirectory
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        config_file = project_dir / "pipeline.yml"
        config_file.write_text("""
data:
  output:
    type: csv
    path: results/out.csv

pipeline:
  - name: process
    task: tasks/process.py
    outputs:
      --output: $output
""")
        # Save current cwd and change to tmp_path (not project_dir)
        original_cwd = os.getcwd()
        try:
            os.chdir(tmp_path)

            # Load config - paths should still be relative to pipeline file
            config = PipelineConfig.from_yaml(config_file)
            executor = PipelineExecutor(config)
            step = config.get_step_by_name("process")
            cmd = executor.build_command(step)

            # Script should resolve to project_dir/tasks/process.py, not tmp_path/tasks/process.py
            script_path = Path(cmd[1])
            assert script_path == project_dir / "tasks" / "process.py"

            # Output should resolve to project_dir/results/out.csv
            output_idx = cmd.index("--output")
            output_path = Path(cmd[output_idx + 1])
            assert output_path == project_dir / "results" / "out.csv"
        finally:
            os.chdir(original_cwd)


class TestPipelineExecutorGetStepsToRun:
    """Tests for PipelineExecutor._get_steps_to_run method."""

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
                StepConfig(name="step4", script="s4.py"),
                StepConfig(name="step5", script="s5.py", optional=True),
            ],
        )

    def test_get_all_non_optional_steps(self, config: PipelineConfig) -> None:
        """Test getting all non-optional steps by default."""
        executor = PipelineExecutor(config)
        steps = executor._get_steps_to_run()

        names = [s.name for s in steps]
        assert names == ["step1", "step2", "step4"]

    def test_get_specific_steps(self, config: PipelineConfig) -> None:
        """Test getting specific steps by name."""
        executor = PipelineExecutor(config)
        steps = executor._get_steps_to_run(steps=["step2", "step4"])

        names = [s.name for s in steps]
        assert names == ["step2", "step4"]

    def test_get_steps_from_step(self, config: PipelineConfig) -> None:
        """Test getting steps from a specific step onward."""
        executor = PipelineExecutor(config)
        steps = executor._get_steps_to_run(from_step="step2")

        names = [s.name for s in steps]
        assert names == ["step2", "step4"]

    def test_get_steps_include_optional(self, config: PipelineConfig) -> None:
        """Test including optional steps."""
        executor = PipelineExecutor(config)
        steps = executor._get_steps_to_run(include_optional=["step3", "step5"])

        names = [s.name for s in steps]
        assert names == ["step1", "step2", "step3", "step4", "step5"]

    def test_get_steps_from_with_optional(self, config: PipelineConfig) -> None:
        """Test from_step combined with include_optional."""
        executor = PipelineExecutor(config)
        steps = executor._get_steps_to_run(from_step="step3", include_optional=["step3"])

        names = [s.name for s in steps]
        assert names == ["step3", "step4"]

    def test_get_specific_optional_step(self, config: PipelineConfig) -> None:
        """Test getting a specific optional step by name."""
        executor = PipelineExecutor(config)
        steps = executor._get_steps_to_run(steps=["step3"])

        assert len(steps) == 1
        assert steps[0].name == "step3"


class TestPipelineExecutorCanRunStep:
    """Tests for PipelineExecutor._can_run_step method."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a config with dependencies."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv"},
            parameters={},
            steps=[
                StepConfig(name="step1", script="s1.py", outputs={"-o": "$a"}),
                StepConfig(name="step2", script="s2.py", inputs={"x": "$a"}, outputs={"-o": "$b"}),
                StepConfig(name="step3", script="s3.py", inputs={"x": "$b"}),
            ],
        )

    def test_can_run_step_no_dependencies(self, config: PipelineConfig) -> None:
        """Test step with no dependencies can always run."""
        executor = PipelineExecutor(config)
        step1 = config.get_step_by_name("step1")

        assert executor._can_run_step(step1) is True

    def test_can_run_step_dependency_not_run(self, config: PipelineConfig) -> None:
        """Test step can run if dependency wasn't run yet."""
        executor = PipelineExecutor(config)
        step2 = config.get_step_by_name("step2")

        # step1 not in results means it wasn't run
        assert executor._can_run_step(step2) is True

    def test_can_run_step_dependency_succeeded(self, config: PipelineConfig) -> None:
        """Test step can run if dependency succeeded."""
        executor = PipelineExecutor(config)
        executor._results["step1"] = True
        step2 = config.get_step_by_name("step2")

        assert executor._can_run_step(step2) is True

    def test_cannot_run_step_dependency_failed(self, config: PipelineConfig) -> None:
        """Test step cannot run if dependency failed."""
        executor = PipelineExecutor(config)
        executor._results["step1"] = False
        step2 = config.get_step_by_name("step2")

        assert executor._can_run_step(step2) is False

    def test_cannot_run_step_transitive_dependency_failed(self, config: PipelineConfig) -> None:
        """Test step cannot run if transitive dependency failed."""
        executor = PipelineExecutor(config)
        executor._results["step1"] = True
        executor._results["step2"] = False
        step3 = config.get_step_by_name("step3")

        assert executor._can_run_step(step3) is False


class TestPipelineExecutorDryRun:
    """Tests for dry run mode."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a simple config for testing."""
        return PipelineConfig(
            variables={"input": "in.txt", "output": "out.txt"},
            parameters={},
            steps=[
                StepConfig(
                    name="process",
                    script="scripts/process.py",
                    inputs={"x": "$input"},
                    outputs={"-o": "$output"},
                ),
            ],
        )

    def test_dry_run_does_not_execute(
        self, config: PipelineConfig, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test that dry run doesn't actually execute commands."""
        executor = PipelineExecutor(config, dry_run=True)
        step = config.steps[0]

        result = executor.run_step(step)

        assert result is None
        captured = capsys.readouterr()
        assert "[DRY RUN]" in captured.out

    def test_dry_run_pipeline_marks_success(self, config: PipelineConfig) -> None:
        """Test that dry run marks steps as successful."""
        executor = PipelineExecutor(config, dry_run=True)
        results = executor.run_pipeline()

        assert results["process"] is True


class TestPipelineExecutorEnsureOutputDirs:
    """Tests for output directory creation."""

    def test_ensure_output_dirs_creates_parent(self) -> None:
        """Test that parent directories are created for outputs."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config = PipelineConfig(
                variables={"output": f"{tmpdir}/subdir/deep/output.csv"},
                parameters={},
                steps=[],
            )
            step = StepConfig(
                name="test",
                script="test.py",
                outputs={"-o": "$output"},
            )
            executor = PipelineExecutor(config)
            executor._ensure_output_dirs(step)

            assert Path(f"{tmpdir}/subdir/deep").exists()


class TestPipelineExecutorRunPipeline:
    """Integration tests for run_pipeline method."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a config for pipeline testing."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv", "c": "c.csv"},
            parameters={},
            steps=[
                StepConfig(name="step1", script="s1.py", outputs={"-o": "$a"}),
                StepConfig(name="step2", script="s2.py", inputs={"x": "$a"}, outputs={"-o": "$b"}),
                StepConfig(name="step3", script="s3.py", inputs={"x": "$b"}, outputs={"-o": "$c"}),
            ],
        )

    def test_run_pipeline_dry_run_all_steps(self, config: PipelineConfig) -> None:
        """Test running full pipeline in dry run mode."""
        executor = PipelineExecutor(config, dry_run=True)
        results = executor.run_pipeline()

        assert len(results) == 3
        assert all(results.values())

    @patch("loom.runner.executor.subprocess.run")
    def test_run_pipeline_skips_after_failure(
        self, mock_run: MagicMock, config: PipelineConfig
    ) -> None:
        """Test that dependent steps are skipped after a failure."""

        # Make step1 fail, step2 and step3 would succeed if run
        def side_effect(cmd: list[str], **kwargs: object) -> MagicMock:
            # step1 fails (script name ends with s1.py)
            if any("s1.py" in str(c) for c in cmd):
                return MagicMock(returncode=1)
            return MagicMock(returncode=0)

        mock_run.side_effect = side_effect

        with tempfile.TemporaryDirectory() as tmpdir:
            # Update config with temp paths so output dirs can be created
            config.variables["a"] = f"{tmpdir}/a.csv"
            config.variables["b"] = f"{tmpdir}/b.csv"
            config.variables["c"] = f"{tmpdir}/c.csv"

            executor = PipelineExecutor(config)
            results = executor.run_pipeline()

            # step1 should fail
            assert results["step1"] is False
            # step2 and step3 should be skipped because step1 failed
            assert results["step2"] is False
            assert results["step3"] is False

    def test_run_pipeline_empty_returns_empty(self, config: PipelineConfig) -> None:
        """Test that empty step selection returns empty results."""
        executor = PipelineExecutor(config, dry_run=True)
        results = executor.run_pipeline(from_step="nonexistent_step")

        # No steps match, so empty
        assert results == {}

    @patch("loom.runner.executor.subprocess.run")
    def test_run_pipeline_actual_execution(
        self, mock_run: MagicMock, config: PipelineConfig
    ) -> None:
        """Test actual execution calls subprocess correctly."""
        mock_run.return_value = MagicMock(returncode=0)

        with tempfile.TemporaryDirectory() as tmpdir:
            # Update config with temp paths
            config.variables["a"] = f"{tmpdir}/a.csv"
            config.variables["b"] = f"{tmpdir}/b.csv"
            config.variables["c"] = f"{tmpdir}/c.csv"

            executor = PipelineExecutor(config, dry_run=False)
            results = executor.run_pipeline(steps=["step1"])

            assert mock_run.called
            assert results["step1"] is True

    @patch("loom.runner.executor.subprocess.run")
    def test_run_pipeline_handles_failure(
        self, mock_run: MagicMock, config: PipelineConfig
    ) -> None:
        """Test that pipeline handles step failure correctly."""
        mock_run.return_value = MagicMock(returncode=1)

        with tempfile.TemporaryDirectory() as tmpdir:
            config.variables["a"] = f"{tmpdir}/a.csv"

            executor = PipelineExecutor(config, dry_run=False)
            results = executor.run_pipeline(steps=["step1"])

            assert results["step1"] is False


class TestBuildDependencyGraph:
    """Tests for _build_dependency_graph method."""

    @pytest.fixture
    def config_diamond(self) -> PipelineConfig:
        """Create a config with diamond dependency pattern (A -> B,C -> D)."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv", "c": "c.csv", "d": "d.csv"},
            parameters={},
            steps=[
                StepConfig(name="step_a", script="a.py", outputs={"-o": "$a"}),
                StepConfig(name="step_b", script="b.py", inputs={"x": "$a"}, outputs={"-o": "$b"}),
                StepConfig(name="step_c", script="c.py", inputs={"x": "$a"}, outputs={"-o": "$c"}),
                StepConfig(
                    name="step_d",
                    script="d.py",
                    inputs={"x": "$b", "y": "$c"},
                    outputs={"-o": "$d"},
                ),
            ],
        )

    def test_build_dependency_graph_diamond(self, config_diamond: PipelineConfig) -> None:
        """Test building dependency graph for diamond pattern."""
        executor = PipelineExecutor(config_diamond)
        deps, dependents = executor._build_dependency_graph(config_diamond.steps)

        # Check dependencies
        assert deps["step_a"] == set()
        assert deps["step_b"] == {"step_a"}
        assert deps["step_c"] == {"step_a"}
        assert deps["step_d"] == {"step_b", "step_c"}

        # Check dependents (reverse mapping)
        assert dependents["step_a"] == {"step_b", "step_c"}
        assert dependents["step_b"] == {"step_d"}
        assert dependents["step_c"] == {"step_d"}
        assert dependents["step_d"] == set()

    def test_build_dependency_graph_subset(self, config_diamond: PipelineConfig) -> None:
        """Test building dependency graph for a subset of steps."""
        executor = PipelineExecutor(config_diamond)
        # Only include step_b and step_d (step_a and step_c are not in the list)
        steps = [
            config_diamond.get_step_by_name("step_b"),
            config_diamond.get_step_by_name("step_d"),
        ]
        deps, _ = executor._build_dependency_graph(steps)

        # step_a is not in the run list, so step_b has no deps
        assert deps["step_b"] == set()
        # step_c is not in the run list, so step_d only depends on step_b
        assert deps["step_d"] == {"step_b"}


class TestParallelExecution:
    """Tests for parallel pipeline execution."""

    @pytest.fixture
    def config_diamond(self) -> PipelineConfig:
        """Create a config with diamond pattern and parallel enabled."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv", "c": "c.csv", "d": "d.csv"},
            parameters={},
            steps=[
                StepConfig(name="step_a", script="a.py", outputs={"-o": "$a"}),
                StepConfig(name="step_b", script="b.py", inputs={"x": "$a"}, outputs={"-o": "$b"}),
                StepConfig(name="step_c", script="c.py", inputs={"x": "$a"}, outputs={"-o": "$c"}),
                StepConfig(
                    name="step_d",
                    script="d.py",
                    inputs={"x": "$b", "y": "$c"},
                    outputs={"-o": "$d"},
                ),
            ],
            parallel=True,
            max_workers=2,
        )

    def test_parallel_dry_run_all_steps(self, config_diamond: PipelineConfig) -> None:
        """Test running full pipeline in parallel dry run mode."""
        executor = PipelineExecutor(config_diamond, dry_run=True)
        results = executor.run_pipeline()

        assert len(results) == 4
        assert all(results.values())

    @patch("loom.runner.executor.subprocess.run")
    def test_parallel_execution_respects_dependencies(
        self, mock_run: MagicMock, config_diamond: PipelineConfig
    ) -> None:
        """Test that parallel execution respects step dependencies."""
        execution_order: list[str] = []

        def mock_subprocess_run(cmd: list[str], **kwargs: dict) -> MagicMock:
            # Extract step name from script path
            script = cmd[1]
            if "a.py" in script:
                execution_order.append("step_a")
            elif "b.py" in script:
                execution_order.append("step_b")
            elif "c.py" in script:
                execution_order.append("step_c")
            elif "d.py" in script:
                execution_order.append("step_d")
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = mock_subprocess_run

        with tempfile.TemporaryDirectory() as tmpdir:
            config_diamond.variables["a"] = f"{tmpdir}/a.csv"
            config_diamond.variables["b"] = f"{tmpdir}/b.csv"
            config_diamond.variables["c"] = f"{tmpdir}/c.csv"
            config_diamond.variables["d"] = f"{tmpdir}/d.csv"

            executor = PipelineExecutor(config_diamond, dry_run=False)
            results = executor.run_pipeline()

            # All should succeed
            assert all(results.values())

            # step_a must run before step_b and step_c
            assert execution_order.index("step_a") < execution_order.index("step_b")
            assert execution_order.index("step_a") < execution_order.index("step_c")

            # step_b and step_c must run before step_d
            assert execution_order.index("step_b") < execution_order.index("step_d")
            assert execution_order.index("step_c") < execution_order.index("step_d")

    @patch("loom.runner.executor.subprocess.run")
    def test_parallel_skips_on_failure(
        self, mock_run: MagicMock, config_diamond: PipelineConfig
    ) -> None:
        """Test that parallel execution skips dependent steps on failure."""

        def mock_subprocess_run(cmd: list[str], **kwargs: dict) -> MagicMock:
            script = cmd[1]
            # Make step_a fail
            if "a.py" in script:
                return MagicMock(returncode=1, stdout="", stderr="error")
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = mock_subprocess_run

        with tempfile.TemporaryDirectory() as tmpdir:
            config_diamond.variables["a"] = f"{tmpdir}/a.csv"
            config_diamond.variables["b"] = f"{tmpdir}/b.csv"
            config_diamond.variables["c"] = f"{tmpdir}/c.csv"
            config_diamond.variables["d"] = f"{tmpdir}/d.csv"

            executor = PipelineExecutor(config_diamond, dry_run=False)
            results = executor.run_pipeline()

            # step_a failed
            assert results["step_a"] is False
            # step_b, step_c, step_d should be skipped (marked as failed)
            assert results["step_b"] is False
            assert results["step_c"] is False
            assert results["step_d"] is False

    def test_parallel_with_max_workers(self) -> None:
        """Test that max_workers setting is respected."""
        config = PipelineConfig(
            variables={},
            parameters={},
            steps=[StepConfig(name="step1", script="s1.py")],
            parallel=True,
            max_workers=2,
        )

        executor = PipelineExecutor(config, dry_run=True)
        results = executor.run_pipeline()

        assert len(results) == 1
        assert results["step1"] is True


class TestRunStepParallel:
    """Tests for _run_step_parallel method."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a simple config for testing."""
        return PipelineConfig(
            variables={"input": "in.txt", "output": "out.txt"},
            parameters={},
            steps=[
                StepConfig(
                    name="process",
                    script="scripts/process.py",
                    inputs={"x": "$input"},
                    outputs={"-o": "$output"},
                ),
            ],
            parallel=True,
        )

    def test_run_step_parallel_dry_run(self, config: PipelineConfig) -> None:
        """Test _run_step_parallel in dry run mode."""
        executor = PipelineExecutor(config, dry_run=True)
        step = config.steps[0]

        name, success, output = executor._run_step_parallel(step)

        assert name == "process"
        assert success is True
        assert "[DRY RUN]" in output

    @patch("loom.runner.executor.subprocess.run")
    def test_run_step_parallel_captures_output(
        self, mock_run: MagicMock, config: PipelineConfig
    ) -> None:
        """Test that _run_step_parallel captures and prefixes output."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="line1\nline2\n",
            stderr="warning\n",
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            config.variables["output"] = f"{tmpdir}/out.txt"

            executor = PipelineExecutor(config, dry_run=False)
            step = config.steps[0]

            name, success, output = executor._run_step_parallel(step)

            assert name == "process"
            assert success is True
            assert "[process] line1" in output
            assert "[process] line2" in output
            assert "[process] warning" in output
            assert "[SUCCESS] process" in output

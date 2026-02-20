"""Tests for loom.runner.cli module."""

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from loom.runner.cli import main


@pytest.fixture
def sample_config_file() -> Path:
    """Create a sample config file for CLI testing."""
    content = """
data:
  input:
    type: txt
    path: data/input.txt
  output:
    type: txt
    path: data/output.txt

parameters:
  threshold: 0.5
  verbose: true

pipeline:
  - name: process
    script: scripts/process.py
    inputs:
      file: $input
    outputs:
      -o: $output
    args:
      --threshold: $threshold
      --verbose: $verbose

  - name: optional_step
    script: scripts/optional.py
    optional: true
    inputs:
      file: $output
"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as f:
        f.write(content)
        return Path(f.name)


class TestCLIBasic:
    """Basic CLI tests."""

    def test_cli_missing_config_returns_error(self) -> None:
        """Test that missing config file returns error code."""
        with patch("sys.argv", ["loom", "nonexistent.yml"]):
            result = main()
            assert result == 1

    def test_cli_dry_run_succeeds(self, sample_config_file: Path) -> None:
        """Test that dry run completes successfully."""
        with patch("sys.argv", ["loom", str(sample_config_file), "--dry-run"]):
            result = main()
            assert result == 0

    def test_cli_help_shows_usage(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Test that --help shows usage information."""
        with patch("sys.argv", ["loom", "--help"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 0

        captured = capsys.readouterr()
        assert "Run pipelines" in captured.out


class TestCLIStepSelection:
    """Tests for step selection CLI options."""

    def test_cli_step_option(
        self, sample_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --step option selects specific steps."""
        with patch("sys.argv", ["loom", str(sample_config_file), "--step", "process", "--dry-run"]):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "process" in captured.out
        assert "optional_step" not in captured.out

    def test_cli_include_optional(
        self, sample_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --include option includes optional steps."""
        with patch(
            "sys.argv",
            ["loom", str(sample_config_file), "--include", "optional_step", "--dry-run"],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "optional_step" in captured.out


class TestCLIOverrides:
    """Tests for CLI override options."""

    def test_cli_set_parameter(
        self, sample_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --set overrides parameters."""
        with patch(
            "sys.argv",
            ["loom", str(sample_config_file), "--set", "threshold=0.9", "--dry-run"],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "0.9" in captured.out

    def test_cli_var_override(
        self, sample_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --var overrides variables."""
        with patch(
            "sys.argv",
            ["loom", str(sample_config_file), "--var", "input=new_input.txt", "--dry-run"],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "new_input.txt" in captured.out

    def test_cli_multiple_set_values(
        self, sample_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test multiple --set values."""
        with patch(
            "sys.argv",
            [
                "loom",
                str(sample_config_file),
                "--set",
                "threshold=0.8",
                "verbose=false",
                "--dry-run",
            ],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "0.8" in captured.out
        # verbose=false means the flag shouldn't appear
        assert "--verbose" not in captured.out


class TestCLIExtraArgs:
    """Tests for extra arguments option."""

    def test_cli_extra_args_single_step(
        self, sample_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --extra with single step adds arguments."""
        with patch(
            "sys.argv",
            [
                "loom",
                str(sample_config_file),
                "--step",
                "process",
                "--extra",
                "--debug --level 2",
                "--dry-run",
            ],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "--debug" in captured.out
        assert "--level" in captured.out
        assert "2" in captured.out


class TestCLIFromStep:
    """Tests for --from option."""

    def test_cli_from_step(
        self, sample_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --from runs from specified step onward."""
        # Create a config with multiple non-optional steps
        content = """
data:
  a:
    type: txt
    path: a.txt
  b:
    type: txt
    path: b.txt
  c:
    type: txt
    path: c.txt

parameters: {}

pipeline:
  - name: step1
    script: s1.py
    outputs:
      -o: $a

  - name: step2
    script: s2.py
    inputs:
      x: $a
    outputs:
      -o: $b

  - name: step3
    script: s3.py
    inputs:
      x: $b
    outputs:
      -o: $c
"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False) as f:
            f.write(content)
            config_path = Path(f.name)

        with patch("sys.argv", ["loom", str(config_path), "--from", "step2", "--dry-run"]):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "step1" not in captured.out
        assert "step2" in captured.out
        assert "step3" in captured.out


class TestCLIReturnCodes:
    """Tests for CLI return codes."""

    def test_cli_returns_zero_on_success(self, sample_config_file: Path) -> None:
        """Test CLI returns 0 on successful dry run."""
        with patch("sys.argv", ["loom", str(sample_config_file), "--dry-run"]):
            result = main()
            assert result == 0

    def test_cli_returns_one_on_missing_config(self) -> None:
        """Test CLI returns 1 when config file is missing."""
        with patch("sys.argv", ["loom", "missing.yml"]):
            result = main()
            assert result == 1


class TestCLIClean:
    """Tests for --clean CLI option."""

    @pytest.fixture
    def clean_config_file(self, tmp_path: Path) -> Path:
        """Create a config file with data files for clean testing.

        This fixture creates a pipeline with:
        - input.txt: source data (not produced by any step)
        - output.csv: generated data (produced by 'process' step)
        - intermediate.txt: generated data (produced by 'process' step)
        """
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "input.txt").write_text("input data")
        (data_dir / "output.csv").write_text("col1,col2\n1,2")
        (data_dir / "intermediate.txt").write_text("intermediate")

        config = tmp_path / "pipeline.yml"
        config.write_text(f"""
data:
  input:
    type: txt
    path: {data_dir}/input.txt
  output:
    type: csv
    path: {data_dir}/output.csv
  intermediate:
    type: txt
    path: {data_dir}/intermediate.txt
  missing:
    type: txt
    path: {data_dir}/missing.txt

parameters: {{}}

pipeline:
  - name: process
    task: tasks/process.py
    inputs:
      data: $input
    outputs:
      result: $output
      temp: $intermediate
""")
        return config

    def test_clean_with_yes_flag(
        self, clean_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --clean -y skips confirmation prompt."""
        with patch("sys.argv", ["loom", str(clean_config_file), "--clean", "-y"]):
            with patch("loom.runner.clean.send2trash") as mock_trash:
                result = main()

        assert result == 0
        # Should have trashed 2 existing generated files (output.csv and intermediate.txt)
        # Source data (input.txt) should be protected
        assert mock_trash.call_count == 2

        captured = capsys.readouterr()
        assert "Moved to trash" in captured.out

    def test_clean_protects_source_data(
        self, clean_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --clean does not delete source data by default."""
        data_dir = clean_config_file.parent / "data"
        input_file = data_dir / "input.txt"
        output_file = data_dir / "output.csv"

        assert input_file.exists()
        assert output_file.exists()

        with patch("sys.argv", ["loom", str(clean_config_file), "--clean", "--permanent", "-y"]):
            result = main()

        assert result == 0
        # Source data (input.txt) should still exist
        assert input_file.exists()
        # Generated data (output.csv) should be deleted
        assert not output_file.exists()

    def test_clean_permanent_flag(
        self, clean_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --clean --permanent permanently deletes generated files."""
        data_dir = clean_config_file.parent / "data"
        output_file = data_dir / "output.csv"
        intermediate_file = data_dir / "intermediate.txt"

        assert output_file.exists()
        assert intermediate_file.exists()

        with patch("sys.argv", ["loom", str(clean_config_file), "--clean", "--permanent", "-y"]):
            result = main()

        assert result == 0
        assert not output_file.exists()
        assert not intermediate_file.exists()

        captured = capsys.readouterr()
        assert "Permanently deleted" in captured.out

    def test_clean_with_confirmation(
        self, clean_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --clean prompts for confirmation."""
        with patch("sys.argv", ["loom", str(clean_config_file), "--clean"]):
            with patch("builtins.input", return_value="y"):
                with patch("loom.runner.clean.send2trash") as mock_trash:
                    result = main()

        assert result == 0
        # Should trash 2 generated files (output.csv and intermediate.txt)
        assert mock_trash.call_count == 2

    def test_clean_cancelled_on_no(
        self, clean_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --clean can be cancelled by answering 'n'."""
        with patch("sys.argv", ["loom", str(clean_config_file), "--clean"]):
            with patch("builtins.input", return_value="n"):
                with patch("loom.runner.clean.send2trash") as mock_trash:
                    result = main()

        assert result == 0
        mock_trash.assert_not_called()

        captured = capsys.readouterr()
        assert "Cancelled" in captured.out

    def test_clean_no_files_to_clean(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --clean with no existing generated files."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  missing:
    type: txt
    path: nonexistent.txt

parameters: {}

pipeline:
  - name: produce
    task: tasks/produce.py
    outputs:
      out: $missing
""")

        with patch("sys.argv", ["loom", str(config), "--clean", "-y"]):
            result = main()

        assert result == 0
        captured = capsys.readouterr()
        assert "No data files to clean" in captured.out

    def test_clean_shows_file_list(
        self, clean_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --clean shows list of generated files to be cleaned."""
        with patch("sys.argv", ["loom", str(clean_config_file), "--clean"]):
            with patch("builtins.input", return_value="n"):
                main()

        captured = capsys.readouterr()
        # Should show generated data
        assert "output" in captured.out
        assert "intermediate" in captured.out
        # Should NOT show source data
        assert (
            "input" not in captured.out
            or "input" in captured.out
            and "protected" in captured.out.lower()
        )


class TestCLIInspection:
    """Tests for --list and --investigate CLI options."""

    @pytest.fixture
    def inspection_config_file(self, tmp_path: Path) -> Path:
        """Create a pipeline config with optional/disabled steps for inspection tests."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        # Create a task with full frontmatter schema
        task_with_schema = tasks_dir / "compute_stats.py"
        task_with_schema.write_text(
            '"""Compute statistics from sensor readings.\n\n'
            "---\n"
            "inputs:\n"
            "  data:\n"
            "    type: csv\n"
            "    description: Input CSV with sensor readings\n"
            "outputs:\n"
            "  --output:\n"
            "    type: csv\n"
            "    description: JSON file with computed statistics\n"
            "args:\n"
            "  --threshold:\n"
            "    type: float\n"
            "    default: 50.0\n"
            "    description: Detection threshold\n"
            "---\n"
            '"""\n'
        )

        # Create a simple task without schema
        simple_task = tasks_dir / "generate_data.py"
        simple_task.write_text('"""Generate synthetic data."""\n')

        config = tmp_path / "pipeline.yml"
        config.write_text(
            """
data:
  raw:
    type: csv
    path: data/raw.csv
  stats:
    type: csv
    path: data/stats.csv

parameters: {}

pipeline:
  - name: generate_data
    task: tasks/generate_data.py
    outputs:
      -o: $raw

  - name: compute_stats
    task: tasks/compute_stats.py
    inputs:
      data: $raw
    outputs:
      --output: $stats

  - name: optional_report
    task: tasks/generate_data.py
    optional: true
    inputs:
      data: $stats

  - name: disabled_export
    task: tasks/generate_data.py
    disabled: true
    inputs:
      data: $stats
"""
        )
        return config

    def test_list_shows_all_steps(
        self, inspection_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --list shows all step names."""
        with patch("sys.argv", ["loom", str(inspection_config_file), "--list"]):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "generate_data" in captured.out
        assert "compute_stats" in captured.out
        assert "optional_report" in captured.out
        assert "disabled_export" in captured.out
        assert "Pipeline steps (4)" in captured.out

    def test_list_marks_optional_steps(
        self, inspection_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --list marks optional and disabled steps."""
        with patch("sys.argv", ["loom", str(inspection_config_file), "--list"]):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "[optional]" in captured.out
        assert "[disabled]" in captured.out

    def test_investigate_requires_step(
        self, inspection_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --investigate without --step prints error and returns 1."""
        with patch("sys.argv", ["loom", str(inspection_config_file), "--investigate"]):
            result = main()
            assert result == 1

        captured = capsys.readouterr()
        assert "Error" in captured.err

    def test_investigate_shows_schema(
        self, inspection_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --investigate shows description, inputs, outputs, and args."""
        with patch(
            "sys.argv",
            ["loom", str(inspection_config_file), "--step", "compute_stats", "--investigate"],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "compute_stats" in captured.out
        assert "Compute statistics from sensor readings" in captured.out
        assert "Inputs:" in captured.out
        assert "data" in captured.out
        assert "Outputs:" in captured.out
        assert "--output" in captured.out
        assert "Args:" in captured.out
        assert "--threshold" in captured.out
        assert "50.0" in captured.out

    def test_investigate_unknown_step(
        self, inspection_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --investigate with nonexistent step name returns error."""
        with patch(
            "sys.argv",
            ["loom", str(inspection_config_file), "--step", "nonexistent", "--investigate"],
        ):
            result = main()
            assert result == 1

        captured = capsys.readouterr()
        assert "Error" in captured.err


class TestCLIGroup:
    """Tests for --group CLI option."""

    @pytest.fixture
    def group_config_file(self, tmp_path: Path) -> Path:
        """Create a pipeline config with grouped steps."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        # Create simple task scripts
        for name in ("gen.py", "load.py", "stats.py", "merge.py"):
            (tasks_dir / name).write_text(f'"""Task: {name}."""\n')

        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  raw:
    type: csv
    path: data/raw.csv
  validated:
    type: csv
    path: data/validated.csv
  stats:
    type: json
    path: data/stats.json
  report:
    type: json
    path: data/report.json

parameters: {}

pipeline:
  - group: ingestion
    steps:
      - name: generate_data
        task: tasks/gen.py
        outputs:
          -o: $raw
      - name: load_data
        task: tasks/load.py
        inputs:
          raw: $raw
        outputs:
          -o: $validated

  - group: analysis
    steps:
      - name: compute_stats
        task: tasks/stats.py
        inputs:
          data: $validated
        outputs:
          -o: $stats

  - name: merge_results
    task: tasks/merge.py
    inputs:
      stats: $stats
    outputs:
      -o: $report
""")
        return config

    def test_group_dry_run(
        self, group_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --group with --dry-run runs only group steps."""
        with patch(
            "sys.argv",
            ["loom", str(group_config_file), "--group", "ingestion", "--dry-run"],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "generate_data" in captured.out
        assert "load_data" in captured.out
        assert "compute_stats" not in captured.out
        assert "merge_results" not in captured.out

    def test_group_unknown_fails(
        self, group_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --group with unknown group name returns exit code 1."""
        with patch(
            "sys.argv",
            ["loom", str(group_config_file), "--group", "nonexistent", "--dry-run"],
        ):
            result = main()
            assert result == 1

        captured = capsys.readouterr()
        assert "Error" in captured.err
        assert "nonexistent" in captured.err

    def test_group_mutual_exclusion_with_step(self, group_config_file: Path) -> None:
        """Test --group and --step are mutually exclusive."""
        with patch(
            "sys.argv",
            ["loom", str(group_config_file), "--group", "ingestion", "--step", "foo"],
        ):
            with pytest.raises(SystemExit):
                main()

    def test_group_mutual_exclusion_with_from(self, group_config_file: Path) -> None:
        """Test --group and --from are mutually exclusive."""
        with patch(
            "sys.argv",
            ["loom", str(group_config_file), "--group", "ingestion", "--from", "foo"],
        ):
            with pytest.raises(SystemExit):
                main()

    def test_group_investigate(
        self, group_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --group with --investigate shows group info."""
        with patch(
            "sys.argv",
            ["loom", str(group_config_file), "--group", "ingestion", "--investigate"],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "Group: ingestion" in captured.out
        assert "Steps: 2" in captured.out
        assert "generate_data" in captured.out
        assert "load_data" in captured.out
        assert "depends on (in-group): generate_data" in captured.out

    def test_list_shows_groups(
        self, group_config_file: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Test --list on grouped pipeline shows Group: sections."""
        with patch(
            "sys.argv",
            ["loom", str(group_config_file), "--list"],
        ):
            result = main()
            assert result == 0

        captured = capsys.readouterr()
        assert "Group: ingestion" in captured.out
        assert "Group: analysis" in captured.out
        assert "merge_results" in captured.out

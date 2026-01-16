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
variables:
  input: data/input.txt
  output: data/output.txt

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
variables:
  a: a.txt
  b: b.txt
  c: c.txt

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

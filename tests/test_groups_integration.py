"""Integration tests for group execution against example pipelines.

These tests run actual pipelines using subprocess to verify end-to-end behavior.
"""

import shutil
import subprocess
import sys
from collections.abc import Generator
from pathlib import Path

import pytest

EXAMPLES_DIR = Path(__file__).parent.parent / "examples"
GROUPS_PIPELINE = EXAMPLES_DIR / "groups" / "pipeline.yml"
DIAMOND_PIPELINE = EXAMPLES_DIR / "diamond" / "pipeline.yml"


@pytest.fixture
def clean_groups_data() -> Generator[None, None, None]:
    """Clean generated data before and after running groups example."""
    data_dir = EXAMPLES_DIR / "groups" / "data"
    if data_dir.exists():
        shutil.rmtree(data_dir)
    yield
    if data_dir.exists():
        shutil.rmtree(data_dir)


@pytest.fixture
def clean_diamond_data() -> Generator[None, None, None]:
    """Clean generated data before and after running diamond example."""
    data_dir = EXAMPLES_DIR / "diamond" / "data"
    if data_dir.exists():
        shutil.rmtree(data_dir)
    yield
    if data_dir.exists():
        shutil.rmtree(data_dir)


class TestGroupIntegration:
    """Integration tests running actual pipelines with --group flag."""

    def test_run_ingestion_group(self, clean_groups_data: None) -> None:
        """Run --group ingestion and verify output files exist."""
        result = subprocess.run(
            [sys.executable, "-m", "loom.runner.cli", str(GROUPS_PIPELINE), "--group", "ingestion"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"

        data_dir = EXAMPLES_DIR / "groups" / "data"
        assert (data_dir / "raw.csv").exists()
        assert (data_dir / "validated.csv").exists()
        # Analysis outputs should NOT exist — only ingestion was run
        assert not (data_dir / "stats.json").exists()
        assert not (data_dir / "final_report.json").exists()

    def test_run_full_pipeline_then_group(self, clean_groups_data: None) -> None:
        """Run full pipeline, then run --group analysis alone."""
        # First, run the full pipeline
        result = subprocess.run(
            [sys.executable, "-m", "loom.runner.cli", str(GROUPS_PIPELINE)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"

        data_dir = EXAMPLES_DIR / "groups" / "data"
        assert (data_dir / "final_report.json").exists()

        # Now delete analysis outputs and re-run only the analysis group
        (data_dir / "stats.json").unlink(missing_ok=True)
        (data_dir / "clean.csv").unlink(missing_ok=True)

        result = subprocess.run(
            [sys.executable, "-m", "loom.runner.cli", str(GROUPS_PIPELINE), "--group", "analysis"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert (data_dir / "stats.json").exists()
        assert (data_dir / "clean.csv").exists()


class TestListIntegration:
    """Integration tests for --list with group and flat formats."""

    def test_list_shows_groups(self) -> None:
        """Run --list on groups example and check for Group: sections."""
        result = subprocess.run(
            [sys.executable, "-m", "loom.runner.cli", str(GROUPS_PIPELINE), "--list"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "Group: ingestion" in result.stdout
        assert "Group: analysis" in result.stdout
        assert "merge_results" in result.stdout

    def test_list_flat_format_no_groups(self) -> None:
        """Run --list on diamond example (no groups) and verify flat format."""
        result = subprocess.run(
            [sys.executable, "-m", "loom.runner.cli", str(DIAMOND_PIPELINE), "--list"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "Group:" not in result.stdout
        assert "generate_data" in result.stdout
        assert "merge_results" in result.stdout


class TestInvestigateGroupIntegration:
    """Integration tests for --investigate --group."""

    def test_investigate_group(self) -> None:
        """Run --group ingestion --investigate and check output."""
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "loom.runner.cli",
                str(GROUPS_PIPELINE),
                "--group",
                "ingestion",
                "--investigate",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "Group: ingestion" in result.stdout
        assert "Steps: 2" in result.stdout
        assert "generate_data" in result.stdout
        assert "load_data" in result.stdout

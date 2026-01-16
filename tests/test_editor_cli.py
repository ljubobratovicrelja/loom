"""Tests for the loom editor CLI."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class TestEditorCLI:
    """Tests for the editor CLI entry point."""

    def test_config_not_found_returns_error(self, tmp_path: Path, capsys) -> None:
        """Should return 1 and print error when config file doesn't exist."""
        from loom.ui.cli import main

        nonexistent = tmp_path / "missing.yml"

        with patch("sys.argv", ["loom-ui", str(nonexistent)]):
            result = main()

        assert result == 1
        captured = capsys.readouterr()
        assert "not found" in captured.out
        assert "Use --new" in captured.out

    def test_new_flag_allows_missing_config(self, tmp_path: Path) -> None:
        """With --new flag, missing config should not be an error."""
        from loom.ui.cli import main

        nonexistent = tmp_path / "new_pipeline.yml"

        with patch("sys.argv", ["loom-ui", str(nonexistent), "--new"]), \
             patch("loom.ui.cli.webbrowser.open"), \
             patch("loom.ui.cli.uvicorn.run") as mock_uvicorn:
            result = main()

        # Should start server (returns 0), not fail with error
        assert result == 0
        mock_uvicorn.assert_called_once()

    def test_tasks_dir_defaults_to_config_parent(self, tmp_path: Path) -> None:
        """Tasks dir should default to tasks/ relative to config file."""
        from loom.ui.cli import main

        config = tmp_path / "pipelines" / "my_pipeline.yml"
        config.parent.mkdir(parents=True)
        config.write_text("variables: {}\npipeline: []")

        with patch("sys.argv", ["loom-ui", str(config)]), \
             patch("loom.ui.cli.webbrowser.open"), \
             patch("loom.ui.cli.uvicorn.run"), \
             patch("loom.ui.server.configure") as mock_configure:
            main()

        # Check that configure was called with correct tasks_dir
        mock_configure.assert_called_once()
        call_kwargs = mock_configure.call_args.kwargs
        assert call_kwargs["tasks_dir"] == tmp_path / "pipelines" / "tasks"

    def test_tasks_dir_override(self, tmp_path: Path) -> None:
        """--tasks-dir should override the default tasks directory."""
        from loom.ui.cli import main

        config = tmp_path / "pipeline.yml"
        config.write_text("variables: {}\npipeline: []")
        custom_tasks = tmp_path / "my_custom_tasks"

        with patch("sys.argv", ["loom-ui", str(config), "--tasks-dir", str(custom_tasks)]), \
             patch("loom.ui.cli.webbrowser.open"), \
             patch("loom.ui.cli.uvicorn.run"), \
             patch("loom.ui.server.configure") as mock_configure:
            main()

        call_kwargs = mock_configure.call_args.kwargs
        assert call_kwargs["tasks_dir"] == custom_tasks

    def test_tasks_dir_fallback_for_new_without_config(self) -> None:
        """With --new and no config, tasks dir should fallback to cwd/tasks."""
        from loom.ui.cli import main

        with patch("sys.argv", ["loom-ui", "--new"]), \
             patch("loom.ui.cli.webbrowser.open"), \
             patch("loom.ui.cli.uvicorn.run"), \
             patch("loom.ui.server.configure") as mock_configure:
            main()

        call_kwargs = mock_configure.call_args.kwargs
        assert call_kwargs["tasks_dir"] == Path("tasks")

    def test_no_browser_flag_skips_browser_open(self, tmp_path: Path, capsys) -> None:
        """--no-browser should prevent browser from opening."""
        from loom.ui.cli import main

        config = tmp_path / "pipeline.yml"
        config.write_text("variables: {}\npipeline: []")

        with patch("sys.argv", ["loom-ui", str(config), "--no-browser"]), \
             patch("loom.ui.cli.webbrowser.open") as mock_browser, \
             patch("loom.ui.cli.uvicorn.run"):
            main()

        mock_browser.assert_not_called()

    def test_browser_opens_by_default(self, tmp_path: Path) -> None:
        """Browser should open by default."""
        from loom.ui.cli import main

        config = tmp_path / "pipeline.yml"
        config.write_text("variables: {}\npipeline: []")

        with patch("sys.argv", ["loom-ui", str(config)]), \
             patch("loom.ui.cli.webbrowser.open") as mock_browser, \
             patch("loom.ui.cli.uvicorn.run"):
            main()

        mock_browser.assert_called_once()
        # Should open with default host:port
        assert "127.0.0.1:8000" in mock_browser.call_args[0][0]

    def test_custom_port_and_host(self, tmp_path: Path) -> None:
        """--port and --host should configure server binding."""
        from loom.ui.cli import main

        config = tmp_path / "pipeline.yml"
        config.write_text("variables: {}\npipeline: []")

        with patch("sys.argv", ["loom-ui", str(config),
                                "--port", "9999", "--host", "0.0.0.0"]), \
             patch("loom.ui.cli.webbrowser.open") as mock_browser, \
             patch("loom.ui.cli.uvicorn.run") as mock_uvicorn:
            main()

        # Check uvicorn was called with custom port/host
        mock_uvicorn.assert_called_once()
        call_kwargs = mock_uvicorn.call_args.kwargs
        assert call_kwargs["port"] == 9999
        assert call_kwargs["host"] == "0.0.0.0"

        # Browser should open with custom port/host
        assert "0.0.0.0:9999" in mock_browser.call_args[0][0]

    def test_existing_config_is_printed(self, tmp_path: Path, capsys) -> None:
        """Should print config path when editing existing file."""
        from loom.ui.cli import main

        config = tmp_path / "pipeline.yml"
        config.write_text("variables: {}\npipeline: []")

        with patch("sys.argv", ["loom-ui", str(config)]), \
             patch("loom.ui.cli.webbrowser.open"), \
             patch("loom.ui.cli.uvicorn.run"):
            main()

        captured = capsys.readouterr()
        assert "Editing:" in captured.out
        assert str(config) in captured.out

    def test_new_pipeline_message(self, capsys) -> None:
        """Should print 'Creating new pipeline' with --new."""
        from loom.ui.cli import main

        with patch("sys.argv", ["loom-ui", "--new"]), \
             patch("loom.ui.cli.webbrowser.open"), \
             patch("loom.ui.cli.uvicorn.run"):
            main()

        captured = capsys.readouterr()
        assert "Creating new pipeline" in captured.out

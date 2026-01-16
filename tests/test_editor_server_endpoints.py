"""Tests for editor server HTTP endpoints and validation logic."""

import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from loom.ui.server import (
    ValidationWarning,
    _get_running_step,
    _is_step_running,
    _register_running_step,
    _running_steps,
    _unregister_running_step,
    _validate_pipeline,
    app,
    configure,
)


# =============================================================================
# Tests for _validate_pipeline()
# =============================================================================


class TestValidatePipeline:
    """Tests for pipeline validation against task schemas."""

    def test_validate_empty_pipeline_returns_no_warnings(self) -> None:
        """Empty pipeline should produce no warnings."""
        yaml_data: dict = {"pipeline": []}
        task_schemas: dict = {}

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert warnings == []

    def test_validate_step_without_schema_returns_no_warnings(self) -> None:
        """Steps without matching schemas should be skipped (no warnings)."""
        yaml_data = {
            "pipeline": [
                {
                    "name": "my_step",
                    "task": "tasks/unknown.py",
                    "inputs": {"video": "$input_video"},
                }
            ],
            "variables": {"input_video": "/path/to/video.mp4"},
        }
        task_schemas: dict = {}  # No schema for this task

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert warnings == []

    def test_validate_typed_input_connected_to_untyped_variable(self) -> None:
        """Should warn when typed input is connected to untyped variable."""
        yaml_data = {
            "pipeline": [
                {
                    "name": "extract_gaze",
                    "task": "tasks/extract_gaze.py",
                    "inputs": {"video": "$input_video"},
                }
            ],
            "variables": {"input_video": "/path/to/video.mp4"},
            "data": {},  # No typed data node for input_video
        }
        task_schemas = {
            "tasks/extract_gaze.py": {
                "inputs": {
                    "video": {"type": "video", "description": "Input video file"}
                }
            }
        }

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert len(warnings) == 1
        assert warnings[0].level == "info"
        assert warnings[0].step == "extract_gaze"
        assert warnings[0].input_output == "video"
        assert "expects type 'video'" in warnings[0].message
        assert "untyped variable" in warnings[0].message

    def test_validate_typed_output_connected_to_untyped_variable(self) -> None:
        """Should warn when typed output is connected to untyped variable."""
        yaml_data = {
            "pipeline": [
                {
                    "name": "extract_gaze",
                    "task": "tasks/extract_gaze.py",
                    "outputs": {"--output": "$gaze_csv"},
                }
            ],
            "variables": {"gaze_csv": "/path/to/gaze.csv"},
            "data": {},
        }
        task_schemas = {
            "tasks/extract_gaze.py": {
                "outputs": {
                    "--output": {"type": "csv", "description": "Output CSV"}
                }
            }
        }

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert len(warnings) == 1
        assert warnings[0].level == "info"
        assert warnings[0].step == "extract_gaze"
        assert warnings[0].input_output == "--output"
        assert "produces type 'csv'" in warnings[0].message

    def test_validate_typed_input_connected_to_data_node_no_warning(self) -> None:
        """Should NOT warn when typed input is connected to typed data node."""
        yaml_data = {
            "pipeline": [
                {
                    "name": "extract_gaze",
                    "task": "tasks/extract_gaze.py",
                    "inputs": {"video": "$input_video"},
                }
            ],
            "variables": {"input_video": "/path/to/video.mp4"},
            "data": {
                "input_video": {"type": "video", "path": "/path/to/video.mp4"}
            },
        }
        task_schemas = {
            "tasks/extract_gaze.py": {
                "inputs": {"video": {"type": "video"}}
            }
        }

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert warnings == []

    def test_validate_input_without_type_in_schema_no_warning(self) -> None:
        """Inputs without type in schema should not produce warnings."""
        yaml_data = {
            "pipeline": [
                {
                    "name": "my_step",
                    "task": "tasks/process.py",
                    "inputs": {"data": "$input_data"},
                }
            ],
            "variables": {"input_data": "/path/to/data"},
        }
        task_schemas = {
            "tasks/process.py": {
                "inputs": {
                    "data": {"description": "Input data (no type specified)"}
                }
            }
        }

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert warnings == []

    def test_validate_literal_input_no_warning(self) -> None:
        """Literal values (not $references) should not produce warnings."""
        yaml_data = {
            "pipeline": [
                {
                    "name": "my_step",
                    "task": "tasks/process.py",
                    "inputs": {"video": "/literal/path.mp4"},
                }
            ],
            "variables": {},
        }
        task_schemas = {
            "tasks/process.py": {
                "inputs": {"video": {"type": "video"}}
            }
        }

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert warnings == []

    def test_validate_multiple_steps_multiple_warnings(self) -> None:
        """Should collect warnings from multiple steps."""
        yaml_data = {
            "pipeline": [
                {
                    "name": "step1",
                    "task": "tasks/task1.py",
                    "inputs": {"video": "$vid"},
                },
                {
                    "name": "step2",
                    "task": "tasks/task2.py",
                    "outputs": {"--out": "$result"},
                },
            ],
            "variables": {"vid": "/video.mp4", "result": "/out.csv"},
            "data": {},
        }
        task_schemas = {
            "tasks/task1.py": {"inputs": {"video": {"type": "video"}}},
            "tasks/task2.py": {"outputs": {"--out": {"type": "csv"}}},
        }

        warnings = _validate_pipeline(yaml_data, task_schemas)

        assert len(warnings) == 2
        step_names = {w.step for w in warnings}
        assert step_names == {"step1", "step2"}


# =============================================================================
# Tests for running step management
# =============================================================================


class TestRunningStepManagement:
    """Tests for concurrent step execution state tracking."""

    def setup_method(self) -> None:
        """Clear running steps before each test."""
        _running_steps.clear()

    def teardown_method(self) -> None:
        """Clear running steps after each test."""
        _running_steps.clear()

    def test_register_running_step(self) -> None:
        """Should register a step with pid and master_fd."""
        _register_running_step("my_step", pid=1234, master_fd=5)

        assert "my_step" in _running_steps
        assert _running_steps["my_step"]["pid"] == 1234
        assert _running_steps["my_step"]["master_fd"] == 5
        assert _running_steps["my_step"]["status"] == "running"

    def test_unregister_running_step(self) -> None:
        """Should remove step from running steps."""
        _register_running_step("my_step", pid=1234, master_fd=5)
        _unregister_running_step("my_step")

        assert "my_step" not in _running_steps

    def test_unregister_nonexistent_step_no_error(self) -> None:
        """Unregistering non-existent step should not raise."""
        _unregister_running_step("nonexistent")  # Should not raise

    def test_is_step_running_true(self) -> None:
        """Should return True for running step."""
        _register_running_step("my_step", pid=1234, master_fd=5)

        assert _is_step_running("my_step") is True

    def test_is_step_running_false_not_registered(self) -> None:
        """Should return False for non-registered step."""
        assert _is_step_running("unknown_step") is False

    def test_is_step_running_false_not_running_status(self) -> None:
        """Should return False if step exists but status is not 'running'."""
        _register_running_step("my_step", pid=1234, master_fd=5)
        _running_steps["my_step"]["status"] = "completed"

        assert _is_step_running("my_step") is False

    def test_get_running_step_returns_info(self) -> None:
        """Should return step info dict."""
        _register_running_step("my_step", pid=1234, master_fd=5)

        info = _get_running_step("my_step")

        assert info is not None
        assert info["pid"] == 1234
        assert info["master_fd"] == 5

    def test_get_running_step_returns_none_for_unknown(self) -> None:
        """Should return None for unknown step."""
        assert _get_running_step("unknown") is None

    def test_multiple_concurrent_steps(self) -> None:
        """Should track multiple steps independently."""
        _register_running_step("step_a", pid=100, master_fd=1)
        _register_running_step("step_b", pid=200, master_fd=2)
        _register_running_step("step_c", pid=300, master_fd=3)

        assert _is_step_running("step_a")
        assert _is_step_running("step_b")
        assert _is_step_running("step_c")

        _unregister_running_step("step_b")

        assert _is_step_running("step_a")
        assert not _is_step_running("step_b")
        assert _is_step_running("step_c")


# =============================================================================
# Tests for HTTP endpoints using TestClient
# =============================================================================


class TestGetStepsFreshness:
    """Tests for /api/steps/freshness endpoint."""

    def test_freshness_no_config_returns_empty(self) -> None:
        """Should return empty freshness when no config loaded."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.get("/api/steps/freshness")

        assert response.status_code == 200
        assert response.json() == {"freshness": {}}

    def test_freshness_missing_outputs(self, tmp_path: Path) -> None:
        """Steps with missing output files should be marked 'missing'."""
        # Create a pipeline with outputs that don't exist
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  input: input.txt
  output: nonexistent_output.txt

pipeline:
  - name: process
    task: tasks/process.py
    inputs:
      data: $input
    outputs:
      -o: $output
""")
        # Create input file
        (tmp_path / "input.txt").write_text("test")

        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/steps/freshness")

        assert response.status_code == 200
        data = response.json()
        assert data["freshness"]["process"]["status"] == "missing"

    def test_freshness_no_outputs_defined(self, tmp_path: Path) -> None:
        """Steps without outputs should be marked 'no_outputs'."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  input: input.txt

pipeline:
  - name: validate
    task: tasks/validate.py
    inputs:
      data: $input
""")
        (tmp_path / "input.txt").write_text("test")

        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/steps/freshness")

        assert response.status_code == 200
        data = response.json()
        assert data["freshness"]["validate"]["status"] == "no_outputs"

    def test_freshness_fresh_outputs(self, tmp_path: Path) -> None:
        """Outputs newer than inputs should be marked 'fresh'."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  input: input.txt
  output: output.txt

pipeline:
  - name: process
    task: tasks/process.py
    inputs:
      data: $input
    outputs:
      -o: $output
""")
        # Create input first
        input_file = tmp_path / "input.txt"
        input_file.write_text("input data")

        # Wait a bit then create output (so output is newer)
        time.sleep(0.05)
        output_file = tmp_path / "output.txt"
        output_file.write_text("output data")

        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/steps/freshness")

        assert response.status_code == 200
        data = response.json()
        assert data["freshness"]["process"]["status"] == "fresh"

    def test_freshness_stale_outputs(self, tmp_path: Path) -> None:
        """Outputs older than inputs should be marked 'stale'."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  input: input.txt
  output: output.txt

pipeline:
  - name: process
    task: tasks/process.py
    inputs:
      data: $input
    outputs:
      -o: $output
""")
        # Create output first
        output_file = tmp_path / "output.txt"
        output_file.write_text("old output")

        # Wait a bit then create/update input (so input is newer)
        time.sleep(0.05)
        input_file = tmp_path / "input.txt"
        input_file.write_text("new input")

        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/steps/freshness")

        assert response.status_code == 200
        data = response.json()
        assert data["freshness"]["process"]["status"] == "stale"


class TestTrashVariableData:
    """Tests for DELETE /api/variables/{name}/data endpoint."""

    def test_trash_no_config_returns_400(self) -> None:
        """Should return 400 when no config loaded."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.delete("/api/variables/myvar/data")

        assert response.status_code == 400
        assert "No config loaded" in response.json()["detail"]

    def test_trash_variable_not_found_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 when variable doesn't exist."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  existing: /some/path
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.delete("/api/variables/nonexistent/data")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    def test_trash_path_not_exists_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 when variable path doesn't exist on disk."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  myvar: nonexistent_file.txt
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.delete("/api/variables/myvar/data")

        assert response.status_code == 404
        assert "does not exist" in response.json()["detail"]

    def test_trash_variable_success(self, tmp_path: Path) -> None:
        """Should trash variable file successfully."""
        config = tmp_path / "pipeline.yml"
        data_file = tmp_path / "data.txt"
        data_file.write_text("test data")

        config.write_text(f"""
variables:
  myvar: {data_file}
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        with patch("loom.ui.server.endpoints.send2trash") as mock_trash:
            response = client.delete("/api/variables/myvar/data")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        mock_trash.assert_called_once_with(str(data_file))

    def test_trash_data_node_success(self, tmp_path: Path) -> None:
        """Should trash data node path successfully."""
        config = tmp_path / "pipeline.yml"
        data_file = tmp_path / "video.mp4"
        data_file.write_text("fake video")

        config.write_text(f"""
data:
  video:
    type: video
    path: {data_file}
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        with patch("loom.ui.server.endpoints.send2trash") as mock_trash:
            response = client.delete("/api/variables/video/data")

        assert response.status_code == 200
        mock_trash.assert_called_once_with(str(data_file))

    def test_trash_resolves_parameter_references(self, tmp_path: Path) -> None:
        """Should resolve $param references in variable paths."""
        config = tmp_path / "pipeline.yml"
        data_dir = tmp_path / "output"
        data_dir.mkdir()
        data_file = data_dir / "result.csv"
        data_file.write_text("data")

        config.write_text(f"""
parameters:
  output_dir: {data_dir}
variables:
  result: $output_dir/result.csv
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        with patch("loom.ui.server.endpoints.send2trash") as mock_trash:
            response = client.delete("/api/variables/result/data")

        assert response.status_code == 200
        mock_trash.assert_called_once()


class TestGetVariablesStatus:
    """Tests for GET /api/variables/status endpoint."""

    def test_status_no_config_returns_empty(self) -> None:
        """Should return empty dict when no config loaded."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.get("/api/variables/status")

        assert response.status_code == 200
        assert response.json() == {}

    def test_status_checks_file_existence(self, tmp_path: Path) -> None:
        """Should return True for existing files, False for missing."""
        config = tmp_path / "pipeline.yml"
        existing_file = tmp_path / "exists.txt"
        existing_file.write_text("content")

        config.write_text(f"""
variables:
  existing: {existing_file}
  missing: {tmp_path}/nonexistent.txt
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/variables/status")

        assert response.status_code == 200
        data = response.json()
        assert data["existing"] is True
        assert data["missing"] is False


class TestGetConfig:
    """Tests for GET /api/config endpoint."""

    def test_get_config_no_path_returns_empty_graph(self) -> None:
        """Should return empty graph when no config path set."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.get("/api/config")

        assert response.status_code == 200
        data = response.json()
        assert data["nodes"] == []
        assert data["edges"] == []
        assert data["variables"] == {}

    def test_get_config_file_not_found_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 when config file doesn't exist."""
        missing = tmp_path / "missing.yml"
        configure(config_path=missing)
        client = TestClient(app)

        response = client.get("/api/config")

        assert response.status_code == 404

    def test_get_config_success(self, tmp_path: Path) -> None:
        """Should return graph for valid config."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  input: data/input.txt
pipeline:
  - name: process
    task: tasks/process.py
    inputs:
      data: $input
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/config")

        assert response.status_code == 200
        data = response.json()
        assert len(data["nodes"]) == 2  # 1 step + 1 variable
        step_nodes = [n for n in data["nodes"] if n["type"] == "step"]
        assert step_nodes[0]["data"]["name"] == "process"


class TestSaveConfig:
    """Tests for POST /api/config endpoint."""

    def test_save_config_no_path_returns_400(self) -> None:
        """Should return 400 when no config path set."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.post("/api/config", json={
            "variables": {},
            "parameters": {},
            "nodes": [],
            "edges": [],
        })

        assert response.status_code == 400

    def test_save_config_creates_parent_dirs(self, tmp_path: Path) -> None:
        """Should create parent directories if they don't exist."""
        config = tmp_path / "subdir" / "deep" / "pipeline.yml"
        configure(config_path=config)
        client = TestClient(app)

        response = client.post("/api/config", json={
            "variables": {"input": "/path"},
            "parameters": {},
            "nodes": [],
            "edges": [],
        })

        assert response.status_code == 200
        assert config.exists()

    def test_save_config_preserves_existing_comments(self, tmp_path: Path) -> None:
        """Should preserve comments when updating existing file."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""# Important comment
variables:
  # Variable comment
  input: old_path
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.post("/api/config", json={
            "variables": {"input": "new_path"},
            "parameters": {},
            "nodes": [
                {
                    "id": "var_input",
                    "type": "variable",
                    "position": {"x": 50, "y": 50},
                    "data": {"name": "input", "value": "new_path"},
                }
            ],
            "edges": [],
        })

        assert response.status_code == 200
        content = config.read_text()
        assert "# Important comment" in content
        assert "new_path" in content


class TestValidateConfig:
    """Tests for GET /api/config/validate endpoint."""

    def test_validate_no_config_returns_empty_warnings(self) -> None:
        """Should return empty warnings list when no config path set."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.get("/api/config/validate")

        assert response.status_code == 200
        data = response.json()
        assert data["warnings"] == []

    def test_validate_missing_config_returns_empty_warnings(self, tmp_path: Path) -> None:
        """Should return empty warnings for non-existent config file."""
        missing = tmp_path / "missing.yml"
        configure(config_path=missing)
        client = TestClient(app)

        response = client.get("/api/config/validate")

        assert response.status_code == 200
        assert response.json()["warnings"] == []

    def test_validate_valid_pipeline_no_warnings(self, tmp_path: Path) -> None:
        """Should return no warnings for valid pipeline without type mismatches."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
variables:
  input_video: /path/to/video.mp4

pipeline:
  - name: process
    task: tasks/process.py
    inputs:
      video: $input_video
""")
        # Note: Schema lookup requires task paths to match exactly.
        # When tasks_dir doesn't contain a file matching the pipeline's task path,
        # no schema is found and no warnings are produced.
        configure(config_path=config, tasks_dir=tmp_path / "tasks")
        client = TestClient(app)

        response = client.get("/api/config/validate")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["warnings"], list)

    def test_validate_with_path_query_param(self, tmp_path: Path) -> None:
        """Should validate a specific config file via path query param."""
        config = tmp_path / "other.yml"
        config.write_text("""
variables:
  input: /path/to/input
pipeline: []
""")
        # Set a different default config
        configure(config_path=tmp_path / "default.yml")
        client = TestClient(app)

        response = client.get("/api/config/validate", params={"path": str(config)})

        assert response.status_code == 200
        # Should validate successfully with no warnings (empty pipeline)
        assert response.json()["warnings"] == []


class TestListTasks:
    """Tests for GET /api/tasks endpoint."""

    def test_list_tasks_empty_directory(self, tmp_path: Path) -> None:
        """Should return empty list when tasks directory is empty."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        configure(tasks_dir=tasks_dir)
        client = TestClient(app)

        response = client.get("/api/tasks")

        assert response.status_code == 200
        assert response.json() == []

    def test_list_tasks_returns_schemas(self, tmp_path: Path) -> None:
        """Should return task schemas from task files."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        # Create a task with schema
        task_file = tasks_dir / "extract_features.py"
        task_file.write_text('''"""Extract features from video.

---
inputs:
  video:
    type: video
    description: Input video file
outputs:
  -o:
    type: csv
    description: Feature CSV
args:
  --batch-size:
    type: int
    default: 32
    description: Batch size for processing
---
"""
''')

        configure(tasks_dir=tasks_dir)
        client = TestClient(app)

        response = client.get("/api/tasks")

        assert response.status_code == 200
        tasks = response.json()
        assert len(tasks) == 1
        task = tasks[0]
        assert task["name"] == "extract_features"
        assert "video" in task["inputs"]
        assert task["inputs"]["video"]["type"] == "video"
        assert "-o" in task["outputs"]
        assert "--batch-size" in task["args"]

    def test_list_tasks_skips_private_files(self, tmp_path: Path) -> None:
        """Should skip files starting with underscore."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        # Create public and private task files
        (tasks_dir / "public_task.py").write_text('"""Public task."""\n')
        (tasks_dir / "_private_task.py").write_text('"""Private task."""\n')

        configure(tasks_dir=tasks_dir)
        client = TestClient(app)

        response = client.get("/api/tasks")

        assert response.status_code == 200
        tasks = response.json()
        # Should only include the public task
        names = [t["name"] for t in tasks]
        assert "public_task" in names
        assert "_private_task" not in names

    def test_list_tasks_multiple_tasks(self, tmp_path: Path) -> None:
        """Should return all tasks sorted by name."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        # Create multiple tasks
        (tasks_dir / "zebra.py").write_text('"""Zebra task."""\n')
        (tasks_dir / "alpha.py").write_text('"""Alpha task."""\n')
        (tasks_dir / "beta.py").write_text('"""Beta task."""\n')

        configure(tasks_dir=tasks_dir)
        client = TestClient(app)

        response = client.get("/api/tasks")

        assert response.status_code == 200
        tasks = response.json()
        names = [t["name"] for t in tasks]
        assert names == ["alpha", "beta", "zebra"]


class TestGetState:
    """Tests for GET /api/state endpoint."""

    def test_get_state_returns_current_paths(self, tmp_path: Path) -> None:
        """Should return current config path and tasks directory."""
        config = tmp_path / "pipeline.yml"
        tasks = tmp_path / "tasks"
        configure(config_path=config, tasks_dir=tasks)
        client = TestClient(app)

        response = client.get("/api/state")

        assert response.status_code == 200
        data = response.json()
        assert data["configPath"] == str(config)
        assert data["tasksDir"] == str(tasks)

    def test_get_state_no_config_returns_null(self) -> None:
        """Should return null configPath when no config set."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.get("/api/state")

        assert response.status_code == 200
        data = response.json()
        assert data["configPath"] is None


class TestRunStatus:
    """Tests for GET /api/run/status endpoint."""

    def test_run_status_idle(self) -> None:
        """Should return idle status when nothing is running."""
        from loom.ui.server import _execution_state
        _execution_state["status"] = "idle"
        _execution_state["current_step"] = None

        client = TestClient(app)
        response = client.get("/api/run/status")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "idle"
        assert data["current_step"] is None

    def test_run_status_running(self) -> None:
        """Should return running status with current step."""
        from loom.ui.server import _execution_state
        _execution_state["status"] = "running"
        _execution_state["current_step"] = "extract_features"

        client = TestClient(app)
        response = client.get("/api/run/status")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert data["current_step"] == "extract_features"

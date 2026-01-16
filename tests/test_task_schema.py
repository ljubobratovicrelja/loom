"""Tests for task schema parsing from YAML frontmatter."""

from pathlib import Path

import pytest

from loom.ui.task_schema import (
    ArgSchema,
    InputOutputSchema,
    TaskSchema,
    extract_docstring,
    list_task_schemas,
    parse_frontmatter,
    parse_task_schema,
)


class TestExtractDocstring:
    """Tests for extract_docstring function."""

    def test_extracts_module_docstring(self, tmp_path: Path) -> None:
        """Should extract module-level docstring from Python file."""
        task_file = tmp_path / "task.py"
        task_file.write_text('''"""This is the docstring."""

def main():
    pass
''')
        result = extract_docstring(task_file)
        assert result == "This is the docstring."

    def test_extracts_multiline_docstring(self, tmp_path: Path) -> None:
        """Should extract multiline docstrings."""
        task_file = tmp_path / "task.py"
        task_file.write_text('''"""Short description.

More details here.
And another line.
"""

def main():
    pass
''')
        result = extract_docstring(task_file)
        assert "Short description." in result
        assert "More details here." in result

    def test_returns_none_for_no_docstring(self, tmp_path: Path) -> None:
        """Should return None when no docstring present."""
        task_file = tmp_path / "task.py"
        task_file.write_text("def main():\n    pass\n")

        result = extract_docstring(task_file)

        assert result is None

    def test_returns_none_for_syntax_error(self, tmp_path: Path) -> None:
        """Should return None for files with syntax errors."""
        task_file = tmp_path / "bad.py"
        task_file.write_text("def broken(\n")

        result = extract_docstring(task_file)

        assert result is None

    def test_returns_none_for_missing_file(self, tmp_path: Path) -> None:
        """Should return None for non-existent files."""
        result = extract_docstring(tmp_path / "nonexistent.py")
        assert result is None


class TestParseFrontmatter:
    """Tests for parse_frontmatter function."""

    def test_parses_valid_frontmatter(self) -> None:
        """Should parse YAML frontmatter delimited by ---."""
        docstring = """Short description.

---
inputs:
  video: Input video file
outputs:
  -o: Output file
---
"""
        result = parse_frontmatter(docstring)

        assert result is not None
        assert result["inputs"] == {"video": "Input video file"}
        assert result["outputs"] == {"-o": "Output file"}

    def test_returns_none_for_no_frontmatter(self) -> None:
        """Should return None when no frontmatter present."""
        docstring = "Just a plain docstring.\n\nNo frontmatter here."

        result = parse_frontmatter(docstring)

        assert result is None

    def test_returns_none_for_empty_docstring(self) -> None:
        """Should return None for empty string."""
        assert parse_frontmatter("") is None
        assert parse_frontmatter(None) is None  # type: ignore

    def test_returns_none_for_invalid_yaml(self) -> None:
        """Should return None for invalid YAML in frontmatter."""
        docstring = """Description.

---
invalid: yaml: syntax: here
  - bad indentation
---
"""
        result = parse_frontmatter(docstring)
        assert result is None

    def test_handles_complex_frontmatter(self) -> None:
        """Should parse frontmatter with nested structures."""
        docstring = """Description.

---
inputs:
  video:
    type: video
    description: Input video
args:
  --threshold:
    type: float
    default: 50.0
    choices:
      - 25.0
      - 50.0
      - 75.0
---
"""
        result = parse_frontmatter(docstring)

        assert result is not None
        assert result["inputs"]["video"]["type"] == "video"
        assert result["args"]["--threshold"]["default"] == 50.0
        assert result["args"]["--threshold"]["choices"] == [25.0, 50.0, 75.0]


class TestParseTaskSchema:
    """Tests for parse_task_schema function."""

    def test_parses_minimal_task(self, tmp_path: Path) -> None:
        """Task without docstring should produce minimal schema."""
        task_file = tmp_path / "simple.py"
        task_file.write_text("def main(): pass\n")

        result = parse_task_schema(task_file)

        assert result.name == "simple"
        assert result.path == str(task_file)
        assert result.description == ""
        assert result.inputs == {}
        assert result.outputs == {}
        assert result.args == {}

    def test_parses_docstring_only(self, tmp_path: Path) -> None:
        """Task with docstring but no frontmatter should get description."""
        task_file = tmp_path / "task.py"
        task_file.write_text('"""Process video files."""\n\ndef main(): pass\n')

        result = parse_task_schema(task_file)

        assert result.name == "task"
        assert result.description == "Process video files."
        assert result.inputs == {}

    def test_parses_old_format_inputs(self, tmp_path: Path) -> None:
        """Should parse old format (string descriptions) for inputs."""
        task_file = tmp_path / "task.py"
        task_file.write_text('''"""Process data.

---
inputs:
  video: Input video file
  csv: Input CSV data
---
"""
''')
        result = parse_task_schema(task_file)

        assert "video" in result.inputs
        assert result.inputs["video"].description == "Input video file"
        assert result.inputs["video"].type is None  # Old format has no type

    def test_parses_new_format_inputs_with_types(self, tmp_path: Path) -> None:
        """Should parse new format (dict with type) for inputs."""
        task_file = tmp_path / "task.py"
        task_file.write_text('''"""Process data.

---
inputs:
  video:
    type: video
    description: Input video file
  gaze_csv:
    type: csv
    description: Gaze data
---
"""
''')
        result = parse_task_schema(task_file)

        assert result.inputs["video"].type == "video"
        assert result.inputs["video"].description == "Input video file"
        assert result.inputs["gaze_csv"].type == "csv"

    def test_parses_outputs(self, tmp_path: Path) -> None:
        """Should parse output definitions."""
        task_file = tmp_path / "task.py"
        task_file.write_text('''"""Generate output.

---
outputs:
  -o: Output file path
  --secondary:
    type: json
    description: Secondary output
---
"""
''')
        result = parse_task_schema(task_file)

        assert result.outputs["-o"].description == "Output file path"
        assert result.outputs["--secondary"].type == "json"

    def test_parses_args_with_full_schema(self, tmp_path: Path) -> None:
        """Should parse args with type, default, choices."""
        task_file = tmp_path / "task.py"
        task_file.write_text('''"""Process data.

---
args:
  --threshold:
    type: float
    default: 50.0
    description: Detection threshold
    required: false
  --mode:
    type: str
    default: fast
    choices:
      - fast
      - accurate
---
"""
''')
        result = parse_task_schema(task_file)

        threshold = result.args["--threshold"]
        assert threshold.type == "float"
        assert threshold.default == 50.0
        assert threshold.description == "Detection threshold"
        assert threshold.required is False

        mode = result.args["--mode"]
        assert mode.choices == ["fast", "accurate"]

    def test_parses_args_simple_format(self, tmp_path: Path) -> None:
        """Should handle simple arg format (just description)."""
        task_file = tmp_path / "task.py"
        task_file.write_text('''"""Process data.

---
args:
  --verbose: Enable verbose output
---
"""
''')
        result = parse_task_schema(task_file)

        assert result.args["--verbose"].description == "Enable verbose output"
        assert result.args["--verbose"].type == "str"  # Default type


class TestTaskSchemaToDict:
    """Tests for TaskSchema.to_dict() method."""

    def test_serializes_complete_schema(self) -> None:
        """Should serialize all fields to dict."""
        schema = TaskSchema(
            name="test_task",
            path="tasks/test_task.py",
            description="Test description",
            inputs={
                "video": InputOutputSchema(
                    name="video", description="Input video", type="video"
                )
            },
            outputs={
                "-o": InputOutputSchema(name="-o", description="Output file")
            },
            args={
                "--threshold": ArgSchema(
                    name="--threshold",
                    type="float",
                    default=50.0,
                    description="Threshold",
                    required=True,
                    choices=None,
                )
            },
        )

        result = schema.to_dict()

        assert result["name"] == "test_task"
        assert result["path"] == "tasks/test_task.py"
        assert result["description"] == "Test description"
        assert result["inputs"]["video"]["type"] == "video"
        assert result["outputs"]["-o"]["description"] == "Output file"
        assert result["args"]["--threshold"]["type"] == "float"
        assert result["args"]["--threshold"]["required"] is True


class TestListTaskSchemas:
    """Tests for list_task_schemas function."""

    def test_returns_empty_for_missing_directory(self, tmp_path: Path) -> None:
        """Should return empty list when directory doesn't exist."""
        result = list_task_schemas(tmp_path / "nonexistent")
        assert result == []

    def test_returns_empty_for_empty_directory(self, tmp_path: Path) -> None:
        """Should return empty list when no Python files."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        result = list_task_schemas(tasks_dir)

        assert result == []

    def test_skips_private_files(self, tmp_path: Path) -> None:
        """Should skip files starting with underscore."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "_helper.py").write_text("# private\n")
        (tasks_dir / "__init__.py").write_text("# init\n")
        (tasks_dir / "public_task.py").write_text('"""A task."""\n')

        result = list_task_schemas(tasks_dir)

        assert len(result) == 1
        assert result[0].name == "public_task"

    def test_skips_runner_file(self, tmp_path: Path) -> None:
        """Should skip runner.py file."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "runner.py").write_text("# runner\n")
        (tasks_dir / "task.py").write_text('"""A task."""\n')

        result = list_task_schemas(tasks_dir)

        assert len(result) == 1
        assert result[0].name == "task"

    def test_lists_multiple_tasks_sorted(self, tmp_path: Path) -> None:
        """Should list tasks in sorted order."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()
        (tasks_dir / "zebra.py").write_text('"""Zebra task."""\n')
        (tasks_dir / "alpha.py").write_text('"""Alpha task."""\n')
        (tasks_dir / "beta.py").write_text('"""Beta task."""\n')

        result = list_task_schemas(tasks_dir)

        names = [s.name for s in result]
        assert names == ["alpha", "beta", "zebra"]

    def test_parses_all_tasks_with_schemas(self, tmp_path: Path) -> None:
        """Should parse schemas for all tasks."""
        tasks_dir = tmp_path / "tasks"
        tasks_dir.mkdir()

        (tasks_dir / "extract.py").write_text('''"""Extract gaze data.

---
inputs:
  video:
    type: video
    description: Input video
outputs:
  -o:
    type: csv
    description: Output CSV
---
"""
''')
        (tasks_dir / "process.py").write_text('"""Process data."""\n')

        result = list_task_schemas(tasks_dir)

        assert len(result) == 2

        extract = next(s for s in result if s.name == "extract")
        assert extract.inputs["video"].type == "video"
        assert extract.outputs["-o"].type == "csv"

        process = next(s for s in result if s.name == "process")
        assert process.description == "Process data."
        assert process.inputs == {}

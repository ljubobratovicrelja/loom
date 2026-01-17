"""Parse task schema from YAML frontmatter in task docstrings.

Tasks can define their interface using YAML frontmatter in the module docstring.

**Basic format** (just descriptions):
```python
\"\"\"Short description of the task.

---
inputs:
  video: Path to input video file
  gaze_csv: Path to gaze positions CSV
outputs:
  -o: Output CSV file
args:
  --threshold:
    type: float
    default: 50.0
    description: Detection threshold
---
\"\"\"
```

**Typed format** (with data types for validation):
```python
\"\"\"Short description of the task.

---
inputs:
  video:
    type: video
    description: Path to input video file
  gaze_csv:
    type: csv
    description: Path to gaze positions CSV
outputs:
  -o:
    type: csv
    description: Output CSV file
args:
  --threshold:
    type: float
    default: 50.0
    description: Detection threshold
---
\"\"\"
```

The frontmatter is delimited by `---` lines and contains:
- inputs: Named input files (positional arguments)
- outputs: Output file flags (typically -o/--output)
- args: Additional arguments with type, default, and description

Supported data types for inputs/outputs:
- video: Video files (mp4, avi, mov, webm)
- image: Image files (png, jpg, jpeg, webp, bmp)
- csv: CSV data files
- json: JSON configuration/data files
- image_directory: Directory containing images
- data_folder: Generic data directory
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class ArgSchema:
    """Schema for a single argument."""

    name: str
    type: str = "str"
    default: Any = None
    description: str = ""
    required: bool = False
    choices: list[str] | None = None


@dataclass
class InputOutputSchema:
    """Schema for a single input or output.

    Supports both old format (just description string) and new format with type.
    Valid types: video, image, csv, json, image_directory, data_folder
    """

    name: str
    description: str = ""
    type: str | None = None  # video, image, csv, json, image_directory, data_folder

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        result: dict[str, Any] = {"description": self.description}
        if self.type is not None:
            result["type"] = self.type
        return result


@dataclass
class TaskSchema:
    """Schema for a task's interface."""

    name: str
    path: str
    description: str = ""
    inputs: dict[str, InputOutputSchema] = field(default_factory=dict)
    outputs: dict[str, InputOutputSchema] = field(default_factory=dict)
    args: dict[str, ArgSchema] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "path": self.path,
            "description": self.description,
            "inputs": {name: io.to_dict() for name, io in self.inputs.items()},
            "outputs": {name: io.to_dict() for name, io in self.outputs.items()},
            "args": {
                name: {
                    "type": arg.type,
                    "default": arg.default,
                    "description": arg.description,
                    "required": arg.required,
                    "choices": arg.choices,
                }
                for name, arg in self.args.items()
            },
        }


def extract_docstring(file_path: Path) -> str | None:
    """Extract module docstring from a Python file without importing it.

    Args:
        file_path: Path to Python file.

    Returns:
        Module docstring or None if not found.
    """
    try:
        with open(file_path) as f:
            source = f.read()
        tree = ast.parse(source)
        return ast.get_docstring(tree)
    except (SyntaxError, FileNotFoundError):
        return None


def parse_frontmatter(docstring: str) -> dict | None:
    """Extract and parse YAML frontmatter from docstring.

    Args:
        docstring: Module docstring potentially containing frontmatter.

    Returns:
        Parsed YAML dict or None if no frontmatter found.
    """
    if not docstring:
        return None

    # Find frontmatter delimited by ---
    pattern = r"^---\s*\n(.*?)\n---\s*$"
    match = re.search(pattern, docstring, re.MULTILINE | re.DOTALL)

    if not match:
        return None

    try:
        result = yaml.safe_load(match.group(1))
        return dict(result) if result else None
    except yaml.YAMLError:
        return None


def parse_task_schema(file_path: Path) -> TaskSchema:
    """Parse task schema from a Python task file.

    Args:
        file_path: Path to task Python file.

    Returns:
        TaskSchema with parsed interface, or minimal schema if no frontmatter.
    """
    name = file_path.stem
    path = str(file_path)

    # Extract docstring
    docstring = extract_docstring(file_path)
    if not docstring:
        return TaskSchema(name=name, path=path)

    # Get first line as description
    first_line = docstring.split("\n")[0].strip()

    # Parse frontmatter
    frontmatter = parse_frontmatter(docstring)
    if not frontmatter:
        return TaskSchema(name=name, path=path, description=first_line)

    # Parse inputs (support old string format and new dict format)
    inputs_raw = frontmatter.get("inputs", {}) or {}
    inputs: dict[str, InputOutputSchema] = {}
    for input_name, input_info in inputs_raw.items():
        if isinstance(input_info, str):
            # Old format: just description string
            inputs[input_name] = InputOutputSchema(name=input_name, description=input_info)
        elif isinstance(input_info, dict):
            # New format: dict with type and description
            inputs[input_name] = InputOutputSchema(
                name=input_name,
                description=input_info.get("description", ""),
                type=input_info.get("type"),
            )
        else:
            # Fallback: convert to string
            inputs[input_name] = InputOutputSchema(
                name=input_name, description=str(input_info) if input_info else ""
            )

    # Parse outputs (support old string format and new dict format)
    outputs_raw = frontmatter.get("outputs", {}) or {}
    outputs: dict[str, InputOutputSchema] = {}
    for output_name, output_info in outputs_raw.items():
        if isinstance(output_info, str):
            # Old format: just description string
            outputs[output_name] = InputOutputSchema(name=output_name, description=output_info)
        elif isinstance(output_info, dict):
            # New format: dict with type and description
            outputs[output_name] = InputOutputSchema(
                name=output_name,
                description=output_info.get("description", ""),
                type=output_info.get("type"),
            )
        else:
            # Fallback: convert to string
            outputs[output_name] = InputOutputSchema(
                name=output_name, description=str(output_info) if output_info else ""
            )

    # Parse args
    args_data = frontmatter.get("args", {}) or {}
    args = {}
    for arg_name, arg_info in args_data.items():
        if isinstance(arg_info, dict):
            args[arg_name] = ArgSchema(
                name=arg_name,
                type=arg_info.get("type", "str"),
                default=arg_info.get("default"),
                description=arg_info.get("description", ""),
                required=arg_info.get("required", False),
                choices=arg_info.get("choices"),
            )
        else:
            # Simple format: just description
            args[arg_name] = ArgSchema(name=arg_name, description=str(arg_info))

    return TaskSchema(
        name=name,
        path=path,
        description=first_line,
        inputs=inputs,
        outputs=outputs,
        args=args,
    )


def list_task_schemas(tasks_dir: Path) -> list[TaskSchema]:
    """List all tasks with their schemas.

    Args:
        tasks_dir: Directory containing task Python files.

    Returns:
        List of TaskSchema objects.
    """
    schemas: list[TaskSchema] = []
    if not tasks_dir.exists():
        return schemas

    for py_file in sorted(tasks_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        # Skip non-task files
        if py_file.name in ("runner.py", "__init__.py"):
            continue
        schemas.append(parse_task_schema(py_file))

    return schemas

"""HTTP API endpoints for the pipeline editor server."""

import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from ruamel.yaml import YAML
from send2trash import send2trash

from . import state
from .graph import update_yaml_from_graph, yaml_to_graph
from .models import ExecutionStatus, PipelineGraph, ValidationResult
from .validation import validate_pipeline

# Create YAML instance that preserves comments
_yaml = YAML()
_yaml.preserve_quotes = True

# Create router for API endpoints
router = APIRouter()

# Frontend directory path
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"


@router.get("/api/config/validate")
def validate_config(path: str = Query(None)) -> ValidationResult:
    """Validate pipeline configuration and return warnings."""
    from ..task_schema import list_task_schemas

    config_path = Path(path) if path else state.config_path
    if not config_path or not config_path.exists():
        return ValidationResult(warnings=[])

    with open(config_path) as f:
        data = _yaml.load(f) or {}

    # Build task schema lookup
    schemas = list_task_schemas(state.tasks_dir)
    task_schemas = {schema.path: schema.to_dict() for schema in schemas}

    warnings = validate_pipeline(dict(data), task_schemas)
    return ValidationResult(warnings=warnings)


@router.get("/api/config")
def get_config(path: str = Query(None)) -> PipelineGraph:
    """Load pipeline config and return as graph."""
    config_path = Path(path) if path else state.config_path
    if not config_path:
        # Return empty graph for new pipeline
        return PipelineGraph(variables={}, parameters={}, data={}, nodes=[], edges=[])

    if not config_path.exists():
        raise HTTPException(404, f"Config not found: {config_path}")

    with open(config_path) as f:
        data = _yaml.load(f) or {}

    return yaml_to_graph(dict(data))


@router.post("/api/config")
def save_config(graph: PipelineGraph, path: str = Query(None)) -> dict[str, str]:
    """Save graph as YAML config, preserving comments from original file."""
    config_path = Path(path) if path else state.config_path
    if not config_path:
        raise HTTPException(400, "No config path specified")

    # Ensure parent directory exists
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # Load original file to preserve comments, or create new structure
    if config_path.exists():
        with open(config_path) as f:
            data = _yaml.load(f)
    else:
        data = {}

    # Update the data structure in-place to preserve comments
    update_yaml_from_graph(data, graph)

    with open(config_path, "w") as f:
        _yaml.dump(data, f)

    return {"status": "saved", "path": str(config_path)}


@router.get("/api/tasks")
def list_tasks() -> list[dict[str, Any]]:
    """List available tasks with their schemas.

    Returns task schemas parsed from YAML frontmatter in task docstrings.
    Each schema includes:
    - name: Task name (filename without .py)
    - path: Full path to task file
    - description: Short description from docstring
    - inputs: Named input files (positional arguments)
    - outputs: Output file flags (typically -o)
    - args: Additional arguments with type, default, description
    """
    from ..task_schema import list_task_schemas

    schemas = list_task_schemas(state.tasks_dir)
    return [schema.to_dict() for schema in schemas]


@router.get("/api/state")
def get_state() -> dict[str, Any]:
    """Get current editor state."""
    return {
        "configPath": str(state.config_path) if state.config_path else None,
        "tasksDir": str(state.tasks_dir),
    }


@router.get("/api/variables/status")
def get_variables_status() -> dict[str, bool]:
    """Check which variable and data node paths exist on disk.

    Returns a map of name -> exists (bool).
    Paths are resolved relative to the pipeline file's directory.
    """
    from loom.runner import PipelineConfig

    if not state.config_path or not state.config_path.exists():
        return {}

    try:
        config = PipelineConfig.from_yaml(state.config_path)
    except Exception:
        return {}

    result = {}

    # Check all variable paths
    for name in config.variables:
        try:
            path = config.resolve_path(f"${name}")
            result[name] = path.exists()
        except (ValueError, OSError):
            result[name] = False

    return result


@router.get("/api/steps/freshness")
def get_steps_freshness() -> dict[str, dict[str, dict[str, str]]]:
    """Check freshness status of each step based on file timestamps.

    Compares input file modification times vs output file modification times.
    A step is:
    - "fresh": All outputs exist and are newer than all inputs
    - "stale": Outputs exist but at least one input is newer
    - "missing": One or more outputs don't exist
    - "no_outputs": Step has no outputs defined

    Returns a map of step_name -> {"status": status, "reason": reason}.
    """
    from loom.runner import PipelineConfig

    if not state.config_path or not state.config_path.exists():
        return {"freshness": {}}

    try:
        config = PipelineConfig.from_yaml(state.config_path)
    except Exception:
        return {"freshness": {}}

    freshness: dict[str, dict[str, str]] = {}

    for step in config.steps:
        step_name = step.name

        # Skip steps with no outputs
        if not step.outputs:
            freshness[step_name] = {"status": "no_outputs", "reason": "No outputs defined"}
            continue

        # Get output file paths and their mtimes
        output_paths = []
        output_mtimes = []
        missing_outputs = []

        for var_ref in step.outputs.values():
            try:
                output_path = config.resolve_path(var_ref)
                output_paths.append(output_path)

                if output_path.exists():
                    output_mtimes.append(output_path.stat().st_mtime)
                else:
                    missing_outputs.append(str(output_path))
            except Exception:
                missing_outputs.append(var_ref)

        # If any output is missing, step needs to run
        if missing_outputs:
            freshness[step_name] = {
                "status": "missing",
                "reason": f"Missing: {', '.join(missing_outputs[:2])}{'...' if len(missing_outputs) > 2 else ''}",
            }
            continue

        # Get input file paths and their mtimes
        input_mtimes = []
        newest_input = None
        newest_input_path = None

        for var_ref in step.inputs.values():
            try:
                input_path = config.resolve_path(var_ref)

                if input_path.exists():
                    mtime = input_path.stat().st_mtime
                    input_mtimes.append(mtime)
                    if newest_input is None or mtime > newest_input:
                        newest_input = mtime
                        newest_input_path = input_path
            except Exception:
                pass  # Non-file inputs (parameters) are ignored

        # Compare timestamps
        if not output_mtimes:
            freshness[step_name] = {"status": "missing", "reason": "No output files found"}
            continue

        oldest_output = min(output_mtimes)

        # If any input is newer than the oldest output, step is stale
        if newest_input is not None and newest_input > oldest_output:
            freshness[step_name] = {
                "status": "stale",
                "reason": f"Input newer: {newest_input_path.name if newest_input_path else 'unknown'}",
            }
        else:
            freshness[step_name] = {"status": "fresh", "reason": "All outputs up to date"}

    return {"freshness": freshness}


@router.delete("/api/variables/{name}/data")
def trash_variable_data(name: str) -> dict[str, str]:
    """Move variable or data node data to trash.

    Resolves the variable/data path and moves it to system trash.
    Supports both variables (from variables section) and data nodes (from data section).
    """
    if not state.config_path or not state.config_path.exists():
        raise HTTPException(status_code=400, detail="No config loaded")

    with open(state.config_path) as f:
        config_data = _yaml.load(f) or {}

    variables = config_data.get("variables", {})
    parameters = config_data.get("parameters", {})
    data_section = config_data.get("data", {})

    # Try to find in variables first, then in data section
    resolved: str | None = None
    if name in variables:
        resolved = str(variables[name])
    elif name in data_section:
        # Data node - get the path directly
        data_entry = data_section[name]
        if isinstance(data_entry, dict):
            resolved = str(data_entry.get("path", ""))
        else:
            resolved = str(data_entry)
    else:
        raise HTTPException(status_code=404, detail=f"Variable or data '{name}' not found")

    if not resolved:
        raise HTTPException(status_code=400, detail=f"No path found for '{name}'")

    # Resolve parameter references
    for param_name, param_value in parameters.items():
        resolved = resolved.replace(f"${param_name}", str(param_value))

    path = Path(resolved)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {resolved}")

    try:
        send2trash(str(path))
        return {"status": "ok", "message": f"Moved to trash: {resolved}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trash: {e}")


@router.post("/api/open-path")
def open_path(path: str = Query(...)) -> dict[str, str]:
    """Open a file or folder with the system's default application."""
    resolved_path = Path(path)
    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")

    try:
        if sys.platform == "darwin":
            subprocess.run(["open", str(resolved_path)], check=True)
        elif sys.platform == "win32":
            os.startfile(str(resolved_path))  # type: ignore[attr-defined]
        else:  # Linux
            subprocess.run(["xdg-open", str(resolved_path)], check=True)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open: {e}")


@router.get("/api/run/status")
def get_run_status() -> ExecutionStatus:
    """Get current execution status."""
    return ExecutionStatus(
        status=state.execution_state["status"],
        current_step=state.execution_state["current_step"],
    )


@router.post("/api/run/cancel")
def cancel_run() -> dict[str, str]:
    """Cancel running execution."""
    if state.execution_state["pid"] and state.execution_state["status"] == "running":
        try:
            os.killpg(os.getpgid(state.execution_state["pid"]), signal.SIGTERM)
            state.execution_state["status"] = "cancelled"
            return {"status": "cancelled"}
        except ProcessLookupError:
            return {"status": "not_found"}
    return {"status": "not_running"}


# Frontend serving endpoints


@router.get("/")
def serve_index() -> HTMLResponse:
    """Serve the frontend."""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text())
    return HTMLResponse(
        content="""
<!DOCTYPE html>
<html>
<head>
    <title>Loom - Setup Required</title>
    <style>
        body {
            font-family: system-ui, sans-serif; padding: 40px;
            max-width: 700px; margin: 0 auto;
            background: #0f172a; color: #e2e8f0;
        }
        h1 { color: #60a5fa; }
        pre { background: #1e293b; padding: 16px; border-radius: 8px; }
        code { color: #34d399; }
        .note { background: #1e3a5f; padding: 12px 16px; border-radius: 8px; }
    </style>
</head>
<body>
    <h1>Loom Pipeline Editor</h1>
    <p>The frontend needs to be built first. This requires <strong>Node.js 18+</strong>.</p>

    <h3>Build Instructions</h3>
    <pre><code>cd src/loom/ui/frontend
npm install
npm run build</code></pre>

    <p>Then restart the editor:</p>
    <pre><code>loom-ui pipeline.yml</code></pre>

    <div class="note">
        <strong>Note:</strong> The API is already running. You can test it at
        <a href="/api/state" style="color: #60a5fa;">/api/state</a> and
        <a href="/api/tasks" style="color: #60a5fa;">/api/tasks</a>.
    </div>
</body>
</html>
        """
    )


@router.get("/favicon.svg")
def serve_favicon() -> FileResponse:
    """Serve the favicon."""
    favicon_path = FRONTEND_DIR / "favicon.svg"
    if favicon_path.exists():
        return FileResponse(favicon_path, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Favicon not found")

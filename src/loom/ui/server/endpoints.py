"""HTTP API endpoints for the pipeline editor server."""

import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse, HTMLResponse
from ruamel.yaml import YAML
from send2trash import send2trash  # type: ignore[import-untyped]

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
    """Check which data node paths exist on disk.

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

    # Check all data node paths (stored internally as variables for path resolution)
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
    """Move data node data to trash.

    Resolves the data node path and moves it to system trash.
    Paths are resolved relative to the pipeline file's directory.
    """
    from loom.runner import PipelineConfig

    if not state.config_path or not state.config_path.exists():
        raise HTTPException(status_code=400, detail="No config loaded")

    try:
        config = PipelineConfig.from_yaml(state.config_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load config: {e}")

    # Check if this is a known data node
    if name not in config.variables:
        raise HTTPException(status_code=404, detail=f"Data node '{name}' not found")

    # Get the raw path value and resolve any embedded parameter references
    resolved = config.variables[name]
    for param_name, param_value in config.parameters.items():
        resolved = resolved.replace(f"${param_name}", str(param_value))

    # Make relative paths absolute relative to pipeline directory
    path = Path(resolved)
    if not path.is_absolute():
        path = config.base_dir / path

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {path}")

    try:
        send2trash(str(path))
        return {"status": "ok", "message": f"Moved to trash: {path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trash: {e}")


@router.get("/api/clean/preview")
def preview_clean() -> dict[str, Any]:
    """Preview what files would be cleaned.

    Returns a list of data node paths that would be affected by a clean operation.
    """
    from loom.runner import PipelineConfig, get_cleanable_paths

    if not state.config_path or not state.config_path.exists():
        raise HTTPException(status_code=400, detail="No config loaded")

    try:
        config = PipelineConfig.from_yaml(state.config_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load config: {e}")

    paths = get_cleanable_paths(config)
    return {
        "paths": [
            {"name": name, "path": str(path), "exists": exists} for name, path, exists in paths
        ]
    }


@router.post("/api/clean")
def clean_all_data(
    mode: str = Query("trash", description="Clean mode: 'trash' or 'permanent'"),
    include_thumbnails: bool = Query(True, description="Include thumbnail cache"),
) -> dict[str, Any]:
    """Clean all data node files.

    Removes all data node files, either by moving to trash or permanent deletion.
    """
    from loom.runner import PipelineConfig, clean_pipeline_data

    if not state.config_path or not state.config_path.exists():
        raise HTTPException(status_code=400, detail="No config loaded")

    try:
        config = PipelineConfig.from_yaml(state.config_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load config: {e}")

    permanent = mode == "permanent"
    results = clean_pipeline_data(
        config, permanent=permanent, include_thumbnails=include_thumbnails
    )

    return {
        "results": [
            {
                "path": str(r.path),
                "success": r.success,
                "action": r.action,
                "error": r.error,
            }
            for r in results
        ],
        "cleaned_count": sum(1 for r in results if r.action in ("trashed", "deleted")),
        "failed_count": sum(1 for r in results if not r.success),
    }


@router.post("/api/open-path")
def open_path(path: str = Query(...)) -> dict[str, str]:
    """Open a file or folder with the system's default application.

    The path can be absolute or relative. Relative paths are resolved
    relative to the config file's directory.
    """
    # Start with the path as given
    resolved_path = Path(path)

    # If relative and config is loaded, resolve relative to config directory
    if not resolved_path.is_absolute() and state.config_path:
        resolved_path = state.config_path.parent / path

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


@router.get("/api/thumbnail/{data_key}")
def get_thumbnail(data_key: str) -> Response:
    """Get thumbnail image for a data node.

    Returns a PNG thumbnail for image/video data types.
    Returns 404 if data node doesn't exist or isn't image/video type.
    Returns 204 if thumbnail generation fails.
    """
    from loom.runner import PipelineConfig

    from .thumbnails import ThumbnailGenerator

    if not state.config_path or not state.config_path.exists():
        raise HTTPException(status_code=400, detail="No config loaded")

    try:
        config = PipelineConfig.from_yaml(state.config_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load config: {e}")

    # Security: Validate data_key exists in pipeline config
    if data_key not in config.variables:
        raise HTTPException(status_code=404, detail=f"Data node '{data_key}' not found")

    data_type = config.data_types.get(data_key, "")
    if data_type not in ("image", "video"):
        raise HTTPException(
            status_code=404, detail=f"Data type '{data_type}' doesn't support thumbnails"
        )

    # Resolve path
    try:
        file_path = config.resolve_path(f"${data_key}")
    except (ValueError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve path: {e}")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File does not exist")

    # Generate thumbnail
    generator = ThumbnailGenerator(state.config_path.parent)
    thumbnail_bytes = generator.get_thumbnail(file_path, data_type)

    if thumbnail_bytes is None:
        return Response(status_code=204)

    return Response(content=thumbnail_bytes, media_type="image/png")


@router.get("/api/preview/{data_key}")
def get_preview(data_key: str) -> dict[str, Any]:
    """Get text preview for a data node.

    Returns first few lines for txt/csv/json data types.
    Returns 404 if data node doesn't exist or isn't a text type.
    """
    from loom.runner import PipelineConfig

    from .thumbnails import ThumbnailGenerator

    if not state.config_path or not state.config_path.exists():
        raise HTTPException(status_code=400, detail="No config loaded")

    try:
        config = PipelineConfig.from_yaml(state.config_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load config: {e}")

    # Security: Validate data_key exists in pipeline config
    if data_key not in config.variables:
        raise HTTPException(status_code=404, detail=f"Data node '{data_key}' not found")

    data_type = config.data_types.get(data_key, "")
    if data_type not in ("txt", "csv", "json"):
        raise HTTPException(
            status_code=404, detail=f"Data type '{data_type}' doesn't support preview"
        )

    # Resolve path
    try:
        file_path = config.resolve_path(f"${data_key}")
    except (ValueError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve path: {e}")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File does not exist")

    # Generate preview
    generator = ThumbnailGenerator(state.config_path.parent)
    preview = generator.get_preview(file_path, data_type)

    if preview is None:
        raise HTTPException(status_code=500, detail="Failed to generate preview")

    return dict(preview)


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

"""FastAPI server for the pipeline editor."""

import asyncio
import os
import pty
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from ruamel.yaml import YAML
from send2trash import send2trash

# Create a YAML instance that preserves comments
_yaml = YAML()
_yaml.preserve_quotes = True

app = FastAPI(title="Loom Pipeline Editor")

# CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
_config_path: Path | None = None
_tasks_dir: Path = Path("tasks")

# Execution state for terminal - supports multiple concurrent steps
# Each step has its own entry: {"pid": int, "master_fd": int, "status": str}
_running_steps: dict[str, dict[str, Any]] = {}

# Legacy single execution state (for backward compatibility with sequential modes)
_execution_state: dict[str, Any] = {
    "status": "idle",  # idle, running, cancelled, completed, failed
    "current_step": None,
    "pid": None,
    "master_fd": None,
}


def _register_running_step(step_name: str, pid: int, master_fd: int) -> None:
    """Register a step as running."""
    _running_steps[step_name] = {"pid": pid, "master_fd": master_fd, "status": "running"}


def _unregister_running_step(step_name: str) -> None:
    """Unregister a running step."""
    _running_steps.pop(step_name, None)


def _is_step_running(step_name: str) -> bool:
    """Check if a step is currently running."""
    return step_name in _running_steps and _running_steps[step_name]["status"] == "running"


def _get_running_step(step_name: str) -> dict[str, Any] | None:
    """Get running step info."""
    return _running_steps.get(step_name)


class RunRequest(BaseModel):
    """Request to run pipeline steps."""

    mode: Literal["step", "from_step", "to_variable", "all", "parallel"]
    step_name: str | None = None
    step_names: list[str] | None = None  # For parallel mode
    variable_name: str | None = None


class ExecutionStatus(BaseModel):
    """Current execution status."""

    status: str
    current_step: str | None = None


class GraphNode(BaseModel):
    """React Flow node."""

    id: str
    type: str
    position: dict[str, float]
    data: dict[str, Any]


class GraphEdge(BaseModel):
    """React Flow edge."""

    model_config = {"populate_by_name": True}

    id: str
    source: str
    target: str
    sourceHandle: str | None = None  # noqa: N815 - React Flow requires camelCase
    targetHandle: str | None = None  # noqa: N815 - React Flow requires camelCase


class EditorOptions(BaseModel):
    """Editor-specific options stored with the pipeline."""

    autoSave: bool = False  # noqa: N815 - matches frontend naming


class DataEntry(BaseModel):
    """Data node entry in YAML."""

    type: str  # video, image, csv, json, image_directory, data_folder
    path: str
    name: str | None = None  # Display name (falls back to key if not set)
    description: str | None = None
    pattern: str | None = None  # File pattern for directories


class PipelineGraph(BaseModel):
    """Full pipeline as React Flow graph."""

    variables: dict[str, str]
    parameters: dict[str, Any]
    data: dict[str, DataEntry] = {}  # NEW: Typed data nodes
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    editor: EditorOptions = EditorOptions()
    hasLayout: bool = False  # noqa: N815 - True if positions were loaded from YAML


def yaml_to_graph(data: dict[str, Any]) -> PipelineGraph:
    """Convert YAML pipeline to React Flow graph format."""
    variables = data.get("variables", {})
    parameters = data.get("parameters", {})
    pipeline = data.get("pipeline", [])
    layout = data.get("layout", {})  # Saved node positions

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    # Step 1: Identify output variables (produced by steps)
    output_vars: dict[str, dict[str, str]] = {}  # var_name -> {step, flag}
    for step in pipeline:
        for out_flag, out_ref in step.get("outputs", {}).items():
            if out_ref.startswith("$"):
                var_name = out_ref[1:]
                output_vars[var_name] = {"step": step["name"], "flag": out_flag}

    # Step 2: Create step nodes and track their positions
    # Use saved layout positions if available, otherwise compute default positions
    step_positions: dict[str, dict[str, float]] = {}
    for i, step in enumerate(pipeline):
        step_id = step["name"]
        # Check if we have a saved position for this node
        if step_id in layout:
            saved = layout[step_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        else:
            # Default: row-based layout to preserve order in graph_to_yaml sorting
            row = i // 2
            col = i % 2
            position = {"x": 300 + col * 400, "y": 50 + row * 250}
        step_positions[step_id] = position
        nodes.append(
            GraphNode(
                id=step_id,
                type="step",
                position=position,
                data={
                    "name": step["name"],
                    "task": step["task"],
                    "inputs": step.get("inputs", {}),
                    "outputs": step.get("outputs", {}),
                    "args": step.get("args", {}),
                    "optional": step.get("optional", False),
                },
            )
        )

    # Step 3: Create variable nodes with appropriate positioning
    input_var_index = 0
    for name, value in variables.items():
        is_output = name in output_vars
        node_id = f"var_{name}"

        # Check if we have a saved position for this node
        if node_id in layout:
            saved = layout[node_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        elif is_output:
            # Position output variables after their producing step
            producer = output_vars[name]
            producer_pos = step_positions.get(producer["step"], {"x": 300, "y": 100})
            position = {"x": producer_pos["x"] + 280, "y": producer_pos["y"] + 50}
        else:
            # Input-only variables stay on the left
            position = {"x": 50, "y": 50 + input_var_index * 80}
            input_var_index += 1

        nodes.append(
            GraphNode(
                id=node_id,
                type="variable",
                position=position,
                data={
                    "name": name,
                    "value": value,
                    "isOutput": is_output,
                    "producedBy": output_vars.get(name, {}).get("step"),
                },
            )
        )

    # Step 3b: Create parameter nodes (positioned above variables on left)
    for param_idx, (param_name, param_value) in enumerate(parameters.items()):
        node_id = f"param_{param_name}"
        # Check if we have a saved position for this node
        if node_id in layout:
            saved = layout[node_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        else:
            # Position parameters above input variables
            param_y = -100 - (len(parameters) - param_idx - 1) * 60
            position = {"x": 50, "y": param_y}
        nodes.append(
            GraphNode(
                id=node_id,
                type="parameter",
                position=position,
                data={
                    "name": param_name,
                    "value": param_value,
                },
            )
        )

    # Step 3c: Create data nodes (typed file/directory nodes)
    data_section = data.get("data", {})
    for data_idx, (data_name, data_info) in enumerate(data_section.items()):
        node_id = f"data_{data_name}"
        # Check if we have a saved position for this node
        if node_id in layout:
            saved = layout[node_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        else:
            # Position data nodes below parameters, on the left side
            position = {"x": 50, "y": -200 - data_idx * 80}
        nodes.append(
            GraphNode(
                id=node_id,
                type="data",
                position=position,
                data={
                    "key": data_name,  # Programmatic identifier for $references
                    "name": data_info.get("name") or data_name,  # Display name
                    "type": data_info.get("type", "data_folder"),
                    "path": data_info.get("path", ""),
                    "description": data_info.get("description"),
                    "pattern": data_info.get("pattern"),
                },
            )
        )

    # Track data names for edge creation
    data_names = set(data_section.keys())

    # Step 4: Create edges
    # 4a: Edges from steps to output variables/data nodes they produce
    for var_name, producer in output_vars.items():
        # Check if output goes to a data node or variable node
        if var_name in data_names:
            # Output to data node
            edges.append(
                GraphEdge(
                    id=f"e_{producer['step']}_data_{var_name}",
                    source=producer["step"],
                    target=f"data_{var_name}",
                    sourceHandle=producer["flag"],
                    targetHandle="input",
                )
            )
        else:
            # Output to variable node
            edges.append(
                GraphEdge(
                    id=f"e_{producer['step']}_var_{var_name}",
                    source=producer["step"],
                    target=f"var_{var_name}",
                    sourceHandle=producer["flag"],
                    targetHandle="input",
                )
            )

    # 4b: Edges from variables/data nodes to steps that consume them
    for step in pipeline:
        step_id = step["name"]
        for input_name, var_ref in step.get("inputs", {}).items():
            if var_ref.startswith("$"):
                ref_name = var_ref[1:]
                # Check if it's a data node reference or variable reference
                if ref_name in data_names:
                    # Data node -> step edge
                    edges.append(
                        GraphEdge(
                            id=f"e_data_{ref_name}_{step_id}_{input_name}",
                            source=f"data_{ref_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=input_name,
                        )
                    )
                else:
                    # Variable -> step edge
                    edges.append(
                        GraphEdge(
                            id=f"e_var_{ref_name}_{step_id}_{input_name}",
                            source=f"var_{ref_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=input_name,
                        )
                    )

    # 4c: Edges from parameters to steps that use them in args
    for step in pipeline:
        step_id = step["name"]
        for arg_key, arg_value in step.get("args", {}).items():
            if isinstance(arg_value, str) and arg_value.startswith("$"):
                param_name = arg_value[1:]
                # Only create edge if parameter exists
                if param_name in parameters:
                    edges.append(
                        GraphEdge(
                            id=f"e_param_{param_name}_{step_id}_{arg_key}",
                            source=f"param_{param_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=arg_key,
                        )
                    )

    # Read editor options
    editor_data = data.get("editor", {})
    editor = EditorOptions(
        autoSave=editor_data.get("autoSave", False),
    )

    # Build data entries dict for graph
    data_entries: dict[str, DataEntry] = {}
    for name, info in data_section.items():
        data_entries[name] = DataEntry(
            type=info.get("type", "data_folder"),
            path=info.get("path", ""),
            name=info.get("name"),  # Display name (None falls back to key)
            description=info.get("description"),
            pattern=info.get("pattern"),
        )

    return PipelineGraph(
        variables=variables,
        parameters=parameters,
        data=data_entries,
        nodes=nodes,
        edges=edges,
        editor=editor,
        hasLayout=bool(layout),  # True if layout section existed in YAML
    )


def graph_to_yaml(graph: PipelineGraph) -> dict[str, Any]:
    """Convert React Flow graph back to YAML format."""
    # Extract variables from variable nodes
    variables = {}
    for node in graph.nodes:
        if node.type == "variable":
            variables[node.data["name"]] = node.data["value"]

    # Also include any variables not shown as nodes
    variables.update(graph.variables)

    # Extract parameters from parameter nodes
    parameters = dict(graph.parameters)  # Start with base parameters
    for node in graph.nodes:
        if node.type == "parameter":
            parameters[node.data["name"]] = node.data["value"]

    # Build lookup of parameter edges: (target_step, target_handle) -> param_name
    param_edges: dict[tuple[str, str], str] = {}
    for edge in graph.edges:
        if edge.source.startswith("param_"):
            param_name = edge.source[6:]  # Strip "param_" prefix
            if edge.targetHandle:
                param_edges[(edge.target, edge.targetHandle)] = param_name

    # Build pipeline from step nodes
    pipeline = []
    step_nodes = [n for n in graph.nodes if n.type == "step"]

    # Sort by y,x position for consistent ordering
    step_nodes.sort(key=lambda n: (n.position.get("y", 0), n.position.get("x", 0)))

    for node in step_nodes:
        step: dict[str, Any] = {
            "name": node.data["name"],
            "task": node.data["task"],
        }

        if node.data.get("inputs"):
            step["inputs"] = node.data["inputs"]
        if node.data.get("outputs"):
            step["outputs"] = node.data["outputs"]

        # Build args: merge node data args with parameter edge connections
        args = dict(node.data.get("args", {}))
        step_name = node.data["name"]
        for (target, handle), param_name in param_edges.items():
            if target == step_name:
                args[handle] = f"${param_name}"

        if args:
            step["args"] = args
        if node.data.get("optional"):
            step["optional"] = True

        pipeline.append(step)

    # Extract layout (positions) from all nodes
    layout: dict[str, dict[str, float]] = {}
    for node in graph.nodes:
        # Round positions to integers for cleaner YAML
        layout[node.id] = {
            "x": round(node.position.get("x", 0)),
            "y": round(node.position.get("y", 0)),
        }

    # Extract data nodes from graph nodes
    data_section: dict[str, dict[str, Any]] = {}
    for node in graph.nodes:
        if node.type == "data":
            # Use 'key' as the YAML key (for $references), fall back to 'name' for old format
            data_key = node.data.get("key") or node.data["name"]
            entry: dict[str, Any] = {
                "type": node.data["type"],
                "path": node.data["path"],
            }
            # Include display name if different from key
            display_name = node.data.get("name")
            if display_name and display_name != data_key:
                entry["name"] = display_name
            if node.data.get("description"):
                entry["description"] = node.data["description"]
            if node.data.get("pattern"):
                entry["pattern"] = node.data["pattern"]
            data_section[data_key] = entry

    # Also include any data from graph.data not shown as nodes
    for name, data_entry in graph.data.items():
        if name not in data_section:
            entry = {"type": data_entry.type, "path": data_entry.path}
            if data_entry.name:
                entry["name"] = data_entry.name
            if data_entry.description:
                entry["description"] = data_entry.description
            if data_entry.pattern:
                entry["pattern"] = data_entry.pattern
            data_section[name] = entry

    # Editor options (only include non-default values to keep YAML clean)
    editor: dict[str, Any] = {}
    if graph.editor.autoSave:
        editor["autoSave"] = True

    result: dict[str, Any] = {
        "variables": variables,
        "parameters": parameters,
        "pipeline": pipeline,
        "layout": layout,
    }
    if data_section:
        result["data"] = data_section
    if editor:
        result["editor"] = editor

    return result


def _update_yaml_from_graph(data: dict[str, Any], graph: PipelineGraph) -> None:
    """Update YAML data structure in-place from graph, preserving comments."""
    # Extract variables from graph nodes
    variables = {}
    for node in graph.nodes:
        if node.type == "variable":
            variables[node.data["name"]] = node.data["value"]
    # Include any variables not shown as nodes
    variables.update(graph.variables)

    # Update variables in-place
    if "variables" not in data:
        data["variables"] = {}
    for name, value in variables.items():
        data["variables"][name] = value

    # Extract parameters from parameter nodes and graph.parameters
    parameters = dict(graph.parameters)
    for node in graph.nodes:
        if node.type == "parameter":
            parameters[node.data["name"]] = node.data["value"]

    # Update parameters in-place
    if "parameters" not in data:
        data["parameters"] = {}
    for name, value in parameters.items():
        data["parameters"][name] = value

    # Extract data nodes from graph nodes
    data_section: dict[str, dict[str, Any]] = {}
    for node in graph.nodes:
        if node.type == "data":
            # Use 'key' as the YAML key (for $references), fall back to 'name' for old format
            data_key = node.data.get("key") or node.data["name"]
            entry: dict[str, Any] = {
                "type": node.data["type"],
                "path": node.data["path"],
            }
            # Include display name if different from key
            display_name = node.data.get("name")
            if display_name and display_name != data_key:
                entry["name"] = display_name
            if node.data.get("description"):
                entry["description"] = node.data["description"]
            if node.data.get("pattern"):
                entry["pattern"] = node.data["pattern"]
            data_section[data_key] = entry

    # Also include any data from graph.data not shown as nodes
    for name, data_entry in graph.data.items():
        if name not in data_section:
            entry = {"type": data_entry.type, "path": data_entry.path}
            if data_entry.name:
                entry["name"] = data_entry.name
            if data_entry.description:
                entry["description"] = data_entry.description
            if data_entry.pattern:
                entry["pattern"] = data_entry.pattern
            data_section[name] = entry

    # Update data section in-place
    if data_section:
        if "data" not in data:
            data["data"] = {}
        for name, entry in data_section.items():
            data["data"][name] = entry
    elif "data" in data and not data["data"]:
        del data["data"]

    # Build lookup of parameter edges: (target_step, target_handle) -> param_name
    param_edges: dict[tuple[str, str], str] = {}
    for edge in graph.edges:
        if edge.source.startswith("param_"):
            param_name = edge.source[6:]  # Strip "param_" prefix
            if edge.targetHandle:
                param_edges[(edge.target, edge.targetHandle)] = param_name

    # Build step lookup from graph
    step_nodes = [n for n in graph.nodes if n.type == "step"]
    graph_steps = {}
    for node in step_nodes:
        step_name = node.data["name"]
        step_data: dict[str, Any] = {
            "name": step_name,
            "task": node.data["task"],
        }
        if node.data.get("inputs"):
            step_data["inputs"] = dict(node.data["inputs"])
        if node.data.get("outputs"):
            step_data["outputs"] = dict(node.data["outputs"])

        # Build args: merge node data args with parameter edge connections
        args = dict(node.data.get("args", {}))
        for (target, handle), param_name in param_edges.items():
            if target == step_name:
                args[handle] = f"${param_name}"
        if args:
            step_data["args"] = args

        if node.data.get("optional"):
            step_data["optional"] = True
        graph_steps[step_name] = step_data

    # Update pipeline steps in-place, preserving order
    if "pipeline" not in data:
        data["pipeline"] = []

    # Update existing steps in-place
    existing_names = set()
    for step in data["pipeline"]:
        name = step["name"]
        existing_names.add(name)
        if name in graph_steps:
            graph_step = graph_steps[name]
            step["task"] = graph_step["task"]
            # Update inputs
            if "inputs" in graph_step:
                step["inputs"] = graph_step["inputs"]
            elif "inputs" in step:
                del step["inputs"]
            # Update outputs
            if "outputs" in graph_step:
                step["outputs"] = graph_step["outputs"]
            elif "outputs" in step:
                del step["outputs"]
            # Update args
            if "args" in graph_step:
                step["args"] = graph_step["args"]
            elif "args" in step:
                del step["args"]
            # Update optional
            if graph_step.get("optional"):
                step["optional"] = True
            elif "optional" in step:
                del step["optional"]

    # Add any new steps from the graph
    for name, graph_step in graph_steps.items():
        if name not in existing_names:
            data["pipeline"].append(graph_step)

    # Update layout (positions) from all nodes
    if "layout" not in data:
        data["layout"] = {}
    for node in graph.nodes:
        # Round positions to integers for cleaner YAML
        data["layout"][node.id] = {
            "x": round(node.position.get("x", 0)),
            "y": round(node.position.get("y", 0)),
        }

    # Update editor options (only include non-default values)
    if graph.editor.autoSave:
        if "editor" not in data:
            data["editor"] = {}
        data["editor"]["autoSave"] = True
    elif "editor" in data and "autoSave" in data["editor"]:
        del data["editor"]["autoSave"]
        # Clean up empty editor section
        if not data["editor"]:
            del data["editor"]


class ValidationWarning(BaseModel):
    """A validation warning for the pipeline."""

    level: Literal["warning", "error", "info"]
    message: str
    step: str | None = None  # Step name if applicable
    input_output: str | None = None  # Input/output name if applicable


class ValidationResult(BaseModel):
    """Result of pipeline validation."""

    warnings: list[ValidationWarning] = []


def _validate_pipeline(
    yaml_data: dict[str, Any], task_schemas: dict[str, Any]
) -> list[ValidationWarning]:
    """Validate pipeline configuration against task schemas.

    Checks:
    1. Task inputs/outputs have types defined in schema
    2. Pipeline uses typed data nodes where appropriate
    3. Warns about missing type annotations
    """
    warnings: list[ValidationWarning] = []
    pipeline = yaml_data.get("pipeline", [])
    data_section = yaml_data.get("data", {})
    variables = yaml_data.get("variables", {})

    for step in pipeline:
        step_name = step.get("name", "unknown")
        task_path = step.get("task", "")
        task_schema = task_schemas.get(task_path)

        if not task_schema:
            continue  # No schema to validate against

        # Check inputs
        for input_name, input_ref in step.get("inputs", {}).items():
            input_schema = task_schema.get("inputs", {}).get(input_name, {})
            expected_type = input_schema.get("type")

            if expected_type:
                # Task expects a typed input
                if input_ref.startswith("$"):
                    ref_name = input_ref[1:]
                    if ref_name in variables and ref_name not in data_section:
                        # Connected to untyped variable, but task expects type
                        warnings.append(
                            ValidationWarning(
                                level="info",
                                message=f"Input '{input_name}' expects type '{expected_type}' but is connected to untyped variable '${ref_name}'. Consider using a typed data node.",
                                step=step_name,
                                input_output=input_name,
                            )
                        )

        # Check outputs
        for output_name, output_ref in step.get("outputs", {}).items():
            output_schema = task_schema.get("outputs", {}).get(output_name, {})
            expected_type = output_schema.get("type")

            if expected_type:
                # Task produces a typed output
                if output_ref.startswith("$"):
                    ref_name = output_ref[1:]
                    if ref_name in variables and ref_name not in data_section:
                        # Connected to untyped variable, but task produces typed output
                        warnings.append(
                            ValidationWarning(
                                level="info",
                                message=f"Output '{output_name}' produces type '{expected_type}' but is connected to untyped variable '${ref_name}'. Consider using a typed data node.",
                                step=step_name,
                                input_output=output_name,
                            )
                        )

    return warnings


@app.get("/api/config/validate")
def validate_config(path: str = Query(None)) -> ValidationResult:
    """Validate pipeline configuration and return warnings."""
    from .task_schema import list_task_schemas

    config_path = Path(path) if path else _config_path
    if not config_path or not config_path.exists():
        return ValidationResult(warnings=[])

    with open(config_path) as f:
        data = _yaml.load(f) or {}

    # Build task schema lookup
    schemas = list_task_schemas(_tasks_dir)
    task_schemas = {schema.path: schema.to_dict() for schema in schemas}

    warnings = _validate_pipeline(dict(data), task_schemas)
    return ValidationResult(warnings=warnings)


@app.get("/api/config")
def get_config(path: str = Query(None)) -> PipelineGraph:
    """Load pipeline config and return as graph."""
    config_path = Path(path) if path else _config_path
    if not config_path:
        # Return empty graph for new pipeline
        return PipelineGraph(variables={}, parameters={}, data={}, nodes=[], edges=[])

    if not config_path.exists():
        raise HTTPException(404, f"Config not found: {config_path}")

    with open(config_path) as f:
        data = _yaml.load(f) or {}

    return yaml_to_graph(dict(data))


@app.post("/api/config")
def save_config(graph: PipelineGraph, path: str = Query(None)) -> dict[str, str]:
    """Save graph as YAML config, preserving comments from original file."""
    config_path = Path(path) if path else _config_path
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
    _update_yaml_from_graph(data, graph)

    with open(config_path, "w") as f:
        _yaml.dump(data, f)

    return {"status": "saved", "path": str(config_path)}


@app.get("/api/tasks")
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
    from .task_schema import list_task_schemas

    schemas = list_task_schemas(_tasks_dir)
    return [schema.to_dict() for schema in schemas]


@app.get("/api/state")
def get_state() -> dict[str, Any]:
    """Get current editor state."""
    return {
        "configPath": str(_config_path) if _config_path else None,
        "tasksDir": str(_tasks_dir),
    }


@app.get("/api/variables/status")
def get_variables_status() -> dict[str, bool]:
    """Check which variable and data node paths exist on disk.

    Returns a map of name -> exists (bool).
    Resolves parameter references in values before checking.
    """
    if not _config_path or not _config_path.exists():
        return {}

    with open(_config_path) as f:
        data = _yaml.load(f) or {}

    variables = data.get("variables", {})
    parameters = data.get("parameters", {})
    data_section = data.get("data", {})

    result = {}

    # Check variable paths
    for name, value in variables.items():
        # Resolve parameter references like $param
        resolved = str(value)
        for param_name, param_value in parameters.items():
            resolved = resolved.replace(f"${param_name}", str(param_value))

        # Check if path exists
        path = Path(resolved)
        result[name] = path.exists()

    # Check data node paths
    for name, data_info in data_section.items():
        data_path = data_info.get("path", "")
        # Resolve parameter references
        resolved = str(data_path)
        for param_name, param_value in parameters.items():
            resolved = resolved.replace(f"${param_name}", str(param_value))

        # Check if path exists
        path = Path(resolved)
        result[name] = path.exists()

    return result


@app.get("/api/steps/freshness")
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

    if not _config_path or not _config_path.exists():
        return {"freshness": {}}

    try:
        config = PipelineConfig.from_yaml(_config_path)
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
                resolved = config.resolve_value(var_ref)
                output_path = Path(resolved)
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
                resolved = config.resolve_value(var_ref)
                input_path = Path(resolved)

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


@app.delete("/api/variables/{name}/data")
def trash_variable_data(name: str) -> dict[str, str]:
    """Move variable or data node data to trash.

    Resolves the variable/data path and moves it to system trash.
    Supports both variables (from variables section) and data nodes (from data section).
    """
    if not _config_path or not _config_path.exists():
        raise HTTPException(status_code=400, detail="No config loaded")

    with open(_config_path) as f:
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


@app.post("/api/open-path")
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


@app.get("/api/run/status")
def get_run_status() -> ExecutionStatus:
    """Get current execution status."""
    return ExecutionStatus(
        status=_execution_state["status"],
        current_step=_execution_state["current_step"],
    )


@app.post("/api/run/cancel")
def cancel_run() -> dict[str, str]:
    """Cancel running execution."""
    if _execution_state["pid"] and _execution_state["status"] == "running":
        try:
            os.killpg(os.getpgid(_execution_state["pid"]), signal.SIGTERM)
            _execution_state["status"] = "cancelled"
            return {"status": "cancelled"}
        except ProcessLookupError:
            return {"status": "not_found"}
    return {"status": "not_running"}


@app.websocket("/ws/terminal")
async def terminal_websocket(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time terminal streaming.

    Protocol:
    1. Client sends RunRequest JSON: {"mode": "step", "step_name": "extract_gaze"}
    2. Server streams PTY output as binary data
    3. Client can send "__CANCEL__" to terminate
    4. Connection closes when process completes
    """
    await websocket.accept()

    master_fd = None
    pid = None

    try:
        # Receive run configuration
        data = await websocket.receive_json()
        run_request = RunRequest(**data)

        if not _config_path:
            await websocket.send_text("\x1b[31m[ERROR]\x1b[0m No config path set\r\n")
            return

        # Build commands using execution bridge
        from .execution import (
            build_parallel_commands,
            build_pipeline_commands,
            build_step_command,
            get_step_output_dirs,
            validate_parallel_execution,
        )

        # Handle independent single-step mode (for concurrent execution)
        # This allows multiple steps to run independently in separate WebSocket connections
        if run_request.mode == "step" and run_request.step_name:
            step_name = run_request.step_name
            import fcntl
            import json

            # Check if step is already running
            if _is_step_running(step_name):
                await websocket.send_text(
                    f"\x1b[33m[WARN]\x1b[0m Step '{step_name}' is already running\r\n"
                )
                return

            # Build command for this single step
            try:
                cmd = build_step_command(_config_path, step_name)
            except ValueError as e:
                await websocket.send_text(f"\x1b[31m[ERROR]\x1b[0m {e}\r\n")
                return

            # Create output directories
            try:
                for dir_path in get_step_output_dirs(_config_path, step_name):
                    dir_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                await websocket.send_text(
                    f"\x1b[31m[ERROR]\x1b[0m Failed to create output dirs: {e}\r\n"
                )
                return

            # Send step status
            await websocket.send_text(
                json.dumps({"type": "step_status", "step": step_name, "status": "running"})
            )

            cmd_str = " ".join(cmd)
            await websocket.send_text(f"\x1b[36m[RUNNING]\x1b[0m {step_name}\r\n")
            await websocket.send_text(f"  {cmd_str}\r\n")

            # Create PTY
            step_master_fd, step_slave_fd = pty.openpty()

            # Fork and exec
            step_pid = os.fork()
            if step_pid == 0:
                # Child process
                os.setsid()
                os.dup2(step_slave_fd, 0)
                os.dup2(step_slave_fd, 1)
                os.dup2(step_slave_fd, 2)
                os.close(step_master_fd)
                os.close(step_slave_fd)
                os.execvp(cmd[0], cmd)
            else:
                # Parent process
                os.close(step_slave_fd)

                # Register this step as running
                _register_running_step(step_name, step_pid, step_master_fd)

                # Set non-blocking
                flags = fcntl.fcntl(step_master_fd, fcntl.F_GETFL)
                fcntl.fcntl(step_master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

                cancelled = False
                ws_closed = False

                async def listen_for_cancel_step():
                    nonlocal cancelled, ws_closed
                    try:
                        while True:
                            msg = await websocket.receive_text()
                            if msg == "__CANCEL__":
                                cancelled = True
                                try:
                                    os.killpg(os.getpgid(step_pid), signal.SIGTERM)
                                except (ProcessLookupError, PermissionError):
                                    pass
                                break
                    except Exception:
                        # WebSocket closed by client
                        ws_closed = True

                cancel_task = asyncio.create_task(listen_for_cancel_step())

                async def safe_send_bytes(data: bytes) -> bool:
                    """Send bytes, return False if websocket is closed."""
                    if ws_closed:
                        return False
                    try:
                        await websocket.send_bytes(data)
                        return True
                    except Exception:
                        return False

                async def safe_send_text(text: str) -> bool:
                    """Send text, return False if websocket is closed."""
                    if ws_closed:
                        return False
                    try:
                        await websocket.send_text(text)
                        return True
                    except Exception:
                        return False

                try:
                    # Stream output
                    while True:
                        try:
                            data_bytes = os.read(step_master_fd, 4096)
                            if not data_bytes:
                                break
                            if not await safe_send_bytes(data_bytes):
                                break  # WebSocket closed
                        except BlockingIOError:
                            # Check if process is still running
                            result = os.waitpid(step_pid, os.WNOHANG)
                            if result[0] != 0:
                                # Process exited, drain remaining output
                                try:
                                    while True:
                                        remaining = os.read(step_master_fd, 4096)
                                        if not remaining:
                                            break
                                        if not await safe_send_bytes(remaining):
                                            break
                                except (BlockingIOError, OSError):
                                    pass
                                break
                            await asyncio.sleep(0.01)
                        except OSError:
                            break

                    # Wait for process
                    _, status = os.waitpid(step_pid, 0)

                finally:
                    cancel_task.cancel()
                    try:
                        await cancel_task
                    except asyncio.CancelledError:
                        pass

                    os.close(step_master_fd)
                    _unregister_running_step(step_name)

                # Send result (only if websocket still open)
                if cancelled:
                    await safe_send_text(f"\x1b[33m[CANCELLED]\x1b[0m {step_name}\r\n")
                    await safe_send_text(
                        json.dumps(
                            {"type": "step_status", "step": step_name, "status": "cancelled"}
                        )
                    )
                elif os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0:
                    await safe_send_text(f"\x1b[32m[SUCCESS]\x1b[0m {step_name}\r\n")
                    await safe_send_text(
                        json.dumps(
                            {"type": "step_status", "step": step_name, "status": "completed"}
                        )
                    )
                else:
                    exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
                    await safe_send_text(
                        f"\x1b[31m[FAILED]\x1b[0m {step_name} (exit code {exit_code})\r\n"
                    )
                    await safe_send_text(
                        json.dumps({"type": "step_status", "step": step_name, "status": "failed"})
                    )

            return  # End independent single-step mode

        # Handle parallel mode separately
        if run_request.mode == "parallel":
            if not run_request.step_names:
                await websocket.send_text(
                    "\x1b[31m[ERROR]\x1b[0m No steps specified for parallel mode\r\n"
                )
                return

            # Validate no output conflicts
            is_valid, error_msg = validate_parallel_execution(_config_path, run_request.step_names)
            if not is_valid:
                await websocket.send_text(f"\x1b[31m[ERROR]\x1b[0m {error_msg}\r\n")
                return

            commands = build_parallel_commands(_config_path, run_request.step_names)
            if not commands:
                await websocket.send_text("\x1b[33m[WARN]\x1b[0m No steps to run\r\n")
                return

            _execution_state["status"] = "running"

            # Track cancellation per step
            cancelled_steps: set[str] = set()

            async def listen_for_cancel_parallel():
                """Listen for per-step cancel messages."""
                try:
                    while True:
                        msg = await websocket.receive_text()
                        if msg.startswith("__CANCEL__:"):
                            step_to_cancel = msg.split(":", 1)[1]
                            cancelled_steps.add(step_to_cancel)
                        elif msg == "__CANCEL__":
                            # Cancel all
                            for name, _ in commands:
                                cancelled_steps.add(name)
                except Exception:
                    pass

            async def run_step_pty(step_name: str, cmd: list[str]) -> tuple[str, bool]:
                """Run a single step in its own PTY. Returns (step_name, success)."""
                import fcntl

                # Create output directories
                try:
                    for dir_path in get_step_output_dirs(_config_path, step_name):
                        dir_path.mkdir(parents=True, exist_ok=True)
                except Exception as e:
                    await websocket.send_bytes(
                        f"[OUTPUT:{step_name}]\x1b[31m[ERROR]\x1b[0m Failed to create output dirs: {e}\r\n".encode()
                    )
                    return step_name, False

                # Send step status
                import json

                await websocket.send_text(
                    json.dumps({"type": "step_status", "step": step_name, "status": "running"})
                )

                cmd_str = " ".join(cmd)
                await websocket.send_bytes(
                    f"[OUTPUT:{step_name}]\x1b[36m[RUNNING]\x1b[0m {step_name}\r\n  {cmd_str}\r\n".encode()
                )

                # Create PTY
                step_master_fd, step_slave_fd = pty.openpty()

                step_pid = os.fork()
                if step_pid == 0:
                    # Child process
                    os.setsid()
                    os.dup2(step_slave_fd, 0)
                    os.dup2(step_slave_fd, 1)
                    os.dup2(step_slave_fd, 2)
                    os.close(step_master_fd)
                    os.close(step_slave_fd)
                    os.execvp(cmd[0], cmd)
                else:
                    # Parent process
                    os.close(step_slave_fd)

                    # Set non-blocking
                    flags = fcntl.fcntl(step_master_fd, fcntl.F_GETFL)
                    fcntl.fcntl(step_master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

                    try:
                        while True:
                            # Check if cancelled
                            if step_name in cancelled_steps:
                                try:
                                    os.killpg(os.getpgid(step_pid), signal.SIGTERM)
                                except (ProcessLookupError, PermissionError):
                                    pass
                                break

                            # Check if process exited
                            wpid, status = os.waitpid(step_pid, os.WNOHANG)
                            if wpid != 0:
                                # Read remaining output
                                try:
                                    while True:
                                        data_bytes = os.read(step_master_fd, 4096)
                                        if not data_bytes:
                                            break
                                        await websocket.send_bytes(
                                            f"[OUTPUT:{step_name}]".encode() + data_bytes
                                        )
                                except (OSError, BlockingIOError):
                                    pass

                                os.close(step_master_fd)

                                if os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0:
                                    await websocket.send_bytes(
                                        f"[OUTPUT:{step_name}]\x1b[32m[SUCCESS]\x1b[0m {step_name}\r\n".encode()
                                    )
                                    await websocket.send_text(
                                        json.dumps(
                                            {
                                                "type": "step_status",
                                                "step": step_name,
                                                "status": "completed",
                                            }
                                        )
                                    )
                                    return step_name, True
                                else:
                                    exit_code = (
                                        os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
                                    )
                                    await websocket.send_bytes(
                                        f"[OUTPUT:{step_name}]\x1b[31m[FAILED]\x1b[0m {step_name} (exit code {exit_code})\r\n".encode()
                                    )
                                    await websocket.send_text(
                                        json.dumps(
                                            {
                                                "type": "step_status",
                                                "step": step_name,
                                                "status": "failed",
                                            }
                                        )
                                    )
                                    return step_name, False

                            # Read output
                            try:
                                data_bytes = os.read(step_master_fd, 4096)
                                if data_bytes:
                                    await websocket.send_bytes(
                                        f"[OUTPUT:{step_name}]".encode() + data_bytes
                                    )
                            except BlockingIOError:
                                pass
                            except OSError:
                                break

                            await asyncio.sleep(0.01)
                    finally:
                        try:
                            os.close(step_master_fd)
                        except OSError:
                            pass

                    # Handle cancellation
                    if step_name in cancelled_steps:
                        await websocket.send_bytes(
                            f"[OUTPUT:{step_name}]\x1b[33m[CANCELLED]\x1b[0m {step_name}\r\n".encode()
                        )
                        await websocket.send_text(
                            json.dumps(
                                {"type": "step_status", "step": step_name, "status": "cancelled"}
                            )
                        )
                        return step_name, False

                return step_name, False

            # Start cancel listener
            cancel_task = asyncio.create_task(listen_for_cancel_parallel())

            try:
                # Run all steps in parallel
                tasks = [run_step_pty(name, cmd) for name, cmd in commands]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                # Check results
                success_count = sum(1 for r in results if isinstance(r, tuple) and r[1])
                total = len(commands)

                if success_count == total:
                    await websocket.send_text(
                        f"\x1b[32m[COMPLETED]\x1b[0m {total} step(s) succeeded in parallel\r\n"
                    )
                    _execution_state["status"] = "completed"
                else:
                    await websocket.send_text(
                        f"\x1b[33m[PARTIAL]\x1b[0m {success_count}/{total} steps succeeded\r\n"
                    )
                    _execution_state["status"] = "failed" if success_count == 0 else "completed"
            finally:
                cancel_task.cancel()
                try:
                    await cancel_task
                except asyncio.CancelledError:
                    pass

            return  # End parallel mode handling

        try:
            commands = build_pipeline_commands(
                _config_path,
                run_request.mode,
                run_request.step_name,
                run_request.variable_name,
            )
        except ValueError as e:
            await websocket.send_text(f"\x1b[31m[ERROR]\x1b[0m {e}\r\n")
            return

        if not commands:
            await websocket.send_text("\x1b[33m[WARN]\x1b[0m No steps to run\r\n")
            return

        _execution_state["status"] = "running"

        # Execute each step
        for step_name, cmd in commands:
            _execution_state["current_step"] = step_name

            # Create output directories
            try:
                for dir_path in get_step_output_dirs(_config_path, step_name):
                    dir_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                await websocket.send_text(
                    f"\x1b[31m[ERROR]\x1b[0m Failed to create output dirs: {e}\r\n"
                )
                _execution_state["status"] = "failed"
                return

            # Print step header
            cmd_str = " ".join(cmd)
            await websocket.send_text(f"\x1b[36m[RUNNING]\x1b[0m {step_name}\r\n")
            await websocket.send_text(f"  {cmd_str}\r\n")

            # Create PTY
            master_fd, slave_fd = pty.openpty()
            _execution_state["master_fd"] = master_fd

            # Fork and exec
            pid = os.fork()
            if pid == 0:
                # Child process
                os.setsid()
                os.dup2(slave_fd, 0)
                os.dup2(slave_fd, 1)
                os.dup2(slave_fd, 2)
                os.close(master_fd)
                os.close(slave_fd)
                os.execvp(cmd[0], cmd)
            else:
                # Parent process
                os.close(slave_fd)
                _execution_state["pid"] = pid

                # Set non-blocking for PTY
                import fcntl

                flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
                fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

                # Track if cancelled
                cancelled = False

                # Task to listen for cancel messages
                async def listen_for_cancel():
                    nonlocal cancelled
                    try:
                        while True:
                            msg = await websocket.receive_text()
                            if msg == "__CANCEL__":
                                cancelled = True
                                _execution_state["status"] = "cancelled"
                                # Kill the process group
                                try:
                                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                                except (ProcessLookupError, PermissionError):
                                    pass
                                return
                    except Exception:
                        pass

                # Start cancel listener as background task
                cancel_task = asyncio.create_task(listen_for_cancel())

                # Stream output while process runs
                try:
                    while True:
                        # Check if cancelled
                        if cancelled:
                            break

                        # Check if process exited
                        wpid, status = os.waitpid(pid, os.WNOHANG)
                        if wpid != 0:
                            # Process exited, read any remaining output
                            try:
                                while True:
                                    data_bytes = os.read(master_fd, 4096)
                                    if not data_bytes:
                                        break
                                    await websocket.send_bytes(data_bytes)
                            except (OSError, BlockingIOError):
                                pass
                            break

                        # Try to read from PTY
                        try:
                            data_bytes = os.read(master_fd, 4096)
                            if data_bytes:
                                await websocket.send_bytes(data_bytes)
                        except BlockingIOError:
                            pass
                        except OSError:
                            break

                        # Small delay to prevent busy waiting
                        await asyncio.sleep(0.01)
                finally:
                    # Clean up cancel listener
                    cancel_task.cancel()
                    try:
                        await cancel_task
                    except asyncio.CancelledError:
                        pass

                os.close(master_fd)
                master_fd = None
                _execution_state["master_fd"] = None
                _execution_state["pid"] = None

                # Handle cancellation first
                if cancelled:
                    await websocket.send_text(f"\x1b[33m[CANCELLED]\x1b[0m {step_name}\r\n")
                    return

                # Check exit status
                if os.WIFEXITED(status):
                    exit_code = os.WEXITSTATUS(status)
                    if exit_code == 0:
                        await websocket.send_text(f"\x1b[32m[SUCCESS]\x1b[0m {step_name}\r\n")
                    else:
                        await websocket.send_text(
                            f"\x1b[31m[FAILED]\x1b[0m {step_name} (exit code {exit_code})\r\n"
                        )
                        _execution_state["status"] = "failed"
                        return
                elif _execution_state["status"] == "cancelled":
                    await websocket.send_text(f"\x1b[33m[CANCELLED]\x1b[0m {step_name}\r\n")
                    return
                else:
                    await websocket.send_text(f"\x1b[31m[FAILED]\x1b[0m {step_name} (signal)\r\n")
                    _execution_state["status"] = "failed"
                    return

        # All steps completed
        await websocket.send_text(
            f"\x1b[32m[COMPLETED]\x1b[0m {len(commands)} step(s) succeeded\r\n"
        )
        _execution_state["status"] = "completed"

    except WebSocketDisconnect:
        # Client disconnected, kill process if running
        if pid:
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
    except Exception as e:
        import traceback

        traceback.print_exc()  # Print to server console for debugging
        try:
            await websocket.send_text(f"\x1b[31m[ERROR]\x1b[0m {e}\r\n")
        except Exception:
            pass  # WebSocket might already be closed
        _execution_state["status"] = "failed"
    finally:
        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass
        _execution_state["status"] = "idle"
        _execution_state["current_step"] = None
        _execution_state["pid"] = None
        _execution_state["master_fd"] = None


# Serve frontend
FRONTEND_DIR = Path(__file__).parent / "frontend" / "dist"


@app.get("/")
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
    <title>Loom Editor - Setup Required</title>
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
    <pre><code>cd src/loom/editor/frontend
npm install
npm run build</code></pre>

    <p>Then restart the editor:</p>
    <pre><code>loom-editor pipeline.yml</code></pre>

    <div class="note">
        <strong>Note:</strong> The API is already running. You can test it at
        <a href="/api/state" style="color: #60a5fa;">/api/state</a> and
        <a href="/api/tasks" style="color: #60a5fa;">/api/tasks</a>.
    </div>
</body>
</html>
        """
    )


@app.get("/favicon.svg")
def serve_favicon() -> FileResponse:
    """Serve the favicon."""
    favicon_path = FRONTEND_DIR / "favicon.svg"
    if favicon_path.exists():
        return FileResponse(favicon_path, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Favicon not found")


# Mount static files if they exist
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")


def configure(config_path: Path | None = None, tasks_dir: Path | None = None) -> None:
    """Configure the server with paths."""
    global _config_path, _tasks_dir
    _config_path = config_path
    if tasks_dir:
        _tasks_dir = tasks_dir

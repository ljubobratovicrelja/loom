"""FastAPI server for the pipeline editor.

This package provides the web server for the visual pipeline editor.
The server is organized into:
- models.py: Pydantic models for API request/response
- graph.py: YAML <-> React Flow graph conversion
- validation.py: Pipeline validation against task schemas
- state.py: Global state management
- endpoints.py: HTTP API endpoints
- terminal.py: WebSocket terminal for execution streaming
"""

from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import state
from .endpoints import FRONTEND_DIR, _yaml, router

# Re-export graph conversion functions (used by tests)
from .graph import graph_to_yaml, yaml_to_graph

# Re-export the internal update function with underscore prefix for tests
from .graph import update_yaml_from_graph as _update_yaml_from_graph

# Re-export models (used by tests and other modules)
from .models import (
    DataEntry,
    EditorOptions,
    ExecutionStatus,
    GraphEdge,
    GraphNode,
    PipelineGraph,
    RunRequest,
    ValidationResult,
    ValidationWarning,
)

# Re-export state management (used by tests)
from .state import (
    config_path as _config_path,
)
from .state import (
    execution_state as _execution_state,
)
from .state import (
    get_running_step as _get_running_step,
)
from .state import (
    is_step_running as _is_step_running,
)
from .state import (
    register_running_step as _register_running_step,
)
from .state import (
    running_steps as _running_steps,
)
from .state import (
    tasks_dir as _tasks_dir,
)
from .state import (
    unregister_running_step as _unregister_running_step,
)
from .terminal import terminal_websocket

# Re-export validation function (used by tests)
from .validation import validate_pipeline as _validate_pipeline

# Create FastAPI app
app = FastAPI(title="Loom Pipeline Editor")

# CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include HTTP endpoints
app.include_router(router)


# WebSocket endpoint (can't use router for websockets with our pattern)
@app.websocket("/ws/terminal")
async def ws_terminal(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time terminal streaming."""
    await terminal_websocket(websocket)


# Mount static files if they exist
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")


def configure(
    config_path: Path | None = None,
    tasks_dir: Path | None = None,
    workspace: Path | None = None,
) -> None:
    """Configure the server with paths."""
    state.configure(config=config_path, tasks=tasks_dir, workspace=workspace)


__all__ = [
    # Main exports
    "app",
    "configure",
    # Models
    "DataEntry",
    "EditorOptions",
    "ExecutionStatus",
    "GraphEdge",
    "GraphNode",
    "PipelineGraph",
    "RunRequest",
    "ValidationResult",
    "ValidationWarning",
    # Graph functions
    "graph_to_yaml",
    "yaml_to_graph",
    "_update_yaml_from_graph",
    # Validation
    "_validate_pipeline",
    # State (internal, but needed by tests)
    "_config_path",
    "_tasks_dir",
    "_execution_state",
    "_running_steps",
    "_register_running_step",
    "_unregister_running_step",
    "_is_step_running",
    "_get_running_step",
    # YAML
    "_yaml",
]

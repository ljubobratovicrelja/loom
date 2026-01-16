"""Pydantic models for the pipeline editor server."""

from typing import Any, Literal

from pydantic import BaseModel


class RunRequest(BaseModel):
    """Request to run pipeline steps."""

    mode: Literal["step", "from_step", "to_data", "all", "parallel"]
    step_name: str | None = None
    step_names: list[str] | None = None  # For parallel mode
    data_name: str | None = None


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
    data: dict[str, DataEntry] = {}  # Typed data nodes
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    editor: EditorOptions = EditorOptions()
    hasLayout: bool = False  # noqa: N815 - True if positions were loaded from YAML


class ValidationWarning(BaseModel):
    """A validation warning for the pipeline."""

    level: Literal["warning", "error", "info"]
    message: str
    step: str | None = None  # Step name if applicable
    input_output: str | None = None  # Input/output name if applicable


class ValidationResult(BaseModel):
    """Result of pipeline validation."""

    warnings: list[ValidationWarning] = []


class PipelineInfo(BaseModel):
    """Information about a discovered pipeline in workspace mode."""

    name: str  # Display name (parent directory name)
    path: str  # Absolute path to pipeline.yml
    relative_path: str  # Path relative to workspace directory

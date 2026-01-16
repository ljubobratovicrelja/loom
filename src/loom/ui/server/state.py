"""Global state management for the pipeline editor server."""

from pathlib import Path
from typing import Any

# Server configuration
config_path: Path | None = None
tasks_dir: Path = Path("tasks")

# Execution state for terminal - supports multiple concurrent steps
# Each step has its own entry: {"pid": int, "master_fd": int, "status": str}
running_steps: dict[str, dict[str, Any]] = {}

# Legacy single execution state (for backward compatibility with sequential modes)
execution_state: dict[str, Any] = {
    "status": "idle",  # idle, running, cancelled, completed, failed
    "current_step": None,
    "pid": None,
    "master_fd": None,
}


def configure(config: Path | None = None, tasks: Path | None = None) -> None:
    """Configure the server with paths."""
    global config_path, tasks_dir
    config_path = config
    if tasks:
        tasks_dir = tasks


def register_running_step(step_name: str, pid: int, master_fd: int) -> None:
    """Register a step as running."""
    running_steps[step_name] = {"pid": pid, "master_fd": master_fd, "status": "running"}


def unregister_running_step(step_name: str) -> None:
    """Unregister a running step."""
    running_steps.pop(step_name, None)


def is_step_running(step_name: str) -> bool:
    """Check if a step is currently running."""
    return step_name in running_steps and running_steps[step_name]["status"] == "running"


def get_running_step(step_name: str) -> dict[str, Any] | None:
    """Get running step info."""
    return running_steps.get(step_name)

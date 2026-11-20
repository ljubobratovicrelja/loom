"""Global state management for the pipeline editor server."""

import os
import signal
from pathlib import Path
from typing import Any

# Server configuration
config_path: Path | None = None
tasks_dir: Path = Path("tasks")
workspace_dir: Path | None = None  # Set when launched in workspace mode

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


def configure(
    config: Path | None = None,
    tasks: Path | None = None,
    workspace: Path | None = None,
) -> None:
    """Configure the server with paths."""
    global config_path, tasks_dir, workspace_dir
    config_path = config
    if tasks:
        tasks_dir = tasks
    workspace_dir = workspace


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


def _terminate_process(pid: int | None) -> bool:
    """SIGTERM the process group led by ``pid``.

    Every subprocess the server spawns calls ``os.setsid()`` in the child, so the
    child's pid is also its process-group id and killing the group takes down any
    grandchildren (e.g. the loom CLI re-invoked for loop / multi_pass steps).

    Returns:
        True if a signal was delivered, False if the process was already gone.
    """
    if not pid:
        return False
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def stop_all_processes() -> list[str]:
    """Terminate every execution the server is currently aware of.

    Covers independent single-step runs (``running_steps``) and the sequential
    pipeline run tracked by ``execution_state``. Used by the cancel-all endpoint
    so a reloaded/closed browser tab cannot leave orphans behind.

    Returns:
        Names of the steps whose processes were signalled, in registration order.
    """
    stopped: list[str] = []

    for step_name, info in list(running_steps.items()):
        if info.get("status") != "running":
            continue
        if _terminate_process(info.get("pid")):
            info["status"] = "cancelled"
            stopped.append(step_name)

    if execution_state["status"] == "running" and _terminate_process(execution_state.get("pid")):
        execution_state["status"] = "cancelled"
        current_step = execution_state.get("current_step")
        if current_step and current_step not in stopped:
            stopped.append(current_step)

    return stopped

"""WebSocket terminal for real-time pipeline execution streaming."""

import asyncio
import fcntl
import json
import os
import pty
import signal
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from . import state
from .models import RunRequest


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

        if not state.config_path:
            await websocket.send_text("\x1b[31m[ERROR]\x1b[0m No config path set\r\n")
            return

        # Build commands using execution bridge
        from ..execution import (
            build_parallel_commands,
            build_pipeline_commands,
            build_step_command,
            get_step_output_dirs,
            validate_parallel_execution,
        )

        # Handle independent single-step mode (for concurrent execution)
        # This allows multiple steps to run independently in separate WebSocket connections
        if run_request.mode == "step" and run_request.step_name:
            await _run_single_step(
                websocket,
                run_request.step_name,
                build_step_command,
                get_step_output_dirs,
            )
            return

        # Handle parallel mode separately
        if run_request.mode == "parallel":
            await _run_parallel_steps(
                websocket,
                run_request,
                build_parallel_commands,
                validate_parallel_execution,
                get_step_output_dirs,
            )
            return

        # Sequential pipeline execution
        await _run_sequential_pipeline(
            websocket,
            run_request,
            build_pipeline_commands,
            get_step_output_dirs,
        )

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
        state.execution_state["status"] = "failed"
    finally:
        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass
        state.execution_state["status"] = "idle"
        state.execution_state["current_step"] = None
        state.execution_state["pid"] = None
        state.execution_state["master_fd"] = None


async def _run_single_step(
    websocket: WebSocket,
    step_name: str,
    build_step_command: Any,
    get_step_output_dirs: Any,
) -> None:
    """Run a single step in independent mode."""
    # Check if step is already running
    if state.is_step_running(step_name):
        await websocket.send_text(
            f"\x1b[33m[WARN]\x1b[0m Step '{step_name}' is already running\r\n"
        )
        return

    # Build command for this single step
    try:
        cmd = build_step_command(state.config_path, step_name)
    except ValueError as e:
        await websocket.send_text(f"\x1b[31m[ERROR]\x1b[0m {e}\r\n")
        return

    # Create output directories
    try:
        for dir_path in get_step_output_dirs(state.config_path, step_name):
            dir_path.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        await websocket.send_text(f"\x1b[31m[ERROR]\x1b[0m Failed to create output dirs: {e}\r\n")
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
        state.register_running_step(step_name, step_pid, step_master_fd)

        # Set non-blocking
        flags = fcntl.fcntl(step_master_fd, fcntl.F_GETFL)
        fcntl.fcntl(step_master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        cancelled = False
        ws_closed = False

        async def listen_for_cancel_step() -> None:
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
            state.unregister_running_step(step_name)

        # Send result (only if websocket still open)
        if cancelled:
            await safe_send_text(f"\x1b[33m[CANCELLED]\x1b[0m {step_name}\r\n")
            await safe_send_text(
                json.dumps({"type": "step_status", "step": step_name, "status": "cancelled"})
            )
        elif os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0:
            await safe_send_text(f"\x1b[32m[SUCCESS]\x1b[0m {step_name}\r\n")
            await safe_send_text(
                json.dumps({"type": "step_status", "step": step_name, "status": "completed"})
            )
        else:
            exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
            await safe_send_text(f"\x1b[31m[FAILED]\x1b[0m {step_name} (exit code {exit_code})\r\n")
            await safe_send_text(
                json.dumps({"type": "step_status", "step": step_name, "status": "failed"})
            )


async def _run_parallel_steps(
    websocket: WebSocket,
    run_request: RunRequest,
    build_parallel_commands: Any,
    validate_parallel_execution: Any,
    get_step_output_dirs: Any,
) -> None:
    """Run multiple steps in parallel."""
    if not run_request.step_names:
        await websocket.send_text("\x1b[31m[ERROR]\x1b[0m No steps specified for parallel mode\r\n")
        return

    # Validate no output conflicts
    is_valid, error_msg = validate_parallel_execution(state.config_path, run_request.step_names)
    if not is_valid:
        await websocket.send_text(f"\x1b[31m[ERROR]\x1b[0m {error_msg}\r\n")
        return

    commands = build_parallel_commands(state.config_path, run_request.step_names)
    if not commands:
        await websocket.send_text("\x1b[33m[WARN]\x1b[0m No steps to run\r\n")
        return

    state.execution_state["status"] = "running"

    # Track cancellation per step
    cancelled_steps: set[str] = set()

    async def listen_for_cancel_parallel() -> None:
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
        # Create output directories
        try:
            for dir_path in get_step_output_dirs(state.config_path, step_name):
                dir_path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            await websocket.send_bytes(
                f"[OUTPUT:{step_name}]\x1b[31m[ERROR]\x1b[0m Failed to create output dirs: {e}\r\n".encode()
            )
            return step_name, False

        # Send step status
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
                            exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
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
                    json.dumps({"type": "step_status", "step": step_name, "status": "cancelled"})
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
            state.execution_state["status"] = "completed"
        else:
            await websocket.send_text(
                f"\x1b[33m[PARTIAL]\x1b[0m {success_count}/{total} steps succeeded\r\n"
            )
            state.execution_state["status"] = "failed" if success_count == 0 else "completed"
    finally:
        cancel_task.cancel()
        try:
            await cancel_task
        except asyncio.CancelledError:
            pass


async def _run_sequential_pipeline(
    websocket: WebSocket,
    run_request: RunRequest,
    build_pipeline_commands: Any,
    get_step_output_dirs: Any,
) -> None:
    """Run pipeline steps sequentially."""
    try:
        commands = build_pipeline_commands(
            state.config_path,
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

    state.execution_state["status"] = "running"

    # Execute each step
    for step_name, cmd in commands:
        state.execution_state["current_step"] = step_name

        # Create output directories
        try:
            for dir_path in get_step_output_dirs(state.config_path, step_name):
                dir_path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            await websocket.send_text(
                f"\x1b[31m[ERROR]\x1b[0m Failed to create output dirs: {e}\r\n"
            )
            state.execution_state["status"] = "failed"
            return

        # Print step header
        cmd_str = " ".join(cmd)
        await websocket.send_text(f"\x1b[36m[RUNNING]\x1b[0m {step_name}\r\n")
        await websocket.send_text(f"  {cmd_str}\r\n")

        # Create PTY
        master_fd, slave_fd = pty.openpty()
        state.execution_state["master_fd"] = master_fd

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
            state.execution_state["pid"] = pid

            # Set non-blocking for PTY
            flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
            fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            # Track if cancelled
            cancelled = False

            # Task to listen for cancel messages
            async def listen_for_cancel() -> None:
                nonlocal cancelled
                try:
                    while True:
                        msg = await websocket.receive_text()
                        if msg == "__CANCEL__":
                            cancelled = True
                            state.execution_state["status"] = "cancelled"
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
            state.execution_state["master_fd"] = None
            state.execution_state["pid"] = None

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
                    state.execution_state["status"] = "failed"
                    return
            elif state.execution_state["status"] == "cancelled":
                await websocket.send_text(f"\x1b[33m[CANCELLED]\x1b[0m {step_name}\r\n")
                return
            else:
                await websocket.send_text(f"\x1b[31m[FAILED]\x1b[0m {step_name} (signal)\r\n")
                state.execution_state["status"] = "failed"
                return

    # All steps completed
    await websocket.send_text(f"\x1b[32m[COMPLETED]\x1b[0m {len(commands)} step(s) succeeded\r\n")
    state.execution_state["status"] = "completed"

"""Pipeline execution engine."""

import subprocess
import sys
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .config import PipelineConfig, StepConfig
from .orchestrator import EventType, PipelineOrchestrator, StepResult

# Lock for thread-safe printing in parallel execution
_print_lock = threading.Lock()


def _wait_brief() -> None:
    """Brief sleep to avoid busy-waiting in parallel execution."""
    import time

    time.sleep(0.01)


class PipelineExecutor:
    """Executes pipeline steps with dependency tracking.

    Uses PipelineOrchestrator for orchestration logic (what to run, when,
    in what order) while handling the actual subprocess execution.
    """

    def __init__(self, config: PipelineConfig, dry_run: bool = False) -> None:
        """Initialize executor with pipeline configuration.

        Args:
            config: Pipeline configuration.
            dry_run: If True, print commands without executing.
        """
        self.config = config
        self.dry_run = dry_run
        self._results: dict[str, bool] = {}

    def build_command(
        self,
        step: StepConfig,
        extra_args: str | None = None,
        loop_bindings: dict[str, str] | None = None,
    ) -> list[str]:
        """Build subprocess command from step definition.

        Args:
            step: Step configuration.
            extra_args: Additional arguments to append.
            loop_bindings: Per-iteration variable bindings for loop steps,
                e.g. {"loop_item": "/path/file.jpg", "loop_output": "/out/file.jpg"}.

        Returns:
            Command as list of strings.
        """
        # Resolve script path relative to pipeline directory
        script_path = self.config.resolve_script_path(step.script)
        cmd = [sys.executable, str(script_path)]

        # Add positional inputs in order (resolved to absolute paths)
        for var_ref in step.inputs.values():
            if (
                loop_bindings
                and isinstance(var_ref, str)
                and var_ref.startswith("$")
                and var_ref[1:] in loop_bindings
            ):
                cmd.append(loop_bindings[var_ref[1:]])
            else:
                # Use resolve_path_for_execution to handle URL downloads
                resolved = self.config.resolve_path_for_execution(var_ref)
                cmd.append(str(resolved))

        # Add output flags (resolved to absolute paths)
        for flag, var_ref in step.outputs.items():
            if (
                loop_bindings
                and isinstance(var_ref, str)
                and var_ref.startswith("$")
                and var_ref[1:] in loop_bindings
            ):
                cmd.append(flag)
                cmd.append(loop_bindings[var_ref[1:]])
            else:
                resolved = self.config.resolve_path(var_ref)
                cmd.append(flag)
                cmd.append(str(resolved))

        # Add other args
        for flag, value in step.args.items():
            if loop_bindings:
                resolved = self.config.resolve_value_with_loop(value, loop_bindings)
            else:
                resolved = self.config.resolve_value(value)

            # Handle boolean flags
            if isinstance(resolved, bool):
                if resolved:
                    cmd.append(flag)
            else:
                cmd.append(flag)
                cmd.append(str(resolved))

        # Add extra args if provided
        if extra_args:
            cmd.extend(extra_args.split())

        return cmd

    def _ensure_output_dirs(self, step: StepConfig) -> None:
        """Create parent directories for step outputs."""
        for var_ref in step.outputs.values():
            output_path = self.config.resolve_path(var_ref)
            output_path.parent.mkdir(parents=True, exist_ok=True)

    def run_step(
        self, step: StepConfig, extra_args: str | None = None
    ) -> subprocess.CompletedProcess | None:
        """Run a single pipeline step.

        For loop steps (step.loop is set), iterates over the collection.

        Args:
            step: Step configuration.
            extra_args: Additional arguments to append.

        Returns:
            CompletedProcess if executed, None if dry run.
        """
        if step.loop is not None:
            if self.dry_run:
                self._print_loop_dry_run(step)
                return None
            success = self.run_loop_step(step)
            return subprocess.CompletedProcess(args=[], returncode=0 if success else 1)

        cmd = self.build_command(step, extra_args)
        cmd_str = " ".join(cmd)

        if self.dry_run:
            print(f"[DRY RUN] {step.name}:")
            print(f"  {cmd_str}")
            return None

        print(f"[RUNNING] {step.name}")
        print(f"  {cmd_str}")

        self._ensure_output_dirs(step)

        result = subprocess.run(cmd, capture_output=False)

        if result.returncode == 0:
            print(f"[SUCCESS] {step.name}")
        else:
            print(f"[FAILED] {step.name} (exit code {result.returncode})")

        return result

    def _print_loop_dry_run(self, step: StepConfig) -> None:
        """Print dry-run output for a loop step."""
        loop = step.loop
        assert loop is not None
        over_path = self.config.resolve_path(loop.over)
        into_path = self.config.resolve_path(loop.into)
        if loop.filter:
            files = sorted(over_path.glob(loop.filter)) if over_path.exists() else []
        else:
            files = (
                sorted(f for f in over_path.iterdir() if f.is_file()) if over_path.exists() else []
            )
        print(f"[DRY RUN] {step.name} (loop: {len(files)} items):")
        for f in files:
            loop_bindings = {
                "loop_item": str(f),
                "loop_output": str(into_path / f.name),
            }
            cmd = self.build_command(step, loop_bindings=loop_bindings)
            print(f"  item {f.name}: {' '.join(cmd)}")

    def run_loop_step(self, step: StepConfig) -> bool:
        """Execute a loop step, running the task for each item in the collection.

        Args:
            step: Step with a loop config.

        Returns:
            True if all iterations succeeded, False otherwise.
        """
        loop = step.loop
        assert loop is not None

        over_path = self.config.resolve_path(loop.over)

        if not over_path.exists():
            print(f"[FAILED] {step.name}: loop.over directory does not exist: {over_path}")
            return False

        # Enumerate files, optionally filtered
        if loop.filter:
            files = sorted(over_path.glob(loop.filter))
        else:
            files = sorted(f for f in over_path.iterdir() if f.is_file())

        if not files:
            print(f"[RUNNING] {step.name} (loop: no files to process)")
            print(f"[SUCCESS] {step.name}")
            return True

        into_path = self.config.resolve_path(loop.into)
        into_path.mkdir(parents=True, exist_ok=True)

        # Determine whether to run iterations in parallel
        use_parallel = loop.parallel if loop.parallel is not None else self.config.parallel
        max_workers = self.config.max_workers or 4

        mode = f"loop: {len(files)} items" + (", parallel" if use_parallel else "")
        print(f"[RUNNING] {step.name} ({mode})")

        if use_parallel:
            success = self._run_loop_iterations_parallel(step, files, into_path, max_workers)
        else:
            success = self._run_loop_iterations_sequential(step, files, into_path)

        if success:
            print(f"[SUCCESS] {step.name}")
        else:
            print(f"[FAILED] {step.name} (some iterations failed)")

        return success

    def _run_loop_iterations_sequential(
        self, step: StepConfig, files: list[Path], into_path: Path
    ) -> bool:
        """Run loop iterations one at a time."""
        total = len(files)
        for i, f in enumerate(files):
            loop_bindings = {
                "loop_item": str(f),
                "loop_output": str(into_path / f.name),
            }
            cmd = self.build_command(step, loop_bindings=loop_bindings)
            print(f"  [{i + 1}/{total}] {f.name}")
            result = subprocess.run(cmd, capture_output=False)
            if result.returncode != 0:
                print(f"  [FAILED] item {f.name} (exit code {result.returncode})")
                return False
        return True

    def _run_loop_iterations_parallel(
        self, step: StepConfig, files: list[Path], into_path: Path, max_workers: int
    ) -> bool:
        """Run loop iterations concurrently."""

        def run_item(f: Path) -> tuple[str, bool, str]:
            loop_bindings = {
                "loop_item": str(f),
                "loop_output": str(into_path / f.name),
            }
            cmd = self.build_command(step, loop_bindings=loop_bindings)
            result = subprocess.run(cmd, capture_output=True, text=True)
            output_lines: list[str] = []
            if result.stdout:
                for line in result.stdout.rstrip().split("\n"):
                    if line:
                        output_lines.append(f"[{step.name}/{f.name}] {line}")
            if result.stderr:
                for line in result.stderr.rstrip().split("\n"):
                    if line:
                        output_lines.append(f"[{step.name}/{f.name}] {line}")
            return f.name, result.returncode == 0, "\n".join(output_lines)

        all_success = True
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [pool.submit(run_item, f) for f in files]
            for future in futures:
                item_name, item_success, output = future.result()
                with _print_lock:
                    if output:
                        print(output)
                    if not item_success:
                        print(f"  [FAILED] item {item_name}")
                if not item_success:
                    all_success = False
        return all_success

    def _get_steps_to_run(
        self,
        steps: list[str] | None = None,
        from_step: str | None = None,
        include_optional: list[str] | None = None,
    ) -> list[StepConfig]:
        """Determine which steps to run based on CLI options.

        This method delegates to the orchestrator for consistency.

        Args:
            steps: Specific step names to run.
            from_step: Run this step and all subsequent steps.
            include_optional: Optional steps to include.

        Returns:
            List of steps to run in order.
        """
        orch = PipelineOrchestrator(self.config)
        return orch.get_steps_to_run(steps, from_step, include_optional)

    def _can_run_step(self, step: StepConfig) -> bool:
        """Check if step can run based on dependency results.

        Args:
            step: Step to check.

        Returns:
            True if all dependencies succeeded or weren't run.
        """
        dependencies = self.config.get_step_dependencies(step)

        for dep_name in dependencies:
            # If dependency was run and failed, we can't run this step
            if dep_name in self._results and not self._results[dep_name]:
                return False

        return True

    def _build_dependency_graph(
        self, steps: list[StepConfig]
    ) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
        """Build dependency graph for parallel execution.

        This method delegates to the orchestrator for consistency.

        Args:
            steps: List of steps to build graph for.

        Returns:
            Tuple of (dependencies, dependents) dicts.
        """
        orch = PipelineOrchestrator(self.config)
        return orch.build_dependency_graph(steps)

    def _run_step_parallel(
        self, step: StepConfig, extra_args: str | None = None
    ) -> tuple[str, bool, str]:
        """Run a single step with captured output for pipeline-level parallel execution.

        For loop steps, runs all iterations and captures combined output.

        Args:
            step: Step configuration.
            extra_args: Additional arguments to append.

        Returns:
            Tuple of (step_name, success, output_text).
        """
        if step.loop is not None:
            if self.dry_run:
                return step.name, True, f"[DRY RUN] {step.name} (loop)"
            return self._run_loop_step_captured(step)

        cmd = self.build_command(step, extra_args)
        cmd_str = " ".join(cmd)
        output_lines: list[str] = []

        if self.dry_run:
            output_lines.append(f"[DRY RUN] {step.name}:")
            output_lines.append(f"  {cmd_str}")
            return step.name, True, "\n".join(output_lines)

        output_lines.append(f"[RUNNING] {step.name}")
        output_lines.append(f"  {cmd_str}")

        self._ensure_output_dirs(step)

        # Capture output for parallel execution
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
        )

        # Prefix each output line with step name
        if result.stdout:
            for line in result.stdout.rstrip().split("\n"):
                if line:
                    output_lines.append(f"[{step.name}] {line}")

        if result.stderr:
            for line in result.stderr.rstrip().split("\n"):
                if line:
                    output_lines.append(f"[{step.name}] {line}")

        if result.returncode == 0:
            output_lines.append(f"[SUCCESS] {step.name}")
        else:
            output_lines.append(f"[FAILED] {step.name} (exit code {result.returncode})")

        return step.name, result.returncode == 0, "\n".join(output_lines)

    def _run_loop_step_captured(self, step: StepConfig) -> tuple[str, bool, str]:
        """Run a loop step with captured output, for use in parallel pipeline execution.

        Args:
            step: Loop step.

        Returns:
            Tuple of (step_name, success, output_text).
        """
        loop = step.loop
        assert loop is not None

        output_lines: list[str] = []
        over_path = self.config.resolve_path(loop.over)

        if not over_path.exists():
            msg = f"[FAILED] {step.name}: loop.over directory does not exist: {over_path}"
            return step.name, False, msg

        if loop.filter:
            files = sorted(over_path.glob(loop.filter))
        else:
            files = sorted(f for f in over_path.iterdir() if f.is_file())

        if not files:
            output_lines.append(f"[RUNNING] {step.name} (loop: no files to process)")
            output_lines.append(f"[SUCCESS] {step.name}")
            return step.name, True, "\n".join(output_lines)

        into_path = self.config.resolve_path(loop.into)
        into_path.mkdir(parents=True, exist_ok=True)

        use_parallel = loop.parallel if loop.parallel is not None else self.config.parallel
        mode = f"loop: {len(files)} items" + (", parallel" if use_parallel else "")
        output_lines.append(f"[RUNNING] {step.name} ({mode})")

        all_success = True
        for f in files:
            loop_bindings = {
                "loop_item": str(f),
                "loop_output": str(into_path / f.name),
            }
            cmd = self.build_command(step, loop_bindings=loop_bindings)
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.stdout:
                for line in result.stdout.rstrip().split("\n"):
                    if line:
                        output_lines.append(f"[{step.name}/{f.name}] {line}")
            if result.stderr:
                for line in result.stderr.rstrip().split("\n"):
                    if line:
                        output_lines.append(f"[{step.name}/{f.name}] {line}")
            if result.returncode != 0:
                output_lines.append(f"  [FAILED] item {f.name}")
                all_success = False
                break

        if all_success:
            output_lines.append(f"[SUCCESS] {step.name}")
        else:
            output_lines.append(f"[FAILED] {step.name} (some iterations failed)")

        return step.name, all_success, "\n".join(output_lines)

    def run_pipeline(
        self,
        steps: list[str] | None = None,
        from_step: str | None = None,
        include_optional: list[str] | None = None,
        extra_args: dict[str, str] | None = None,
    ) -> dict[str, bool]:
        """Run pipeline steps using the shared orchestrator.

        Args:
            steps: Specific step names to run.
            from_step: Run from this step onward.
            include_optional: Optional steps to include.
            extra_args: Extra arguments per step {step_name: args_string}.

        Returns:
            Dict of step_name -> success status.
        """
        extra_args = extra_args or {}

        orch = PipelineOrchestrator(
            self.config,
            parallel=self.config.parallel,
            max_workers=self.config.max_workers,
        )

        # Get steps to run for display
        steps_to_run = orch.get_steps_to_run(steps, from_step, include_optional)

        if not steps_to_run:
            print("No steps to run.")
            return {}

        # Print header
        if self.config.parallel:
            mode = "parallel"
            if self.config.max_workers:
                mode += f" (max {self.config.max_workers} workers)"
            print(f"\nPipeline: {len(steps_to_run)} step(s) to run [{mode}]")
        else:
            print(f"\nPipeline: {len(steps_to_run)} step(s) to run")
        print("-" * 40)

        # Run using orchestrator
        if self.config.parallel:
            self._run_with_orchestrator_parallel(
                orch, steps, from_step, include_optional, extra_args
            )
        else:
            self._run_with_orchestrator_sequential(
                orch, steps, from_step, include_optional, extra_args
            )

        # Copy results from orchestrator
        self._results = orch.results

        # Print summary
        print("-" * 40)
        success_count = sum(1 for v in self._results.values() if v)
        print(f"Completed: {success_count}/{len(self._results)} steps succeeded")

        return self._results

    def _run_with_orchestrator_sequential(
        self,
        orch: PipelineOrchestrator,
        steps: list[str] | None,
        from_step: str | None,
        include_optional: list[str] | None,
        extra_args: dict[str, str],
    ) -> None:
        """Run pipeline sequentially using orchestrator.

        Args:
            orch: Pipeline orchestrator.
            steps: Specific step names to run.
            from_step: Run from this step onward.
            include_optional: Optional steps to include.
            extra_args: Extra arguments per step.
        """
        gen = orch.orchestrate(steps, from_step, include_optional)

        event = next(gen)
        while event.type != EventType.PIPELINE_COMPLETE:
            if event.type == EventType.STEP_READY:
                # These are guaranteed to be set for STEP_READY events
                assert event.step is not None
                assert event.step_name is not None
                step = event.step
                step_name = event.step_name
                step_extra = extra_args.get(step_name)
                result = self.run_step(step, step_extra)

                if self.dry_run:
                    success = True
                else:
                    success = result is not None and result.returncode == 0

                event = gen.send(StepResult(step_name, success))

            elif event.type == EventType.STEP_SKIPPED:
                print(f"[SKIPPED] {event.step_name} (dependencies failed: {event.failed_deps})")
                event = next(gen)

            else:
                event = next(gen)

    def _run_with_orchestrator_parallel(
        self,
        orch: PipelineOrchestrator,
        steps: list[str] | None,
        from_step: str | None,
        include_optional: list[str] | None,
        extra_args: dict[str, str],
    ) -> None:
        """Run pipeline in parallel using orchestrator.

        Args:
            orch: Pipeline orchestrator.
            steps: Specific step names to run.
            from_step: Run from this step onward.
            include_optional: Optional steps to include.
            extra_args: Extra arguments per step.
        """
        gen = orch.orchestrate(steps, from_step, include_optional)
        running: dict[str, Future[tuple[str, bool, str]]] = {}
        step_map: dict[str, StepConfig] = {}

        max_workers = self.config.max_workers or 4
        executor = ThreadPoolExecutor(max_workers=max_workers)

        try:
            event = next(gen)
            while event.type != EventType.PIPELINE_COMPLETE:
                if event.type == EventType.STEP_READY:
                    # These are guaranteed to be set for STEP_READY events
                    assert event.step is not None
                    assert event.step_name is not None
                    step = event.step
                    step_name = event.step_name
                    step_map[step_name] = step
                    step_extra = extra_args.get(step_name)
                    future = executor.submit(self._run_step_parallel, step, step_extra)
                    running[step_name] = future
                    event = next(gen)

                elif event.type == EventType.STEP_SKIPPED:
                    with _print_lock:
                        print(
                            f"[SKIPPED] {event.step_name} (dependencies failed: {event.failed_deps})"
                        )
                    event = next(gen)

                elif event.type == EventType.WAITING:
                    # Wait for at least one task to complete
                    done_name = None
                    while done_name is None:
                        for name, future in list(running.items()):
                            if future.done():
                                done_name = name
                                break
                        if done_name is None:
                            _wait_brief()

                    future = running.pop(done_name)
                    step_name, success, output = future.result()

                    # Print output atomically
                    with _print_lock:
                        print(output)

                    event = gen.send(StepResult(step_name, success))

                else:
                    event = next(gen)

        finally:
            executor.shutdown(wait=True)


def parse_key_value_args(args: list[str]) -> dict[str, Any]:
    """Parse key=value arguments into a dict.

    Args:
        args: List of "key=value" strings.

    Returns:
        Dict of parsed key-value pairs.
    """
    result: dict[str, Any] = {}
    for arg in args:
        if "=" not in arg:
            raise ValueError(f"Invalid format: {arg}. Expected key=value")
        key, value = arg.split("=", 1)

        # Try to parse as number or bool
        if value.lower() == "true":
            result[key] = True
        elif value.lower() == "false":
            result[key] = False
        else:
            try:
                result[key] = float(value) if "." in value else int(value)
            except ValueError:
                result[key] = value

    return result

"""Pipeline orchestration logic for dependency-based execution.

This module provides a shared orchestrator that handles the "what to run and when"
logic for pipeline execution. It yields events that tell backends (CLI subprocess
or UI PTY) when steps are ready to execute, and receives results back via send().

The orchestrator handles:
- Building dependency graphs from step configurations
- Determining which steps are ready to run (all deps satisfied)
- Tracking step results (success/failure)
- Skipping dependent steps when dependencies fail
- Both sequential and parallel execution modes
"""

import os
from collections.abc import Generator
from dataclasses import dataclass
from enum import Enum

from .config import PipelineConfig, StepConfig


class EventType(Enum):
    """Types of events yielded by the orchestrator."""

    STEP_READY = "step_ready"  # Step is ready to execute
    STEP_SKIPPED = "step_skipped"  # Step skipped due to failed dependency
    WAITING = "waiting"  # Waiting for running steps to complete (parallel mode)
    PIPELINE_COMPLETE = "pipeline_complete"  # All steps processed


@dataclass
class OrchestratorEvent:
    """Event yielded by the orchestrator.

    Attributes:
        type: The type of event (ready, skipped, waiting, complete).
        step_name: Name of the step (for STEP_READY, STEP_SKIPPED).
        step: StepConfig object (for STEP_READY).
        failed_deps: List of failed dependency names (for STEP_SKIPPED).
    """

    type: EventType
    step_name: str | None = None
    step: StepConfig | None = None
    failed_deps: list[str] | None = None


@dataclass
class StepResult:
    """Result of step execution, sent back to orchestrator.

    Attributes:
        step_name: Name of the completed step.
        success: Whether the step succeeded.
    """

    step_name: str
    success: bool


# Type alias for the orchestrator generator
OrchestratorGenerator = Generator[OrchestratorEvent, StepResult | None, None]


class PipelineOrchestrator:
    """Orchestrates pipeline execution with dependency tracking.

    Uses a generator-based interface:
    - Yields events (step ready, step skipped, waiting)
    - Receives step results via send()
    - Handles both sequential and parallel modes

    Example usage (sequential):
        orch = PipelineOrchestrator(config, parallel=False)
        gen = orch.orchestrate()

        event = next(gen)
        while event.type != EventType.PIPELINE_COMPLETE:
            if event.type == EventType.STEP_READY:
                success = run_step(event.step_name, event.step)
                event = gen.send(StepResult(event.step_name, success))
            elif event.type == EventType.STEP_SKIPPED:
                log_skip(event.step_name, event.failed_deps)
                event = next(gen)

    Example usage (parallel):
        orch = PipelineOrchestrator(config, parallel=True)
        gen = orch.orchestrate()
        running = {}

        event = next(gen)
        while event.type != EventType.PIPELINE_COMPLETE:
            if event.type == EventType.STEP_READY:
                task = start_async_step(event.step_name, event.step)
                running[event.step_name] = task
                event = next(gen)
            elif event.type == EventType.STEP_SKIPPED:
                log_skip(event.step_name, event.failed_deps)
                event = next(gen)
            elif event.type == EventType.WAITING:
                # Wait for at least one task to complete
                name, success = await wait_for_any(running)
                del running[name]
                event = gen.send(StepResult(name, success))
    """

    def __init__(
        self,
        config: PipelineConfig,
        parallel: bool = False,
        max_workers: int | None = None,
    ) -> None:
        """Initialize orchestrator with pipeline configuration.

        Args:
            config: Pipeline configuration with steps and dependencies.
            parallel: If True, yield all ready steps at once (parallel mode).
            max_workers: Maximum concurrent steps in parallel mode.
        """
        self.config = config
        self.parallel = parallel
        self.max_workers = max_workers or os.cpu_count() or 4
        self._results: dict[str, bool] = {}

    def build_dependency_graph(
        self, steps: list[StepConfig]
    ) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
        """Build dependency graph for the given steps.

        Args:
            steps: List of steps to build graph for.

        Returns:
            Tuple of (dependencies, dependents) dicts where:
            - dependencies[step_name] = set of step names this step depends on
            - dependents[step_name] = set of step names that depend on this step
        """
        step_names = {s.name for s in steps}
        dependencies: dict[str, set[str]] = {}
        dependents: dict[str, set[str]] = {}

        for step in steps:
            # Get dependencies, but only include steps that are in our run list
            step_deps = self.config.get_step_dependencies(step)
            dependencies[step.name] = step_deps & step_names
            dependents[step.name] = set()

        # Build reverse mapping (dependents)
        for step_name, deps in dependencies.items():
            for dep in deps:
                if dep in dependents:
                    dependents[dep].add(step_name)

        return dependencies, dependents

    def get_steps_to_run(
        self,
        steps: list[str] | None = None,
        from_step: str | None = None,
        include_optional: list[str] | None = None,
    ) -> list[StepConfig]:
        """Determine which steps to run based on options.

        Args:
            steps: Specific step names to run.
            from_step: Run this step and all subsequent steps.
            include_optional: Optional steps to include.

        Returns:
            List of steps to run in order.
        """
        include_optional = include_optional or []

        if steps:
            # Run only specified steps
            return [self.config.get_step_by_name(name) for name in steps]

        # Get all steps, filtering optional ones
        result = []
        started = from_step is None

        for step in self.config.steps:
            if step.name == from_step:
                started = True

            if not started:
                continue

            # Skip disabled steps
            if step.disabled:
                continue

            # Skip optional steps unless explicitly included
            if step.optional and step.name not in include_optional:
                continue

            result.append(step)

        return result

    def orchestrate(
        self,
        steps: list[str] | None = None,
        from_step: str | None = None,
        include_optional: list[str] | None = None,
    ) -> OrchestratorGenerator:
        """Generator that yields execution events.

        This is the main orchestration interface. It yields events indicating
        when steps are ready, skipped, or when the orchestrator is waiting for
        results. Callers should send StepResult back after executing a step.

        Args:
            steps: Specific step names to run.
            from_step: Run from this step onward.
            include_optional: Optional steps to include.

        Yields:
            OrchestratorEvent objects.

        Usage:
            gen = orch.orchestrate()
            event = next(gen)
            while event.type != EventType.PIPELINE_COMPLETE:
                if event.type == EventType.STEP_READY:
                    success = execute(event.step)
                    event = gen.send(StepResult(event.step_name, success))
                else:
                    event = next(gen)
        """
        steps_to_run = self.get_steps_to_run(steps, from_step, include_optional)

        if not steps_to_run:
            yield OrchestratorEvent(type=EventType.PIPELINE_COMPLETE)
            return

        if self.parallel:
            yield from self._orchestrate_parallel(steps_to_run)
        else:
            yield from self._orchestrate_sequential(steps_to_run)

    def _orchestrate_sequential(self, steps: list[StepConfig]) -> OrchestratorGenerator:
        """Sequential execution: yield one step at a time.

        Args:
            steps: List of steps to execute in order.

        Yields:
            OrchestratorEvent for each step (STEP_READY or STEP_SKIPPED).
        """
        for step in steps:
            # Check if we can run this step
            if not self._can_run_step(step):
                deps = self.config.get_step_dependencies(step)
                failed_deps = [d for d in deps if self._results.get(d) is False]
                self._results[step.name] = False
                yield OrchestratorEvent(
                    type=EventType.STEP_SKIPPED,
                    step_name=step.name,
                    step=step,
                    failed_deps=failed_deps,
                )
                continue

            # Step is ready - yield and wait for result
            event = OrchestratorEvent(
                type=EventType.STEP_READY,
                step_name=step.name,
                step=step,
            )
            result = yield event

            # Record result
            if isinstance(result, StepResult):
                self._results[result.step_name] = result.success
            else:
                # Default to success if no result sent (shouldn't happen)
                self._results[step.name] = True

        yield OrchestratorEvent(type=EventType.PIPELINE_COMPLETE)

    def _orchestrate_parallel(self, steps: list[StepConfig]) -> OrchestratorGenerator:
        """Parallel execution: yield all ready steps, wait for completions.

        Args:
            steps: List of steps to execute.

        Yields:
            OrchestratorEvent for ready steps, skip events, and WAITING events.
        """
        dependencies, _ = self.build_dependency_graph(steps)
        step_map = {s.name: s for s in steps}

        pending = set(step_map.keys())
        completed: set[str] = set()
        failed: set[str] = set()
        skipped: set[str] = set()
        running: set[str] = set()

        while pending or running:
            # Find ready steps (all dependencies completed successfully)
            ready: list[str] = []
            to_skip: list[str] = []

            for name in list(pending):
                deps = dependencies[name]
                # Check if any dependency failed or was skipped
                if deps & (failed | skipped):
                    to_skip.append(name)
                elif deps <= completed:
                    # Check max_workers limit (account for both running and already-ready steps)
                    if len(running) + len(ready) < self.max_workers:
                        ready.append(name)

            # Yield skip events
            for name in to_skip:
                pending.remove(name)
                skipped.add(name)
                self._results[name] = False
                deps = dependencies[name]
                failed_deps = list(deps & (failed | skipped))
                yield OrchestratorEvent(
                    type=EventType.STEP_SKIPPED,
                    step_name=name,
                    step=step_map[name],
                    failed_deps=failed_deps,
                )

            # Yield ready steps
            for name in ready:
                pending.remove(name)
                running.add(name)
                yield OrchestratorEvent(
                    type=EventType.STEP_READY,
                    step_name=name,
                    step=step_map[name],
                )

            # If we have running tasks, yield WAITING and expect a result
            if running:
                result = yield OrchestratorEvent(type=EventType.WAITING)

                if isinstance(result, StepResult):
                    running.discard(result.step_name)
                    self._results[result.step_name] = result.success
                    if result.success:
                        completed.add(result.step_name)
                    else:
                        failed.add(result.step_name)
            elif not pending:
                # No running tasks and no pending tasks, we're done
                break

        yield OrchestratorEvent(type=EventType.PIPELINE_COMPLETE)

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

    @property
    def results(self) -> dict[str, bool]:
        """Get execution results.

        Returns:
            Dict mapping step names to success status.
        """
        return self._results.copy()

"""Pipeline execution engine."""

import subprocess
import sys
from typing import Any

from .config import PipelineConfig, StepConfig


class PipelineExecutor:
    """Executes pipeline steps with dependency tracking."""

    def __init__(self, config: PipelineConfig, dry_run: bool = False) -> None:
        """Initialize executor with pipeline configuration.

        Args:
            config: Pipeline configuration.
            dry_run: If True, print commands without executing.
        """
        self.config = config
        self.dry_run = dry_run
        self._results: dict[str, bool] = {}

    def build_command(self, step: StepConfig, extra_args: str | None = None) -> list[str]:
        """Build subprocess command from step definition.

        Args:
            step: Step configuration.
            extra_args: Additional arguments to append.

        Returns:
            Command as list of strings.
        """
        # Resolve script path relative to pipeline directory
        script_path = self.config.resolve_script_path(step.script)
        cmd = [sys.executable, str(script_path)]

        # Add positional inputs in order (resolved to absolute paths)
        for var_ref in step.inputs.values():
            resolved = self.config.resolve_path(var_ref)
            cmd.append(str(resolved))

        # Add output flags (resolved to absolute paths)
        for flag, var_ref in step.outputs.items():
            resolved = self.config.resolve_path(var_ref)
            cmd.append(flag)
            cmd.append(str(resolved))

        # Add other args
        for flag, value in step.args.items():
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

        Args:
            step: Step configuration.
            extra_args: Additional arguments to append.

        Returns:
            CompletedProcess if executed, None if dry run.
        """
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

    def _get_steps_to_run(
        self,
        steps: list[str] | None = None,
        from_step: str | None = None,
        include_optional: list[str] | None = None,
    ) -> list[StepConfig]:
        """Determine which steps to run based on CLI options.

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

    def run_pipeline(
        self,
        steps: list[str] | None = None,
        from_step: str | None = None,
        include_optional: list[str] | None = None,
        extra_args: dict[str, str] | None = None,
    ) -> dict[str, bool]:
        """Run pipeline steps.

        Args:
            steps: Specific step names to run.
            from_step: Run from this step onward.
            include_optional: Optional steps to include.
            extra_args: Extra arguments per step {step_name: args_string}.

        Returns:
            Dict of step_name -> success status.
        """
        extra_args = extra_args or {}
        steps_to_run = self._get_steps_to_run(steps, from_step, include_optional)

        if not steps_to_run:
            print("No steps to run.")
            return {}

        print(f"\nPipeline: {len(steps_to_run)} step(s) to run")
        print("-" * 40)

        for step in steps_to_run:
            if not self._can_run_step(step):
                deps = self.config.get_step_dependencies(step)
                failed_deps = [d for d in deps if self._results.get(d) is False]
                print(f"[SKIPPED] {step.name} (dependencies failed: {failed_deps})")
                self._results[step.name] = False
                continue

            step_extra = extra_args.get(step.name)
            result = self.run_step(step, step_extra)

            if self.dry_run:
                self._results[step.name] = True
            else:
                self._results[step.name] = result is not None and result.returncode == 0

        # Print summary
        print("-" * 40)
        success_count = sum(1 for v in self._results.values() if v)
        print(f"Completed: {success_count}/{len(self._results)} steps succeeded")

        return self._results


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

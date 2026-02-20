"""Execution helpers for the editor server.

Bridges the editor server with the runner module to build commands for
PTY-based execution without reimplementing command building logic.
"""

from pathlib import Path

from loom.runner import PipelineConfig, PipelineExecutor, StepConfig


def _step_outputs_exist(config: PipelineConfig, step: StepConfig) -> bool:
    """Check if all outputs of a step already exist.

    Args:
        config: Pipeline configuration (for resolving variable values).
        step: Step to check.

    Returns:
        True if all output files exist, False otherwise.
    """
    if not step.outputs:
        return False

    for var_ref in step.outputs.values():
        output_path = config.resolve_path(var_ref)
        if not output_path.exists():
            return False

    return True


def build_step_command(config_path: Path, step_name: str) -> list[str]:
    """Build command for a single step.

    Args:
        config_path: Path to pipeline YAML.
        step_name: Name of step to execute.

    Returns:
        Command as list of strings.

    Raises:
        ValueError: If step not found.
    """
    config = PipelineConfig.from_yaml(config_path)
    executor = PipelineExecutor(config, dry_run=True)
    step = config.get_step_by_name(step_name)
    return executor.build_command(step)


def _get_steps_to_produce_data(
    config: PipelineConfig,
    data_name: str,
    skip_completed: bool = False,
) -> list:
    """Get all steps needed to produce a data output, in execution order.

    Args:
        config: Pipeline configuration.
        data_name: Name of the data output to produce.
        skip_completed: If True, filter out steps whose outputs already exist.

    Returns:
        List of steps in execution order.

    Raises:
        ValueError: If no step produces the data output.
    """
    # Find which step produces this data output
    producing_step = None
    for step in config.steps:
        for out_ref in step.outputs.values():
            if out_ref == f"${data_name}":
                producing_step = step
                break
        if producing_step:
            break

    if not producing_step:
        raise ValueError(f"No step produces data '{data_name}'")

    # Build dependency graph: which variables does each step need?
    # Then trace back from producing_step to find all required steps
    all_steps = list(config.steps)
    step_by_name = {s.name: s for s in all_steps}

    # Map variable -> step that produces it
    var_producers: dict[str, str] = {}
    for step in all_steps:
        for out_ref in step.outputs.values():
            if out_ref.startswith("$"):
                var_producers[out_ref[1:]] = step.name

    # Find all steps needed (BFS from producing_step backwards)
    needed_steps: set[str] = {producing_step.name}
    queue = [producing_step]

    while queue:
        step = queue.pop(0)
        # Check what variables this step needs as inputs
        for in_ref in step.inputs.values():
            if in_ref.startswith("$"):
                var_name = in_ref[1:]
                if var_name in var_producers:
                    dep_step_name = var_producers[var_name]
                    if dep_step_name not in needed_steps:
                        needed_steps.add(dep_step_name)
                        queue.append(step_by_name[dep_step_name])

    # Get steps in pipeline order (preserving execution order)
    steps = [s for s in all_steps if s.name in needed_steps]

    # Optionally filter out steps whose outputs already exist
    if skip_completed:
        steps = [s for s in steps if not _step_outputs_exist(config, s)]

    return steps


def _get_steps_to_step(config: PipelineConfig, step_name: str) -> list[StepConfig]:
    """Get all upstream steps needed to reach a target step, in pipeline order.

    Unlike _get_steps_to_produce_data, this always re-runs everything (no skip_completed).
    Uses config.get_step_dependencies which handles both inputs and loop.over references.

    Args:
        config: Pipeline configuration.
        step_name: Name of the target step.

    Returns:
        List of steps in pipeline definition order (target step included).
    """
    target_step = config.get_step_by_name(step_name)
    step_by_name = {s.name: s for s in config.steps}

    # BFS backwards from target step using PipelineConfig's dependency resolution
    needed_steps: set[str] = {target_step.name}
    queue = [target_step]

    while queue:
        step = queue.pop(0)
        for dep_name in config.get_step_dependencies(step):
            if dep_name not in needed_steps:
                needed_steps.add(dep_name)
                queue.append(step_by_name[dep_name])

    # Return in pipeline definition order
    return [s for s in config.steps if s.name in needed_steps]


def build_pipeline_commands(
    config_path: Path,
    mode: str,
    step_name: str | None = None,
    data_name: str | None = None,
    include_optional: list[str] | None = None,
) -> list[tuple[str, list[str]]]:
    """Build commands for pipeline execution.

    Args:
        config_path: Path to pipeline YAML.
        mode: Execution mode - "step", "from_step", "to_step", "to_data", or "all".
        step_name: Step name (required for "step" and "from_step" modes).
        data_name: Data output name (required for "to_data" mode).
        include_optional: List of optional step names to include.

    Returns:
        List of (step_name, command) tuples in execution order.

    Raises:
        ValueError: If mode requires step_name/data_name but not provided.
    """
    config = PipelineConfig.from_yaml(config_path)
    executor = PipelineExecutor(config, dry_run=True)

    # Determine which steps to run based on mode
    if mode == "step":
        if not step_name:
            raise ValueError("step_name required for 'step' mode")
        steps = [config.get_step_by_name(step_name)]
    elif mode == "from_step":
        if not step_name:
            raise ValueError("step_name required for 'from_step' mode")
        steps = executor._get_steps_to_run(from_step=step_name, include_optional=include_optional)
    elif mode == "to_step":
        if not step_name:
            raise ValueError("step_name required for 'to_step' mode")
        raw_steps = _get_steps_to_step(config, step_name)
        # Filter like other modes: skip disabled, exclude optional unless included.
        # Always keep the target step itself (user explicitly selected it).
        steps = [
            s
            for s in raw_steps
            if s.name == step_name
            or (
                not s.disabled
                and (not s.optional or (include_optional and s.name in include_optional))
            )
        ]
    elif mode == "to_data":
        if not data_name:
            raise ValueError("data_name required for 'to_data' mode")
        # Skip steps whose outputs already exist (only run what's missing)
        steps = _get_steps_to_produce_data(config, data_name, skip_completed=True)
    else:  # mode == "all"
        steps = executor._get_steps_to_run(include_optional=include_optional)

    # Build commands for each step
    commands = []
    for step in steps:
        cmd = executor.build_command(step)
        commands.append((step.name, cmd))

    return commands


def build_group_commands(config_path: Path, group_name: str) -> list[tuple[str, list[str]]]:
    """Build commands for all steps in a named group.

    Args:
        config_path: Path to pipeline YAML.
        group_name: Name of the group to build commands for.

    Returns:
        List of (step_name, command) tuples in pipeline order.

    Raises:
        ValueError: If group not found.
    """
    config = PipelineConfig.from_yaml(config_path)
    executor = PipelineExecutor(config, dry_run=True)
    group_steps = config.get_steps_by_group(group_name)

    commands = []
    for step in group_steps:
        cmd = executor.build_command(step)
        commands.append((step.name, cmd))

    return commands


def validate_parallel_execution(config_path: Path, step_names: list[str]) -> tuple[bool, str]:
    """Check if steps can run in parallel (no shared outputs).

    Args:
        config_path: Path to pipeline YAML.
        step_names: List of step names to validate.

    Returns:
        Tuple of (is_valid, error_message). If valid, error_message is empty.
    """
    config = PipelineConfig.from_yaml(config_path)
    outputs_seen: dict[str, str] = {}  # output_ref -> step_name

    for name in step_names:
        step = config.get_step_by_name(name)
        for out_ref in step.outputs.values():
            if out_ref in outputs_seen:
                return (
                    False,
                    f"Output conflict: {out_ref} is produced by both "
                    f"'{outputs_seen[out_ref]}' and '{name}'",
                )
            outputs_seen[out_ref] = name

    return True, ""


def build_parallel_commands(
    config_path: Path, step_names: list[str]
) -> list[tuple[str, list[str]]]:
    """Build commands for parallel execution of specific steps.

    Args:
        config_path: Path to pipeline YAML.
        step_names: List of step names to execute in parallel.

    Returns:
        List of (step_name, command) tuples.
    """
    config = PipelineConfig.from_yaml(config_path)
    executor = PipelineExecutor(config, dry_run=True)

    commands = []
    for name in step_names:
        step = config.get_step_by_name(name)
        cmd = executor.build_command(step)
        commands.append((name, cmd))

    return commands


def get_step_output_dirs(config_path: Path, step_name: str) -> list[Path]:
    """Get output directories for a step (to create before execution).

    Args:
        config_path: Path to pipeline YAML.
        step_name: Name of step.

    Returns:
        List of parent directories for step outputs (absolute paths).
    """
    config = PipelineConfig.from_yaml(config_path)
    step = config.get_step_by_name(step_name)

    dirs = []
    for var_ref in step.outputs.values():
        output_path = config.resolve_path(var_ref)
        parent = output_path.parent
        if parent not in dirs:
            dirs.append(parent)

    return dirs

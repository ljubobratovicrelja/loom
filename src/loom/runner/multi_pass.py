"""Multi-pass configuration for pipeline groups.

Parses ``multi_pass:`` blocks into ``MultiPassGroupConfig`` objects that the
executor uses at runtime to iterate template steps.  No parse-time unrolling —
template steps appear once and are executed in a loop by the executor.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Safe builtins allowed in eval() for expressions
SAFE_BUILTINS: dict[str, Any] = {
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "int": int,
    "float": float,
    "True": True,
    "False": False,
    "__builtins__": {},
}


@dataclass
class ConditionConfig:
    """Configuration for a condition script that controls early stopping."""

    script: str
    inputs: dict[str, str] = field(default_factory=dict)
    args: dict[str, Any] = field(default_factory=dict)


@dataclass
class MultiPassGroupConfig:
    """Stored on PipelineConfig for each multi_pass group."""

    group_name: str
    template_step_dicts: list[dict[str, Any]]
    schedule: list[dict[str, Any]] | None = None
    expressions: dict[str, str] | None = None
    count: int = 1
    condition: ConditionConfig | None = None
    feedback: dict[str, str] = field(default_factory=dict)
    internal_outputs: set[str] = field(default_factory=set)

    @property
    def iteration_count(self) -> int:
        """Return the number of iterations."""
        if self.schedule is not None:
            return len(self.schedule)
        return self.count


def _suffix_path(path: str, suffix: str) -> str:
    """Append a suffix to a file path before the extension.

    Examples:
        >>> _suffix_path("results/graph.npz", "iter0")
        'results/graph_iter0.npz'
        >>> _suffix_path("data/output/", "iter1")
        'data/output_iter1/'
        >>> _suffix_path("results/mesh", "iter2")
        'results/mesh_iter2'
    """
    if not path:
        return f"_{suffix}"

    # Handle trailing slash (directory paths)
    if path.endswith("/"):
        return f"{path.rstrip('/')}_{suffix}/"

    # Find last dot for extension splitting
    last_slash = path.rfind("/")
    dot_pos = path.rfind(".")

    if dot_pos > last_slash:
        # Has extension: insert suffix before extension
        return f"{path[:dot_pos]}_{suffix}{path[dot_pos:]}"
    else:
        # No extension: append suffix
        return f"{path}_{suffix}"


def _validate_expression(expr: str, label: str) -> None:
    """Validate a Python expression via compile().

    Args:
        expr: Python expression string.
        label: Human-readable label for error messages.

    Raises:
        ValueError: If the expression has a syntax error.
    """
    try:
        compile(expr, f"<{label}>", "eval")
    except SyntaxError as e:
        raise ValueError(f"Invalid syntax in {label}: {expr!r} — {e}") from e


def parse_multi_pass_config(
    group_name: str,
    multi_pass_data: dict[str, Any],
    template_step_dicts: list[dict[str, Any]],
    data_section: dict[str, Any],
) -> MultiPassGroupConfig:
    """Parse and validate multi_pass YAML block.

    Args:
        group_name: Name of the pipeline group.
        multi_pass_data: The ``multi_pass:`` dict from YAML.
        template_step_dicts: The ``steps:`` list from the group block.
        data_section: The pipeline's ``data:`` section.

    Returns:
        Parsed MultiPassGroupConfig (no expansion).

    Raises:
        ValueError: On validation errors.
    """
    schedule = multi_pass_data.get("schedule")
    expressions = multi_pass_data.get("expressions")
    count = multi_pass_data.get("count")
    condition_data = multi_pass_data.get("condition")
    feedback = multi_pass_data.get("feedback", {})

    # --- Mutual exclusivity ---
    if schedule is not None and expressions is not None:
        raise ValueError(
            f"multi_pass group '{group_name}': 'schedule' and 'expressions' are mutually exclusive"
        )

    # --- Schedule validation ---
    if schedule is not None:
        if not isinstance(schedule, list) or len(schedule) == 0:
            raise ValueError(
                f"multi_pass group '{group_name}': 'schedule' must be a non-empty list"
            )
        inferred_count = len(schedule)
    else:
        inferred_count = None

    # --- Expressions validation ---
    if expressions is not None:
        if count is None:
            raise ValueError(
                f"multi_pass group '{group_name}': 'count' is required when using 'expressions'"
            )
        if not isinstance(expressions, dict) or len(expressions) == 0:
            raise ValueError(
                f"multi_pass group '{group_name}': 'expressions' must be a non-empty dict"
            )
        for param_name, expr in expressions.items():
            _validate_expression(expr, f"expressions.{param_name}")

    # --- Count validation ---
    if count is not None and not isinstance(count, int):
        raise ValueError(f"multi_pass group '{group_name}': 'count' must be an integer")
    if count is not None and count < 1:
        raise ValueError(f"multi_pass group '{group_name}': 'count' must be >= 1")

    # --- Condition validation ---
    condition: ConditionConfig | None = None
    if condition_data is not None:
        if not isinstance(condition_data, dict):
            raise ValueError(f"multi_pass group '{group_name}': 'condition' must be a dict")
        if "script" not in condition_data:
            raise ValueError(
                f"multi_pass group '{group_name}': 'condition' must have a 'script' key"
            )
        condition = ConditionConfig(
            script=condition_data["script"],
            inputs=condition_data.get("inputs", {}),
            args=condition_data.get("args", {}),
        )

    # --- Identify internal output variables ---
    internal_outputs: set[str] = set()
    for step in template_step_dicts:
        for ref in step.get("outputs", {}).values():
            if isinstance(ref, str) and ref.startswith("$"):
                internal_outputs.add(ref[1:])

    # --- Feedback validation ---
    if feedback:
        # Collect step names and their output/input flags
        step_output_flags: dict[str, set[str]] = {}
        step_names: set[str] = set()
        for step in template_step_dicts:
            sname = step["name"]
            step_names.add(sname)
            step_output_flags[sname] = set(step.get("outputs", {}).keys())

        for source_spec, target_spec in feedback.items():
            # Validate source
            if "." not in source_spec:
                raise ValueError(
                    f"multi_pass group '{group_name}': "
                    f"feedback source '{source_spec}' must be 'step.flag'"
                )
            src_step, src_flag = source_spec.split(".", 1)
            if src_step not in step_names:
                raise ValueError(
                    f"multi_pass group '{group_name}': "
                    f"feedback source step '{src_step}' not found in group"
                )
            if src_flag not in step_output_flags[src_step]:
                raise ValueError(
                    f"multi_pass group '{group_name}': "
                    f"feedback source flag '{src_flag}' not found in "
                    f"outputs of step '{src_step}'"
                )

            # Validate target
            if "." not in target_spec:
                raise ValueError(
                    f"multi_pass group '{group_name}': "
                    f"feedback target '{target_spec}' must be 'step.flag'"
                )
            tgt_step, _tgt_flag = target_spec.split(".", 1)
            if tgt_step not in step_names:
                raise ValueError(
                    f"multi_pass group '{group_name}': "
                    f"feedback target step '{tgt_step}' not found in group"
                )

    final_count = inferred_count if inferred_count is not None else (count or 1)

    return MultiPassGroupConfig(
        group_name=group_name,
        template_step_dicts=template_step_dicts,
        schedule=schedule,
        expressions=expressions,
        count=final_count,
        condition=condition,
        feedback=feedback,
        internal_outputs=internal_outputs,
    )

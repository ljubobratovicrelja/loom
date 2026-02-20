"""Multi-pass expansion for pipeline groups.

Expands ``multi_pass:`` blocks into concrete flat steps during pipeline
flattening. Each pass generates suffixed copies of the template steps with
per-pass parameters, output path suffixing, and chaining between consecutive
passes.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PassConfig:
    """Configuration for a single pass in a multi-pass group."""

    name: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class MultiPassConfig:
    """Parsed multi_pass configuration block."""

    passes: list[PassConfig]
    chain: dict[str, str] = field(default_factory=dict)
    # chain maps "step.--output-flag" -> "step.--input-flag"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MultiPassConfig":
        """Parse a multi_pass dict from YAML.

        Args:
            data: The ``multi_pass:`` dict containing ``passes`` and
                optionally ``chain``.

        Returns:
            Parsed MultiPassConfig.

        Raises:
            KeyError: If ``passes`` is missing.
            ValueError: If passes list is empty or a pass is missing ``name``.
        """
        if "passes" not in data:
            raise KeyError("multi_pass config must have 'passes' field")
        raw_passes = data["passes"]
        if not raw_passes:
            raise ValueError("multi_pass must have at least one pass")

        passes = []
        for p in raw_passes:
            if "name" not in p:
                raise ValueError("Each pass must have a 'name' field")
            passes.append(PassConfig(name=p["name"], params=p.get("params", {})))

        chain = data.get("chain", {})
        return cls(passes=passes, chain=chain)


@dataclass
class MultiPassExpansion:
    """Result of expanding a multi_pass group into flat steps."""

    steps: list[dict[str, Any]]
    extra_variables: dict[str, str]
    extra_data_types: dict[str, str]
    variable_overrides: dict[str, str]
    producer_overrides: dict[str, str]  # unsuffixed var_name -> last pass step name


def _suffix_path(path: str, suffix: str) -> str:
    """Append a suffix to a file path before the extension.

    Examples:
        >>> _suffix_path("results/graph.npz", "coarse")
        'results/graph_coarse.npz'
        >>> _suffix_path("data/output/", "fine")
        'data/output_fine/'
        >>> _suffix_path("results/mesh", "medium")
        'results/mesh_medium'
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


def expand_multi_pass(
    group_name: str,
    multi_pass_data: dict[str, Any],
    template_steps: list[dict[str, Any]],
    data_section: dict[str, Any],
) -> MultiPassExpansion:
    """Expand a multi_pass group into concrete flat steps.

    Args:
        group_name: Name of the group (used as the ``group`` field on each step).
        multi_pass_data: The raw ``multi_pass:`` dict from YAML.
        template_steps: The ``steps:`` list from the group block.
        data_section: The pipeline's ``data:`` section for resolving paths/types.

    Returns:
        A ``MultiPassExpansion`` with flat steps, extra variables, data types,
        and variable overrides for the last pass.
    """
    config = MultiPassConfig.from_dict(multi_pass_data)

    # Identify internal output variables — all $var refs in outputs of template steps
    internal_outputs: set[str] = set()
    for step in template_steps:
        for out_ref in step.get("outputs", {}).values():
            if out_ref.startswith("$"):
                internal_outputs.add(out_ref[1:])

    # Parse chain mappings: resolve "step.--flag" pairs to variable names
    # chain maps source_step.source_flag -> target_step.target_flag
    # We need to find which variable the source flag produces
    chain_source_vars: dict[str, str] = {}  # "target_step.target_flag" -> source var name
    for source_spec, target_spec in config.chain.items():
        src_step_name, src_flag = source_spec.split(".", 1)
        # Find the source variable from template steps
        for step in template_steps:
            if step["name"] == src_step_name:
                for flag, ref in step.get("outputs", {}).items():
                    if flag == src_flag and ref.startswith("$"):
                        chain_source_vars[target_spec] = ref[1:]
                        break

    flat_steps: list[dict[str, Any]] = []
    extra_variables: dict[str, str] = {}
    extra_data_types: dict[str, str] = {}
    variable_overrides: dict[str, str] = {}

    for pass_idx, pass_cfg in enumerate(config.passes):
        pass_name = pass_cfg.name
        prev_pass_name = config.passes[pass_idx - 1].name if pass_idx > 0 else None

        for step in template_steps:
            step_name = step["name"]
            concrete_name = f"{step_name}_{pass_name}"

            concrete_step: dict[str, Any] = {
                "name": concrete_name,
                "task": step.get("task") or step.get("script", ""),
                "group": group_name,
            }

            # Copy optional/disabled flags
            if step.get("optional"):
                concrete_step["optional"] = True
            if step.get("disabled"):
                concrete_step["disabled"] = True

            # Process outputs: suffix internal output variables
            if step.get("outputs"):
                new_outputs: dict[str, str] = {}
                for flag, ref in step["outputs"].items():
                    if ref.startswith("$") and ref[1:] in internal_outputs:
                        var_name = ref[1:]
                        suffixed_var = f"{var_name}_{pass_name}"
                        new_outputs[flag] = f"${suffixed_var}"

                        # Register the suffixed variable
                        original_entry = data_section.get(var_name, {})
                        if isinstance(original_entry, dict):
                            original_path = original_entry.get("path", "")
                            original_type = original_entry.get("type", "")
                        else:
                            original_path = str(original_entry)
                            original_type = ""
                        extra_variables[suffixed_var] = _suffix_path(original_path, pass_name)
                        if original_type:
                            extra_data_types[suffixed_var] = original_type
                    else:
                        new_outputs[flag] = ref
                concrete_step["outputs"] = new_outputs

            # Process inputs: rewrite internal refs to suffixed versions
            if step.get("inputs"):
                new_inputs: dict[str, str] = {}
                for input_name, ref in step["inputs"].items():
                    if ref.startswith("$") and ref[1:] in internal_outputs:
                        var_name = ref[1:]
                        new_inputs[input_name] = f"${var_name}_{pass_name}"
                    else:
                        new_inputs[input_name] = ref
                concrete_step["inputs"] = new_inputs

            # Process args: inline pass params, rewrite internal refs
            if step.get("args"):
                new_args: dict[str, Any] = {}
                for arg_key, arg_value in step["args"].items():
                    if isinstance(arg_value, str) and arg_value.startswith("$"):
                        param_name = arg_value[1:]
                        if param_name in pass_cfg.params:
                            # Inline the pass-specific parameter value
                            new_args[arg_key] = pass_cfg.params[param_name]
                        elif param_name in internal_outputs:
                            # Rewrite internal variable ref
                            new_args[arg_key] = f"${param_name}_{pass_name}"
                        else:
                            # External ref — keep as-is
                            new_args[arg_key] = arg_value
                    else:
                        new_args[arg_key] = arg_value
                concrete_step["args"] = new_args

            # Apply chain connections for pass N+1
            if prev_pass_name is not None:
                for target_spec, source_var in chain_source_vars.items():
                    tgt_step, tgt_flag = target_spec.split(".", 1)
                    if tgt_step == step_name:
                        suffixed_source = f"${source_var}_{prev_pass_name}"
                        # Add to args so it appears as a --flag on the command line
                        if "args" not in concrete_step:
                            concrete_step["args"] = {}
                        concrete_step["args"][tgt_flag] = suffixed_source

            # Copy loop if present
            if step.get("loop"):
                concrete_step["loop"] = step["loop"]

            flat_steps.append(concrete_step)

    # Register last-pass aliases: unsuffixed var -> last pass's suffixed path
    # Also track which step produces each unsuffixed variable (for dependency tracking)
    producer_overrides: dict[str, str] = {}
    if config.passes:
        last_pass_name = config.passes[-1].name
        for var_name in internal_outputs:
            suffixed_var = f"{var_name}_{last_pass_name}"
            if suffixed_var in extra_variables:
                variable_overrides[var_name] = extra_variables[suffixed_var]
            # Find the step that produces this var in the last pass
            for step in template_steps:
                for flag, ref in step.get("outputs", {}).items():
                    if ref.startswith("$") and ref[1:] == var_name:
                        producer_overrides[var_name] = f"{step['name']}_{last_pass_name}"
                        break

    return MultiPassExpansion(
        steps=flat_steps,
        extra_variables=extra_variables,
        extra_data_types=extra_data_types,
        variable_overrides=variable_overrides,
        producer_overrides=producer_overrides,
    )

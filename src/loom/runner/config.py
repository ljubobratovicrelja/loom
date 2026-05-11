"""Configuration parsing for pipelines."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .multi_pass import MultiPassGroupConfig, parse_multi_pass_config
from .url import URL_CACHE_DIR_NAME, ensure_url_downloaded, is_url


@dataclass
class FlattenResult:
    """Result of flattening a pipeline with possible multi_pass groups."""

    steps: list[dict[str, Any]]
    multi_pass_configs: dict[str, MultiPassGroupConfig] = field(default_factory=dict)


@dataclass
class LoopConfig:
    """Configuration for a loop block on a pipeline step."""

    over: str  # e.g. "$raw_images" — data var referencing an image_directory or data_folder
    into: str  # e.g. "$processed_images" — data var where per-item outputs are collected
    parallel: bool | None = None  # None = use pipeline-level setting
    filter: str | None = None  # Glob pattern to filter files, e.g. "*.jpg"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "LoopConfig":
        """Create LoopConfig from YAML dict."""
        if "over" not in data:
            raise KeyError("Loop config must have 'over' field")
        if "into" not in data:
            raise KeyError("Loop config must have 'into' field")
        return cls(
            over=data["over"],
            into=data["into"],
            parallel=data.get("parallel"),
            filter=data.get("filter"),
        )


def _merge_external_inputs(
    mp_config: MultiPassGroupConfig,
) -> dict[str, str]:
    """Collect external inputs for a multi_pass group's synthetic step.

    External inputs are $var references in template step inputs/args that are
    NOT produced by a step within the group.
    """
    inputs: dict[str, str] = {}
    for step_dict in mp_config.template_step_dicts:
        for input_name, var_ref in step_dict.get("inputs", {}).items():
            if isinstance(var_ref, str) and var_ref.startswith("$"):
                var_name = var_ref[1:]
                if var_name not in mp_config.internal_outputs:
                    inputs[input_name] = var_ref
    return inputs


def _merge_unsuffixed_outputs(
    mp_config: MultiPassGroupConfig,
) -> dict[str, str]:
    """Collect unsuffixed output refs for the synthetic step."""
    outputs: dict[str, str] = {}
    for step_dict in mp_config.template_step_dicts:
        for flag, var_ref in step_dict.get("outputs", {}).items():
            if isinstance(var_ref, str) and var_ref.startswith("$"):
                var_name = var_ref[1:]
                if var_name in mp_config.internal_outputs:
                    outputs[flag] = var_ref
    return outputs


def _flatten_pipeline(
    pipeline: list[dict[str, Any]],
    data_section: dict[str, Any] | None = None,
) -> FlattenResult:
    """Flatten grouped pipeline entries into a flat list with group tag injected.

    Group blocks of the form ``{"group": name, "steps": [...]}`` are expanded
    into flat step dicts with a ``"group"`` key added to each step.
    Multi-pass groups (with ``"multi_pass"`` key) emit a single synthetic
    group step that the executor handles at runtime.
    Ungrouped steps are passed through unchanged.

    Args:
        pipeline: Raw pipeline list from YAML.
        data_section: The ``data:`` section from YAML, needed for multi_pass
            validation. May be ``None`` if no multi_pass blocks are present.

    Returns:
        A ``FlattenResult`` with flat steps and multi_pass configs.
    """
    flat: list[dict[str, Any]] = []
    multi_pass_configs: dict[str, MultiPassGroupConfig] = {}

    for entry in pipeline:
        if "group" in entry and "steps" in entry:
            if "multi_pass" in entry:
                # Multi-pass group: parse config, emit synthetic step
                mp_config = parse_multi_pass_config(
                    group_name=entry["group"],
                    multi_pass_data=entry["multi_pass"],
                    template_step_dicts=entry["steps"],
                    data_section=data_section or {},
                )
                multi_pass_configs[entry["group"]] = mp_config

                # Synthetic step: group as single unit for orchestrator
                synthetic: dict[str, Any] = {
                    "name": entry["group"],
                    "task": "__multi_pass__",
                    "group": entry["group"],
                    "inputs": _merge_external_inputs(mp_config),
                    "outputs": _merge_unsuffixed_outputs(mp_config),
                    "args": {},
                }
                flat.append(synthetic)
            else:
                # Regular group: flatten steps with group tag
                for step in entry["steps"]:
                    flat.append({**step, "group": entry["group"]})
        else:
            flat.append(entry)

    return FlattenResult(
        steps=flat,
        multi_pass_configs=multi_pass_configs,
    )


@dataclass
class StepConfig:
    """Configuration for a single pipeline step."""

    name: str
    script: str
    inputs: dict[str, str] = field(default_factory=dict)
    outputs: dict[str, str] = field(default_factory=dict)
    args: dict[str, Any] = field(default_factory=dict)
    optional: bool = False
    disabled: bool = False
    loop: LoopConfig | None = None
    group: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StepConfig":
        """Create StepConfig from YAML dict."""
        # Support both 'task' (new) and 'script' (legacy) field names
        script = data.get("task") or data.get("script")
        if not script:
            raise KeyError("Step must have 'task' or 'script' field")
        loop: LoopConfig | None = None
        if "loop" in data:
            loop = LoopConfig.from_dict(data["loop"])
        return cls(
            name=data["name"],
            script=script,
            inputs=data.get("inputs", {}),
            outputs=data.get("outputs", {}),
            args=data.get("args", {}),
            optional=data.get("optional", False),
            disabled=data.get("disabled", False),
            loop=loop,
            group=data.get("group"),
        )


@dataclass
class PipelineConfig:
    """Configuration for a full pipeline."""

    variables: dict[str, str]
    parameters: dict[str, Any]
    steps: list[StepConfig]
    base_dir: Path = field(default_factory=Path.cwd)
    data_types: dict[str, str] = field(default_factory=dict)
    parallel: bool = False
    max_workers: int | None = None
    multi_pass_groups: dict[str, MultiPassGroupConfig] = field(default_factory=dict)
    _output_producers: dict[str, str] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        """Build output producer mapping after init."""
        self._output_producers = {}
        for step in self.steps:
            for var_ref in step.outputs.values():
                var_name = var_ref.lstrip("$")
                self._output_producers[var_name] = step.name
            # Register loop.into as produced by this step
            if step.loop is not None:
                var_name = step.loop.into.lstrip("$")
                self._output_producers[var_name] = step.name

    @classmethod
    def from_yaml(cls, path: Path) -> "PipelineConfig":
        """Load pipeline configuration from YAML file.

        All relative paths in the pipeline (scripts, data nodes) are resolved
        relative to the directory containing the YAML file.
        """
        with open(path) as f:
            data = yaml.safe_load(f) or {}

        # Reject pipelines with legacy 'variables' section
        if data.get("variables"):
            raise ValueError(
                "The 'variables' section is deprecated. "
                "Use typed 'data' section instead. "
                "See examples for the new format."
            )

        data_section = data.get("data", {})
        result = _flatten_pipeline(data.get("pipeline", []), data_section)
        steps = [StepConfig.from_dict(s) for s in result.steps]

        # Load variables from 'data' section
        # Data nodes provide typed file/dir references
        variables: dict[str, str] = {}
        data_types: dict[str, str] = {}

        # Extract path and type from each data entry
        for name, entry in data_section.items():
            if isinstance(entry, dict):
                # New format: {type: ..., path: ..., ...}
                variables[name] = entry.get("path", "")
                data_types[name] = entry.get("type", "")
            else:
                # Fallback: treat as path string
                variables[name] = str(entry)
                data_types[name] = ""

        # Store the pipeline file's directory for relative path resolution
        base_dir = path.parent.resolve()

        # Parse execution settings
        execution = data.get("execution", {})
        parallel = execution.get("parallel", False)
        max_workers = execution.get("max_workers")

        config = cls(
            variables=variables,
            parameters=data.get("parameters", {}),
            steps=steps,
            base_dir=base_dir,
            data_types=data_types,
            parallel=parallel,
            max_workers=max_workers,
            multi_pass_groups=result.multi_pass_configs,
        )

        return config

    def resolve_value_with_loop(self, value: Any, loop_bindings: dict[str, str]) -> Any:
        """Resolve $variable references, checking loop bindings first.

        Args:
            value: Value to resolve. If string starting with $, checks
                   loop_bindings first, then falls back to resolve_value.
            loop_bindings: Per-iteration bindings, e.g. {"loop_item": "/path/to/file"}.

        Returns:
            Resolved value.
        """
        if not isinstance(value, str) or not value.startswith("$"):
            return value
        ref_name = value[1:]
        if ref_name in loop_bindings:
            return loop_bindings[ref_name]
        return self.resolve_value(value)

    def resolve_value(self, value: Any) -> Any:
        """Resolve $variable and $parameter references.

        Args:
            value: Value to resolve. If string starting with $, looks up
                   in variables first, then parameters. Otherwise returns as-is.

        Returns:
            Resolved value.
        """
        if not isinstance(value, str) or not value.startswith("$"):
            return value

        ref_name = value[1:]  # Strip leading $

        # Try variables first, then parameters
        if ref_name in self.variables:
            return self.variables[ref_name]
        if ref_name in self.parameters:
            return self.parameters[ref_name]

        raise ValueError(f"Unknown reference: {value}")

    def resolve_path(self, value: Any) -> Path:
        """Resolve a value to an absolute path.

        First resolves any $variable/$parameter references, then makes the
        resulting path absolute relative to the pipeline's base directory.

        Args:
            value: Value to resolve (string with optional $ reference).

        Returns:
            Absolute Path object.
        """
        resolved = self.resolve_value(value)
        path = Path(str(resolved))

        # Make relative paths absolute relative to pipeline directory
        if not path.is_absolute():
            path = self.base_dir / path

        return path

    def resolve_script_path(self, script: str) -> Path:
        """Resolve a task script path to an absolute path.

        Args:
            script: Script path (e.g., 'tasks/process.py').

        Returns:
            Absolute Path object.
        """
        path = Path(script)
        if not path.is_absolute():
            path = self.base_dir / path
        return path

    def get_step_by_name(self, name: str) -> StepConfig:
        """Get a step by its name."""
        for step in self.steps:
            if step.name == name:
                return step
        raise ValueError(f"Unknown step: {name}")

    def get_steps_by_group(self, group_name: str) -> list[StepConfig]:
        """Get all steps belonging to a named group, in pipeline order.

        Args:
            group_name: Name of the group to filter by.

        Returns:
            List of steps in the group, in pipeline order.

        Raises:
            ValueError: If no steps found for the given group name.
        """
        steps = [s for s in self.steps if s.group == group_name]
        if not steps:
            raise ValueError(f"Unknown group: {group_name}")
        return steps

    def get_group_names(self) -> list[str]:
        """Get unique group names in pipeline order of first appearance.

        Returns:
            List of group names, preserving order of first appearance.
            Empty list if no steps have groups.
        """
        seen: set[str] = set()
        names: list[str] = []
        for step in self.steps:
            if step.group and step.group not in seen:
                seen.add(step.group)
                names.append(step.group)
        return names

    def get_step_dependencies(self, step: StepConfig) -> set[str]:
        """Return names of steps that produce this step's inputs.

        Args:
            step: The step to find dependencies for.

        Returns:
            Set of step names that must complete before this step.
        """
        dependencies = set()

        # Check each input to see if it's produced by another step
        for var_ref in step.inputs.values():
            var_name = var_ref.lstrip("$")
            if var_name in self._output_producers:
                dependencies.add(self._output_producers[var_name])

        # Check args for $var references (e.g. multi_pass chain connections)
        for arg_value in step.args.values():
            if isinstance(arg_value, str) and arg_value.startswith("$"):
                var_name = arg_value[1:]
                if var_name in self._output_producers:
                    dependencies.add(self._output_producers[var_name])

        # If this is a loop step, also depend on the step that produces loop.over
        if step.loop is not None:
            var_name = step.loop.over.lstrip("$")
            if var_name in self._output_producers:
                dependencies.add(self._output_producers[var_name])

        return dependencies

    def is_source_data(self, name: str) -> bool:
        """Check if a data node is source (not produced by any step).

        Source data is input data that was not generated by any pipeline step.
        This is useful for protecting original input files from deletion.

        Args:
            name: The data node name.

        Returns:
            True if the data is source (not produced by any step), False otherwise.
        """
        return name not in self._output_producers

    def override_variables(self, overrides: dict[str, str]) -> None:
        """Override variable values."""
        self.variables.update(overrides)

    def override_parameters(self, overrides: dict[str, Any]) -> None:
        """Override parameter values."""
        self.parameters.update(overrides)

    def get_url_cache_dir(self) -> Path:
        """Get the URL cache directory for this pipeline.

        Returns:
            Path to the URL cache directory.
        """
        return self.base_dir / URL_CACHE_DIR_NAME

    def is_url_path(self, value: Any) -> bool:
        """Check if a value resolves to a URL.

        Args:
            value: Value to check (string with optional $ reference).

        Returns:
            True if the resolved value is an HTTP/HTTPS URL.
        """
        resolved = self.resolve_value(value)
        return isinstance(resolved, str) and is_url(resolved)

    def get_raw_path(self, value: Any) -> str:
        """Get the raw path value without downloading URLs.

        This is useful for checking if a path is a URL or getting the
        original path before any transformations.

        Args:
            value: Value to resolve (string with optional $ reference).

        Returns:
            The raw path string (may be a URL or local path).
        """
        resolved = self.resolve_value(value)
        return str(resolved)

    def resolve_path_for_execution(self, value: Any) -> Path:
        """Resolve a value to a local path, downloading URLs if needed.

        This method should be used during pipeline execution when actual
        local file access is required. For URLs, it downloads the resource
        to the cache directory first.

        Args:
            value: Value to resolve (string with optional $ reference).

        Returns:
            Absolute Path object pointing to a local file.

        Raises:
            RuntimeError: If URL download fails.
        """
        resolved = self.resolve_value(value)
        path_str = str(resolved)

        # If it's a URL, download and return cache path
        if is_url(path_str):
            cache_dir = self.get_url_cache_dir()
            return ensure_url_downloaded(path_str, cache_dir)

        # Otherwise, resolve as normal path
        path = Path(path_str)
        if not path.is_absolute():
            path = self.base_dir / path

        return path

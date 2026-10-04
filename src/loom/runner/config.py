"""Configuration parsing for pipelines."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .env import expand_env
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


def _validate_nested_parents(data_parents: dict[str, str]) -> None:
    """Ensure ``nested_in`` chains are acyclic."""
    for start in data_parents:
        seen = {start}
        current = data_parents.get(start)
        while current is not None:
            if current in seen:
                raise ValueError(
                    f"Cyclic 'nested_in' relationship detected involving data node '{start}'"
                )
            seen.add(current)
            current = data_parents.get(current)


#: Recognised pipeline entry kinds.  "task" is the default (a subprocess step).
KIND_TASK = "task"
KIND_CONDITION = "condition"
KIND_SWITCH = "switch"


@dataclass
class StepConfig:
    """Configuration for a single pipeline node.

    Most nodes are ``task`` steps (a subprocess).  The logic-board kinds are:

    - ``condition``: evaluates a predicate/script in-process to a boolean.
    - ``switch``: routes a data payload by a boolean condition.
    """

    name: str
    script: str = ""
    inputs: dict[str, str] = field(default_factory=dict)
    outputs: dict[str, str] = field(default_factory=dict)
    args: dict[str, Any] = field(default_factory=dict)
    optional: bool = False
    disabled: bool = False
    loop: LoopConfig | None = None
    group: str | None = None
    # Logic-board nodes
    kind: str = KIND_TASK
    predicate: str | None = None  # condition: built-in predicate id
    negate: bool = False  # condition: invert the result
    condition: str | None = None  # switch: boolean ref ($name or $param)
    data: str | None = None  # switch: payload ref ($data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StepConfig":
        """Create StepConfig from a YAML dict."""
        name = data["name"]
        kind = data.get("kind", KIND_TASK)

        if kind == KIND_CONDITION:
            predicate = data.get("predicate")
            script = data.get("script")
            if not predicate and not script:
                raise ValueError(
                    f"condition node '{name}' must have a 'predicate' or 'script' field"
                )
            return cls(
                name=name,
                script=script or "",
                inputs=data.get("inputs", {}),
                args=data.get("args", {}),
                group=data.get("group"),
                optional=data.get("optional", False),
                disabled=data.get("disabled", False),
                kind=KIND_CONDITION,
                predicate=predicate,
                negate=data.get("negate", False),
            )

        if kind == KIND_SWITCH:
            condition = data.get("condition")
            if not condition:
                raise ValueError(f"switch node '{name}' must have a 'condition' field")
            return cls(
                name=name,
                inputs=data.get("inputs", {}),
                outputs=data.get("outputs", {}),
                args=data.get("args", {}),
                group=data.get("group"),
                optional=data.get("optional", False),
                disabled=data.get("disabled", False),
                kind=KIND_SWITCH,
                condition=condition,
                data=data.get("data"),
            )

        if kind != KIND_TASK:
            raise ValueError(f"Unknown pipeline node kind: {kind!r} (node '{name}')")

        # Support both 'task' (new) and 'script' (legacy) field names
        script = data.get("task") or data.get("script")
        if not script:
            raise KeyError("Step must have 'task' or 'script' field")
        loop: LoopConfig | None = None
        if "loop" in data:
            loop = LoopConfig.from_dict(data["loop"])
        return cls(
            name=name,
            script=script,
            inputs=data.get("inputs", {}),
            outputs=data.get("outputs", {}),
            args=data.get("args", {}),
            optional=data.get("optional", False),
            disabled=data.get("disabled", False),
            loop=loop,
            group=data.get("group"),
        )

    @property
    def is_task(self) -> bool:
        """True for subprocess task steps."""
        return self.kind == KIND_TASK


@dataclass
class PipelineConfig:
    """Configuration for a full pipeline."""

    variables: dict[str, str]
    parameters: dict[str, Any]
    steps: list[StepConfig]
    base_dir: Path = field(default_factory=Path.cwd)
    data_types: dict[str, str] = field(default_factory=dict)
    #: child data node name -> container data node name (from ``nested_in``).
    data_parents: dict[str, str] = field(default_factory=dict, repr=False)
    output_dir: str = "output"
    parallel: bool = False
    max_workers: int | None = None
    multi_pass_groups: dict[str, MultiPassGroupConfig] = field(default_factory=dict)
    external_data: set[str] = field(default_factory=set, repr=False)
    _output_producers: dict[str, str] = field(default_factory=dict, repr=False)
    _condition_names: set[str] = field(default_factory=set, repr=False)
    _switch_names: set[str] = field(default_factory=set, repr=False)
    # Runtime state populated during execution (per run).
    condition_results: dict[str, bool] = field(default_factory=dict, repr=False)
    active_branches: dict[str, str] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        """Build output producer and logic-node name mappings after init."""
        self._output_producers = {}
        self._condition_names = set()
        self._switch_names = set()
        for step in self.steps:
            if step.kind == KIND_CONDITION:
                self._condition_names.add(step.name)
                continue
            if step.kind == KIND_SWITCH:
                self._switch_names.add(step.name)
                continue
            for var_ref in step.outputs.values():
                var_name = var_ref.lstrip("$")
                self._output_producers[var_name] = step.name
            # Register loop.into as produced by this step
            if step.loop is not None:
                var_name = step.loop.into.lstrip("$")
                self._output_producers[var_name] = step.name

        # Propagate producers through `nested_in` containment chains: a file
        # nested in a produced directory is itself produced by that directory's
        # producing step, so downstream ordering, cleaning and containment all
        # apply to it too.
        if self.data_parents:
            changed = True
            while changed:
                changed = False
                for child, parent in self.data_parents.items():
                    if child in self._output_producers:
                        continue
                    producer = self._output_producers.get(parent)
                    if producer is not None:
                        self._output_producers[child] = producer
                        changed = True

    def ref_producer(self, ref: Any) -> str | None:
        """Return the node name that produces a ``$ref``, if any.

        Handles plain data refs, condition output refs (a condition node's name)
        and switch branch aliases (``$sw.then`` / ``$sw.else``).
        """
        if not (isinstance(ref, str) and ref.startswith("$")):
            return None
        name = ref[1:]
        if "." in name:
            switch_name = name.split(".", 1)[0]
            if switch_name in self._switch_names:
                return switch_name
        if name in self._condition_names:
            return name
        return self._output_producers.get(name)

    @staticmethod
    def parse_branch_ref(ref: Any) -> tuple[str, str] | None:
        """Parse ``$<switch>.<then|else>`` into (switch_name, branch).

        Returns None for any ref that is not a branch alias or has an unknown
        branch label.
        """
        if not (isinstance(ref, str) and ref.startswith("$")):
            return None
        name = ref[1:]
        if "." not in name:
            return None
        switch_name, branch = name.split(".", 1)
        if branch not in ("then", "else"):
            return None
        return switch_name, branch

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
        external_data: set[str] = set()
        data_parents: dict[str, str] = {}

        # Extract path and type from each data entry
        for name, entry in data_section.items():
            if isinstance(entry, dict):
                # New format: {type: ..., path: ..., ...}
                variables[name] = entry.get("path", "")
                data_types[name] = entry.get("type", "")
                if entry.get("allow_outside_pipeline"):
                    external_data.add(name)
                nested = entry.get("nested_in")
                if nested:
                    if not isinstance(nested, str):
                        raise ValueError(
                            f"Data node '{name}' has invalid 'nested_in' (expected a "
                            f"$data reference)"
                        )
                    parent_name = nested.lstrip("$")
                    if parent_name == name:
                        raise ValueError(f"Data node '{name}' cannot be nested in itself")
                    if parent_name not in data_section:
                        raise ValueError(
                            f"Data node '{name}' declares nested_in: '{nested}', but "
                            f"'{parent_name}' is not a data node"
                        )
                    data_parents[name] = parent_name
            else:
                # Fallback: treat as path string
                variables[name] = str(entry)
                data_types[name] = ""

        _validate_nested_parents(data_parents)

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
            data_parents=data_parents,
            output_dir=data.get("output_dir", "output"),
            parallel=parallel,
            max_workers=max_workers,
            multi_pass_groups=result.multi_pass_configs,
            external_data=external_data,
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
        if not isinstance(value, str):
            return value
        # Bare $name loop binding takes precedence over data/parameters.
        if value.startswith("$") and not value.startswith("${"):
            ref_name = value[1:]
            if ref_name in loop_bindings:
                return loop_bindings[ref_name]
        # Otherwise defer to resolve_value (also expands embedded ${ENV}).
        return self.resolve_value(value)

    def resolve_value(self, value: Any) -> Any:
        """Resolve $variable, $parameter, and ${ENV_VAR} references.

        Bare ``$name`` is an exact-match data/parameter reference. The brace
        form ``${ENV_VAR}`` is substituted from the process environment and may
        be embedded anywhere in a string (multiple per string). A stored
        data-node path or string parameter may itself contain ``${ENV_VAR}``,
        which is expanded after the reference is resolved (composition).

        Args:
            value: Value to resolve. Non-strings are returned untouched.

        Returns:
            Resolved value.

        Raises:
            ValueError: If a bare $name reference is unknown.
            EnvVarError: If a referenced environment variable is not set.
        """
        if not isinstance(value, str):
            return value

        # Bare $name (not ${...}): exact-match data/parameter reference.
        if value.startswith("$") and not value.startswith("${"):
            ref_name = value[1:]

            # Switch branch alias: $<switch>.then / $<switch>.else -> payload.
            if "." in ref_name:
                switch_name = ref_name.split(".", 1)[0]
                if switch_name in self._switch_names:
                    switch = self.get_step_by_name(switch_name)
                    if not switch.data:
                        raise ValueError(f"Switch '{switch_name}' has no 'data' payload to alias")
                    return self.resolve_value(switch.data)

            if ref_name in self.variables:
                if ref_name in self.data_parents:
                    return self._resolve_nested_path(ref_name)
                return expand_env(self.variables[ref_name], where=f"data node '{ref_name}'")
            if ref_name in self.parameters:
                param = self.parameters[ref_name]
                if isinstance(param, str):
                    return expand_env(param, where=f"parameter '{ref_name}'")
                return param
            raise ValueError(f"Unknown reference: {value}")

        # Plain literal or embedded/pure ${ENV_VAR}: expand env, else pass through.
        return expand_env(value)

    def _resolve_nested_path(self, name: str) -> str:
        """Resolve a data node nested in a container to its full path.

        The stored path of a ``nested_in`` node is interpreted relative to its
        container's resolved path (absolute paths are used as-is). Containers
        may themselves be nested, so this recurses.
        """
        parent = self.data_parents[name]
        parent_path = Path(str(self.resolve_value(f"${parent}")))
        child_path = Path(expand_env(self.variables[name], where=f"data node '{name}'"))
        if child_path.is_absolute():
            return str(child_path)
        return str(parent_path / child_path)

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
        script = expand_env(script, where="task script")
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

        if step.kind == KIND_CONDITION:
            refs: list[str] = list(step.inputs.values())
            refs += [v for v in step.args.values() if isinstance(v, str)]
        elif step.kind == KIND_SWITCH:
            refs = [r for r in (step.condition, step.data) if r is not None]
        else:
            refs = list(step.inputs.values())
            refs += [v for v in step.args.values() if isinstance(v, str)]
            if step.loop is not None:
                refs.append(step.loop.over)

        for ref in refs:
            producer = self.ref_producer(ref)
            if producer:
                dependencies.add(producer)

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

    @property
    def output_root(self) -> Path:
        """Absolute path to the pipeline's owned output tree.

        Produced data (anything written by a step) is expected to live under
        this directory so that ``--clean`` can safely purge it without touching
        user-owned input data.
        """
        root = Path(self.output_dir)
        if not root.is_absolute():
            root = self.base_dir / root
        return root.resolve()

    def is_external_data(self, name: str) -> bool:
        """Check if a data node opted out of output containment."""
        return name in self.external_data

    def containment_issues(self) -> list[tuple[str, str]]:
        """Report output-containment violations for produced data nodes.

        Produced data is expected to live under ``output_dir`` (default
        ``output/``). Data nodes may opt out with ``allow_outside_pipeline:
        true``.

        Returns:
            A list of ``(level, message)`` tuples. ``level`` is ``"error"``
            when a produced path resolves outside the pipeline directory
            (where ``--clean`` could endanger unrelated files) and
            ``"warning"`` when it is inside the pipeline but outside the owned
            output tree.
        """
        issues: list[tuple[str, str]] = []
        base = self.base_dir.resolve()
        root = self.output_root

        for name in self.variables:
            if self.is_source_data(name) or self.is_external_data(name):
                continue
            try:
                resolved = self.resolve_path(f"${name}").resolve()
            except (ValueError, OSError):
                continue

            if not resolved.is_relative_to(base):
                issues.append(
                    (
                        "error",
                        f"Output data node '{name}' resolves outside the pipeline "
                        f"directory ({resolved}). Move it under '{self.output_dir}/' "
                        "or set 'allow_outside_pipeline: true'.",
                    )
                )
            elif not resolved.is_relative_to(root):
                issues.append(
                    (
                        "warning",
                        f"Output data node '{name}' is outside the "
                        f"'{self.output_dir}/' tree ({resolved}). Store generated "
                        f"data under '{self.output_dir}/' so cleaning is safe.",
                    )
                )

        # A nested node must actually resolve inside its declared container.
        for child, parent in self.data_parents.items():
            try:
                child_path = self.resolve_path(f"${child}").resolve()
                parent_path = self.resolve_path(f"${parent}").resolve()
            except (ValueError, OSError):
                continue
            if not child_path.is_relative_to(parent_path):
                issues.append(
                    (
                        "error",
                        f"Data node '{child}' declares nested_in: '${parent}' but its "
                        f"resolved path ({child_path}) is not inside it ({parent_path}).",
                    )
                )

        # Safety net: a source node that physically lives inside a produced
        # directory is part of that directory's DAG but is not declared as such.
        # Surface it so the dependency can be made explicit with `nested_in`.
        produced_dirs: list[tuple[str, Path]] = []
        for name in self.variables:
            if self.is_source_data(name) or self.is_external_data(name):
                continue
            if self.data_types.get(name) not in ("data_folder", "image_directory"):
                continue
            try:
                produced_dirs.append((name, self.resolve_path(f"${name}").resolve()))
            except (ValueError, OSError):
                continue

        if produced_dirs:
            for name in self.variables:
                if name in self.data_parents or not self.is_source_data(name):
                    continue
                try:
                    resolved = self.resolve_path(f"${name}").resolve()
                except (ValueError, OSError):
                    continue
                for dir_name, dir_path in produced_dirs:
                    if resolved.is_relative_to(dir_path):
                        issues.append(
                            (
                                "warning",
                                f"Data node '{name}' is inside the directory produced "
                                f"by '${dir_name}' but does not declare "
                                f"'nested_in: ${dir_name}'. Add it so the dependency "
                                f"is tracked and the file is drawn with the directory.",
                            )
                        )
                        break

        return issues

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

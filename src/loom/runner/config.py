"""Configuration parsing for pipelines."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class StepConfig:
    """Configuration for a single pipeline step."""

    name: str
    script: str
    inputs: dict[str, str] = field(default_factory=dict)
    outputs: dict[str, str] = field(default_factory=dict)
    args: dict[str, Any] = field(default_factory=dict)
    optional: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StepConfig":
        """Create StepConfig from YAML dict."""
        # Support both 'task' (new) and 'script' (legacy) field names
        script = data.get("task") or data.get("script")
        if not script:
            raise KeyError("Step must have 'task' or 'script' field")
        return cls(
            name=data["name"],
            script=script,
            inputs=data.get("inputs", {}),
            outputs=data.get("outputs", {}),
            args=data.get("args", {}),
            optional=data.get("optional", False),
        )


@dataclass
class PipelineConfig:
    """Configuration for a full pipeline."""

    variables: dict[str, str]
    parameters: dict[str, Any]
    steps: list[StepConfig]
    _output_producers: dict[str, str] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        """Build output producer mapping after init."""
        self._output_producers = {}
        for step in self.steps:
            for var_ref in step.outputs.values():
                var_name = var_ref.lstrip("$")
                self._output_producers[var_name] = step.name

    @classmethod
    def from_yaml(cls, path: Path) -> "PipelineConfig":
        """Load pipeline configuration from YAML file."""
        with open(path) as f:
            data = yaml.safe_load(f) or {}

        steps = [StepConfig.from_dict(s) for s in data.get("pipeline", [])]

        # Load variables from both 'variables' section and 'data' section
        # Data nodes provide typed file/dir references, but for execution
        # we just need the path values to resolve $references
        variables = dict(data.get("variables", {}))

        # Merge data section: extract path from each data entry
        for name, entry in data.get("data", {}).items():
            if isinstance(entry, dict):
                # New format: {type: ..., path: ..., ...}
                variables[name] = entry.get("path", "")
            else:
                # Fallback: treat as path string
                variables[name] = str(entry)

        return cls(
            variables=variables,
            parameters=data.get("parameters", {}),
            steps=steps,
        )

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

    def get_step_by_name(self, name: str) -> StepConfig:
        """Get a step by its name."""
        for step in self.steps:
            if step.name == name:
                return step
        raise ValueError(f"Unknown step: {name}")

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

        return dependencies

    def override_variables(self, overrides: dict[str, str]) -> None:
        """Override variable values."""
        self.variables.update(overrides)

    def override_parameters(self, overrides: dict[str, Any]) -> None:
        """Override parameter values."""
        self.parameters.update(overrides)

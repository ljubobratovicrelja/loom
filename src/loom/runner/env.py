"""Environment-variable substitution for pipeline values.

Supports ``${ENV_VAR}`` brace-form references embedded anywhere in a string.
Bare ``$name`` is left untouched (it is a data/parameter reference handled by
:mod:`loom.runner.config`).
"""

import os
import re

_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class EnvVarError(ValueError):
    """Raised when a referenced environment variable is not set."""


def expand_env(value: str, *, where: str | None = None) -> str:
    """Expand ``${ENV_VAR}`` references against the process environment.

    Args:
        value: String possibly containing one or more ``${NAME}`` references.
        where: Optional context for error messages, e.g. ``"data node 'x'"``.

    Returns:
        The string with all ``${NAME}`` references replaced by their values.

    Raises:
        EnvVarError: If a referenced environment variable is not set.
    """

    def _sub(m: "re.Match[str]") -> str:
        name = m.group(1)
        if name not in os.environ:
            ctx = f" (referenced in {where})" if where else ""
            raise EnvVarError(f"environment variable '{name}' is not set{ctx}")
        return os.environ[name]

    return _ENV_PATTERN.sub(_sub, value)

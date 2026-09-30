"""In-process condition predicates for the loom logic board.

A *condition* node turns data (or a parameter) into a boolean.  Conditions are
evaluated in-process (no subprocess) once per run, after their inputs exist.

Built-in predicates are simple, data-agnostic functions of the form
``pred(data, **args) -> bool``.  Custom conditions are Python scripts authored
like tasks; they expose an ``evaluate(**inputs, **args) -> bool`` function and
declare ``kind: condition`` in their frontmatter.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Callable
from pathlib import Path
from typing import Any

# Comparison operators shared by numeric predicates.
_COMPARATORS: dict[str, Callable[[float, float], bool]] = {
    "==": lambda a, b: a == b,
    "=": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
}


def _as_path(value: Any) -> Path:
    return Path(str(value))


def pred_exists(data: Any, **_: Any) -> bool:
    """True if the data path exists (file or directory)."""
    return _as_path(data).exists()


def pred_is_file(data: Any, **_: Any) -> bool:
    """True if the data path is an existing regular file."""
    return _as_path(data).is_file()


def pred_is_dir(data: Any, **_: Any) -> bool:
    """True if the data path is an existing directory."""
    return _as_path(data).is_dir()


def pred_non_empty(data: Any, **_: Any) -> bool:
    """True if a file has non-zero size or a directory has at least one entry."""
    path = _as_path(data)
    if path.is_dir():
        try:
            return next(path.iterdir(), None) is not None
        except OSError:
            return False
    return path.is_file() and path.stat().st_size > 0


def pred_count(data: Any, pattern: str = "*", op: str = ">=", n: int = 1, **_: Any) -> bool:
    """Compare the number of files matching ``pattern`` under ``data``.

    A file path counts as a single item (pattern is ignored for files).
    """
    path = _as_path(data)
    if not path.exists():
        return False
    if path.is_file():
        matches = [path]
    else:
        try:
            matches = list(path.glob(pattern))
        except OSError:
            return False

    comparator = _COMPARATORS.get(str(op))
    if comparator is None:
        raise ValueError(f"Unknown count operator: {op!r}")
    return comparator(float(len(matches)), float(n))


def pred_param(data: Any, **_: Any) -> bool:
    """Interpret a parameter/data value as a boolean.

    Accepts real booleans, numbers, and the strings ``true/false/yes/no/1/0``.
    """
    if isinstance(data, bool):
        return data
    if isinstance(data, (int, float)):
        return data != 0
    if isinstance(data, str):
        return data.strip().lower() not in ("", "0", "false", "no", "off", "none", "null")
    return bool(data)


#: Built-in condition predicate registry.  Key = predicate id used in YAML.
BUILTIN_CONDITIONS: dict[str, Callable[..., bool]] = {
    "exists": pred_exists,
    "is_file": pred_is_file,
    "is_dir": pred_is_dir,
    "non_empty": pred_non_empty,
    "count": pred_count,
    "param": pred_param,
}


def load_condition_script(script_path: Path) -> Callable[..., bool]:
    """Load the ``evaluate`` callable from a custom condition script.

    Args:
        script_path: Absolute path to the condition script.

    Returns:
        The module's ``evaluate`` callable.

    Raises:
        FileNotFoundError: If the script does not exist.
        AttributeError: If the script has no ``evaluate`` function.
    """
    if not script_path.exists():
        raise FileNotFoundError(f"Condition script not found: {script_path}")
    spec = importlib.util.spec_from_file_location(f"loom_condition_{script_path.stem}", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "evaluate"):
        raise AttributeError(f"Condition script {script_path} has no evaluate() function")
    return module.evaluate  # type: ignore[no-any-return]


def evaluate_condition(
    *,
    predicate: str | None = None,
    script_path: Path | None = None,
    inputs: dict[str, Any] | None = None,
    args: dict[str, Any] | None = None,
    negate: bool = False,
) -> bool:
    """Evaluate a condition to a boolean.

    Args:
        predicate: Built-in predicate id (mutually exclusive with ``script_path``).
        script_path: Path to a custom condition script exposing ``evaluate``.
        inputs: Resolved input values (paths for data refs, raw values for params).
        args: Extra keyword arguments passed to the predicate.
        negate: If True, invert the result.

    Returns:
        The boolean result (possibly negated).

    Raises:
        ValueError: If neither or both of predicate/script_path are given, or the
            predicate id is unknown.
    """
    inputs = inputs or {}
    args = dict(args or {})

    if bool(predicate) == bool(script_path):
        raise ValueError("Exactly one of 'predicate' or 'script_path' is required")

    if predicate is not None:
        fn = BUILTIN_CONDITIONS.get(predicate)
        if fn is None:
            known = ", ".join(sorted(BUILTIN_CONDITIONS))
            raise ValueError(f"Unknown condition predicate: {predicate!r} (known: {known})")
    else:
        assert script_path is not None
        fn = load_condition_script(script_path)

    result = bool(fn(**inputs, **args))
    return not result if negate else result

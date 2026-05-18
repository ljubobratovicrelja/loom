"""Tests for environment-variable substitution (loom.runner.env)."""

import pytest

from loom.runner.env import EnvVarError, expand_env


def test_single_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    """A single ${VAR} is replaced by its value."""
    monkeypatch.setenv("DATA_ROOT", "/srv/data")
    assert expand_env("${DATA_ROOT}/raw.csv") == "/srv/data/raw.csv"


def test_embedded_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    """A ${VAR} embedded mid-string is replaced in place."""
    monkeypatch.setenv("RUN_ID", "r1")
    assert expand_env("out/${RUN_ID}.json") == "out/r1.json"


def test_multiple_references(monkeypatch: pytest.MonkeyPatch) -> None:
    """Multiple references in one string are all replaced."""
    monkeypatch.setenv("SCRATCH", "/tmp")
    monkeypatch.setenv("RUN_ID", "r1")
    assert expand_env("${SCRATCH}/out/${RUN_ID}/x") == "/tmp/out/r1/x"


def test_bare_dollar_name_untouched(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bare $name (no braces) is left untouched."""
    monkeypatch.setenv("FOO", "bar")
    assert expand_env("$FOO/path") == "$FOO/path"


def test_invalid_name_passed_through() -> None:
    """A name that violates POSIX rules is not treated as a reference."""
    assert expand_env("${1BAD}") == "${1BAD}"
    assert expand_env("${with-dash}") == "${with-dash}"


def test_no_reference_passes_through() -> None:
    """A plain literal with no ${...} is returned unchanged."""
    assert expand_env("data/file.csv") == "data/file.csv"


def test_unset_raises_with_message(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unset variable raises EnvVarError with the variable named."""
    monkeypatch.delenv("MISSING_VAR", raising=False)
    with pytest.raises(EnvVarError, match="environment variable 'MISSING_VAR' is not set"):
        expand_env("${MISSING_VAR}/x")


def test_unset_raises_with_where_suffix(monkeypatch: pytest.MonkeyPatch) -> None:
    """The where context is appended to the error message."""
    monkeypatch.delenv("MISSING_VAR", raising=False)
    with pytest.raises(
        EnvVarError,
        match=r"environment variable 'MISSING_VAR' is not set "
        r"\(referenced in data node 'x'\)",
    ):
        expand_env("${MISSING_VAR}", where="data node 'x'")


def test_env_var_error_is_value_error() -> None:
    """EnvVarError subclasses ValueError for graceful UI degradation."""
    assert issubclass(EnvVarError, ValueError)

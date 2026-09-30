"""Tests for loom.runner.conditions (logic-board predicates)."""

from pathlib import Path

import pytest

from loom.runner.conditions import (
    BUILTIN_CONDITIONS,
    evaluate_condition,
    load_condition_script,
)


class TestBuiltinPredicates:
    def test_exists(self, tmp_path: Path) -> None:
        f = tmp_path / "a.txt"
        assert evaluate_condition(predicate="exists", inputs={"data": str(f)}) is False
        f.write_text("hi")
        assert evaluate_condition(predicate="exists", inputs={"data": str(f)}) is True

    def test_is_file(self, tmp_path: Path) -> None:
        d = tmp_path / "folder"
        d.mkdir()
        assert evaluate_condition(predicate="is_file", inputs={"data": str(d)}) is False
        f = tmp_path / "a.txt"
        f.write_text("hi")
        assert evaluate_condition(predicate="is_file", inputs={"data": str(f)}) is True

    def test_is_dir(self, tmp_path: Path) -> None:
        d = tmp_path / "folder"
        d.mkdir()
        assert evaluate_condition(predicate="is_dir", inputs={"data": str(d)}) is True

    def test_non_empty_file(self, tmp_path: Path) -> None:
        f = tmp_path / "a.txt"
        f.write_text("")
        assert evaluate_condition(predicate="non_empty", inputs={"data": str(f)}) is False
        f.write_text("x")
        assert evaluate_condition(predicate="non_empty", inputs={"data": str(f)}) is True

    def test_non_empty_dir(self, tmp_path: Path) -> None:
        d = tmp_path / "folder"
        d.mkdir()
        assert evaluate_condition(predicate="non_empty", inputs={"data": str(d)}) is False
        (d / "x.txt").write_text("x")
        assert evaluate_condition(predicate="non_empty", inputs={"data": str(d)}) is True

    def test_count(self, tmp_path: Path) -> None:
        d = tmp_path / "folder"
        d.mkdir()
        for i in range(3):
            (d / f"f{i}.jpg").write_text("x")
        (d / "ignore.txt").write_text("x")

        assert (
            evaluate_condition(
                predicate="count",
                inputs={"data": str(d)},
                args={"pattern": "*.jpg", "op": ">=", "n": 3},
            )
            is True
        )
        assert (
            evaluate_condition(
                predicate="count",
                inputs={"data": str(d)},
                args={"pattern": "*.jpg", "op": ">", "n": 3},
            )
            is False
        )
        assert (
            evaluate_condition(
                predicate="count",
                inputs={"data": str(d)},
                args={"pattern": "*.png", "op": "==", "n": 0},
            )
            is True
        )

    def test_count_unknown_operator(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError):
            evaluate_condition(
                predicate="count",
                inputs={"data": str(tmp_path)},
                args={"op": "~", "n": 1},
            )

    def test_param(self) -> None:
        assert evaluate_condition(predicate="param", inputs={"data": True}) is True
        assert evaluate_condition(predicate="param", inputs={"data": False}) is False
        assert evaluate_condition(predicate="param", inputs={"data": "false"}) is False
        assert evaluate_condition(predicate="param", inputs={"data": "yes"}) is True
        assert evaluate_condition(predicate="param", inputs={"data": 0}) is False
        assert evaluate_condition(predicate="param", inputs={"data": 2}) is True

    def test_negate(self, tmp_path: Path) -> None:
        f = tmp_path / "a.txt"
        f.write_text("x")
        assert (
            evaluate_condition(predicate="is_file", inputs={"data": str(f)}, negate=True) is False
        )
        assert evaluate_condition(predicate="is_dir", inputs={"data": str(f)}, negate=True) is True


class TestCustomConditionScript:
    def test_load_and_evaluate(self, tmp_path: Path) -> None:
        script = tmp_path / "my_condition.py"
        script.write_text(
            "def evaluate(data, threshold=0.5):\n"
            "    import json\n"
            "    return json.load(open(data))['score'] >= threshold\n"
        )
        data = tmp_path / "metrics.json"
        data.write_text('{"score": 0.9}')

        result = evaluate_condition(
            script_path=script,
            inputs={"data": str(data)},
            args={"threshold": 0.5},
        )
        assert result is True

        result = evaluate_condition(
            script_path=script,
            inputs={"data": str(data)},
            args={"threshold": 0.95},
        )
        assert result is False

    def test_missing_script(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            load_condition_script(tmp_path / "nope.py")

    def test_script_without_evaluate(self, tmp_path: Path) -> None:
        script = tmp_path / "bad.py"
        script.write_text("x = 1\n")
        with pytest.raises(AttributeError):
            load_condition_script(script)


class TestEvaluateConditionValidation:
    def test_requires_exactly_one_source(self) -> None:
        with pytest.raises(ValueError):
            evaluate_condition()
        with pytest.raises(ValueError):
            evaluate_condition(predicate="exists", script_path=Path("/tmp/x.py"))

    def test_unknown_predicate(self) -> None:
        with pytest.raises(ValueError, match="Unknown condition predicate"):
            evaluate_condition(predicate="nope", inputs={"data": "x"})

    def test_registry_has_expected_kinds(self) -> None:
        assert set(BUILTIN_CONDITIONS) == {
            "exists",
            "is_file",
            "is_dir",
            "non_empty",
            "count",
            "param",
        }

"""Tests for logic-board nodes: condition/switch parsing, dependencies and gating."""

from pathlib import Path

import pytest

from loom.runner.config import KIND_CONDITION, KIND_SWITCH, PipelineConfig, StepConfig
from loom.runner.executor import PipelineExecutor
from loom.runner.orchestrator import EventType, PipelineOrchestrator, StepResult

PIPELINE_YAML = """
data:
  in_file:
    type: txt
    path: in.txt
  made:
    type: txt
    path: made.txt
  then_out:
    type: txt
    path: then.txt
  else_out:
    type: txt
    path: else.txt

pipeline:
  - name: make
    task: tasks/make.py
    outputs:
      -o: $made

  - name: is_txt
    kind: condition
    predicate: is_file
    inputs:
      data: $in_file

  - name: gate
    kind: switch
    condition: $is_txt
    data: $in_file

  - name: then_step
    task: tasks/step.py
    inputs:
      x: $gate.then
    outputs:
      -o: $then_out

  - name: else_step
    task: tasks/step.py
    inputs:
      x: $gate.else
    outputs:
      -o: $else_out

  - name: after_else
    task: tasks/step.py
    inputs:
      x: $else_out
    outputs:
      -o: $made
"""


def _write_pipeline(tmp_path: Path) -> PipelineConfig:
    (tmp_path / "tasks").mkdir()
    (tmp_path / "tasks" / "make.py").write_text("")
    (tmp_path / "tasks" / "step.py").write_text("")
    (tmp_path / "pipeline.yml").write_text(PIPELINE_YAML)
    return PipelineConfig.from_yaml(tmp_path / "pipeline.yml")


def _run_gated(config: PipelineConfig) -> dict[str, bool]:
    """Drive the sequential orchestrator, faking task execution as success."""
    executor = PipelineExecutor(config, dry_run=True)
    orch = PipelineOrchestrator(config)
    gen = orch.orchestrate()

    event = next(gen)
    while event.type != EventType.PIPELINE_COMPLETE:
        if event.type == EventType.STEP_READY:
            step = event.step
            assert step is not None and event.step_name is not None
            if step.kind == KIND_CONDITION:
                ok = executor.run_condition(step)
            elif step.kind == KIND_SWITCH:
                ok = executor.run_switch(step)
            else:
                ok = True
            event = gen.send(StepResult(event.step_name, ok))
        else:
            event = next(gen)
    return orch.results


class TestParsing:
    def test_kinds_parsed(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path)
        by_name = {s.name: s for s in config.steps}
        assert by_name["is_txt"].kind == KIND_CONDITION
        assert by_name["is_txt"].predicate == "is_file"
        assert by_name["gate"].kind == KIND_SWITCH
        assert by_name["gate"].condition == "$is_txt"
        assert by_name["gate"].data == "$in_file"
        assert by_name["make"].kind == "task"

    def test_dependencies(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path)
        assert config.get_step_dependencies(config.get_step_by_name("is_txt")) == set()
        assert config.get_step_dependencies(config.get_step_by_name("gate")) == {"is_txt"}
        assert config.get_step_dependencies(config.get_step_by_name("then_step")) == {"gate"}
        assert config.get_step_dependencies(config.get_step_by_name("else_step")) == {"gate"}
        # after_else depends on the producer of $else_out (else_step)
        assert config.get_step_dependencies(config.get_step_by_name("after_else")) == {"else_step"}

    def test_resolve_branch_alias(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path)
        assert config.resolve_value("$gate.then") == config.resolve_value("$in_file")
        assert config.resolve_path("$gate.then") == tmp_path / "in.txt"
        assert config.resolve_path("$gate.else") == tmp_path / "in.txt"

    def test_parse_branch_ref(self) -> None:
        assert PipelineConfig.parse_branch_ref("$gate.then") == ("gate", "then")
        assert PipelineConfig.parse_branch_ref("$gate.else") == ("gate", "else")
        assert PipelineConfig.parse_branch_ref("$gate.nope") is None
        assert PipelineConfig.parse_branch_ref("$data") is None


class TestGating:
    def test_then_branch_taken(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path)
        (tmp_path / "in.txt").write_text("hello")

        results = _run_gated(config)

        assert config.condition_results["is_txt"] is True
        assert config.active_branches["gate"] == "then"
        assert results["then_step"] is True
        assert results["else_step"] is False
        assert results["after_else"] is False  # transitive skip

    def test_else_branch_taken(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path)
        # in.txt missing -> condition false
        results = _run_gated(config)

        assert config.condition_results["is_txt"] is False
        assert config.active_branches["gate"] == "else"
        assert results["then_step"] is False
        assert results["else_step"] is True
        assert results["after_else"] is True

    def test_negate(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path)
        (tmp_path / "in.txt").write_text("hello")
        # Flip the condition to "not is_file"
        cond = config.get_step_by_name("is_txt")
        cond.negate = True

        results = _run_gated(config)
        assert config.condition_results["is_txt"] is False
        assert results["else_step"] is True
        assert results["then_step"] is False


class TestValidatorErrors:
    def test_condition_without_predicate_or_script(self) -> None:
        with pytest.raises(ValueError, match="predicate.*script|script.*predicate"):
            StepConfig.from_dict({"name": "c", "kind": "condition"})

    def test_switch_without_condition(self) -> None:
        with pytest.raises(ValueError, match="condition"):
            StepConfig.from_dict({"name": "s", "kind": "switch"})

    def test_unknown_kind(self) -> None:
        with pytest.raises(ValueError, match="Unknown pipeline node kind"):
            StepConfig.from_dict({"name": "x", "kind": "loop"})


class TestUnevaluableCondition:
    """An unconnected condition must yield no branch (unknown), not false."""

    def test_unconnected_input_is_unevaluable(self) -> None:
        config = PipelineConfig(
            variables={},
            parameters={},
            steps=[
                StepConfig(
                    name="c",
                    kind=KIND_CONDITION,
                    predicate="exists",
                    inputs={"data": ""},
                ),
                StepConfig(name="s", kind=KIND_SWITCH, condition="$c"),
            ],
        )
        executor = PipelineExecutor(config, dry_run=True)

        assert executor.run_condition(config.get_step_by_name("c")) is False
        assert "c" not in config.condition_results

        # Switch cannot decide -> no active branch recorded.
        assert executor.run_switch(config.get_step_by_name("s")) is False
        assert "s" not in config.active_branches

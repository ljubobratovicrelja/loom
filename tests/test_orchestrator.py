"""Tests for loom.runner.orchestrator module."""

import pytest

from loom.runner.config import PipelineConfig, StepConfig
from loom.runner.orchestrator import (
    EventType,
    PipelineOrchestrator,
    StepResult,
)


class TestOrchestratorBuildDependencyGraph:
    """Tests for PipelineOrchestrator.build_dependency_graph method."""

    @pytest.fixture
    def config_diamond(self) -> PipelineConfig:
        """Create a config with diamond dependency pattern (A -> B,C -> D)."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv", "c": "c.csv", "d": "d.csv"},
            parameters={},
            steps=[
                StepConfig(name="step_a", script="a.py", outputs={"-o": "$a"}),
                StepConfig(name="step_b", script="b.py", inputs={"x": "$a"}, outputs={"-o": "$b"}),
                StepConfig(name="step_c", script="c.py", inputs={"x": "$a"}, outputs={"-o": "$c"}),
                StepConfig(
                    name="step_d",
                    script="d.py",
                    inputs={"x": "$b", "y": "$c"},
                    outputs={"-o": "$d"},
                ),
            ],
        )

    def test_build_dependency_graph_diamond(self, config_diamond: PipelineConfig) -> None:
        """Test building dependency graph for diamond pattern."""
        orch = PipelineOrchestrator(config_diamond)
        deps, dependents = orch.build_dependency_graph(config_diamond.steps)

        # Check dependencies
        assert deps["step_a"] == set()
        assert deps["step_b"] == {"step_a"}
        assert deps["step_c"] == {"step_a"}
        assert deps["step_d"] == {"step_b", "step_c"}

        # Check dependents (reverse mapping)
        assert dependents["step_a"] == {"step_b", "step_c"}
        assert dependents["step_b"] == {"step_d"}
        assert dependents["step_c"] == {"step_d"}
        assert dependents["step_d"] == set()

    def test_build_dependency_graph_subset(self, config_diamond: PipelineConfig) -> None:
        """Test building dependency graph for a subset of steps."""
        orch = PipelineOrchestrator(config_diamond)
        # Only include step_b and step_d (step_a and step_c are not in the list)
        steps = [
            config_diamond.get_step_by_name("step_b"),
            config_diamond.get_step_by_name("step_d"),
        ]
        deps, _ = orch.build_dependency_graph(steps)

        # step_a is not in the run list, so step_b has no deps
        assert deps["step_b"] == set()
        # step_c is not in the run list, so step_d only depends on step_b
        assert deps["step_d"] == {"step_b"}


class TestOrchestratorSequentialExecution:
    """Tests for sequential orchestration."""

    @pytest.fixture
    def config_linear(self) -> PipelineConfig:
        """Create a config with linear dependency (A -> B -> C)."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv", "c": "c.csv"},
            parameters={},
            steps=[
                StepConfig(name="step_a", script="a.py", outputs={"-o": "$a"}),
                StepConfig(name="step_b", script="b.py", inputs={"x": "$a"}, outputs={"-o": "$b"}),
                StepConfig(name="step_c", script="c.py", inputs={"x": "$b"}, outputs={"-o": "$c"}),
            ],
        )

    def test_orchestrate_sequential_yields_in_order(self, config_linear: PipelineConfig) -> None:
        """Test that sequential orchestration yields steps in order."""
        orch = PipelineOrchestrator(config_linear, parallel=False)
        gen = orch.orchestrate()

        # Step A
        event = next(gen)
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_a"
        event = gen.send(StepResult("step_a", True))

        # Step B
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_b"
        event = gen.send(StepResult("step_b", True))

        # Step C
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_c"
        event = gen.send(StepResult("step_c", True))

        # Complete
        assert event.type == EventType.PIPELINE_COMPLETE

    def test_orchestrate_sequential_skips_on_failure(self, config_linear: PipelineConfig) -> None:
        """Test that sequential orchestration skips steps after failure."""
        orch = PipelineOrchestrator(config_linear, parallel=False)
        gen = orch.orchestrate()

        # Step A succeeds
        event = next(gen)
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_a"
        event = gen.send(StepResult("step_a", True))

        # Step B fails
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_b"
        event = gen.send(StepResult("step_b", False))

        # Step C is skipped
        assert event.type == EventType.STEP_SKIPPED
        assert event.step_name == "step_c"
        assert event.failed_deps is not None
        assert "step_b" in event.failed_deps

        # Complete
        event = next(gen)
        assert event.type == EventType.PIPELINE_COMPLETE

        # Check results
        assert orch.results == {"step_a": True, "step_b": False, "step_c": False}


class TestOrchestratorParallelExecution:
    """Tests for parallel orchestration."""

    @pytest.fixture
    def config_diamond(self) -> PipelineConfig:
        """Create a config with diamond pattern (A -> B,C -> D)."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv", "c": "c.csv", "d": "d.csv"},
            parameters={},
            steps=[
                StepConfig(name="step_a", script="a.py", outputs={"-o": "$a"}),
                StepConfig(name="step_b", script="b.py", inputs={"x": "$a"}, outputs={"-o": "$b"}),
                StepConfig(name="step_c", script="c.py", inputs={"x": "$a"}, outputs={"-o": "$c"}),
                StepConfig(
                    name="step_d",
                    script="d.py",
                    inputs={"x": "$b", "y": "$c"},
                    outputs={"-o": "$d"},
                ),
            ],
        )

    @pytest.fixture
    def config_independent(self) -> PipelineConfig:
        """Create a config with independent steps (no dependencies)."""
        return PipelineConfig(
            variables={"a": "a.csv", "b": "b.csv", "c": "c.csv"},
            parameters={},
            steps=[
                StepConfig(name="step_a", script="a.py", outputs={"-o": "$a"}),
                StepConfig(name="step_b", script="b.py", outputs={"-o": "$b"}),
                StepConfig(name="step_c", script="c.py", outputs={"-o": "$c"}),
            ],
        )

    def test_orchestrate_parallel_independent_steps(
        self, config_independent: PipelineConfig
    ) -> None:
        """Test that parallel orchestration yields all independent steps together."""
        orch = PipelineOrchestrator(config_independent, parallel=True, max_workers=4)
        gen = orch.orchestrate()

        # All three steps should be ready immediately
        ready_steps: list[str] = []
        event = next(gen)
        while event.type == EventType.STEP_READY:
            assert event.step_name is not None
            ready_steps.append(event.step_name)
            event = next(gen)

        assert set(ready_steps) == {"step_a", "step_b", "step_c"}

        # Should be WAITING for results
        assert event.type == EventType.WAITING

        # Send results
        for step_name in ready_steps:
            event = gen.send(StepResult(step_name, True))

        # Complete
        assert event.type == EventType.PIPELINE_COMPLETE

    def test_orchestrate_parallel_respects_dependencies(
        self, config_diamond: PipelineConfig
    ) -> None:
        """Test that parallel orchestration respects dependencies."""
        orch = PipelineOrchestrator(config_diamond, parallel=True, max_workers=4)
        gen = orch.orchestrate()

        # Only step_a should be ready initially
        event = next(gen)
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_a"

        # Next should be WAITING
        event = next(gen)
        assert event.type == EventType.WAITING

        # Complete step_a
        event = gen.send(StepResult("step_a", True))

        # Now step_b and step_c should be ready
        ready_steps = []
        while event.type == EventType.STEP_READY:
            ready_steps.append(event.step_name)
            event = next(gen)

        assert set(ready_steps) == {"step_b", "step_c"}
        assert event.type == EventType.WAITING

        # Complete step_b
        event = gen.send(StepResult("step_b", True))
        # step_d is not ready yet (needs step_c)
        assert event.type == EventType.WAITING

        # Complete step_c
        event = gen.send(StepResult("step_c", True))

        # Now step_d should be ready
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_d"

        # Next should be WAITING
        event = next(gen)
        assert event.type == EventType.WAITING

        # Complete step_d
        event = gen.send(StepResult("step_d", True))

        # Complete
        assert event.type == EventType.PIPELINE_COMPLETE

    def test_orchestrate_parallel_skips_on_failure(self, config_diamond: PipelineConfig) -> None:
        """Test that parallel orchestration skips dependent steps on failure."""
        orch = PipelineOrchestrator(config_diamond, parallel=True, max_workers=4)
        gen = orch.orchestrate()

        # step_a ready
        event = next(gen)
        assert event.type == EventType.STEP_READY
        assert event.step_name == "step_a"

        # WAITING
        event = next(gen)
        assert event.type == EventType.WAITING

        # step_a fails
        event = gen.send(StepResult("step_a", False))

        # step_b, step_c, step_d should all be skipped
        skipped_steps = []
        while event.type == EventType.STEP_SKIPPED:
            skipped_steps.append(event.step_name)
            event = next(gen)

        assert set(skipped_steps) == {"step_b", "step_c", "step_d"}
        assert event.type == EventType.PIPELINE_COMPLETE

        # Check results
        results = orch.results
        assert results["step_a"] is False
        assert results["step_b"] is False
        assert results["step_c"] is False
        assert results["step_d"] is False

    def test_orchestrate_parallel_max_workers(self, config_independent: PipelineConfig) -> None:
        """Test that parallel orchestration respects max_workers limit."""
        orch = PipelineOrchestrator(config_independent, parallel=True, max_workers=2)
        gen = orch.orchestrate()

        # Only 2 steps should be ready initially (limited by max_workers)
        ready_steps = []
        event = next(gen)
        while event.type == EventType.STEP_READY:
            ready_steps.append(event.step_name)
            event = next(gen)

        assert len(ready_steps) == 2


class TestOrchestratorGetStepsToRun:
    """Tests for PipelineOrchestrator.get_steps_to_run method."""

    @pytest.fixture
    def config(self) -> PipelineConfig:
        """Create a config with multiple steps."""
        return PipelineConfig(
            variables={},
            parameters={},
            steps=[
                StepConfig(name="step1", script="s1.py"),
                StepConfig(name="step2", script="s2.py"),
                StepConfig(name="step3", script="s3.py", optional=True),
                StepConfig(name="step4", script="s4.py"),
                StepConfig(name="step5", script="s5.py", optional=True),
            ],
        )

    def test_get_all_non_optional_steps(self, config: PipelineConfig) -> None:
        """Test getting all non-optional steps by default."""
        orch = PipelineOrchestrator(config)
        steps = orch.get_steps_to_run()

        names = [s.name for s in steps]
        assert names == ["step1", "step2", "step4"]

    def test_get_specific_steps(self, config: PipelineConfig) -> None:
        """Test getting specific steps by name."""
        orch = PipelineOrchestrator(config)
        steps = orch.get_steps_to_run(steps=["step2", "step4"])

        names = [s.name for s in steps]
        assert names == ["step2", "step4"]

    def test_get_steps_from_step(self, config: PipelineConfig) -> None:
        """Test getting steps from a specific step onward."""
        orch = PipelineOrchestrator(config)
        steps = orch.get_steps_to_run(from_step="step2")

        names = [s.name for s in steps]
        assert names == ["step2", "step4"]

    def test_get_steps_include_optional(self, config: PipelineConfig) -> None:
        """Test including optional steps."""
        orch = PipelineOrchestrator(config)
        steps = orch.get_steps_to_run(include_optional=["step3", "step5"])

        names = [s.name for s in steps]
        assert names == ["step1", "step2", "step3", "step4", "step5"]


class TestOrchestratorEmptyPipeline:
    """Tests for edge cases with empty pipelines."""

    def test_orchestrate_empty_pipeline(self) -> None:
        """Test orchestrating an empty pipeline."""
        config = PipelineConfig(
            variables={},
            parameters={},
            steps=[],
        )
        orch = PipelineOrchestrator(config)
        gen = orch.orchestrate()

        event = next(gen)
        assert event.type == EventType.PIPELINE_COMPLETE

    def test_orchestrate_no_matching_steps(self) -> None:
        """Test orchestrating when no steps match the filter."""
        config = PipelineConfig(
            variables={},
            parameters={},
            steps=[
                StepConfig(name="step1", script="s1.py", optional=True),
                StepConfig(name="step2", script="s2.py", optional=True),
            ],
        )
        orch = PipelineOrchestrator(config)
        gen = orch.orchestrate()  # No optional steps included

        event = next(gen)
        assert event.type == EventType.PIPELINE_COMPLETE


class TestOrchestratorResults:
    """Tests for orchestrator results tracking."""

    def test_results_property_returns_copy(self) -> None:
        """Test that results property returns a copy, not the internal dict."""
        config = PipelineConfig(
            variables={"a": "a.csv"},
            parameters={},
            steps=[
                StepConfig(name="step_a", script="a.py", outputs={"-o": "$a"}),
            ],
        )
        orch = PipelineOrchestrator(config)
        gen = orch.orchestrate()

        next(gen)
        gen.send(StepResult("step_a", True))

        results1 = orch.results
        results2 = orch.results

        # Should be equal but not the same object
        assert results1 == results2
        assert results1 is not results2

        # Modifying returned dict should not affect internal state
        results1["step_a"] = False
        assert orch.results["step_a"] is True

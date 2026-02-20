"""Tests for parameter node references (clones) in graph conversion."""

from loom.ui.server import (
    EditorOptions,
    ExecutionOptions,
    GraphEdge,
    GraphNode,
    PipelineGraph,
    _update_yaml_from_graph,
    graph_to_yaml,
    yaml_to_graph,
)


def _make_graph(
    nodes: list[GraphNode],
    edges: list[GraphEdge],
    parameters: dict | None = None,
) -> PipelineGraph:
    """Helper to build a PipelineGraph with sensible defaults."""
    return PipelineGraph(
        variables={},
        parameters=parameters or {},
        data={},
        nodes=nodes,
        edges=edges,
        editor=EditorOptions(autoSave=False),
        execution=ExecutionOptions(parallel=False, maxWorkers=None),
        hasLayout=True,
    )


class TestParamNameResolution:
    """Bug fix: clone param edges should resolve to the canonical param name."""

    def test_clone_edge_resolves_to_correct_param_name(self) -> None:
        """graph_to_yaml should produce $threshold, not $threshold_ref_1."""
        nodes = [
            GraphNode(
                id="param_threshold",
                type="parameter",
                position={"x": 0, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="param_threshold_ref_1",
                type="parameter",
                position={"x": 200, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="step1",
                type="step",
                position={"x": 400, "y": 0},
                data={
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
        ]
        edges = [
            GraphEdge(
                id="e_clone_step1",
                source="param_threshold_ref_1",
                target="step1",
                sourceHandle="value",
                targetHandle="--threshold",
            ),
        ]
        graph = _make_graph(nodes, edges, parameters={"threshold": 50.0})
        result = graph_to_yaml(graph)

        # The step's arg should reference $threshold, NOT $threshold_ref_1
        step = result["pipeline"][0]
        assert step["args"]["--threshold"] == "$threshold"

    def test_primary_node_edge_still_works(self) -> None:
        """Edges from the primary param node should still resolve correctly."""
        nodes = [
            GraphNode(
                id="param_threshold",
                type="parameter",
                position={"x": 0, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="step1",
                type="step",
                position={"x": 400, "y": 0},
                data={
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
        ]
        edges = [
            GraphEdge(
                id="e_param_threshold_step1",
                source="param_threshold",
                target="step1",
                sourceHandle="value",
                targetHandle="--threshold",
            ),
        ]
        graph = _make_graph(nodes, edges, parameters={"threshold": 50.0})
        result = graph_to_yaml(graph)

        step = result["pipeline"][0]
        assert step["args"]["--threshold"] == "$threshold"


class TestParamRefsPersistence:
    """Tests for saving and loading parameter reference (clone) nodes."""

    def test_graph_to_yaml_writes_parameter_refs(self) -> None:
        """Clone nodes should be persisted in editor.parameterRefs."""
        nodes = [
            GraphNode(
                id="param_threshold",
                type="parameter",
                position={"x": 0, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="param_threshold_ref_1",
                type="parameter",
                position={"x": 200, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="step1",
                type="step",
                position={"x": 400, "y": 0},
                data={
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
            GraphNode(
                id="step2",
                type="step",
                position={"x": 400, "y": 200},
                data={
                    "name": "step2",
                    "task": "tasks/step2.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
        ]
        edges = [
            GraphEdge(
                id="e_param_threshold_step1",
                source="param_threshold",
                target="step1",
                sourceHandle="value",
                targetHandle="--threshold",
            ),
            GraphEdge(
                id="e_clone_step2",
                source="param_threshold_ref_1",
                target="step2",
                sourceHandle="value",
                targetHandle="--cutoff",
            ),
        ]
        graph = _make_graph(nodes, edges, parameters={"threshold": 50.0})
        result = graph_to_yaml(graph)

        assert "editor" in result
        refs = result["editor"]["parameterRefs"]
        assert "param_threshold_ref_1" in refs
        assert refs["param_threshold_ref_1"]["parameter"] == "threshold"
        assert "step2:--cutoff" in refs["param_threshold_ref_1"]["edges"]

    def test_graph_to_yaml_no_refs_when_no_clones(self) -> None:
        """No parameterRefs should be written when there are no clones."""
        nodes = [
            GraphNode(
                id="param_threshold",
                type="parameter",
                position={"x": 0, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="step1",
                type="step",
                position={"x": 400, "y": 0},
                data={
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
        ]
        edges = [
            GraphEdge(
                id="e_param_threshold_step1",
                source="param_threshold",
                target="step1",
                sourceHandle="value",
                targetHandle="--threshold",
            ),
        ]
        graph = _make_graph(nodes, edges, parameters={"threshold": 50.0})
        result = graph_to_yaml(graph)

        # editor should not exist or not contain parameterRefs
        if "editor" in result:
            assert "parameterRefs" not in result["editor"]

    def test_roundtrip_preserves_clones(self) -> None:
        """YAML with parameterRefs -> yaml_to_graph -> graph_to_yaml roundtrip."""
        yaml_data = {
            "parameters": {"threshold": 50.0},
            "pipeline": [
                {
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "args": {"--threshold": "$threshold"},
                },
                {
                    "name": "step2",
                    "task": "tasks/step2.py",
                    "args": {"--cutoff": "$threshold"},
                },
            ],
            "layout": {
                "step1": {"x": 400, "y": 0},
                "step2": {"x": 400, "y": 200},
                "param_threshold": {"x": 0, "y": 0},
                "param_threshold_ref_1": {"x": 200, "y": 0},
            },
            "editor": {
                "parameterRefs": {
                    "param_threshold_ref_1": {
                        "parameter": "threshold",
                        "edges": ["step2:--cutoff"],
                    }
                }
            },
        }

        # Load
        graph = yaml_to_graph(yaml_data)

        # Verify 2 parameter nodes
        param_nodes = [n for n in graph.nodes if n.type == "parameter"]
        assert len(param_nodes) == 2
        param_ids = {n.id for n in param_nodes}
        assert "param_threshold" in param_ids
        assert "param_threshold_ref_1" in param_ids

        # Verify both have the same name and value
        for n in param_nodes:
            assert n.data["name"] == "threshold"
            assert n.data["value"] == 50.0

        # Verify edges route correctly
        step2_edges = [e for e in graph.edges if e.target == "step2"]
        assert len(step2_edges) == 1
        assert step2_edges[0].source == "param_threshold_ref_1"

        step1_edges = [
            e for e in graph.edges if e.target == "step1" and e.targetHandle == "--threshold"
        ]
        assert len(step1_edges) == 1
        assert step1_edges[0].source == "param_threshold"

        # Save back and verify parameterRefs preserved
        result = graph_to_yaml(graph)
        refs = result["editor"]["parameterRefs"]
        assert "param_threshold_ref_1" in refs
        assert refs["param_threshold_ref_1"]["parameter"] == "threshold"
        assert "step2:--cutoff" in refs["param_threshold_ref_1"]["edges"]


class TestBackwardsCompatibility:
    """Old YAML without parameterRefs should work unchanged."""

    def test_yaml_without_param_refs_creates_single_nodes(self) -> None:
        """YAML without parameterRefs -> yaml_to_graph creates one node per param."""
        yaml_data = {
            "parameters": {"threshold": 50.0, "width": 1920},
            "pipeline": [
                {
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "args": {"--threshold": "$threshold", "--width": "$width"},
                },
            ],
        }

        graph = yaml_to_graph(yaml_data)

        param_nodes = [n for n in graph.nodes if n.type == "parameter"]
        assert len(param_nodes) == 2

        param_names = {n.data["name"] for n in param_nodes}
        assert param_names == {"threshold", "width"}

        # Each param should have the canonical ID
        param_ids = {n.id for n in param_nodes}
        assert param_ids == {"param_threshold", "param_width"}

    def test_yaml_without_param_refs_roundtrip_no_editor_section(self) -> None:
        """No editor section added when there are no clones or autoSave."""
        yaml_data = {
            "parameters": {"threshold": 50.0},
            "pipeline": [
                {
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "args": {"--threshold": "$threshold"},
                },
            ],
        }

        graph = yaml_to_graph(yaml_data)
        result = graph_to_yaml(graph)

        # No editor section should appear
        assert "editor" not in result


class TestUpdateYamlFromGraphParamRefs:
    """Tests for update_yaml_from_graph with parameter clones."""

    def test_update_yaml_writes_param_refs(self) -> None:
        """update_yaml_from_graph should write parameterRefs for clones."""
        yaml_data: dict = {
            "parameters": {"threshold": 50.0},
            "pipeline": [
                {
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "args": {"--threshold": "$threshold"},
                },
                {
                    "name": "step2",
                    "task": "tasks/step2.py",
                    "args": {"--cutoff": "$threshold"},
                },
            ],
        }

        nodes = [
            GraphNode(
                id="param_threshold",
                type="parameter",
                position={"x": 0, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="param_threshold_ref_1",
                type="parameter",
                position={"x": 200, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="step1",
                type="step",
                position={"x": 400, "y": 0},
                data={
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
            GraphNode(
                id="step2",
                type="step",
                position={"x": 400, "y": 200},
                data={
                    "name": "step2",
                    "task": "tasks/step2.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
        ]
        edges = [
            GraphEdge(
                id="e_param_threshold_step1",
                source="param_threshold",
                target="step1",
                sourceHandle="value",
                targetHandle="--threshold",
            ),
            GraphEdge(
                id="e_clone_step2",
                source="param_threshold_ref_1",
                target="step2",
                sourceHandle="value",
                targetHandle="--cutoff",
            ),
        ]
        graph = _make_graph(nodes, edges, parameters={"threshold": 50.0})

        _update_yaml_from_graph(yaml_data, graph)

        assert "editor" in yaml_data
        refs = yaml_data["editor"]["parameterRefs"]
        assert "param_threshold_ref_1" in refs
        assert refs["param_threshold_ref_1"]["parameter"] == "threshold"

        # Args should reference $threshold (not $threshold_ref_1)
        assert yaml_data["pipeline"][1]["args"]["--cutoff"] == "$threshold"

    def test_update_yaml_removes_param_refs_when_clone_deleted(self) -> None:
        """Deleting all clones should remove parameterRefs from editor."""
        yaml_data: dict = {
            "parameters": {"threshold": 50.0},
            "pipeline": [
                {
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "args": {"--threshold": "$threshold"},
                },
            ],
            "editor": {
                "parameterRefs": {
                    "param_threshold_ref_1": {
                        "parameter": "threshold",
                        "edges": [],
                    }
                }
            },
        }

        # Graph has no clones (clone was deleted)
        nodes = [
            GraphNode(
                id="param_threshold",
                type="parameter",
                position={"x": 0, "y": 0},
                data={"name": "threshold", "value": 50.0},
            ),
            GraphNode(
                id="step1",
                type="step",
                position={"x": 400, "y": 0},
                data={
                    "name": "step1",
                    "task": "tasks/step1.py",
                    "inputs": {},
                    "outputs": {},
                    "args": {},
                },
            ),
        ]
        edges = [
            GraphEdge(
                id="e_param_threshold_step1",
                source="param_threshold",
                target="step1",
                sourceHandle="value",
                targetHandle="--threshold",
            ),
        ]
        graph = _make_graph(nodes, edges, parameters={"threshold": 50.0})

        _update_yaml_from_graph(yaml_data, graph)

        # parameterRefs should be removed, and editor section cleaned up
        if "editor" in yaml_data:
            assert "parameterRefs" not in yaml_data["editor"]

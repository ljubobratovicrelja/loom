"""Tests for graph <-> YAML conversion of condition/switch nodes."""

from typing import Any

from loom.ui.server.graph import graph_to_yaml, update_yaml_from_graph, yaml_to_graph

YAML_DATA: dict[str, Any] = {
    "data": {
        "in_file": {"type": "txt", "path": "in.txt"},
        "made": {"type": "txt", "path": "made.txt"},
        "then_out": {"type": "txt", "path": "then.txt"},
        "else_out": {"type": "txt", "path": "else.txt"},
    },
    "parameters": {"enabled": True},
    "pipeline": [
        {"name": "make", "task": "tasks/make.py", "outputs": {"-o": "$made"}},
        {
            "name": "is_txt",
            "kind": "condition",
            "predicate": "is_file",
            "inputs": {"data": "$in_file"},
        },
        {"name": "gate", "kind": "switch", "condition": "$is_txt", "data": "$in_file"},
        {
            "name": "then_step",
            "task": "tasks/step.py",
            "inputs": {"x": "$gate.then"},
            "outputs": {"-o": "$then_out"},
        },
        {
            "name": "else_step",
            "task": "tasks/step.py",
            "inputs": {"x": "$gate.else"},
            "outputs": {"-o": "$else_out"},
        },
    ],
}


class TestYamlToGraph:
    def test_node_types(self) -> None:
        graph = yaml_to_graph(YAML_DATA)
        by_id = {n.id: n for n in graph.nodes}
        assert by_id["is_txt"].type == "condition"
        assert by_id["is_txt"].data["predicate"] == "is_file"
        assert by_id["gate"].type == "switch"
        assert by_id["gate"].data["condition"] == "$is_txt"
        assert by_id["gate"].data["data"] == "$in_file"
        assert by_id["then_step"].type == "step"

    def test_logic_edges(self) -> None:
        graph = yaml_to_graph(YAML_DATA)
        edge_set = {(e.source, e.sourceHandle, e.target, e.targetHandle) for e in graph.edges}

        # data -> condition
        assert ("data_in_file", "value", "is_txt", "data") in edge_set
        # condition -> switch
        assert ("is_txt", "result", "gate", "condition") in edge_set
        # data -> switch payload
        assert ("data_in_file", "value", "gate", "data") in edge_set
        # switch branches -> gated steps
        assert ("gate", "then", "then_step", "x") in edge_set
        assert ("gate", "else", "else_step", "x") in edge_set


class TestRoundTrip:
    def test_graph_to_yaml_preserves_logic(self) -> None:
        graph = yaml_to_graph(YAML_DATA)
        result = graph_to_yaml(graph)
        by_name = {s["name"]: s for s in result["pipeline"]}

        assert by_name["is_txt"]["kind"] == "condition"
        assert by_name["is_txt"]["predicate"] == "is_file"
        assert by_name["is_txt"]["inputs"] == {"data": "$in_file"}
        assert by_name["gate"]["kind"] == "switch"
        assert by_name["gate"]["condition"] == "$is_txt"
        assert by_name["gate"]["data"] == "$in_file"
        assert by_name["then_step"]["inputs"] == {"x": "$gate.then"}
        assert by_name["else_step"]["inputs"] == {"x": "$gate.else"}

    def test_update_yaml_in_place(self) -> None:
        data: dict[str, Any] = {
            "data": dict(YAML_DATA["data"]),
            "parameters": dict(YAML_DATA["parameters"]),
            "pipeline": [
                {
                    "name": "is_txt",
                    "kind": "condition",
                    "predicate": "exists",
                    "inputs": {"data": "$in_file"},
                },
                {"name": "gate", "kind": "switch", "condition": "$is_txt", "data": "$in_file"},
            ],
        }
        graph = yaml_to_graph(data)
        # Mutate the condition predicate in the graph
        for node in graph.nodes:
            if node.id == "is_txt":
                node.data["predicate"] = "non_empty"

        update_yaml_from_graph(data, graph)

        by_name = {s["name"]: s for s in data["pipeline"]}
        assert by_name["is_txt"]["predicate"] == "non_empty"
        assert by_name["is_txt"]["kind"] == "condition"
        assert "task" not in by_name["is_txt"]
        assert by_name["gate"]["kind"] == "switch"

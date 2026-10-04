"""Tests for nested data nodes (``nested_in`` containment)."""

from pathlib import Path

import pytest
import yaml

from loom.runner.config import PipelineConfig
from loom.ui.server.graph import graph_to_yaml, yaml_to_graph

NESTED_YAML = """\
output_dir: output

data:
  processed_dir:
    type: data_folder
    path: output/processed
  config_file:
    type: json
    path: config.json
    nested_in: $processed_dir
  report:
    type: json
    path: output/report.json

pipeline:
  - name: produce
    task: tasks/produce.py
    outputs:
      -o: $processed_dir
  - name: consume
    task: tasks/consume.py
    inputs:
      cfg: $config_file
    outputs:
      -o: $report
"""


@pytest.fixture
def nested_config(tmp_path: Path) -> PipelineConfig:
    """Load a pipeline with a file nested inside a produced directory."""
    path = tmp_path / "pipeline.yml"
    path.write_text(NESTED_YAML)
    return PipelineConfig.from_yaml(path)


class TestNestedConfig:
    """Runner-side semantics of ``nested_in``."""

    def test_parses_data_parents(self, nested_config: PipelineConfig) -> None:
        assert nested_config.data_parents == {"config_file": "processed_dir"}

    def test_resolves_relative_path(self, nested_config: PipelineConfig) -> None:
        assert nested_config.resolve_path("$config_file") == (
            nested_config.base_dir / "output/processed/config.json"
        )

    def test_inherits_producer(self, nested_config: PipelineConfig) -> None:
        assert nested_config.ref_producer("$config_file") == "produce"
        assert nested_config.is_source_data("config_file") is False

    def test_consumer_depends_on_producer(self, nested_config: PipelineConfig) -> None:
        consume = nested_config.get_step_by_name("consume")
        assert nested_config.get_step_dependencies(consume) == {"produce"}

    def test_containment_has_no_issues(self, nested_config: PipelineConfig) -> None:
        assert nested_config.containment_issues() == []

    def test_unknown_parent_raises(self, tmp_path: Path) -> None:
        path = tmp_path / "p.yml"
        path.write_text("data:\n  f:\n    type: json\n    path: f.json\n    nested_in: $missing\n")
        with pytest.raises(ValueError, match="not a data node"):
            PipelineConfig.from_yaml(path)

    def test_cycle_raises(self, tmp_path: Path) -> None:
        path = tmp_path / "p.yml"
        path.write_text(
            "data:\n"
            "  a:\n    type: data_folder\n    path: a\n    nested_in: $b\n"
            "  b:\n    type: data_folder\n    path: b\n    nested_in: $a\n"
        )
        with pytest.raises(ValueError, match="Cyclic"):
            PipelineConfig.from_yaml(path)

    def test_outside_container_is_error(self, tmp_path: Path) -> None:
        path = tmp_path / "p.yml"
        path.write_text(
            "data:\n"
            "  dir:\n    type: data_folder\n    path: output/dir\n"
            "  f:\n    type: json\n    path: /tmp/outside.json\n    nested_in: $dir\n"
        )
        config = PipelineConfig.from_yaml(path)
        issues = config.containment_issues()
        assert any(level == "error" and "nested_in" in message for level, message in issues)

    def test_undeclared_nested_file_warns(self, tmp_path: Path) -> None:
        path = tmp_path / "p.yml"
        path.write_text(
            "output_dir: output\n"
            "data:\n"
            "  dir:\n    type: data_folder\n    path: output/dir\n"
            "  f:\n    type: json\n    path: output/dir/f.json\n"
            "pipeline:\n"
            "  - name: produce\n    task: t.py\n    outputs:\n      -o: $dir\n"
        )
        config = PipelineConfig.from_yaml(path)
        issues = config.containment_issues()
        assert any(level == "warning" and "'f'" in message for level, message in issues)


class TestNestedGraph:
    """Editor graph conversion for ``nested_in``."""

    def test_containment_edge_and_roundtrip(self) -> None:
        graph = yaml_to_graph(yaml.safe_load(NESTED_YAML))

        containment = [edge for edge in graph.edges if edge.type == "containment"]
        assert len(containment) == 1
        assert containment[0].source == "data_processed_dir"
        assert containment[0].target == "data_config_file"

        node = next(n for n in graph.nodes if n.id == "data_config_file")
        assert node.data["nested_in"] == "$processed_dir"

        out = graph_to_yaml(graph)
        assert out["data"]["config_file"]["nested_in"] == "$processed_dir"
        assert out["data"]["config_file"]["path"] == "config.json"

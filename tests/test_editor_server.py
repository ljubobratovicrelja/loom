"""Tests for the loom pipeline editor server."""

from pathlib import Path

from loom.ui.server import (
    DataEntry,
    EditorOptions,
    ExecutionOptions,
    GraphNode,
    PipelineGraph,
    _update_yaml_from_graph,
    _yaml,
    graph_to_yaml,
    yaml_to_graph,
)

# Sample YAML content with comments and all features
SAMPLE_YAML_CONTENT = """\
# Pipeline configuration file
# This comment should be preserved

data:
  # Source video file
  video:
    type: video
    path: data/videos/test.mp4
  # Output files
  gaze_csv:
    type: csv
    path: data/tracking/gaze.csv
  fixations_csv:
    type: csv
    path: data/tracking/fixations.csv

parameters:
  # Video dimensions
  frame_width: 1920
  frame_height: 1080
  # Processing settings
  threshold: 50.0

pipeline:
  # Step 1: Extract gaze
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: \\$video
    outputs:
      -o: \\$gaze_csv
    args:
      --threshold: \\$threshold

  # Step 2: Detect fixations
  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: \\$gaze_csv
    outputs:
      -o: \\$fixations_csv
    args:
      --width: \\$frame_width
      --height: \\$frame_height

  # Step 3: Optional visualization
  - name: visualize
    task: tasks/visualize.py
    optional: true
    inputs:
      video: \\$video
      fixations: \\$fixations_csv
    outputs:
      -o: data/viz/output.mp4
"""


class TestYamlRoundTrip:
    """Test that YAML load/save round-trip preserves content."""

    def test_roundtrip_preserves_comments(self, tmp_path: Path) -> None:
        """Comments in the YAML file should be preserved after load/save."""
        # Arrange
        yaml_file = tmp_path / "test_pipeline.yml"
        yaml_file.write_text(SAMPLE_YAML_CONTENT)

        # Act - Load with ruamel.yaml, convert to graph, update in-place, save
        with open(yaml_file) as f:
            data = _yaml.load(f)

        graph = yaml_to_graph(dict(data))
        _update_yaml_from_graph(data, graph)

        output_file = tmp_path / "output_pipeline.yml"
        with open(output_file, "w") as f:
            _yaml.dump(data, f)

        # Assert - Read back and check comments are preserved
        saved_content = output_file.read_text()
        assert "# Pipeline configuration file" in saved_content
        assert "# Source video file" in saved_content
        assert "# Step 1: Extract gaze" in saved_content

    def test_roundtrip_preserves_all_pipeline_steps(self, tmp_path: Path) -> None:
        """All pipeline steps should be preserved after load/save."""
        # Arrange
        yaml_file = tmp_path / "test_pipeline.yml"
        yaml_file.write_text(SAMPLE_YAML_CONTENT)

        import yaml

        with open(yaml_file) as f:
            original_data = yaml.safe_load(f)

        original_step_names = [step["name"] for step in original_data["pipeline"]]

        # Act
        graph = yaml_to_graph(original_data)
        roundtrip_data = graph_to_yaml(graph)

        # Assert
        roundtrip_step_names = [step["name"] for step in roundtrip_data["pipeline"]]
        assert roundtrip_step_names == original_step_names, (
            f"Pipeline steps changed: {original_step_names} -> {roundtrip_step_names}"
        )


class TestLayoutSerialization:
    """Test that node positions are serialized and restored correctly."""

    def test_yaml_to_graph_reads_saved_positions(self) -> None:
        """Saved positions in layout section should be applied to nodes."""
        # Arrange
        yaml_data = {
            "data": {"input": {"type": "csv", "path": "/path/to/input"}},
            "parameters": {"lr": 0.001},
            "pipeline": [{"name": "step1", "task": "tasks/test.py"}],
            "layout": {
                "step1": {"x": 100, "y": 200},
                "data_input": {"x": 50, "y": 75},
                "param_lr": {"x": 25, "y": -50},
            },
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        positions = {node.id: node.position for node in graph.nodes}
        assert positions["step1"] == {"x": 100.0, "y": 200.0}
        assert positions["data_input"] == {"x": 50.0, "y": 75.0}
        assert positions["param_lr"] == {"x": 25.0, "y": -50.0}

    def test_yaml_to_graph_computes_defaults_without_layout(self) -> None:
        """Without layout section, default positions should be computed."""
        # Arrange
        yaml_data = {
            "data": {"input": {"type": "csv", "path": "/path/to/input"}},
            "parameters": {},
            "pipeline": [{"name": "step1", "task": "tasks/test.py"}],
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert - positions should be non-zero defaults
        positions = {node.id: node.position for node in graph.nodes}
        assert positions["step1"]["x"] == 300  # Default step x position
        assert positions["data_input"]["x"] == 50  # Default data node x

    def test_yaml_to_graph_sets_has_layout_true_when_layout_exists(self) -> None:
        """hasLayout should be True when layout section exists in YAML."""
        # Arrange
        yaml_data = {
            "data": {"input": {"type": "csv", "path": "/path"}},
            "parameters": {},
            "pipeline": [{"name": "step1", "task": "tasks/test.py"}],
            "layout": {"step1": {"x": 100, "y": 200}},
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        assert graph.hasLayout is True

    def test_yaml_to_graph_sets_has_layout_false_when_no_layout(self) -> None:
        """hasLayout should be False when no layout section in YAML."""
        # Arrange
        yaml_data = {
            "data": {"input": {"type": "csv", "path": "/path"}},
            "parameters": {},
            "pipeline": [{"name": "step1", "task": "tasks/test.py"}],
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        assert graph.hasLayout is False

    def test_graph_to_yaml_writes_layout_section(self) -> None:
        """Node positions should be written to layout section when hasLayout is True."""
        # Arrange
        graph = PipelineGraph(
            variables={},
            parameters={},
            data={"input": DataEntry(type="csv", path="/path")},
            nodes=[
                GraphNode(
                    id="step1",
                    type="step",
                    position={"x": 150, "y": 250},
                    data={
                        "name": "step1",
                        "task": "tasks/test.py",
                        "inputs": {},
                        "outputs": {},
                        "args": {},
                        "optional": False,
                    },
                ),
                GraphNode(
                    id="data_input",
                    type="data",
                    position={"x": 50, "y": 100},
                    data={"key": "input", "name": "input", "type": "csv", "path": "/path"},
                ),
            ],
            edges=[],
            hasLayout=True,
        )

        # Act
        yaml_out = graph_to_yaml(graph)

        # Assert
        assert "layout" in yaml_out
        assert yaml_out["layout"]["step1"] == {"x": 150, "y": 250}
        assert yaml_out["layout"]["data_input"] == {"x": 50, "y": 100}

    def test_graph_to_yaml_omits_layout_section_when_no_layout(self) -> None:
        """Layout section should be omitted when hasLayout is False (auto-layout)."""
        # Arrange
        graph = PipelineGraph(
            variables={},
            parameters={},
            data={},
            nodes=[
                GraphNode(
                    id="step1",
                    type="step",
                    position={"x": 150, "y": 250},
                    data={
                        "name": "step1",
                        "task": "tasks/test.py",
                        "inputs": {},
                        "outputs": {},
                        "args": {},
                        "optional": False,
                    },
                ),
            ],
            edges=[],
            hasLayout=False,
        )

        # Act
        yaml_out = graph_to_yaml(graph)

        # Assert
        assert "layout" not in yaml_out


class TestEditorOptionsSerialization:
    """Test that editor options are serialized and restored correctly."""

    def test_yaml_to_graph_reads_editor_options(self) -> None:
        """Editor options in YAML should be read into graph."""
        # Arrange
        yaml_data = {
            "data": {},
            "parameters": {},
            "pipeline": [],
            "editor": {"autoSave": True},
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        assert graph.editor.autoSave is True

    def test_yaml_to_graph_defaults_editor_options(self) -> None:
        """Without editor section, defaults should be used."""
        # Arrange
        yaml_data: dict[str, object] = {
            "data": {},
            "parameters": {},
            "pipeline": [],
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        assert graph.editor.autoSave is False

    def test_graph_to_yaml_writes_editor_options_when_true(self) -> None:
        """Editor options should be written when non-default."""
        # Arrange
        graph = PipelineGraph(
            variables={},
            parameters={},
            nodes=[],
            edges=[],
            editor=EditorOptions(autoSave=True),
        )

        # Act
        yaml_out = graph_to_yaml(graph)

        # Assert
        assert yaml_out.get("editor") == {"autoSave": True}

    def test_graph_to_yaml_omits_editor_when_default(self) -> None:
        """Editor section should be omitted when all values are default."""
        # Arrange
        graph = PipelineGraph(
            variables={},
            parameters={},
            nodes=[],
            edges=[],
            editor=EditorOptions(autoSave=False),
        )

        # Act
        yaml_out = graph_to_yaml(graph)

        # Assert
        assert "editor" not in yaml_out


class TestExecutionOptionsSerialization:
    """Test that execution options are serialized and restored correctly."""

    def test_yaml_to_graph_reads_execution_options(self) -> None:
        """Execution options in YAML should be read into graph."""
        # Arrange
        yaml_data = {
            "data": {},
            "parameters": {},
            "pipeline": [],
            "execution": {"parallel": True, "max_workers": 4},
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        assert graph.execution.parallel is True
        assert graph.execution.maxWorkers == 4

    def test_yaml_to_graph_reads_parallel_only(self) -> None:
        """Execution options with only parallel should work."""
        # Arrange
        yaml_data = {
            "data": {},
            "parameters": {},
            "pipeline": [],
            "execution": {"parallel": True},
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        assert graph.execution.parallel is True
        assert graph.execution.maxWorkers is None

    def test_yaml_to_graph_defaults_execution_options(self) -> None:
        """Without execution section, defaults should be used."""
        # Arrange
        yaml_data: dict[str, object] = {
            "data": {},
            "parameters": {},
            "pipeline": [],
        }

        # Act
        graph = yaml_to_graph(yaml_data)

        # Assert
        assert graph.execution.parallel is False
        assert graph.execution.maxWorkers is None

    def test_update_yaml_writes_execution_options_when_parallel(self) -> None:
        """Execution options should be written when parallel is enabled."""
        # Arrange
        graph = PipelineGraph(
            variables={},
            parameters={},
            nodes=[],
            edges=[],
            execution=ExecutionOptions(parallel=True),
        )

        # Act - use _update_yaml_from_graph which writes execution options
        data: dict[str, object] = {"parameters": {}, "pipeline": []}
        _update_yaml_from_graph(data, graph)

        # Assert
        assert data.get("execution") == {"parallel": True}

    def test_update_yaml_writes_max_workers(self) -> None:
        """Execution options with max_workers should be written."""
        # Arrange
        graph = PipelineGraph(
            variables={},
            parameters={},
            nodes=[],
            edges=[],
            execution=ExecutionOptions(parallel=True, maxWorkers=8),
        )

        # Act
        data: dict[str, object] = {"parameters": {}, "pipeline": []}
        _update_yaml_from_graph(data, graph)

        # Assert
        assert data.get("execution") == {"parallel": True, "max_workers": 8}

    def test_update_yaml_omits_execution_when_default(self) -> None:
        """Execution section should be omitted when all values are default."""
        # Arrange
        graph = PipelineGraph(
            variables={},
            parameters={},
            nodes=[],
            edges=[],
            execution=ExecutionOptions(parallel=False, maxWorkers=None),
        )

        # Act
        data: dict[str, object] = {"parameters": {}, "pipeline": []}
        _update_yaml_from_graph(data, graph)

        # Assert
        assert "execution" not in data

    def test_update_yaml_removes_execution_when_disabled(self) -> None:
        """Execution section should be removed when parallel is disabled."""
        # Arrange - start with execution options
        data: dict[str, object] = {
            "parameters": {},
            "pipeline": [],
            "execution": {"parallel": True, "max_workers": 4},
        }
        # Graph has defaults (parallel disabled)
        graph = PipelineGraph(
            variables={},
            parameters={},
            nodes=[],
            edges=[],
            execution=ExecutionOptions(parallel=False, maxWorkers=None),
        )

        # Act
        _update_yaml_from_graph(data, graph)

        # Assert - execution section should be removed
        assert "execution" not in data

    def test_execution_options_roundtrip(self) -> None:
        """Execution options should survive yaml -> graph -> update roundtrip."""
        # Arrange
        original_yaml: dict[str, object] = {
            "parameters": {},
            "pipeline": [],
            "execution": {"parallel": True, "max_workers": 6},
        }

        # Act - load to graph, then update yaml
        graph = yaml_to_graph(original_yaml)
        output_yaml: dict[str, object] = {"parameters": {}, "pipeline": []}
        _update_yaml_from_graph(output_yaml, graph)

        # Assert
        assert output_yaml.get("execution") == {"parallel": True, "max_workers": 6}


# Sample YAML with data section (typed data nodes)
SAMPLE_YAML_WITH_DATA = """\
data:
  video:
    type: video
    path: data/videos/test.mp4
    description: Input video file
  gaze_csv:
    type: csv
    path: data/tracking/gaze.csv
    description: Gaze positions output
  fixations_csv:
    type: csv
    path: data/tracking/fixations.csv

parameters:
  threshold: 50.0

pipeline:
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: \\$video
    outputs:
      --output: \\$gaze_csv
    args:
      --threshold: \\$threshold

  - name: detect_fixations
    task: tasks/detect_fixations.py
    inputs:
      gaze_csv: \\$gaze_csv
    outputs:
      --output: \\$fixations_csv
"""


class TestDataSectionParsing:
    """Test parsing of data section with typed data nodes."""

    def test_yaml_to_graph_creates_data_nodes(self) -> None:
        """Data section entries should become data nodes."""
        import yaml

        data = yaml.safe_load(SAMPLE_YAML_WITH_DATA)
        graph = yaml_to_graph(data)

        # Find data nodes
        data_nodes = [n for n in graph.nodes if n.type == "data"]
        data_node_ids = {n.id for n in data_nodes}

        assert "data_video" in data_node_ids
        assert "data_gaze_csv" in data_node_ids
        assert "data_fixations_csv" in data_node_ids

    def test_yaml_to_graph_data_nodes_have_correct_types(self) -> None:
        """Data nodes should have correct type information."""
        import yaml

        data = yaml.safe_load(SAMPLE_YAML_WITH_DATA)
        graph = yaml_to_graph(data)

        data_nodes = {n.id: n for n in graph.nodes if n.type == "data"}

        assert data_nodes["data_video"].data["type"] == "video"
        assert data_nodes["data_gaze_csv"].data["type"] == "csv"
        assert data_nodes["data_fixations_csv"].data["type"] == "csv"


class TestDataSectionRoundTrip:
    """Test round-trip serialization of data section."""

    def test_graph_to_yaml_writes_data_section(self) -> None:
        """Data nodes should be written to data section in YAML."""
        graph = PipelineGraph(
            variables={},
            parameters={},
            data={
                "video": DataEntry(type="video", path="data/test.mp4", description="Test video"),
                "output": DataEntry(type="csv", path="data/out.csv"),
            },
            nodes=[
                GraphNode(
                    id="data_video",
                    type="data",
                    position={"x": 50, "y": 50},
                    data={
                        "name": "video",
                        "type": "video",
                        "path": "data/test.mp4",
                        "description": "Test video",
                    },
                ),
                GraphNode(
                    id="data_output",
                    type="data",
                    position={"x": 50, "y": 150},
                    data={"name": "output", "type": "csv", "path": "data/out.csv"},
                ),
            ],
            edges=[],
        )

        yaml_out = graph_to_yaml(graph)

        assert "data" in yaml_out
        assert "video" in yaml_out["data"]
        assert yaml_out["data"]["video"]["type"] == "video"
        assert yaml_out["data"]["video"]["path"] == "data/test.mp4"
        assert yaml_out["data"]["video"]["description"] == "Test video"

    def test_data_section_roundtrip(self) -> None:
        """Data section should survive yaml -> graph -> yaml roundtrip."""
        import yaml

        data = yaml.safe_load(SAMPLE_YAML_WITH_DATA)

        graph = yaml_to_graph(data)
        yaml_out = graph_to_yaml(graph)

        # Verify data section preserved
        assert "data" in yaml_out
        assert yaml_out["data"]["video"]["type"] == "video"
        assert yaml_out["data"]["video"]["path"] == "data/videos/test.mp4"
        assert yaml_out["data"]["gaze_csv"]["type"] == "csv"
        assert yaml_out["data"]["fixations_csv"]["type"] == "csv"


# ---------------------------------------------------------------------------
# Group block tests
# ---------------------------------------------------------------------------

SAMPLE_YAML_WITH_GROUPS = """\
pipeline:
  - group: preprocessing
    steps:
      - name: preprocess
        task: tasks/preprocess.py
      - name: normalize
        task: tasks/normalize.py
  - name: train
    task: tasks/train.py
"""


class TestGroupBlockYamlToGraph:
    """Test yaml_to_graph with group blocks."""

    def test_step_nodes_have_group_field(self) -> None:
        """Step nodes from grouped steps should carry a 'group' field in data."""
        import yaml

        data = yaml.safe_load(SAMPLE_YAML_WITH_GROUPS)
        graph = yaml_to_graph(data)

        step_nodes = {n.id: n for n in graph.nodes if n.type == "step"}
        assert step_nodes["preprocess"].data["group"] == "preprocessing"
        assert step_nodes["normalize"].data["group"] == "preprocessing"

    def test_ungrouped_step_has_no_group_field(self) -> None:
        """Ungrouped step nodes should not have a 'group' key in data."""
        import yaml

        data = yaml.safe_load(SAMPLE_YAML_WITH_GROUPS)
        graph = yaml_to_graph(data)

        step_nodes = {n.id: n for n in graph.nodes if n.type == "step"}
        assert (
            "group" not in step_nodes["train"].data or step_nodes["train"].data.get("group") is None
        )

    def test_all_steps_become_nodes(self) -> None:
        """All steps (inside groups and ungrouped) should become graph nodes."""
        import yaml

        data = yaml.safe_load(SAMPLE_YAML_WITH_GROUPS)
        graph = yaml_to_graph(data)

        step_ids = {n.id for n in graph.nodes if n.type == "step"}
        assert step_ids == {"preprocess", "normalize", "train"}


class TestGroupBlockGraphToYaml:
    """Test graph_to_yaml with group-tagged step nodes."""

    def test_grouped_steps_emit_group_blocks(self) -> None:
        """Step nodes with 'group' in data should be emitted as nested group blocks."""
        graph = PipelineGraph(
            variables={},
            parameters={},
            data={},
            nodes=[
                GraphNode(
                    id="preprocess",
                    type="step",
                    position={"x": 300, "y": 50},
                    data={
                        "name": "preprocess",
                        "task": "tasks/preprocess.py",
                        "inputs": {},
                        "outputs": {},
                        "args": {},
                        "optional": False,
                        "group": "preprocessing",
                    },
                ),
                GraphNode(
                    id="normalize",
                    type="step",
                    position={"x": 300, "y": 300},
                    data={
                        "name": "normalize",
                        "task": "tasks/normalize.py",
                        "inputs": {},
                        "outputs": {},
                        "args": {},
                        "optional": False,
                        "group": "preprocessing",
                    },
                ),
                GraphNode(
                    id="train",
                    type="step",
                    position={"x": 700, "y": 50},
                    data={
                        "name": "train",
                        "task": "tasks/train.py",
                        "inputs": {},
                        "outputs": {},
                        "args": {},
                        "optional": False,
                    },
                ),
            ],
            edges=[],
        )

        yaml_out = graph_to_yaml(graph)
        pipeline = yaml_out["pipeline"]

        # First entry should be the group block
        assert pipeline[0]["group"] == "preprocessing"
        assert len(pipeline[0]["steps"]) == 2
        step_names = [s["name"] for s in pipeline[0]["steps"]]
        assert "preprocess" in step_names
        assert "normalize" in step_names

        # Second entry should be the ungrouped step
        assert pipeline[1]["name"] == "train"

    def test_group_key_not_inside_step_dicts(self) -> None:
        """The 'group' key should NOT appear inside individual step dicts."""
        graph = PipelineGraph(
            variables={},
            parameters={},
            data={},
            nodes=[
                GraphNode(
                    id="preprocess",
                    type="step",
                    position={"x": 300, "y": 50},
                    data={
                        "name": "preprocess",
                        "task": "tasks/preprocess.py",
                        "inputs": {},
                        "outputs": {},
                        "args": {},
                        "optional": False,
                        "group": "preprocessing",
                    },
                ),
            ],
            edges=[],
        )

        yaml_out = graph_to_yaml(graph)
        group_block = yaml_out["pipeline"][0]
        inner_step = group_block["steps"][0]
        assert "group" not in inner_step


class TestGroupBlockRoundTrip:
    """Round-trip tests: YAML with groups → graph → YAML."""

    def test_group_structure_preserved(self) -> None:
        """Group block structure should be preserved through yaml → graph → yaml."""
        import yaml

        data = yaml.safe_load(SAMPLE_YAML_WITH_GROUPS)
        graph = yaml_to_graph(data)
        yaml_out = graph_to_yaml(graph)

        pipeline = yaml_out["pipeline"]

        # Find the group block
        group_blocks = [e for e in pipeline if "group" in e]
        flat_steps = [e for e in pipeline if "name" in e]

        assert len(group_blocks) == 1
        assert group_blocks[0]["group"] == "preprocessing"
        assert len(group_blocks[0]["steps"]) == 2

        assert len(flat_steps) == 1
        assert flat_steps[0]["name"] == "train"

    def test_update_yaml_handles_group_blocks(self, tmp_path: Path) -> None:
        """update_yaml_from_graph should update steps inside group blocks in-place."""
        yaml_content = """\
pipeline:
  - group: preprocessing
    steps:
      - name: preprocess
        task: tasks/old_preprocess.py
"""
        yaml_file = tmp_path / "pipeline.yml"
        yaml_file.write_text(yaml_content)

        with open(yaml_file) as f:
            data = _yaml.load(f)

        # Update the task path via graph
        graph = yaml_to_graph(dict(data))
        # Modify the task in graph nodes
        for node in graph.nodes:
            if node.id == "preprocess":
                node.data["task"] = "tasks/new_preprocess.py"

        _update_yaml_from_graph(data, graph)

        # The update should have gone into the group block's step
        pipeline = data["pipeline"]
        assert pipeline[0]["group"] == "preprocessing"
        assert pipeline[0]["steps"][0]["task"] == "tasks/new_preprocess.py"

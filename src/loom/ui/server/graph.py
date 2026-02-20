"""Graph conversion between YAML pipeline format and React Flow graph format."""

from typing import Any

from .models import (
    DataEntry,
    EditorOptions,
    ExecutionOptions,
    GraphEdge,
    GraphNode,
    PipelineGraph,
)


def _flatten_pipeline(pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten grouped pipeline entries into a flat list with group tag injected.

    Group blocks of the form ``{"group": name, "steps": [...]}`` are expanded
    into flat step dicts with a ``"group"`` key added to each step.
    Ungrouped steps are passed through unchanged.
    """
    flat = []
    for entry in pipeline:
        if "group" in entry and "steps" in entry:
            for step in entry["steps"]:
                flat.append({**step, "group": entry["group"]})
        else:
            flat.append(entry)
    return flat


def _resolve_param_name(edge_source: str, nodes: list[GraphNode]) -> str | None:
    """Resolve the parameter name from a parameter node ID.

    For clone nodes (e.g. ``param_threshold_ref_1``), the name cannot simply be
    derived by stripping the ``param_`` prefix.  Instead we look up the node's
    ``data.name`` field which always contains the canonical parameter name.
    Falls back to stripping the ``param_`` prefix for backwards-compatibility.
    """
    for node in nodes:
        if node.id == edge_source and node.type == "parameter":
            name = node.data.get("name")
            if name:
                return str(name)
            break
    if edge_source.startswith("param_"):
        return edge_source[6:]
    return None


def _collect_param_refs(
    nodes: list[GraphNode],
    edges: list[GraphEdge],
) -> dict[str, dict[str, Any]]:
    """Detect parameter reference (clone) nodes and build parameterRefs dict."""
    param_refs: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if node.type == "parameter":
            name = node.data.get("name", "")
            if not name or node.id == f"param_{name}":
                continue
            ref_edges = sorted(
                f"{e.target}:{e.targetHandle}"
                for e in edges
                if e.source == node.id and e.targetHandle
            )
            param_refs[node.id] = {"parameter": name, "edges": ref_edges}
    return param_refs


def _build_step_dict(node: GraphNode, param_edges: dict[tuple[str, str], str]) -> dict[str, Any]:
    """Build a YAML step dict from a graph node (without group key)."""
    step: dict[str, Any] = {
        "name": node.data["name"],
        "task": node.data["task"],
    }
    if node.data.get("loop"):
        step["loop"] = node.data["loop"]
    if node.data.get("inputs"):
        step["inputs"] = node.data["inputs"]
    if node.data.get("outputs"):
        step["outputs"] = node.data["outputs"]

    # Build args: merge node data args with parameter edge connections
    args = dict(node.data.get("args", {}))
    step_name = node.data["name"]
    for (target, handle), param_name in param_edges.items():
        if target == step_name:
            args[handle] = f"${param_name}"
    if args:
        step["args"] = args

    if node.data.get("optional"):
        step["optional"] = True
    if node.data.get("disabled"):
        step["disabled"] = True
    return step


def yaml_to_graph(data: dict[str, Any]) -> PipelineGraph:
    """Convert YAML pipeline to React Flow graph format."""
    parameters = data.get("parameters", {})
    pipeline = data.get("pipeline", [])
    layout = data.get("layout", {})  # Saved node positions

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    # Flatten group blocks so all step entries are plain step dicts with optional "group" key
    all_steps = _flatten_pipeline(pipeline)

    # Step 1: Identify output data nodes (produced by steps)
    output_data: dict[str, dict[str, str]] = {}  # data_name -> {step, flag}
    for step in all_steps:
        for out_flag, out_ref in step.get("outputs", {}).items():
            if out_ref.startswith("$"):
                data_name = out_ref[1:]
                output_data[data_name] = {"step": step["name"], "flag": out_flag}

    # Step 2: Create step nodes and track their positions
    # Use saved layout positions if available, otherwise compute default positions
    step_positions: dict[str, dict[str, float]] = {}
    for i, step in enumerate(all_steps):
        step_id = step["name"]
        # Check if we have a saved position for this node
        if step_id in layout:
            saved = layout[step_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        else:
            # Default: row-based layout to preserve order in graph_to_yaml sorting
            row = i // 2
            col = i % 2
            position = {"x": 300 + col * 400, "y": 50 + row * 250}
        step_positions[step_id] = position
        step_data: dict[str, Any] = {
            "name": step["name"],
            "task": step["task"],
            "inputs": step.get("inputs", {}),
            "outputs": step.get("outputs", {}),
            "args": step.get("args", {}),
            "optional": step.get("optional", False),
            "disabled": step.get("disabled", False),
        }
        if step.get("loop"):
            step_data["loop"] = step["loop"]
        if step.get("group"):
            step_data["group"] = step["group"]
        nodes.append(
            GraphNode(
                id=step_id,
                type="step",
                position=position,
                data=step_data,
            )
        )

    # Step 3: Create parameter nodes (positioned on left)
    for param_idx, (param_name, param_value) in enumerate(parameters.items()):
        node_id = f"param_{param_name}"
        # Check if we have a saved position for this node
        if node_id in layout:
            saved = layout[node_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        else:
            # Position parameters above input variables
            param_y = -100 - (len(parameters) - param_idx - 1) * 60
            position = {"x": 50, "y": param_y}
        nodes.append(
            GraphNode(
                id=node_id,
                type="parameter",
                position=position,
                data={
                    "name": param_name,
                    "value": param_value,
                },
            )
        )

    # Step 3b: Create parameter reference (clone) nodes from editor.parameterRefs
    param_refs = data.get("editor", {}).get("parameterRefs", {})
    for ref_id, ref_info in param_refs.items():
        param_name = ref_info.get("parameter")
        if param_name not in parameters:
            continue
        if ref_id in layout:
            saved = layout[ref_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        else:
            position = {"x": 50, "y": 0}
        nodes.append(
            GraphNode(
                id=ref_id,
                type="parameter",
                position=position,
                data={
                    "name": param_name,
                    "value": parameters[param_name],
                },
            )
        )

    # Step 3c: Create data nodes (typed file/directory nodes)
    data_section = data.get("data", {})
    for data_idx, (data_name, data_info) in enumerate(data_section.items()):
        node_id = f"data_{data_name}"
        # Check if we have a saved position for this node
        if node_id in layout:
            saved = layout[node_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        else:
            # Position data nodes below parameters, on the left side
            position = {"x": 50, "y": -200 - data_idx * 80}
        nodes.append(
            GraphNode(
                id=node_id,
                type="data",
                position=position,
                data={
                    "key": data_name,  # Programmatic identifier for $references
                    "name": data_info.get("name") or data_name,  # Display name
                    "type": data_info.get("type", "data_folder"),
                    "path": data_info.get("path", ""),
                    "description": data_info.get("description"),
                    "pattern": data_info.get("pattern"),
                },
            )
        )

    # Track data names for edge creation
    data_names = set(data_section.keys())

    # Step 4: Create edges
    # 4a: Edges from steps to output data nodes they produce
    for data_name, producer in output_data.items():
        if data_name in data_names:
            edges.append(
                GraphEdge(
                    id=f"e_{producer['step']}_data_{data_name}",
                    source=producer["step"],
                    target=f"data_{data_name}",
                    sourceHandle=producer["flag"],
                    targetHandle="input",
                )
            )

    # 4b: Edges from data nodes to steps that consume them
    for step in all_steps:
        step_id = step["name"]
        for input_name, data_ref in step.get("inputs", {}).items():
            if data_ref.startswith("$"):
                ref_name = data_ref[1:]
                if ref_name in data_names:
                    edges.append(
                        GraphEdge(
                            id=f"e_data_{ref_name}_{step_id}_{input_name}",
                            source=f"data_{ref_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=input_name,
                        )
                    )

    # 4c: Edges from parameters to steps that use them in args
    # Build lookup from "step:handle" -> clone node ID for edge routing
    clone_edge_lookup: dict[str, str] = {}  # "step_id:arg_key" -> clone_node_id
    for ref_id, ref_info in param_refs.items():
        for edge_spec in ref_info.get("edges", []):
            clone_edge_lookup[edge_spec] = ref_id

    for step in all_steps:
        step_id = step["name"]
        for arg_key, arg_value in step.get("args", {}).items():
            if isinstance(arg_value, str) and arg_value.startswith("$"):
                param_name = arg_value[1:]
                # Only create edge if parameter exists
                if param_name in parameters:
                    # Route to clone node if mapped to same parameter, otherwise primary
                    source_id = f"param_{param_name}"
                    clone_key = f"{step_id}:{arg_key}"
                    clone_id = clone_edge_lookup.get(clone_key)
                    if clone_id is not None:
                        ref_info = param_refs.get(clone_id)
                        if ref_info and ref_info.get("parameter") == param_name:
                            source_id = clone_id
                    edges.append(
                        GraphEdge(
                            id=f"e_{source_id}_{step_id}_{arg_key}",
                            source=source_id,
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=arg_key,
                        )
                    )

    # 4d: Loop edges — data node → step (loop-over) and step → data node (loop-into)
    for step in all_steps:
        step_id = step["name"]
        loop = step.get("loop")
        if loop:
            over_ref = loop.get("over", "")
            into_ref = loop.get("into", "")

            if over_ref.startswith("$"):
                over_name = over_ref[1:]
                if over_name in data_names:
                    edges.append(
                        GraphEdge(
                            id=f"e_loop_over_data_{over_name}_{step_id}",
                            source=f"data_{over_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle="loop-over",
                        )
                    )

            if into_ref.startswith("$"):
                into_name = into_ref[1:]
                if into_name in data_names:
                    edges.append(
                        GraphEdge(
                            id=f"e_loop_into_{step_id}_data_{into_name}",
                            source=step_id,
                            target=f"data_{into_name}",
                            sourceHandle="loop-into",
                            targetHandle="input",
                        )
                    )

    # Read editor options
    editor_data = data.get("editor", {})
    editor = EditorOptions(
        autoSave=editor_data.get("autoSave", False),
    )

    # Read execution options
    execution_data = data.get("execution", {})
    execution = ExecutionOptions(
        parallel=execution_data.get("parallel", False),
        maxWorkers=execution_data.get("max_workers"),
    )

    # Build data entries dict for graph
    data_entries: dict[str, DataEntry] = {}
    for name, info in data_section.items():
        data_entries[name] = DataEntry(
            type=info.get("type", "data_folder"),
            path=info.get("path", ""),
            name=info.get("name"),  # Display name (None falls back to key)
            description=info.get("description"),
            pattern=info.get("pattern"),
        )

    return PipelineGraph(
        variables={},  # Deprecated - kept for compatibility
        parameters=parameters,
        data=data_entries,
        nodes=nodes,
        edges=edges,
        editor=editor,
        execution=execution,
        hasLayout=bool(layout),  # True if layout section existed in YAML
    )


def graph_to_yaml(graph: PipelineGraph) -> dict[str, Any]:
    """Convert React Flow graph back to YAML format."""
    # Extract parameters from parameter nodes
    parameters = dict(graph.parameters)  # Start with base parameters
    for node in graph.nodes:
        if node.type == "parameter":
            parameters[node.data["name"]] = node.data["value"]

    # Build lookup of parameter edges: (target_step, target_handle) -> param_name
    param_edges: dict[tuple[str, str], str] = {}
    for edge in graph.edges:
        if edge.source.startswith("param_"):
            param_name = _resolve_param_name(edge.source, graph.nodes)
            if param_name and edge.targetHandle:
                param_edges[(edge.target, edge.targetHandle)] = param_name

    # Build pipeline from step nodes
    step_nodes = [n for n in graph.nodes if n.type == "step"]

    # Sort by y,x position for consistent ordering
    step_nodes.sort(key=lambda n: (n.position.get("y", 0), n.position.get("x", 0)))

    # Emit steps, collecting grouped steps into group blocks (first-appearance order).
    # Ungrouped steps appear at their natural sorted position;
    # grouped steps are collected into a single block placed at the position of the
    # first member encountered.
    pipeline: list[dict[str, Any]] = []
    seen_groups: set[str] = set()
    group_block_index: dict[str, int] = {}  # group_name -> index in pipeline list

    for node in step_nodes:
        step_dict = _build_step_dict(node, param_edges)
        group = node.data.get("group")

        if not group:
            pipeline.append(step_dict)
        else:
            if group not in seen_groups:
                seen_groups.add(group)
                group_block_index[group] = len(pipeline)
                pipeline.append({"group": group, "steps": [step_dict]})
            else:
                # Add to existing group block
                pipeline[group_block_index[group]]["steps"].append(step_dict)

    # Extract layout (positions) from all nodes — only if layout should be preserved
    layout: dict[str, dict[str, float]] = {}
    if graph.hasLayout:
        for node in graph.nodes:
            # Round positions to integers for cleaner YAML
            layout[node.id] = {
                "x": round(node.position.get("x", 0)),
                "y": round(node.position.get("y", 0)),
            }

    # Extract data nodes from graph nodes
    data_section: dict[str, dict[str, Any]] = {}
    for node in graph.nodes:
        if node.type == "data":
            # Use 'key' as the YAML key (for $references), fall back to 'name' for old format
            data_key = node.data.get("key") or node.data["name"]
            entry: dict[str, Any] = {
                "type": node.data["type"],
                "path": node.data["path"],
            }
            # Include display name if different from key
            display_name = node.data.get("name")
            if display_name and display_name != data_key:
                entry["name"] = display_name
            if node.data.get("description"):
                entry["description"] = node.data["description"]
            if node.data.get("pattern"):
                entry["pattern"] = node.data["pattern"]
            data_section[data_key] = entry

    # Also include any data from graph.data not shown as nodes
    for name, data_entry in graph.data.items():
        if name not in data_section:
            entry = {"type": data_entry.type, "path": data_entry.path}
            if data_entry.name:
                entry["name"] = data_entry.name
            if data_entry.description:
                entry["description"] = data_entry.description
            if data_entry.pattern:
                entry["pattern"] = data_entry.pattern
            data_section[name] = entry

    # Editor options (only include non-default values to keep YAML clean)
    editor: dict[str, Any] = {}
    if graph.editor.autoSave:
        editor["autoSave"] = True

    # Persist parameter reference (clone) nodes
    param_refs = _collect_param_refs(graph.nodes, graph.edges)
    if param_refs:
        editor["parameterRefs"] = param_refs

    result: dict[str, Any] = {
        "parameters": parameters,
        "pipeline": pipeline,
    }
    if layout:
        result["layout"] = layout
    if data_section:
        result["data"] = data_section
    if editor:
        result["editor"] = editor

    return result


def update_yaml_from_graph(data: dict[str, Any], graph: PipelineGraph) -> None:
    """Update YAML data structure in-place from graph, preserving comments."""
    # Remove deprecated variables section if present
    if "variables" in data:
        del data["variables"]

    # Extract parameters from parameter nodes and graph.parameters
    parameters = dict(graph.parameters)
    for node in graph.nodes:
        if node.type == "parameter":
            parameters[node.data["name"]] = node.data["value"]

    # Update parameters in-place
    if "parameters" not in data:
        data["parameters"] = {}
    for name, value in parameters.items():
        data["parameters"][name] = value

    # Extract data nodes from graph nodes
    data_section: dict[str, dict[str, Any]] = {}
    for node in graph.nodes:
        if node.type == "data":
            # Use 'key' as the YAML key (for $references), fall back to 'name' for old format
            data_key = node.data.get("key") or node.data["name"]
            entry: dict[str, Any] = {
                "type": node.data["type"],
                "path": node.data["path"],
            }
            # Include display name if different from key
            display_name = node.data.get("name")
            if display_name and display_name != data_key:
                entry["name"] = display_name
            if node.data.get("description"):
                entry["description"] = node.data["description"]
            if node.data.get("pattern"):
                entry["pattern"] = node.data["pattern"]
            data_section[data_key] = entry

    # Also include any data from graph.data not shown as nodes
    for name, data_entry in graph.data.items():
        if name not in data_section:
            entry = {"type": data_entry.type, "path": data_entry.path}
            if data_entry.name:
                entry["name"] = data_entry.name
            if data_entry.description:
                entry["description"] = data_entry.description
            if data_entry.pattern:
                entry["pattern"] = data_entry.pattern
            data_section[name] = entry

    # Update data section in-place
    if data_section:
        if "data" not in data:
            data["data"] = {}
        for name, entry in data_section.items():
            data["data"][name] = entry
    elif "data" in data and not data["data"]:
        del data["data"]

    # Build lookup of parameter edges: (target_step, target_handle) -> param_name
    param_edges: dict[tuple[str, str], str] = {}
    for edge in graph.edges:
        if edge.source.startswith("param_"):
            param_name = _resolve_param_name(edge.source, graph.nodes)
            if param_name and edge.targetHandle:
                param_edges[(edge.target, edge.targetHandle)] = param_name

    # Build step lookup from graph (include "group" metadata for new step placement)
    step_nodes = [n for n in graph.nodes if n.type == "step"]
    graph_steps: dict[str, dict[str, Any]] = {}
    for node in step_nodes:
        step_name = node.data["name"]
        step_data: dict[str, Any] = {
            "name": step_name,
            "task": node.data["task"],
        }
        if node.data.get("loop"):
            step_data["loop"] = node.data["loop"]
        if node.data.get("inputs"):
            step_data["inputs"] = dict(node.data["inputs"])
        if node.data.get("outputs"):
            step_data["outputs"] = dict(node.data["outputs"])

        # Build args: merge node data args with parameter edge connections
        args = dict(node.data.get("args", {}))
        for (target, handle), param_name in param_edges.items():
            if target == step_name:
                args[handle] = f"${param_name}"
        if args:
            step_data["args"] = args

        if node.data.get("optional"):
            step_data["optional"] = True
        if node.data.get("disabled"):
            step_data["disabled"] = True
        # Store group for new-step placement (not written into individual step dicts)
        if node.data.get("group"):
            step_data["group"] = node.data["group"]
        graph_steps[step_name] = step_data

    # Update pipeline steps in-place, preserving order and group block structure
    if "pipeline" not in data:
        data["pipeline"] = []

    def _apply_step_update(step: dict[str, Any], graph_step: dict[str, Any]) -> None:
        """Update a single flat step dict in-place from graph_step."""
        step["task"] = graph_step["task"]
        # Update loop
        if "loop" in graph_step:
            step["loop"] = graph_step["loop"]
        elif "loop" in step:
            del step["loop"]
        # Update inputs
        if "inputs" in graph_step:
            step["inputs"] = graph_step["inputs"]
        elif "inputs" in step:
            del step["inputs"]
        # Update outputs
        if "outputs" in graph_step:
            step["outputs"] = graph_step["outputs"]
        elif "outputs" in step:
            del step["outputs"]
        # Update args
        if "args" in graph_step:
            step["args"] = graph_step["args"]
        elif "args" in step:
            del step["args"]
        # Update optional
        if graph_step.get("optional"):
            step["optional"] = True
        elif "optional" in step:
            del step["optional"]
        # Update disabled
        if graph_step.get("disabled"):
            step["disabled"] = True
        elif "disabled" in step:
            del step["disabled"]

    # Walk pipeline entries (flat steps and group blocks) updating in-place
    existing_names: set[str] = set()
    for entry in data["pipeline"]:
        if "group" in entry and "steps" in entry:
            # Group block — update each member step individually
            for step in entry["steps"]:
                name = step["name"]
                existing_names.add(name)
                if name in graph_steps:
                    _apply_step_update(step, graph_steps[name])
        else:
            # Flat (ungrouped) step
            name = entry["name"]
            existing_names.add(name)
            if name in graph_steps:
                _apply_step_update(entry, graph_steps[name])

    # Add any new steps from the graph (not already in existing YAML)
    for name, graph_step in graph_steps.items():
        if name not in existing_names:
            group = graph_step.get("group")
            # Build the plain step dict (no "group" key inside the step)
            plain_step = {k: v for k, v in graph_step.items() if k != "group"}
            if group:
                # Try to append into an existing group block
                appended = False
                for entry in data["pipeline"]:
                    if "group" in entry and entry["group"] == group:
                        entry["steps"].append(plain_step)
                        appended = True
                        break
                if not appended:
                    # Create a new group block
                    data["pipeline"].append({"group": group, "steps": [plain_step]})
            else:
                data["pipeline"].append(plain_step)

    # Update layout (positions) — only if layout should be preserved
    if graph.hasLayout:
        if "layout" not in data:
            data["layout"] = {}
        for node in graph.nodes:
            # Round positions to integers for cleaner YAML
            data["layout"][node.id] = {
                "x": round(node.position.get("x", 0)),
                "y": round(node.position.get("y", 0)),
            }
    elif "layout" in data:
        del data["layout"]

    # Update editor options (only include non-default values)
    if graph.editor.autoSave:
        if "editor" not in data:
            data["editor"] = {}
        data["editor"]["autoSave"] = True
    elif "editor" in data and "autoSave" in data["editor"]:
        del data["editor"]["autoSave"]

    # Persist parameter reference (clone) nodes
    param_refs = _collect_param_refs(graph.nodes, graph.edges)
    if param_refs:
        if "editor" not in data:
            data["editor"] = {}
        data["editor"]["parameterRefs"] = param_refs
    elif "editor" in data and "parameterRefs" in data["editor"]:
        del data["editor"]["parameterRefs"]

    # Clean up empty editor section
    if "editor" in data and not data["editor"]:
        del data["editor"]

    # Update execution options (only include non-default values)
    has_execution_settings = graph.execution.parallel or graph.execution.maxWorkers
    if has_execution_settings:
        if "execution" not in data:
            data["execution"] = {}
        if graph.execution.parallel:
            data["execution"]["parallel"] = True
        elif "parallel" in data.get("execution", {}):
            del data["execution"]["parallel"]
        if graph.execution.maxWorkers is not None:
            data["execution"]["max_workers"] = graph.execution.maxWorkers
        elif "max_workers" in data.get("execution", {}):
            del data["execution"]["max_workers"]
    else:
        # Remove execution section if all values are defaults
        if "execution" in data:
            if "parallel" in data["execution"]:
                del data["execution"]["parallel"]
            if "max_workers" in data["execution"]:
                del data["execution"]["max_workers"]
            if not data["execution"]:
                del data["execution"]

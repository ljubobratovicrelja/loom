"""Graph conversion between YAML pipeline format and React Flow graph format."""

from typing import Any

from .models import DataEntry, EditorOptions, GraphEdge, GraphNode, PipelineGraph


def yaml_to_graph(data: dict[str, Any]) -> PipelineGraph:
    """Convert YAML pipeline to React Flow graph format."""
    variables = data.get("variables", {})
    parameters = data.get("parameters", {})
    pipeline = data.get("pipeline", [])
    layout = data.get("layout", {})  # Saved node positions

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    # Step 1: Identify output variables (produced by steps)
    output_vars: dict[str, dict[str, str]] = {}  # var_name -> {step, flag}
    for step in pipeline:
        for out_flag, out_ref in step.get("outputs", {}).items():
            if out_ref.startswith("$"):
                var_name = out_ref[1:]
                output_vars[var_name] = {"step": step["name"], "flag": out_flag}

    # Step 2: Create step nodes and track their positions
    # Use saved layout positions if available, otherwise compute default positions
    step_positions: dict[str, dict[str, float]] = {}
    for i, step in enumerate(pipeline):
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
        nodes.append(
            GraphNode(
                id=step_id,
                type="step",
                position=position,
                data={
                    "name": step["name"],
                    "task": step["task"],
                    "inputs": step.get("inputs", {}),
                    "outputs": step.get("outputs", {}),
                    "args": step.get("args", {}),
                    "optional": step.get("optional", False),
                    "disabled": step.get("disabled", False),
                },
            )
        )

    # Step 3: Create variable nodes with appropriate positioning
    input_var_index = 0
    for name, value in variables.items():
        is_output = name in output_vars
        node_id = f"var_{name}"

        # Check if we have a saved position for this node
        if node_id in layout:
            saved = layout[node_id]
            position = {"x": float(saved.get("x", 0)), "y": float(saved.get("y", 0))}
        elif is_output:
            # Position output variables after their producing step
            producer = output_vars[name]
            producer_pos = step_positions.get(producer["step"], {"x": 300, "y": 100})
            position = {"x": producer_pos["x"] + 280, "y": producer_pos["y"] + 50}
        else:
            # Input-only variables stay on the left
            position = {"x": 50, "y": 50 + input_var_index * 80}
            input_var_index += 1

        nodes.append(
            GraphNode(
                id=node_id,
                type="variable",
                position=position,
                data={
                    "name": name,
                    "value": value,
                    "isOutput": is_output,
                    "producedBy": output_vars.get(name, {}).get("step"),
                },
            )
        )

    # Step 3b: Create parameter nodes (positioned above variables on left)
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
    # 4a: Edges from steps to output variables/data nodes they produce
    for var_name, producer in output_vars.items():
        # Check if output goes to a data node or variable node
        if var_name in data_names:
            # Output to data node
            edges.append(
                GraphEdge(
                    id=f"e_{producer['step']}_data_{var_name}",
                    source=producer["step"],
                    target=f"data_{var_name}",
                    sourceHandle=producer["flag"],
                    targetHandle="input",
                )
            )
        else:
            # Output to variable node
            edges.append(
                GraphEdge(
                    id=f"e_{producer['step']}_var_{var_name}",
                    source=producer["step"],
                    target=f"var_{var_name}",
                    sourceHandle=producer["flag"],
                    targetHandle="input",
                )
            )

    # 4b: Edges from variables/data nodes to steps that consume them
    for step in pipeline:
        step_id = step["name"]
        for input_name, var_ref in step.get("inputs", {}).items():
            if var_ref.startswith("$"):
                ref_name = var_ref[1:]
                # Check if it's a data node reference or variable reference
                if ref_name in data_names:
                    # Data node -> step edge
                    edges.append(
                        GraphEdge(
                            id=f"e_data_{ref_name}_{step_id}_{input_name}",
                            source=f"data_{ref_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=input_name,
                        )
                    )
                else:
                    # Variable -> step edge
                    edges.append(
                        GraphEdge(
                            id=f"e_var_{ref_name}_{step_id}_{input_name}",
                            source=f"var_{ref_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=input_name,
                        )
                    )

    # 4c: Edges from parameters to steps that use them in args
    for step in pipeline:
        step_id = step["name"]
        for arg_key, arg_value in step.get("args", {}).items():
            if isinstance(arg_value, str) and arg_value.startswith("$"):
                param_name = arg_value[1:]
                # Only create edge if parameter exists
                if param_name in parameters:
                    edges.append(
                        GraphEdge(
                            id=f"e_param_{param_name}_{step_id}_{arg_key}",
                            source=f"param_{param_name}",
                            target=step_id,
                            sourceHandle="value",
                            targetHandle=arg_key,
                        )
                    )

    # Read editor options
    editor_data = data.get("editor", {})
    editor = EditorOptions(
        autoSave=editor_data.get("autoSave", False),
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
        variables=variables,
        parameters=parameters,
        data=data_entries,
        nodes=nodes,
        edges=edges,
        editor=editor,
        hasLayout=bool(layout),  # True if layout section existed in YAML
    )


def graph_to_yaml(graph: PipelineGraph) -> dict[str, Any]:
    """Convert React Flow graph back to YAML format."""
    # Extract variables from variable nodes
    variables = {}
    for node in graph.nodes:
        if node.type == "variable":
            variables[node.data["name"]] = node.data["value"]

    # Also include any variables not shown as nodes
    variables.update(graph.variables)

    # Extract parameters from parameter nodes
    parameters = dict(graph.parameters)  # Start with base parameters
    for node in graph.nodes:
        if node.type == "parameter":
            parameters[node.data["name"]] = node.data["value"]

    # Build lookup of parameter edges: (target_step, target_handle) -> param_name
    param_edges: dict[tuple[str, str], str] = {}
    for edge in graph.edges:
        if edge.source.startswith("param_"):
            param_name = edge.source[6:]  # Strip "param_" prefix
            if edge.targetHandle:
                param_edges[(edge.target, edge.targetHandle)] = param_name

    # Build pipeline from step nodes
    pipeline = []
    step_nodes = [n for n in graph.nodes if n.type == "step"]

    # Sort by y,x position for consistent ordering
    step_nodes.sort(key=lambda n: (n.position.get("y", 0), n.position.get("x", 0)))

    for node in step_nodes:
        step: dict[str, Any] = {
            "name": node.data["name"],
            "task": node.data["task"],
        }

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

        pipeline.append(step)

    # Extract layout (positions) from all nodes
    layout: dict[str, dict[str, float]] = {}
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

    result: dict[str, Any] = {
        "variables": variables,
        "parameters": parameters,
        "pipeline": pipeline,
        "layout": layout,
    }
    if data_section:
        result["data"] = data_section
    if editor:
        result["editor"] = editor

    return result


def update_yaml_from_graph(data: dict[str, Any], graph: PipelineGraph) -> None:
    """Update YAML data structure in-place from graph, preserving comments."""
    # Extract variables from graph nodes
    variables = {}
    for node in graph.nodes:
        if node.type == "variable":
            variables[node.data["name"]] = node.data["value"]
    # Include any variables not shown as nodes
    variables.update(graph.variables)

    # Update variables in-place
    if "variables" not in data:
        data["variables"] = {}
    for name, value in variables.items():
        data["variables"][name] = value

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
            param_name = edge.source[6:]  # Strip "param_" prefix
            if edge.targetHandle:
                param_edges[(edge.target, edge.targetHandle)] = param_name

    # Build step lookup from graph
    step_nodes = [n for n in graph.nodes if n.type == "step"]
    graph_steps = {}
    for node in step_nodes:
        step_name = node.data["name"]
        step_data: dict[str, Any] = {
            "name": step_name,
            "task": node.data["task"],
        }
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
        graph_steps[step_name] = step_data

    # Update pipeline steps in-place, preserving order
    if "pipeline" not in data:
        data["pipeline"] = []

    # Update existing steps in-place
    existing_names = set()
    for step in data["pipeline"]:
        name = step["name"]
        existing_names.add(name)
        if name in graph_steps:
            graph_step = graph_steps[name]
            step["task"] = graph_step["task"]
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

    # Add any new steps from the graph
    for name, graph_step in graph_steps.items():
        if name not in existing_names:
            data["pipeline"].append(graph_step)

    # Update layout (positions) from all nodes
    if "layout" not in data:
        data["layout"] = {}
    for node in graph.nodes:
        # Round positions to integers for cleaner YAML
        data["layout"][node.id] = {
            "x": round(node.position.get("x", 0)),
            "y": round(node.position.get("y", 0)),
        }

    # Update editor options (only include non-default values)
    if graph.editor.autoSave:
        if "editor" not in data:
            data["editor"] = {}
        data["editor"]["autoSave"] = True
    elif "editor" in data and "autoSave" in data["editor"]:
        del data["editor"]["autoSave"]
        # Clean up empty editor section
        if not data["editor"]:
            del data["editor"]

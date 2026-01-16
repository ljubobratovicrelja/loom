# Visual Editor

Reference for the `loom-ui` visual editor.

## Starting the Editor

```bash
# Open a pipeline
loom-ui pipeline.yml

# Browse pipelines in a directory
loom-ui experiments/

# Create a new pipeline
loom-ui --new

# Custom port
loom-ui pipeline.yml --port 8080
```

## User Interface

```
┌──────────────────────────────────────────────────────────────────┐
│ Toolbar: [Logo] path/to/config.yml*  [Run Controls] [Save] etc. │
├──────────┬───────────────────────────────────────┬───────────────┤
│          │                                       │               │
│ Sidebar  │           Canvas                      │  Properties   │
│          │       (Graph View)                    │    Panel      │
│ - Tasks  │                                       │               │
│ - Params │    ┌─────┐      ┌─────┐               │  - Node name  │
│          │    │ Var │─────►│Step │               │  - Inputs     │
│          │    └─────┘      └──┬──┘               │  - Outputs    │
│          │                    │                  │  - Args       │
│          │    ┌─────┐      ┌──▼──┐               │               │
│          │    │ Var │◄─────│Step │               │               │
│          │    └─────┘      └─────┘               │               │
│          │                                       │               │
├──────────┴───────────────────────────────────────┴───────────────┤
│ Terminal Panel (collapsible)                                     │
│ $ Running extract_gaze...                                        │
│ [SUCCESS] extract_gaze                                           │
└──────────────────────────────────────────────────────────────────┘
```

## Panels

### Sidebar (Left)

- **Add Variable** — Create new data nodes
- **Available Tasks** — Click to add to canvas
- **Parameters** — Add/edit configuration values

### Canvas (Center)

- Visual graph of your pipeline
- Drag nodes to arrange
- Connect steps to variables by dragging from handles
- Multi-select with Shift+click or drag box
- Mini-map in corner for navigation

### Properties Panel (Right)

- Edit selected node properties
- **For steps:** name, task, inputs, outputs, args
- **For variables:** name, file path
- Run/Cancel buttons for individual steps
- Shows available variable/parameter references

### Terminal Panel (Bottom)

- Collapsible output panel
- Live streaming execution output
- Per-step output tabs when running parallel
- ANSI color support

## Node Types

### Variable Nodes

Represent file paths:

- **Green** = file exists on disk
- **Grey** = file doesn't exist yet

### Step Nodes

Represent Python tasks:

- **Solid border** = regular step
- **Dashed border** = optional step
- Shows execution state (idle, running, completed, failed)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Ctrl + Y` | Redo (Windows) |
| `Cmd/Ctrl + S` | Save |
| `Cmd/Ctrl + C` | Copy selected nodes |
| `Cmd/Ctrl + V` | Paste nodes |
| `Delete / Backspace` | Delete selected |

## Running Pipelines

### Run Controls (Toolbar)

- **Run All** — Execute entire pipeline
- **Stop** — Cancel running execution

### Run from Properties Panel

Select a step to access:

- **Run Step** — Execute just this step
- **Run From Here** — Execute this step and all downstream

### Execution States

| State | Indicator |
|-------|-----------|
| Idle | Default appearance |
| Running | Animated border |
| Completed | Green checkmark |
| Failed | Red indicator |

## Workspace Mode

Open a directory to browse multiple pipelines:

```bash
loom-ui experiments/
```

Features:

- Pipeline browser in sidebar
- Double-click to switch pipelines
- Prompts to save unsaved changes before switching

## Connections

### Creating Connections

1. Hover over a node handle (small circle)
2. Drag to another node's handle
3. Release to create connection

### Connection Rules

| From | To | Valid? |
|------|----|--------|
| Variable → Step input | Yes | Main data flow |
| Step output → Variable | Yes | Step produces data |
| Parameter → Step arg | Yes | Config value |
| Variable → Variable | No | Not allowed |

### Type Validation

When tasks have typed inputs/outputs, the editor validates that connected types match.

## Saving

- **Auto-save** is disabled by default
- **Unsaved changes** shown with `*` in title
- **Cmd/Ctrl + S** to save manually
- Prompted to save when switching pipelines or closing

## Tips

- **Drag from handles** to create connections
- **Double-click** variables to edit paths inline
- **Shift+click** to multi-select nodes
- **Delete key** removes selected nodes/connections
- **Mini-map** helps navigate large pipelines

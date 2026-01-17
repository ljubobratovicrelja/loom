# Loom Tools Documentation

Complete reference for Loom's two tools:

- **loom** — CLI for executing pipelines (CI/CD, batch runs, automation)
- **loom-ui** — Visual editor for building and running pipelines interactively

Both tools work with the same YAML pipeline format. No external services required.

> **New to Loom?** Start with the [README](../README.md) for a quick overview, or the [Pipeline Authoring Guide](PIPELINE_AUTHORING.md) for a hands-on tutorial.

## Table of Contents

- [Overview](#overview)
- [loom](#loom)
  - [Installation](#installation)
  - [CLI Reference](#cli-reference)
  - [Pipeline Configuration](#pipeline-configuration)
  - [Architecture](#runner-architecture)
- [loom-ui](#loom-ui)
  - [Getting Started](#getting-started)
  - [User Interface](#user-interface)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Task Schema Format](#task-schema-format)
  - [Frontend Architecture](#frontend-architecture)
  - [Backend Architecture](#backend-architecture)
  - [API Reference](#api-reference)
  - [WebSocket Protocol](#websocket-protocol)
- [Related Documentation](#related-documentation)

---

## Overview

```
┌─────────────────┐      ┌─────────────────┐
│   loom-ui   │      │   loom   │
│  (Visual UI)    │      │     (CLI)       │
└────────┬────────┘      └────────┬────────┘
         │                        │
         │    ┌───────────┐       │
         └───►│  YAML     │◄──────┘
              │  Config   │
              └───────────┘
                    │
                    ▼
              ┌───────────┐
              │   Tasks   │
              │ (Python)  │
              └───────────┘
```

Both tools operate on the same YAML configuration:

- **loom-ui**: Visual graph editor with real-time execution — for designing and debugging pipelines
- **loom**: Headless CLI executor — for batch runs and automation

---

## loom

### Installation

```bash
# Core runner only
pip install loom-pipeline

# With editor
pip install loom-pipeline[ui]

# Development
pip install loom-pipeline[dev]
```

### CLI Reference

```bash
# Run full pipeline
loom pipeline.yml

# Preview commands without executing
loom pipeline.yml --dry-run

# Run specific steps
loom pipeline.yml --step extract classify

# Run from a step onward (includes all subsequent steps)
loom pipeline.yml --from classify

# Include optional steps
loom pipeline.yml --include debug_visualize

# Override parameters
loom pipeline.yml --set backend=local threshold=25.0

# Override variables
loom pipeline.yml --var video=other.mp4

# Pass extra arguments to a step
loom pipeline.yml --step extract --extra "--debug --verbose"
```

### Pipeline Configuration

```yaml
# Variables: file paths and data locations
variables:
  input_video: data/raw/video.mp4
  gaze_data: data/raw/gaze_positions.csv
  output_dir: data/processed/

# Parameters: runtime configuration values
parameters:
  backend: local
  threshold: 50.0
  model: gpt-4

# Pipeline: ordered list of processing steps
pipeline:
  - name: extract_gaze
    task: tasks/extract_gaze.py
    inputs:
      video: $input_video
      gaze: $gaze_data
    outputs:
      -o: $output_dir
    args:
      --threshold: $threshold
      --verbose: true

  - name: visualize
    task: tasks/visualize.py
    inputs:
      data: $output_dir
    optional: true  # Skipped unless --include visualize
```

**Key concepts:**
- **Variables**: File paths, prefixed with `$` when referenced
- **Parameters**: Configuration values, also `$`-prefixed when referenced
- **Steps**: Each has a name, task script, inputs/outputs, and optional args
- **Optional steps**: Skipped by default, included with `--include`

See [Pipeline Authoring Guide](PIPELINE_AUTHORING.md) for the full schema reference.

### Runner Architecture

```
src/loom/runner/
├── cli.py          # Entry point, argument parsing
├── config.py       # PipelineConfig, StepConfig dataclasses
└── executor.py     # PipelineExecutor, command building
```

**config.py** - Configuration parsing:
- `PipelineConfig.from_yaml(path)` - Load and parse YAML
- `resolve_value(value)` - Resolve `$references` to actual values
- `get_step_dependencies(step)` - Trace step dependencies

**executor.py** - Execution engine:
- `build_command(step)` - Build shell command from step config
- `run_step(step)` - Execute single step via subprocess
- `run_pipeline(...)` - Execute multiple steps with dependency tracking

---

## loom-ui

### Getting Started

```bash
# Build frontend (first time only)
cd src/loom/ui/frontend
npm install
npm run build
cd ../../../..

# Open existing pipeline
loom-ui pipeline.yml

# Browse pipelines in a directory (workspace mode)
loom-ui experiments/

# Create new pipeline
loom-ui --new

# Custom port/host
loom-ui pipeline.yml --port 8080 --host 0.0.0.0

# Headless mode (no browser auto-open)
loom-ui pipeline.yml --no-browser
```

**Workspace Mode:** Point loom-ui at a directory to browse all pipelines within it. A pipeline browser appears in the sidebar, letting you switch between pipelines with a double-click. Unsaved changes prompt you to save before switching.

### User Interface

```
┌──────────────────────────────────────────────────────────────────┐
│ Toolbar: [Logo] path/to/config.yml*  [Run Controls] [Save] etc. │
├──────────┬───────────────────────────────────────┬───────────────┤
│          │                                       │               │
│ Sidebar  │           Canvas                      │  Properties   │
│          │       (React Flow)                    │    Panel      │
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

**Sidebar (Left)**
- Add Variable button
- Available tasks (click to add to canvas)
- Parameters section (add/edit runtime config)

**Canvas (Center)**
- Visual graph of pipeline
- Drag nodes to arrange
- Connect steps to variables
- Multi-select with Shift+click or drag box
- Mini-map in corner

**Properties Panel (Right)**
- Edit selected node properties
- For steps: name, task, inputs, outputs, args
- For variables: name, file path
- Run/Cancel buttons for individual steps
- Shows available variable/parameter references

**Terminal Panel (Bottom)**
- Collapsible output panel
- Live streaming execution output
- Per-step output tabs when running parallel
- ANSI color support

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Ctrl + Y` | Redo (Windows) |
| `Cmd/Ctrl + S` | Save |
| `Cmd/Ctrl + C` | Copy selected nodes |
| `Cmd/Ctrl + V` | Paste nodes |
| `Delete / Backspace` | Delete selected |

### Task Schema Format

Tasks define their interface via YAML frontmatter in docstrings:

```python
"""Extract gaze positions from video.

Detailed description of what this task does...

---
inputs:
  video:
    type: video
    description: Path to input video file
  gaze:
    type: csv
    description: Path to gaze positions CSV
outputs:
  -o:
    type: csv
    description: Output CSV file for results
args:
  --threshold:
    type: float
    default: 50.0
    description: Detection threshold in pixels
  --model:
    type: str
    choices: [gpt-4, gpt-3.5]
    description: Model to use for classification
  --verbose:
    type: bool
    description: Enable verbose output
---
"""
```

**Input/Output types** (optional, enables connection validation):
`video`, `image`, `csv`, `json`, `image_directory`, `data_folder`

**Supported arg types:** `str`, `int`, `float`, `bool`

**Fields:**
- `type`: Data type (required for args; optional for inputs/outputs)
- `default`: Default value (optional)
- `description`: Help text shown in UI
- `choices`: List of valid options (optional)
- `required`: Whether arg must be provided (default: false)

See [Pipeline Authoring Guide](PIPELINE_AUTHORING.md#task-script-requirements) for full details.

---

## Frontend Architecture

### Technology Stack

- **React 18** - UI framework
- **@xyflow/react** - Node graph visualization
- **@xterm/xterm** - Terminal emulator
- **@dagrejs/dagre** - Automatic graph layout
- **Tailwind CSS** - Styling
- **Vite** - Build tool
- **Vitest** - Testing

### File Structure

```
src/loom/ui/frontend/
├── src/
│   ├── main.tsx              # React DOM entry
│   ├── App.tsx               # Root component (~760 lines)
│   ├── index.css             # Global styles
│   │
│   ├── types/
│   │   └── pipeline.ts       # TypeScript interfaces
│   │
│   ├── hooks/
│   │   ├── useApi.ts         # Backend API communication
│   │   ├── useHistory.ts     # Undo/redo state management
│   │   ├── useTerminal.ts    # Terminal + WebSocket
│   │   └── useStepExecutions.ts  # Per-step execution
│   │
│   ├── components/
│   │   ├── Canvas.tsx        # React Flow wrapper
│   │   ├── StepNode.tsx      # Step node renderer
│   │   ├── VariableNode.tsx  # Variable node renderer
│   │   ├── Toolbar.tsx       # Top bar controls
│   │   ├── Sidebar.tsx       # Left panel
│   │   ├── PropertiesPanel.tsx   # Right panel
│   │   ├── TerminalPanel.tsx     # Bottom terminal
│   │   ├── RunControls.tsx   # Execution buttons
│   │   └── ConfirmDialog.tsx # Save confirmation modal
│   │
│   └── utils/
│       └── layout.ts         # Dagre layout algorithm
│
├── package.json
├── vite.config.ts
├── vitest.config.ts
└── tailwind.config.js
```

### Key Types

```typescript
// Step execution visual state
type StepExecutionState = 'idle' | 'running' | 'completed' | 'failed'

// Step node data
interface StepData {
  name: string
  task: string                     // Path to task file
  inputs: Record<string, string>   // input_name -> "$var_ref"
  outputs: Record<string, string>  // flag -> "$var_ref"
  args: Record<string, unknown>    // --arg -> value
  optional: boolean
  executionState?: StepExecutionState
}

// Variable node data
interface VariableData {
  name: string
  value: string      // File path
  exists?: boolean   // File exists on disk (for UI coloring)
}

// Execution modes
type RunMode = 'step' | 'from_step' | 'to_variable' | 'all' | 'parallel'
```

### State Management

**App.tsx** manages global state:

```typescript
// Graph state (React Flow)
const [nodes, setNodes] = useNodesState([])
const [edges, setEdges] = useEdgesState([])
const [parameters, setParameters] = useState({})

// Change tracking
const [hasChanges, setHasChanges] = useState(false)

// Save confirmation
const [showSaveDialog, setShowSaveDialog] = useState(false)
const [skipSaveConfirmation, setSkipSaveConfirmation] = useState(false)

// Execution
const [executionStatus, setExecutionStatus] = useState('idle')
const [runRequest, setRunRequest] = useState(null)
```

### Hooks

**useHistory** - Undo/redo with snapshot-based state:
```typescript
const { snapshot, undo, redo, clear, canUndo, canRedo } = useHistory({
  maxHistory: 50,
  onRestore: (state) => { /* restore nodes, edges, parameters */ }
})

// Snapshot before changes
snapshot({ nodes, edges, parameters })

// Debounced snapshot for typing (300ms trailing)
debouncedSnapshot({ nodes, edges, parameters })

// Undo/redo pass current state to preserve it
undo(getCurrentState())
redo(getCurrentState())
```

**useApi** - Backend communication:
```typescript
const { loadConfig, saveConfig, loadTasks, loadVariablesStatus } = useApi()

const graph = await loadConfig('/path/to/config.yml')
await saveConfig(graph, '/path/to/config.yml')
const tasks = await loadTasks()
const status = await loadVariablesStatus()  // {varName: exists}
```

**useTerminal** - WebSocket execution:
```typescript
const { run, cancel, cancelStep, terminalRef } = useTerminal({
  onStatusChange: (status) => { /* 'running' | 'completed' | 'failed' */ },
  onStepStatusChange: (stepName, status) => { /* per-step status */ }
})

run({ mode: 'step', step_name: 'extract_gaze' })
cancel()  // Cancel all
cancelStep('extract_gaze')  // Cancel specific step
```

**useStepExecutions** - Independent per-step execution:
```typescript
const { runStep, cancelStep, getStepStatus, stepStatuses } = useStepExecutions({
  onStepStatusChange: (stepName, status) => { /* ... */ },
  onStepOutput: (stepName, output) => { /* ... */ }
})

runStep('extract_gaze')  // Runs independently, can have multiple concurrent
cancelStep('extract_gaze')
const status = getStepStatus('extract_gaze')  // 'idle' | 'running' | ...
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **App.tsx** | Global state, change tracking, history, keyboard shortcuts, execution orchestration |
| **Canvas.tsx** | React Flow graph, copy/paste, drag handling, edge connections |
| **StepNode.tsx** | Step visualization with status colors, input/output handles |
| **VariableNode.tsx** | Variable visualization with existence indicator |
| **Toolbar.tsx** | Top controls: run buttons, undo/redo, save, auto-save toggle |
| **Sidebar.tsx** | Task list, add variable, parameters editor |
| **PropertiesPanel.tsx** | Selected node editing, available references, step execution |
| **TerminalPanel.tsx** | Execution output, per-step tabs, ANSI color rendering |
| **ConfirmDialog.tsx** | Save confirmation modal |

### Important Patterns

**Change Detection:**
```
Edit → setNodes/setEdges → useEffect detects change → setHasChanges(true)
Save → skipChangeTrackingRef++ → prevent false positive → setHasChanges(false)
```

**History Debouncing:**
```
Typing → debouncedSnapshot (300ms trailing) → captures final state only
Drag → snapshot at start → ignore during drag → no action at end
Delete/Connect → immediate snapshot
```

**Variable Status:**
```
Load → loadVariablesStatus() → update node.data.exists
Step complete → 200ms delay → refreshVariableStatus()
Visual: green (exists), grey (missing), indigo (unknown)
```

---

## Backend Architecture

### File Structure

```
src/loom/ui/
├── cli.py           # Entry point: loom-ui command
├── server.py        # FastAPI server (~1150 lines)
├── execution.py     # Bridges to runner module
├── task_schema.py   # Parse task docstrings
└── frontend/        # React app (see above)
```

### Server Components

**cli.py** - Entry point:
```python
def main():
    # Parse args: config_path, --new, --port, --host, --no-browser, --tasks-dir
    configure(config_path, tasks_dir)  # Set global state
    # Auto-open browser unless --no-browser
    uvicorn.run(app, host=host, port=port)
```

**server.py** - FastAPI application:

Global state:
```python
_config_path: str | None    # Current config file
_tasks_dir: str | None      # Tasks directory
_running_steps: dict        # {step_name: {pid, master_fd, status}}
```

Key functions:
```python
def yaml_to_graph(yaml_data) -> PipelineGraph
    # Convert YAML to React Flow nodes/edges

def graph_to_yaml(graph) -> dict
    # Convert React Flow back to YAML structure

def _update_yaml_from_graph(yaml_data, graph)
    # Preserve YAML comments while updating content
```

**execution.py** - Runner bridge:
```python
def build_step_command(step_name) -> list[str]
def build_pipeline_commands(mode, step_name, variable_name) -> list[tuple[str, list[str]]]
def build_parallel_commands(step_names) -> list[tuple[str, list[str]]]
def validate_parallel_execution(step_names) -> tuple[bool, str]  # Check for output conflicts
```

**task_schema.py** - Schema parsing:
```python
def parse_task_schema(path) -> TaskSchema | None
def list_task_schemas(directory) -> list[TaskSchema]
def extract_docstring(source) -> str | None  # AST-based
def parse_frontmatter(docstring) -> dict | None  # YAML extraction
```

---

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/config` | GET | Load pipeline as graph |
| `POST /api/config` | POST | Save graph to YAML |
| `GET /api/tasks` | GET | List available tasks with schemas |
| `GET /api/state` | GET | Get editor state (configPath, tasksDir, workspaceDir, isWorkspaceMode) |
| `GET /api/variables/status` | GET | Check which variable files exist |
| `DELETE /api/variables/{name}/data` | DELETE | Move variable data to trash |
| `GET /api/pipelines` | GET | List pipelines in workspace (workspace mode only) |
| `POST /api/pipelines/open` | POST | Switch to a different pipeline |

### Request/Response Examples

**Load Config:**
```
GET /api/config?path=/path/to/config.yml

Response:
{
  "variables": {"input_video": "data/video.mp4"},
  "parameters": {"threshold": 50.0},
  "nodes": [
    {"id": "var_1", "type": "variable", "position": {"x": 0, "y": 0}, "data": {...}},
    {"id": "step_1", "type": "step", "position": {"x": 200, "y": 0}, "data": {...}}
  ],
  "edges": [
    {"id": "e1", "source": "var_1", "target": "step_1", "sourceHandle": "output", "targetHandle": "input_video"}
  ]
}
```

**Save Config:**
```
POST /api/config?path=/path/to/config.yml
Content-Type: application/json

{
  "variables": {...},
  "parameters": {...},
  "nodes": [...],
  "edges": [...]
}

Response:
{"status": "saved", "path": "/path/to/config.yml"}
```

---

## WebSocket Protocol

### Connection

```
WebSocket: ws://localhost:8000/ws/terminal
```

### Client → Server Messages

**Run Request:**
```json
{
  "mode": "step|from_step|to_variable|all|parallel",
  "step_name": "extract_gaze",
  "variable_name": "output_data",
  "step_names": ["step1", "step2"]
}
```

**Cancel:**
```
"__CANCEL__"           // Cancel all
"__CANCEL__:step_name" // Cancel specific step
```

### Server → Client Messages

**Binary:** Raw PTY output (terminal content)

**Text (JSON):** Status updates
```json
{"type": "step_status", "step": "extract_gaze", "status": "running|completed|failed"}
{"type": "status", "status": "running|completed|failed|cancelled"}
{"type": "error", "message": "..."}
```

**Text (Plain):** Legacy status markers
```
[RUNNING] step_name
[SUCCESS] step_name
[FAILED] step_name
```

**Parallel Mode:** Output prefixed with step name
```
[OUTPUT:step1]Processing frame 1...
[OUTPUT:step2]Loading model...
```

---

## Development

### Frontend Development

```bash
cd src/loom/ui/frontend

# Install dependencies
npm install

# Development server (hot reload)
npm run dev

# Production build
npm run build

# Run tests
npm test

# Run tests once
npm run test:run
```

### Adding a New Component

1. Create component in `src/components/`
2. Add types to `src/types/pipeline.ts` if needed
3. Import and use in parent component
4. Add tests in same directory or `src/hooks/*.test.ts`

### Testing

```bash
# Run all tests with watch
npm test

# Run once
npm run test:run

# Test specific file
npm test -- useHistory.test.ts
```

Test utilities:
```typescript
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
```

---

## Related Documentation

- [Pipeline Authoring Guide](PIPELINE_AUTHORING.md) — YAML schema, task scripts, examples

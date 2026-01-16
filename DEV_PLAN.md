# Development Plan

Notes for future development. This is a living document — update as things get done or priorities change.

---

## 1. Naming

**Problem**: "Loom" collides with the popular screen recording tool (loom.com). This will cause confusion in search results and could be a trademark issue.

**Options to consider**:
- `pipelab` — suggests experimentation + pipelines
- `flowbench` — flow/graph + research bench
- `labflow` — lab/research + flow
- `runnel` — a small stream/channel (evokes data flow)
- `plumb` — connecting pipes, simple
- `taskgraph` — literal but clear
- Keep `loom` if the overlap isn't a real problem (different domains)

**Action**: Before open sourcing, search PyPI and GitHub for collisions. Pick a name that's:
- Available on PyPI
- Not trademarked in dev tools space
- Short and memorable

**When renaming**: Update package name in `pyproject.toml`, CLI entry points (`loom-runner` → `newname-runner`), all docs, and imports.

---

## 2. Code Structure

### server.py is too large (1735 lines)

This file handles:
- FastAPI app setup
- YAML ↔ graph conversion
- REST API endpoints
- WebSocket terminal streaming
- Process management for running steps
- Validation logic

**Suggested refactor**:

```
src/loom/editor/
├── server.py           # FastAPI app, route registration only (~100 lines)
├── api/
│   ├── config.py       # /api/config endpoints
│   ├── tasks.py        # /api/tasks endpoints
│   ├── variables.py    # /api/variables endpoints
│   ├── execution.py    # /api/run endpoints
│   └── websocket.py    # /ws/terminal handler
├── conversion/
│   ├── yaml_to_graph.py
│   └── graph_to_yaml.py
├── process/
│   └── manager.py      # Running step tracking, PTY management
└── validation.py       # Pipeline validation logic
```

**Priority**: Medium. The current structure works, but makes it hard to:
- Test individual components
- Understand the codebase quickly
- Add new features without touching unrelated code

### App.tsx is large (~760 lines)

Similar issue on the frontend. Consider extracting:
- Global state into a context or zustand store
- Keyboard shortcut handling into a hook
- Execution orchestration into a separate module

**Priority**: Low. React components are somewhat self-contained already.

---

## 3. Testing

### Current state

5 test files exist:
- `test_runner_cli.py`
- `test_runner_config.py`
- `test_runner_executor.py`
- `test_editor_server.py`
- `test_editor_execution.py`

### Gaps to address

**Backend**:
- [ ] Test YAML ↔ graph conversion round-trips (critical for data integrity)
- [ ] Test WebSocket terminal streaming
- [ ] Test process cancellation
- [ ] Test parallel execution with output conflicts
- [ ] Test edge cases: empty pipelines, circular references, missing files

**Frontend**:
- [ ] Test useHistory hook (undo/redo logic)
- [ ] Test useTerminal hook (WebSocket handling)
- [ ] Test copy/paste behavior
- [ ] Integration tests with Playwright or Cypress (lower priority)

**Priority**: High for backend conversion tests (data loss risk). Medium for the rest.

### Test commands

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src/loom --cov-report=html

# Run specific test file
pytest tests/test_runner_config.py -v
```

---

## 4. Documentation & Examples

### For open source adoption

**Examples directory** (create `examples/`):
- [ ] `simple_linear/` — A → B → C pipeline, minimal
- [ ] `parameter_sweep/` — Same pipeline with parameter variations
- [ ] `diamond/` — Multiple inputs merging (A → B, A → C, B+C → D)
- [ ] `real_world/` — A realistic ML pipeline (data prep → train → eval)

Each example should have:
- `README.md` explaining what it demonstrates
- `pipeline.yml` config
- Simple Python scripts (can be stubs that just echo inputs)
- Sample input data (small, committed to repo)

**Screenshots/GIFs for README**:
- [ ] Screenshot of editor with a pipeline loaded
- [ ] GIF showing drag-and-drop node creation
- [ ] GIF showing execution with terminal output

**Priority**: High. People won't try a tool they can't understand in 30 seconds.

### For contributors

- [ ] `CONTRIBUTING.md` — How to set up dev environment, run tests, submit PRs
- [ ] Architecture overview in docs (or expand TOOLS.md backend section)
- [ ] Code style guide (or just "run ruff")

---

## 5. Nice-to-Haves (Post-Launch)

Things that would be cool but aren't blockers:

- **Dark mode** for the editor
- **Export pipeline as shell script** — for environments where Loom isn't installed
- **Step timing** — show how long each step took
- **Output preview** — click a variable to see file contents (if CSV/JSON/image)
- **Templates** — starter pipelines for common patterns
- **Plugin system** — custom node types beyond Python scripts

---

## 6. Pre-Release Checklist

Before announcing/open-sourcing:

- [ ] Decide on final name
- [ ] Update all references to new name
- [ ] Create examples directory with 2-3 working examples
- [ ] Add screenshot to README
- [ ] Write CONTRIBUTING.md
- [ ] Test `pip install` from clean virtualenv
- [ ] Test on macOS, Linux (Windows is stretch goal)
- [ ] Set up GitHub Actions for CI (pytest + ruff)
- [ ] Choose a license (currently MIT, confirm this is intended)
- [ ] Create GitHub release with changelog

---

## Notes

*This section is for random thoughts and observations.*

The core value proposition is clear: visual pipeline runner for research, no infrastructure. Keep this focus. Resist adding features that push toward "enterprise" territory — that's not the audience.

The docstring schema discovery is a nice touch. It means users don't have to learn a new way to define tasks. Consider documenting this more prominently as a differentiator.

The YAML format is simple and readable. Don't add complexity to it unless absolutely necessary.

---

*Last updated: January 2025*

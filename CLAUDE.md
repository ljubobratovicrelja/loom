# Claude Code Instructions

## Project Overview

Loom is a lightweight visual pipeline runner for research:
- **loom**: CLI for executing pipelines
- **loom-ui**: Browser-based visual editor (Python backend + React frontend)

## Development Standards

IMPORTANT: before starting a coding undertaking, read [DEVELOPMENT.md](DEVELOPMENT.md) for complete development
guidelines including:
- Project structure
- Python and TypeScript code standards
- Testing requirements

## Workflow

1. **Before implementing**: Read relevant docs and existing code, and reminder - always read the [DEVELOPMENT.md](DEVELOPMENT.md) file.
2. **After changes**: Run `./scripts/format.sh` to auto-format, then `./scripts/lint.sh` to verify.
3. **After implementing**: Run `./scripts/test.sh`
4. **After editing examples**: Run `./scripts/run-examples.sh`
5. **Before committing**: Run `./scripts/check.sh`

## Code Formatting

- **Python**: formatted by `ruff format` (config in `pyproject.toml`).
- **TypeScript / TSX / CSS / JSON / Markdown** (frontend): formatted by Prettier (config in `src/loom/ui/frontend/.prettierrc.json`).
- `./scripts/format.sh` runs both. `./scripts/lint.sh` enforces them via `ruff format --check` and `prettier --check` — CI/pre-commit will fail on unformatted code, so always run the formatter before pushing.

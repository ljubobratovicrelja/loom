# Claude Code Instructions

## Project Overview

Loom is a lightweight visual pipeline runner for research:
- **loom**: CLI for executing pipelines
- **loom-ui**: Browser-based visual editor (Python backend + React frontend)

## Development Standards

See [DEVELOPMENT.md](DEVELOPMENT.md) for complete development guidelines including:
- Project structure
- Python and TypeScript code standards
- Testing requirements

## Quick Commands

```bash
./scripts/check.sh              # Run all checks before committing
./scripts/lint.sh               # Lint Python + Frontend
./scripts/test.sh               # Test Python + Frontend
./scripts/test.sh --coverage    # Tests with coverage
./scripts/build.sh              # Build frontend
./scripts/run-examples.sh       # Run all example pipelines
```

## Workflow

1. **Before implementing**: Read relevant docs and existing code
2. **After changes**: Run `./scripts/lint.sh`
3. **After implementing**: Run `./scripts/test.sh`
4. **After editing examples**: Run `./scripts/run-examples.sh`
5. **Before committing**: Run `./scripts/check.sh`

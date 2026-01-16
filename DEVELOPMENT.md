# Development Guide

## Quick Start

```bash
# Setup Python environment
python -m venv venv
source venv/bin/activate
pip install -e ".[dev]"

# Setup frontend
cd src/loom/editor/frontend
npm install
cd ../../../..

# Verify everything works
./scripts/check.sh
```

## Scripts

| Script | Description |
|--------|-------------|
| `./scripts/check.sh` | Run all checks (lint + test) before committing |
| `./scripts/lint.sh` | Run all linting (Python + Frontend) |
| `./scripts/test.sh` | Run all tests (Python + Frontend) |
| `./scripts/test.sh --coverage` | Run tests with coverage report |
| `./scripts/build.sh` | Build frontend for production |

## Project Structure

```
src/loom/
├── runner/          # CLI pipeline executor
└── editor/
    ├── server/      # FastAPI backend
    └── frontend/    # React/TypeScript app
tests/               # Python tests (pytest)
scripts/             # Developer scripts
docs/                # Documentation
```

---

## Python

### Additional Commands

Beyond `./scripts/lint.sh` and `./scripts/test.sh`:

```bash
pytest tests/test_<module>.py -v    # Run single test file
ruff check --fix src/               # Auto-fix lint issues
```

### Code Standards

- PEP 8, max line length 100
- Type hints for all function signatures
- Google-style docstrings for public APIs
- No wildcard imports

**Naming:** `PascalCase` for classes, `snake_case` for functions/variables, `UPPER_SNAKE_CASE` for constants, `_prefix` for private.

**Imports:** Sorted by ruff. Group: stdlib → third-party → local. Absolute imports cross-module, relative within package.

**Testing:** Tests in `tests/` mirroring `src/` structure. Use pytest fixtures, mock external dependencies. Aim for >80% coverage on new code.

---

## Frontend

Located in `src/loom/editor/frontend/`

### Additional Commands

Beyond `./scripts/lint.sh` and `./scripts/test.sh`:

```bash
npm run dev          # Dev server with hot reload
npm run lint:fix     # Auto-fix lint issues
```

### Code Standards

- TypeScript strict mode
- Functional React components with hooks
- Tailwind CSS for styling

**Naming:** `PascalCase.tsx` for components, `use<Name>.ts` for hooks, `camelCase.ts` for utils.

**Testing:** Tests co-located with source as `<name>.test.ts`. Use Vitest + React Testing Library.

---

## Workflow

1. **Before implementing**: Read relevant docs and existing code
2. **After changes**: Run `./scripts/lint.sh`
3. **After implementing**: Run `./scripts/test.sh`
4. **Before committing**: Run `./scripts/check.sh`

# Installation

## Requirements

- **Python 3.11+**
- **Node.js 20+** (only for development/building from source)

## Install from PyPI

```bash
# Core runner only
pip install loom-pipeline

# With visual editor
pip install loom-pipeline[ui]
```

That's it. No configuration files to create, no external services to manage.

## Verify Installation

```bash
# Check CLI is available
loom --help

# Check UI is available (if installed with [ui])
loom-ui --help
```

## Development Installation

For contributing to Loom or running from source:

```bash
git clone https://github.com/ljubobratovicrelja/loom.git
cd loom
pip install -e ".[dev]"

# Build frontend (requires Node.js 18+)
cd src/loom/ui/frontend
npm install && npm run build
```

## Next Steps

- [Your First Pipeline](first-pipeline.md) — Run an example pipeline

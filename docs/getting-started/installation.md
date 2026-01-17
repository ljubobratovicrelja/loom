# Installation

## Requirements

- **Python 3.9+**
- **Node.js 18+** (only required if using the visual editor)

## Install from PyPI

```bash
# Core runner only
pip install loom-pipeline

# With visual editor
pip install loom-pipeline[ui]
```

That's it. No services to start, no configuration files to create.

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
git clone https://github.com/relja/loom.git
cd loom
pip install -e ".[dev]"

# Build frontend (requires Node.js 18+)
cd src/loom/ui/frontend
npm install && npm run build
```

## Next Steps

- [Your First Pipeline](first-pipeline.md) — Run an example pipeline

#!/bin/bash
# Run all linting (Python + Frontend)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$ROOT_DIR/src/loom/ui/frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Linting Python ===${NC}"

cd "$ROOT_DIR"

# Activate venv if not already active
if [ -z "$VIRTUAL_ENV" ]; then
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    else
        echo -e "${RED}Error: venv not found. Run: python -m venv venv && pip install -e '.[dev]'${NC}"
        exit 1
    fi
fi

echo "Running ruff format --check..."
ruff format --check src/

echo "Running ruff check..."
ruff check src/

echo "Running mypy..."
mypy src/

echo -e "${GREEN}Python linting passed!${NC}"

echo ""
echo -e "${BLUE}=== Linting Frontend ===${NC}"

cd "$FRONTEND_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

echo "Running ESLint..."
npm run lint

echo -e "${GREEN}Frontend linting passed!${NC}"

echo ""
echo -e "${GREEN}=== All linting passed! ===${NC}"

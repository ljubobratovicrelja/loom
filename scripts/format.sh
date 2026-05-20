#!/bin/bash
# Auto-format all code (Python via ruff, TypeScript/CSS/JSON via prettier).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$ROOT_DIR/src/loom/ui/frontend"

# Load nvm if available (needed for Node.js >= 18)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    source "$NVM_DIR/nvm.sh"
    nvm use 20 --silent 2>/dev/null || true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Formatting Python ===${NC}"

cd "$ROOT_DIR"

if [ -z "$VIRTUAL_ENV" ]; then
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    else
        echo -e "${RED}Error: venv not found. Run: python -m venv venv && pip install -e '.[dev]'${NC}"
        exit 1
    fi
fi

ruff format src/ tests/ examples/

echo -e "${GREEN}Python formatting done!${NC}"

echo ""
echo -e "${BLUE}=== Formatting Frontend ===${NC}"

cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

npm run format

echo -e "${GREEN}Frontend formatting done!${NC}"

echo ""
echo -e "${GREEN}=== All formatting done! ===${NC}"

#!/bin/bash
# Run all tests (Python + Frontend)
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

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
COVERAGE=false
VERBOSE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --coverage|-c)
            COVERAGE=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--coverage|-c] [--verbose|-v]"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}=== Running Python Tests ===${NC}"

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

PYTEST_ARGS=""
if [ "$COVERAGE" = true ]; then
    PYTEST_ARGS="--cov=src --cov-report=term-missing"
fi
if [ "$VERBOSE" = true ]; then
    PYTEST_ARGS="$PYTEST_ARGS -v"
fi

pytest $PYTEST_ARGS

echo -e "${GREEN}Python tests passed!${NC}"

echo ""
echo -e "${BLUE}=== Running Frontend Tests ===${NC}"

cd "$FRONTEND_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

if [ "$COVERAGE" = true ]; then
    npm run test:run -- --coverage
else
    npm run test:run
fi

echo -e "${GREEN}Frontend tests passed!${NC}"

echo ""
echo -e "${GREEN}=== All tests passed! ===${NC}"

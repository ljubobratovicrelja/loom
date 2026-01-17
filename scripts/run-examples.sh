#!/bin/bash
# Run all example pipelines to verify they work
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
EXAMPLES_DIR="$ROOT_DIR/examples"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Running Example Pipelines ===${NC}"

cd "$ROOT_DIR"

# Check if loom is available, otherwise try to activate venv
if ! command -v loom &> /dev/null; then
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    else
        echo -e "${RED}Error: loom not found. Run: python -m venv venv && pip install -e '.[dev]'${NC}"
        exit 1
    fi
fi

# Find and run each example pipeline
FAILED=0
PASSED=0

for pipeline in "$EXAMPLES_DIR"/*/pipeline.yml; do
    example_dir=$(dirname "$pipeline")
    example_name=$(basename "$example_dir")

    echo ""
    echo -e "${BLUE}--- Running: $example_name ---${NC}"

    cd "$example_dir"

    # Clean data before running to ensure fresh execution
    echo "Cleaning existing data..."
    loom pipeline.yml --clean -y 2>/dev/null || true

    if loom pipeline.yml; then
        echo -e "${GREEN}$example_name: passed${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}$example_name: FAILED${NC}"
        FAILED=$((FAILED + 1))
    fi
    cd "$ROOT_DIR"
done

echo ""
echo -e "${BLUE}=== Results ===${NC}"
echo -e "${GREEN}Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed: $FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}=== All example pipelines passed! ===${NC}"
fi

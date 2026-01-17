#!/bin/bash
# Run all checks before committing (lint + test)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Running all checks ===${NC}"
echo ""

"$SCRIPT_DIR/lint.sh"

echo ""

"$SCRIPT_DIR/test.sh"

echo ""
echo -e "${GREEN}=== All checks passed! Ready to commit. ===${NC}"

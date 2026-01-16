#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/../src/loom/ui/frontend"

# Load nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    source "$NVM_DIR/nvm.sh"

    # Install Node 20 if not available, then use it
    if ! nvm ls 20 &>/dev/null; then
        echo "Installing Node.js 20..."
        nvm install 20
    fi
    nvm use 20
fi

# Verify node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js >= 18 required (found v$NODE_VERSION)"
    echo "Install via nvm: nvm install 20"
    exit 1
fi

cd "$FRONTEND_DIR"

echo "Installing dependencies..."
npm install

echo "Building frontend..."
npm run build

echo "Build complete!"

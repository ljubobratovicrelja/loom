# Dockerfile for hosting the loom-ui examples demo
#
# This is NOT a general-purpose Dockerfile for loom. It's specifically
# designed to host a read-only demo of the examples directory.
#
# Build from the project root:
#   docker build -f examples/Dockerfile -t loom-examples .
#
# Run locally:
#   docker run -p 8080:8080 loom-examples
#
# Deploy to Railway/Render/Fly.io - see examples/DEPLOY.md

FROM python:3.11-slim

# Install Node.js for building the frontend
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the entire project (build context must be project root)
COPY . .

# Install loom with ui and examples dependencies
RUN pip install --no-cache-dir -e ".[ui,examples]"

# Build the frontend
WORKDIR /app/src/loom/ui/frontend
RUN npm ci && npm run build

# Back to app root
WORKDIR /app

# Expose port
EXPOSE 8080

# Run loom-ui in workspace mode on examples
CMD ["loom-ui", "examples/", "--host", "0.0.0.0", "--port", "8080"]

# Deploying the Loom Examples Demo

This guide explains how to deploy a live demo of loom-ui with the example pipelines.

## Quick Start (Local Docker)

From the **project root**:

```bash
docker build -f examples/Dockerfile -t loom-examples .
docker run -p 8080:8080 loom-examples
```

Open http://localhost:8080 to see the demo.

## Deploy to Render (Free)

Render's free tier spins down after 15 min of inactivity and cold-starts on request (~30-60s).

1. Push `render.yaml` to your GitHub repo
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your repo - Render auto-detects `render.yaml`
4. Deploy

Or manually create a Web Service and set:
- **Runtime**: Docker
- **Dockerfile Path**: `examples/Dockerfile`
- **Plan**: Free

## Deploy to Fly.io

1. Install flyctl: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. From project root:
   ```bash
   fly launch --dockerfile examples/Dockerfile
   ```

## Notes

- **Ephemeral storage**: Changes are lost on container restart (by design)
- **No persistence**: This is a playground, not production deployment
- **Port**: The app runs on port 8080 by default

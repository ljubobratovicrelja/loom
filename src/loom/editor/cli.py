"""CLI entry point for the pipeline editor."""

import argparse
import webbrowser
from pathlib import Path

import uvicorn


def main() -> int:
    """Launch the pipeline editor."""
    parser = argparse.ArgumentParser(
        description="Visual editor for YAML pipelines",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s pipeline.yml           # Edit existing pipeline
  %(prog)s --new                  # Create new pipeline
  %(prog)s pipeline.yml --port 8080  # Custom port
        """,
    )

    parser.add_argument(
        "config",
        nargs="?",
        type=Path,
        help="Path to pipeline YAML config (optional for new pipeline)",
    )
    parser.add_argument(
        "--new",
        action="store_true",
        help="Start with empty pipeline",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to run server on (default: 8000)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't open browser automatically",
    )
    parser.add_argument(
        "--tasks-dir",
        type=Path,
        default=None,
        help="Directory containing tasks (default: tasks/ relative to pipeline)",
    )

    args = parser.parse_args()

    # Validate args
    if not args.new and args.config and not args.config.exists():
        print(f"Config file not found: {args.config}")
        print("Use --new to create a new pipeline")
        return 1

    # Resolve tasks directory relative to pipeline file
    tasks_dir = args.tasks_dir
    if tasks_dir is None and args.config:
        # Default to tasks/ in the same directory as the pipeline
        tasks_dir = args.config.parent / "tasks"
    elif tasks_dir is None:
        # Fallback for --new without config
        tasks_dir = Path("tasks")

    # Configure server
    from .server import configure

    configure(config_path=args.config, tasks_dir=tasks_dir)

    # Open browser
    url = f"http://{args.host}:{args.port}"
    if not args.no_browser:
        print(f"Opening {url} in browser...")
        webbrowser.open(url)

    # Start server
    print(f"Starting editor at {url}")
    if args.config:
        print(f"Editing: {args.config}")
    else:
        print("Creating new pipeline")

    uvicorn.run(
        "loom.editor.server:app",
        host=args.host,
        port=args.port,
        log_level="warning",
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

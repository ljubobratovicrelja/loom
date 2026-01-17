#!/usr/bin/env python3
"""Pipeline runner CLI."""

import argparse
import sys
from pathlib import Path

from .clean import clean_pipeline_data, get_cleanable_paths
from .config import PipelineConfig
from .executor import PipelineExecutor, parse_key_value_args


def main() -> int:
    """Run the pipeline."""
    parser = argparse.ArgumentParser(
        description="Run pipelines defined in YAML",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s pipeline.yml                    # Run full pipeline
  %(prog)s pipeline.yml --step extract     # Run specific step
  %(prog)s pipeline.yml --from classify    # Run from step onward
  %(prog)s pipeline.yml --dry-run          # Preview commands
  %(prog)s pipeline.yml --set backend=local
  %(prog)s pipeline.yml --parallel         # Run with parallel execution
  %(prog)s pipeline.yml --parallel --max-workers 2
  %(prog)s pipeline.yml --clean            # Clean all data (move to trash)
  %(prog)s pipeline.yml --clean --permanent  # Permanently delete data
        """,
    )

    parser.add_argument("config", type=Path, help="Path to pipeline YAML config")

    # Step selection
    step_group = parser.add_mutually_exclusive_group()
    step_group.add_argument(
        "--step", nargs="+", metavar="NAME", help="Run only these specific steps"
    )
    step_group.add_argument(
        "--from", dest="from_step", metavar="NAME", help="Run from this step onward"
    )

    # Optional steps
    parser.add_argument("--include", nargs="+", metavar="NAME", help="Include these optional steps")

    # Overrides
    parser.add_argument(
        "--set",
        nargs="+",
        metavar="KEY=VALUE",
        help="Override parameters (e.g., --set backend=local model=Qwen)",
    )
    parser.add_argument(
        "--var",
        nargs="+",
        metavar="KEY=VALUE",
        help="Override variables (e.g., --var video=other.mp4)",
    )

    # Extra args for specific steps
    parser.add_argument(
        "--extra",
        metavar="ARGS",
        help="Extra arguments for the step (use with --step for single step)",
    )

    # Execution mode
    parser.add_argument("--dry-run", action="store_true", help="Print commands without executing")

    # Parallel execution
    parallel_group = parser.add_mutually_exclusive_group()
    parallel_group.add_argument(
        "--parallel",
        action="store_true",
        help="Enable parallel execution (overrides config)",
    )
    parallel_group.add_argument(
        "--sequential",
        action="store_true",
        help="Force sequential execution (overrides config)",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        metavar="N",
        help="Maximum number of parallel workers (default: CPU count)",
    )

    # Clean mode
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Clean all data node files (move to trash by default)",
    )
    parser.add_argument(
        "--clean-list",
        action="store_true",
        help="List all data files that would be cleaned (preview only)",
    )
    parser.add_argument(
        "--permanent",
        action="store_true",
        help="Permanently delete files instead of moving to trash (use with --clean)",
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Skip confirmation prompt (use with --clean)",
    )

    args = parser.parse_args()

    # Load config
    if not args.config.exists():
        print(f"Error: Config file not found: {args.config}", file=sys.stderr)
        return 1

    config = PipelineConfig.from_yaml(args.config)

    # Handle clean-list mode (preview only)
    if args.clean_list:
        return _handle_clean_list(config)

    # Handle clean mode
    if args.clean:
        return _handle_clean(config, permanent=args.permanent, skip_confirm=args.yes)

    # Apply overrides
    if args.set:
        config.override_parameters(parse_key_value_args(args.set))

    if args.var:
        config.override_variables(parse_key_value_args(args.var))

    # Apply parallel execution overrides
    if args.parallel:
        config.parallel = True
    elif args.sequential:
        config.parallel = False

    if args.max_workers is not None:
        config.max_workers = args.max_workers

    # Build extra args dict
    extra_args = {}
    if args.extra and args.step and len(args.step) == 1:
        extra_args[args.step[0]] = args.extra

    # Run pipeline
    executor = PipelineExecutor(config, dry_run=args.dry_run)
    results = executor.run_pipeline(
        steps=args.step,
        from_step=args.from_step,
        include_optional=args.include,
        extra_args=extra_args,
    )

    # Return non-zero if any step failed
    if not args.dry_run and results:
        failed = [name for name, success in results.items() if not success]
        if failed:
            return 1

    return 0


def _handle_clean_list(config: PipelineConfig) -> int:
    """List all data files that would be cleaned.

    Args:
        config: Pipeline configuration.

    Returns:
        Exit code (0 for success).
    """
    paths = get_cleanable_paths(config)

    # Separate existing and non-existing paths
    existing = [(name, path) for name, path, exists in paths if exists]
    missing = [(name, path) for name, path, exists in paths if not exists]

    if existing:
        print("Data files that would be cleaned:\n")
        for name, path in existing:
            print(f"  {name}: {path}")
        print(f"\nTotal: {len(existing)} file(s) exist")
    else:
        print("No data files to clean (all paths are missing).")

    if missing:
        print(f"\nMissing (would be skipped): {len(missing)} file(s)")

    return 0


def _handle_clean(config: PipelineConfig, permanent: bool, skip_confirm: bool) -> int:
    """Handle the --clean command.

    Args:
        config: Pipeline configuration.
        permanent: If True, permanently delete files.
        skip_confirm: If True, skip confirmation prompt.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    # Get list of paths that would be cleaned
    paths = get_cleanable_paths(config)

    # Filter to only existing paths for display
    existing_paths = [(name, path) for name, path, exists in paths if exists]

    if not existing_paths:
        print("No data files to clean.")
        return 0

    # Display files that will be cleaned
    action = "permanently deleted" if permanent else "moved to trash"
    print(f"\nThe following files will be {action}:\n")
    for name, path in existing_paths:
        print(f"  {name}: {path}")
    print()

    # Prompt for confirmation unless skipped
    if not skip_confirm:
        prompt = "These files will be moved to trash. Continue? [y/N] "
        if permanent:
            prompt = "These files will be PERMANENTLY DELETED. Continue? [y/N] "
        response = input(prompt).strip().lower()
        if response not in ("y", "yes"):
            print("Cancelled.")
            return 0

    # Perform the clean
    results = clean_pipeline_data(config, permanent=permanent)

    # Report results
    cleaned = sum(1 for r in results if r.action in ("trashed", "deleted"))
    skipped = sum(1 for r in results if r.action == "skipped")
    failed = sum(1 for r in results if not r.success)

    if cleaned > 0:
        action_past = "Permanently deleted" if permanent else "Moved to trash"
        print(f"\n{action_past}: {cleaned} file(s)")
    if skipped > 0:
        print(f"Skipped (not found): {skipped} file(s)")
    if failed > 0:
        print(f"Failed: {failed} file(s)")
        for r in results:
            if not r.success:
                print(f"  {r.path}: {r.error}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

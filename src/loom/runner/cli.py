#!/usr/bin/env python3
"""Pipeline runner CLI."""

import argparse
import sys
from pathlib import Path

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

    args = parser.parse_args()

    # Load config
    if not args.config.exists():
        print(f"Error: Config file not found: {args.config}", file=sys.stderr)
        return 1

    config = PipelineConfig.from_yaml(args.config)

    # Apply overrides
    if args.set:
        config.override_parameters(parse_key_value_args(args.set))

    if args.var:
        config.override_variables(parse_key_value_args(args.var))

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


if __name__ == "__main__":
    sys.exit(main())

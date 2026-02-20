"""MkDocs hooks for tutorial generation and version injection."""

import logging
import os
import re
from pathlib import Path

log = logging.getLogger("mkdocs.hooks")


def on_config(config: dict, **kwargs) -> dict:
    """Inject version from environment variable into site config."""
    version = os.environ.get("SITE_VERSION", "")
    if version:
        config.setdefault("extra", {})["version"] = version
        log.info(f"Site version set to: {version}")
    return config


# GitHub raw URL base for images
GITHUB_RAW_BASE = "https://raw.githubusercontent.com/ljubobratovicrelja/loom/main"

# Mapping from example directory names to tutorial filenames and nav titles
EXAMPLES = {
    "linear": ("linear.md", "Linear Pipeline"),
    "diamond": ("diamond.md", "Branching (Diamond)"),
    "parameters": ("parameters.md", "Using Parameters"),
    "parallel": ("parallel.md", "Parallel Execution"),
    "optional_steps": ("optional-steps.md", "Optional Steps"),
    "curve-fitting": ("curve-fitting.md", "Scientific Workflow"),
    "image-processing": ("image-processing.md", "Image Processing"),
    "loop": ("loop.md", "Loop (Per-Item Processing)"),
    "groups": ("groups.md", "Groups"),
}


def is_up_to_date(source: Path, target: Path) -> bool:
    """Check if target exists and is newer than source."""
    if not target.exists():
        return False
    return target.stat().st_mtime >= source.stat().st_mtime


def on_pre_build(config: dict, **kwargs) -> None:
    """Generate tutorial pages from examples/ READMEs before build."""
    docs_dir = Path(config["docs_dir"])
    root_dir = docs_dir.parent
    examples_dir = root_dir / "examples"
    tutorials_dir = docs_dir / "tutorials"

    # Ensure directories exist
    tutorials_dir.mkdir(parents=True, exist_ok=True)

    for example_name, (filename, title) in EXAMPLES.items():
        example_path = examples_dir / example_name
        readme_path = example_path / "README.md"

        if not readme_path.exists():
            log.warning(f"Example README not found: {readme_path}")
            continue

        output_path = tutorials_dir / filename

        # Skip if already up to date (prevents infinite livereload loop)
        if is_up_to_date(readme_path, output_path):
            continue

        # Read and transform the README
        content = readme_path.read_text()
        content = transform_content(content, example_name)

        # Write tutorial page
        output_path.write_text(content)
        log.info(f"Generated tutorial: {output_path}")


def transform_content(content: str, example_name: str) -> str:
    """Transform example README content for use as a tutorial page."""
    # Transform screenshot to GitHub raw URL
    content = re.sub(
        r"!\[([^\]]*)\]\(media/screenshot\.png\)",
        f"![\\1]({GITHUB_RAW_BASE}/examples/{example_name}/media/screenshot.png)",
        content,
    )

    # Transform relative command paths: pipeline.yml -> examples/X/pipeline.yml
    # But only in code blocks - look for patterns like `loom pipeline.yml` or `loom-ui pipeline.yml`
    content = re.sub(
        r"(loom(?:-ui)?\s+)pipeline\.yml",
        f"\\1examples/{example_name}/pipeline.yml",
        content,
    )

    # Transform cat/ls commands with relative data/ paths
    content = re.sub(
        r"(cat|ls)\s+(data/[^\s]+)",
        f"\\1 examples/{example_name}/\\2",
        content,
    )

    return content

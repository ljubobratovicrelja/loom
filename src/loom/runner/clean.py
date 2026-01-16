"""Clean pipeline data functionality."""

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from send2trash import send2trash  # type: ignore[import-untyped]

if TYPE_CHECKING:
    from .config import PipelineConfig

# Thumbnail cache directory name
THUMBNAIL_DIR_NAME = ".loom-thumbnails"


@dataclass
class CleanResult:
    """Result of cleaning a single path."""

    path: Path
    success: bool
    error: str | None = None
    action: Literal["trashed", "deleted", "skipped"] = "skipped"


def get_cleanable_paths(
    config: "PipelineConfig",
    include_thumbnails: bool = True,
) -> list[tuple[str, Path, bool]]:
    """Get list of paths that would be cleaned.

    Args:
        config: Pipeline configuration.
        include_thumbnails: Whether to include .loom-thumbnails directory.

    Returns:
        List of tuples (name, path, exists) for each cleanable path.
    """
    paths: list[tuple[str, Path, bool]] = []

    # Collect all data node paths
    for name in config.variables:
        try:
            path = config.resolve_path(f"${name}")
            paths.append((name, path, path.exists()))
        except (ValueError, OSError):
            # Skip paths that can't be resolved
            pass

    # Add thumbnail cache directory if requested
    if include_thumbnails:
        thumbnail_dir = config.base_dir / THUMBNAIL_DIR_NAME
        paths.append((THUMBNAIL_DIR_NAME, thumbnail_dir, thumbnail_dir.exists()))

    return paths


def clean_pipeline_data(
    config: "PipelineConfig",
    permanent: bool = False,
    include_thumbnails: bool = True,
) -> list[CleanResult]:
    """Clean all data node files from the pipeline.

    Args:
        config: Pipeline configuration.
        permanent: If True, permanently delete files. If False, move to trash.
        include_thumbnails: Whether to include .loom-thumbnails directory.

    Returns:
        List of CleanResult objects describing what happened to each path.
    """
    results: list[CleanResult] = []
    paths = get_cleanable_paths(config, include_thumbnails=include_thumbnails)

    for name, path, exists in paths:
        if not exists:
            results.append(CleanResult(path=path, success=True, action="skipped"))
            continue

        try:
            if permanent:
                _delete_path(path)
                results.append(CleanResult(path=path, success=True, action="deleted"))
            else:
                send2trash(str(path))
                results.append(CleanResult(path=path, success=True, action="trashed"))
        except Exception as e:
            results.append(CleanResult(path=path, success=False, error=str(e)))

    return results


def _delete_path(path: Path) -> None:
    """Permanently delete a path (file or directory).

    Args:
        path: Path to delete.
    """
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()

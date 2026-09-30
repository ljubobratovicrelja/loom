"""Clean pipeline data functionality."""

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from send2trash import send2trash  # type: ignore[import-untyped]

from .url import URL_CACHE_DIR_NAME

if TYPE_CHECKING:
    from .config import PipelineConfig

# Thumbnail cache directory name
THUMBNAIL_DIR_NAME = ".loom-thumbnails"


def _is_relative_to(path: Path, parent: Path) -> bool:
    """Return True if ``path`` is inside ``parent`` (both resolved)."""
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def describe_path(path: Path, base_dir: Path, max_sample: int = 10) -> dict[str, Any]:
    """Summarise a cleanable path for previews.

    Directories are the dangerous case: cleaning removes the whole tree, so the
    preview reports how many files it holds and a small sample of their names.
    ``inside_pipeline`` flags paths that resolve outside the pipeline directory,
    where deletion can affect files unrelated to the pipeline.
    """
    is_dir = path.is_dir()
    entry_count = 0
    sample: list[str] = []
    if is_dir:
        try:
            for entry in path.rglob("*"):
                if entry.is_file():
                    entry_count += 1
                    if len(sample) < max_sample:
                        try:
                            sample.append(str(entry.relative_to(path)))
                        except ValueError:
                            sample.append(str(entry))
        except OSError:
            pass
    return {
        "is_dir": is_dir,
        "entry_count": entry_count,
        "sample": sample,
        "inside_pipeline": _is_relative_to(path, base_dir),
    }


def get_output_root(config: "PipelineConfig") -> Path | None:
    """Return the owned output root if it exists and holds produced data.

    ``--clean`` purges this whole tree after removing individual data nodes,
    which also removes empty directory shells left behind by failed runs.
    Returns ``None`` when the root does not exist or no produced node lives
    under it (so pipelines that keep using ``data/`` are unaffected).
    """
    root = config.output_root
    if not root.exists() or not root.is_dir():
        return None
    for name in config.variables:
        if config.is_source_data(name):
            continue
        try:
            resolved = config.resolve_path(f"${name}").resolve()
        except (ValueError, OSError):
            continue
        if resolved == root or resolved.is_relative_to(root):
            return root
    return None


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
    include_source: bool = False,
    include_url_cache: bool = True,
) -> list[tuple[str, Path, bool]]:
    """Get list of paths that would be cleaned.

    Args:
        config: Pipeline configuration.
        include_thumbnails: Whether to include .loom-thumbnails directory.
        include_source: Whether to include source data (not produced by any step).
            Default is False to protect original input data from accidental deletion.
        include_url_cache: Whether to include .loom-url-cache directory.

    Returns:
        List of tuples (name, path, exists) for each cleanable path.
    """
    paths: list[tuple[str, Path, bool]] = []

    # Collect all data node paths (skip URLs as they're stored in cache)
    for name in config.variables:
        # Skip source data unless explicitly requested
        if not include_source and config.is_source_data(name):
            continue

        # Skip URL paths (they're cleaned via the URL cache directory)
        if config.is_url_path(f"${name}"):
            continue

        try:
            path = config.resolve_path(f"${name}")
            paths.append((name, path, path.exists()))
        except (ValueError, OSError):
            # Skip paths that can't be resolved
            pass

    # For multi-pass groups, also clean _iter{N} files
    for group in config.multi_pass_groups.values():
        for var_name in group.internal_outputs:
            try:
                base_path = config.resolve_path(f"${var_name}")
            except (ValueError, OSError):
                continue
            parent = base_path.parent
            stem = base_path.stem
            suffix = base_path.suffix
            if parent.exists():
                for match in parent.glob(f"{stem}_iter*{suffix}"):
                    paths.append((f"{var_name}_iter", match, match.exists()))

    # Add thumbnail cache directory if requested
    if include_thumbnails:
        thumbnail_dir = config.base_dir / THUMBNAIL_DIR_NAME
        paths.append((THUMBNAIL_DIR_NAME, thumbnail_dir, thumbnail_dir.exists()))

    # Add URL cache directory if requested
    if include_url_cache:
        url_cache_dir = config.base_dir / URL_CACHE_DIR_NAME
        paths.append((URL_CACHE_DIR_NAME, url_cache_dir, url_cache_dir.exists()))

    return paths


def clean_pipeline_data(
    config: "PipelineConfig",
    permanent: bool = False,
    include_thumbnails: bool = True,
    include_source: bool = False,
    include_url_cache: bool = True,
) -> list[CleanResult]:
    """Clean all data node files from the pipeline.

    Args:
        config: Pipeline configuration.
        permanent: If True, permanently delete files. If False, move to trash.
        include_thumbnails: Whether to include .loom-thumbnails directory.
        include_source: Whether to include source data (not produced by any step).
            Default is False to protect original input data from accidental deletion.
        include_url_cache: Whether to include .loom-url-cache directory.

    Returns:
        List of CleanResult objects describing what happened to each path.
    """
    results: list[CleanResult] = []
    paths = get_cleanable_paths(
        config,
        include_thumbnails=include_thumbnails,
        include_source=include_source,
        include_url_cache=include_url_cache,
    )

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

    # Finally purge the owned output tree. Removing it (not just its contents)
    # means a directory shell left by a failed run no longer exists, so the
    # editor stops treating it as produced data.
    output_root = get_output_root(config)
    if output_root is not None and output_root.exists():
        try:
            if permanent:
                _delete_path(output_root)
                results.append(CleanResult(path=output_root, success=True, action="deleted"))
            else:
                send2trash(str(output_root))
                results.append(CleanResult(path=output_root, success=True, action="trashed"))
        except Exception as e:
            results.append(CleanResult(path=output_root, success=False, error=str(e)))

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

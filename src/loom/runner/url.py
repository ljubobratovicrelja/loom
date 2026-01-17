"""URL handling utilities for data node paths."""

import hashlib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import requests

# Cache directory name for downloaded URLs
URL_CACHE_DIR_NAME = ".loom-url-cache"

# Default timeout for HTTP requests (in seconds)
DEFAULT_TIMEOUT = 30

# Default headers for HTTP requests
DEFAULT_HEADERS = {
    "User-Agent": "Loom/1.0 (https://github.com/relja/loom; Pipeline runner)",
}


def is_url(path: str) -> bool:
    """Check if a path is an HTTP/HTTPS URL.

    Args:
        path: Path string to check.

    Returns:
        True if the path starts with http:// or https://.
    """
    return path.startswith("http://") or path.startswith("https://")


def get_url_filename(url: str) -> str:
    """Extract filename from URL, preserving extension.

    Args:
        url: The URL to extract filename from.

    Returns:
        Filename from URL path, or 'download' if none found.
    """
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    if path:
        return Path(path).name
    return "download"


def get_cache_path(url: str, cache_dir: Path) -> Path:
    """Get deterministic cache path for a URL.

    Uses a hash of the URL combined with the original filename to create
    a unique but predictable cache path.

    Args:
        url: The URL to cache.
        cache_dir: Directory to store cached files.

    Returns:
        Path where the URL should be cached.
    """
    # Create hash of URL for uniqueness
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]

    # Preserve original filename for clarity
    filename = get_url_filename(url)

    # Combine hash and filename
    cache_name = f"{url_hash}_{filename}"
    return cache_dir / cache_name


def check_url_exists(url: str, timeout: int = DEFAULT_TIMEOUT) -> bool:
    """Check if a URL is reachable using a HEAD request.

    Args:
        url: The URL to check.
        timeout: Request timeout in seconds.

    Returns:
        True if the URL returns a successful status code.
    """
    try:
        response = requests.head(
            url, timeout=timeout, allow_redirects=True, headers=DEFAULT_HEADERS
        )
        return bool(response.status_code < 400)
    except requests.RequestException:
        return False


@dataclass
class UrlCacheResult:
    """Result of downloading and caching a URL."""

    success: bool
    local_path: Path | None
    error: str | None = None
    from_cache: bool = False


def download_url(
    url: str,
    cache_dir: Path,
    timeout: int = DEFAULT_TIMEOUT,
    force: bool = False,
) -> UrlCacheResult:
    """Download a URL and cache it locally.

    Args:
        url: The URL to download.
        cache_dir: Directory to store cached files.
        timeout: Request timeout in seconds.
        force: If True, re-download even if cached.

    Returns:
        UrlCacheResult with success status and local path.
    """
    cache_path = get_cache_path(url, cache_dir)

    # Return cached file if it exists and force is not set
    if not force and cache_path.exists():
        return UrlCacheResult(
            success=True,
            local_path=cache_path,
            from_cache=True,
        )

    # Ensure cache directory exists
    cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        response = requests.get(url, timeout=timeout, stream=True, headers=DEFAULT_HEADERS)
        response.raise_for_status()

        # Write to cache file
        with open(cache_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        return UrlCacheResult(
            success=True,
            local_path=cache_path,
            from_cache=False,
        )

    except requests.RequestException as e:
        return UrlCacheResult(
            success=False,
            local_path=None,
            error=str(e),
        )


def ensure_url_downloaded(url: str, cache_dir: Path) -> Path:
    """Download URL if needed and return local path.

    This is a convenience function that raises an exception on failure.

    Args:
        url: The URL to download.
        cache_dir: Directory to store cached files.

    Returns:
        Path to the local cached file.

    Raises:
        RuntimeError: If download fails.
    """
    result = download_url(url, cache_dir)
    if not result.success or result.local_path is None:
        raise RuntimeError(f"Failed to download URL {url}: {result.error}")
    return result.local_path

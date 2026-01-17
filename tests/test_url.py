"""Tests for loom.runner.url module."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from loom.runner.url import (
    URL_CACHE_DIR_NAME,
    UrlCacheResult,
    check_url_exists,
    download_url,
    ensure_url_downloaded,
    get_cache_path,
    get_url_filename,
    is_url,
)


class TestIsUrl:
    """Tests for is_url function."""

    def test_http_url_returns_true(self) -> None:
        """Test that HTTP URLs are detected."""
        assert is_url("http://example.com/file.png") is True
        assert is_url("http://localhost:8080/test") is True

    def test_https_url_returns_true(self) -> None:
        """Test that HTTPS URLs are detected."""
        assert is_url("https://example.com/file.png") is True
        assert is_url("https://cdn.example.com/images/photo.jpg") is True

    def test_local_paths_return_false(self) -> None:
        """Test that local paths are not detected as URLs."""
        assert is_url("data/file.png") is False
        assert is_url("/absolute/path/file.png") is False
        assert is_url("./relative/path.csv") is False

    def test_other_protocols_return_false(self) -> None:
        """Test that other protocols are not detected as URLs."""
        assert is_url("ftp://example.com/file") is False
        assert is_url("file:///path/to/file") is False
        assert is_url("s3://bucket/key") is False

    def test_empty_string_returns_false(self) -> None:
        """Test that empty string returns False."""
        assert is_url("") is False


class TestGetUrlFilename:
    """Tests for get_url_filename function."""

    def test_extracts_simple_filename(self) -> None:
        """Test extracting filename from simple URL."""
        assert get_url_filename("https://example.com/image.png") == "image.png"

    def test_extracts_filename_with_path(self) -> None:
        """Test extracting filename from URL with path."""
        assert get_url_filename("https://example.com/path/to/file.csv") == "file.csv"

    def test_handles_query_string(self) -> None:
        """Test that query strings don't affect filename extraction."""
        # Note: urlparse keeps query in separate field, but path might include it
        url = "https://example.com/file.json?param=value"
        filename = get_url_filename(url)
        # The path component is "/file.json" before the query
        assert filename == "file.json"

    def test_returns_default_for_empty_path(self) -> None:
        """Test that 'download' is returned for URLs without path."""
        assert get_url_filename("https://example.com") == "download"
        assert get_url_filename("https://example.com/") == "download"

    def test_handles_trailing_slash(self) -> None:
        """Test handling of trailing slashes in path."""
        assert get_url_filename("https://example.com/folder/") == "folder"


class TestGetCachePath:
    """Tests for get_cache_path function."""

    def test_returns_path_in_cache_dir(self) -> None:
        """Test that cache path is within the cache directory."""
        cache_dir = Path("/tmp/cache")
        url = "https://example.com/file.png"

        result = get_cache_path(url, cache_dir)

        assert result.parent == cache_dir
        assert result.name.endswith("_file.png")

    def test_deterministic_for_same_url(self) -> None:
        """Test that the same URL always produces the same cache path."""
        cache_dir = Path("/tmp/cache")
        url = "https://example.com/file.png"

        result1 = get_cache_path(url, cache_dir)
        result2 = get_cache_path(url, cache_dir)

        assert result1 == result2

    def test_different_urls_produce_different_paths(self) -> None:
        """Test that different URLs produce different cache paths."""
        cache_dir = Path("/tmp/cache")

        result1 = get_cache_path("https://example.com/a.png", cache_dir)
        result2 = get_cache_path("https://example.com/b.png", cache_dir)

        assert result1 != result2

    def test_preserves_file_extension(self) -> None:
        """Test that file extension is preserved in cache filename."""
        cache_dir = Path("/tmp/cache")

        png_path = get_cache_path("https://example.com/image.png", cache_dir)
        csv_path = get_cache_path("https://example.com/data.csv", cache_dir)

        assert png_path.suffix == ".png"
        assert csv_path.suffix == ".csv"


class TestCheckUrlExists:
    """Tests for check_url_exists function."""

    @patch("loom.runner.url.requests.head")
    def test_returns_true_for_200(self, mock_head: MagicMock) -> None:
        """Test that 200 status returns True."""
        mock_head.return_value.status_code = 200

        assert check_url_exists("https://example.com/file.png") is True

    @patch("loom.runner.url.requests.head")
    def test_returns_true_for_success_codes(self, mock_head: MagicMock) -> None:
        """Test that other success codes return True."""
        for status in [200, 201, 301, 302, 304]:
            mock_head.return_value.status_code = status
            assert check_url_exists("https://example.com/file.png") is True

    @patch("loom.runner.url.requests.head")
    def test_returns_false_for_404(self, mock_head: MagicMock) -> None:
        """Test that 404 status returns False."""
        mock_head.return_value.status_code = 404

        assert check_url_exists("https://example.com/missing.png") is False

    @patch("loom.runner.url.requests.head")
    def test_returns_false_for_error_codes(self, mock_head: MagicMock) -> None:
        """Test that error codes return False."""
        for status in [400, 403, 404, 500, 503]:
            mock_head.return_value.status_code = status
            assert check_url_exists("https://example.com/file.png") is False

    @patch("loom.runner.url.requests.head")
    def test_returns_false_on_request_exception(self, mock_head: MagicMock) -> None:
        """Test that request exceptions return False."""
        import requests

        mock_head.side_effect = requests.RequestException("Connection error")

        assert check_url_exists("https://example.com/file.png") is False


class TestDownloadUrl:
    """Tests for download_url function."""

    @patch("loom.runner.url.requests.get")
    def test_downloads_and_caches_file(self, mock_get: MagicMock) -> None:
        """Test that URL is downloaded and cached."""
        mock_get.return_value.iter_content.return_value = [b"test content"]
        mock_get.return_value.raise_for_status = MagicMock()

        with tempfile.TemporaryDirectory() as tmpdir:
            cache_dir = Path(tmpdir) / URL_CACHE_DIR_NAME
            url = "https://example.com/file.txt"

            result = download_url(url, cache_dir)

            assert result.success is True
            assert result.local_path is not None
            assert result.local_path.exists()
            assert result.from_cache is False

    @patch("loom.runner.url.requests.get")
    def test_returns_cached_file_if_exists(self, mock_get: MagicMock) -> None:
        """Test that cached file is returned without re-downloading."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_dir = Path(tmpdir) / URL_CACHE_DIR_NAME
            cache_dir.mkdir(parents=True)
            url = "https://example.com/file.txt"

            # Pre-create cached file
            cache_path = get_cache_path(url, cache_dir)
            cache_path.write_text("cached content")

            result = download_url(url, cache_dir)

            assert result.success is True
            assert result.local_path == cache_path
            assert result.from_cache is True
            mock_get.assert_not_called()

    @patch("loom.runner.url.requests.get")
    def test_force_redownloads_cached_file(self, mock_get: MagicMock) -> None:
        """Test that force=True re-downloads even if cached."""
        mock_get.return_value.iter_content.return_value = [b"new content"]
        mock_get.return_value.raise_for_status = MagicMock()

        with tempfile.TemporaryDirectory() as tmpdir:
            cache_dir = Path(tmpdir) / URL_CACHE_DIR_NAME
            cache_dir.mkdir(parents=True)
            url = "https://example.com/file.txt"

            # Pre-create cached file
            cache_path = get_cache_path(url, cache_dir)
            cache_path.write_text("old content")

            result = download_url(url, cache_dir, force=True)

            assert result.success is True
            assert result.from_cache is False
            mock_get.assert_called_once()

    @patch("loom.runner.url.requests.get")
    def test_returns_error_on_failure(self, mock_get: MagicMock) -> None:
        """Test that download failure returns error result."""
        import requests

        mock_get.side_effect = requests.RequestException("Download failed")

        with tempfile.TemporaryDirectory() as tmpdir:
            cache_dir = Path(tmpdir) / URL_CACHE_DIR_NAME

            result = download_url("https://example.com/file.txt", cache_dir)

            assert result.success is False
            assert result.local_path is None
            assert result.error is not None


class TestEnsureUrlDownloaded:
    """Tests for ensure_url_downloaded function."""

    @patch("loom.runner.url.download_url")
    def test_returns_local_path_on_success(self, mock_download: MagicMock) -> None:
        """Test that local path is returned on successful download."""
        expected_path = Path("/tmp/cache/file.txt")
        mock_download.return_value = UrlCacheResult(success=True, local_path=expected_path)

        result = ensure_url_downloaded("https://example.com/file.txt", Path("/tmp/cache"))

        assert result == expected_path

    @patch("loom.runner.url.download_url")
    def test_raises_on_failure(self, mock_download: MagicMock) -> None:
        """Test that RuntimeError is raised on download failure."""
        mock_download.return_value = UrlCacheResult(
            success=False, local_path=None, error="Download failed"
        )

        with pytest.raises(RuntimeError, match="Failed to download URL"):
            ensure_url_downloaded("https://example.com/file.txt", Path("/tmp/cache"))


class TestUrlCacheDirName:
    """Tests for URL cache directory name constant."""

    def test_cache_dir_name_is_dotfile(self) -> None:
        """Test that cache directory name starts with dot (hidden)."""
        assert URL_CACHE_DIR_NAME.startswith(".")

    def test_cache_dir_name_is_loom_prefixed(self) -> None:
        """Test that cache directory name is clearly from loom."""
        assert "loom" in URL_CACHE_DIR_NAME
        assert "url" in URL_CACHE_DIR_NAME

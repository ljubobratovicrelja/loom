"""Tests for thumbnail generation and caching."""

from pathlib import Path

from fastapi.testclient import TestClient

from loom.ui.server import app, configure
from loom.ui.server.thumbnails import ThumbnailGenerator


class TestThumbnailGenerator:
    """Tests for ThumbnailGenerator class."""

    def test_cache_path_is_deterministic(self, tmp_path: Path) -> None:
        """Same file path should always produce same cache path."""
        generator = ThumbnailGenerator(tmp_path)
        test_file = tmp_path / "test.png"

        path1 = generator._get_cache_path(test_file)
        path2 = generator._get_cache_path(test_file)

        assert path1 == path2

    def test_cache_path_different_for_different_files(self, tmp_path: Path) -> None:
        """Different files should have different cache paths."""
        generator = ThumbnailGenerator(tmp_path)
        file1 = tmp_path / "file1.png"
        file2 = tmp_path / "file2.png"

        path1 = generator._get_cache_path(file1)
        path2 = generator._get_cache_path(file2)

        assert path1 != path2

    def test_cache_validity_returns_false_when_no_cache(self, tmp_path: Path) -> None:
        """Cache should be invalid when no cache file exists."""
        generator = ThumbnailGenerator(tmp_path)
        source_file = tmp_path / "source.txt"
        source_file.write_text("content")
        cache_path = generator._get_cache_path(source_file)

        assert generator._is_cache_valid(source_file, cache_path) is False

    def test_cache_validity_returns_true_when_fresh(self, tmp_path: Path) -> None:
        """Cache should be valid when cache is newer than source."""
        import time

        generator = ThumbnailGenerator(tmp_path)
        source_file = tmp_path / "source.txt"
        source_file.write_text("content")

        # Create cache dir and file after source
        time.sleep(0.05)
        cache_path = generator._get_cache_path(source_file)
        generator._ensure_cache_dir()
        cache_path.write_bytes(b"cached")

        assert generator._is_cache_valid(source_file, cache_path) is True

    def test_cache_validity_returns_false_when_stale(self, tmp_path: Path) -> None:
        """Cache should be invalid when source is newer than cache."""
        import time

        generator = ThumbnailGenerator(tmp_path)
        source_file = tmp_path / "source.txt"

        # Create cache first
        cache_path = generator._get_cache_path(source_file)
        generator._ensure_cache_dir()
        cache_path.write_bytes(b"cached")

        # Create source after cache
        time.sleep(0.05)
        source_file.write_text("content")

        assert generator._is_cache_valid(source_file, cache_path) is False

    def test_ensure_cache_dir_creates_directory(self, tmp_path: Path) -> None:
        """Should create cache directory if it doesn't exist."""
        generator = ThumbnailGenerator(tmp_path)
        assert not generator.cache_dir.exists()

        generator._ensure_cache_dir()

        assert generator.cache_dir.exists()
        assert generator.cache_dir.is_dir()

    def test_text_preview_returns_lines(self, tmp_path: Path) -> None:
        """Should return lines from text file."""
        generator = ThumbnailGenerator(tmp_path)
        text_file = tmp_path / "test.txt"
        text_file.write_text("line1\nline2\nline3")

        preview = generator.get_text_preview(text_file)

        assert preview is not None
        assert preview["lines"] == ["line1", "line2", "line3"]
        assert preview["truncated"] is False

    def test_text_preview_truncates_long_lines(self, tmp_path: Path) -> None:
        """Should truncate lines longer than column limit."""
        generator = ThumbnailGenerator(tmp_path)
        text_file = tmp_path / "test.txt"
        long_line = "a" * 50
        text_file.write_text(long_line)

        preview = generator.get_text_preview(text_file)

        assert preview is not None
        assert len(preview["lines"]) == 1
        assert preview["lines"][0].endswith("...")
        assert len(preview["lines"][0]) < len(long_line)
        assert preview["truncated"] is True

    def test_text_preview_truncates_many_lines(self, tmp_path: Path) -> None:
        """Should truncate after max lines."""
        generator = ThumbnailGenerator(tmp_path)
        text_file = tmp_path / "test.txt"
        text_file.write_text("\n".join([f"line{i}" for i in range(20)]))

        preview = generator.get_text_preview(text_file)

        assert preview is not None
        assert len(preview["lines"]) == 6  # TEXT_PREVIEW_LINES
        assert preview["truncated"] is True

    def test_text_preview_returns_none_for_missing_file(self, tmp_path: Path) -> None:
        """Should return None for non-existent file."""
        generator = ThumbnailGenerator(tmp_path)
        missing_file = tmp_path / "missing.txt"

        preview = generator.get_text_preview(missing_file)

        assert preview is None

    def test_get_preview_for_txt_type(self, tmp_path: Path) -> None:
        """get_preview should work for txt type."""
        generator = ThumbnailGenerator(tmp_path)
        text_file = tmp_path / "test.txt"
        text_file.write_text("test content")

        preview = generator.get_preview(text_file, "txt")

        assert preview is not None
        assert "lines" in preview

    def test_get_preview_for_csv_type(self, tmp_path: Path) -> None:
        """get_preview should work for csv type."""
        generator = ThumbnailGenerator(tmp_path)
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a,b,c\n1,2,3")

        preview = generator.get_preview(csv_file, "csv")

        assert preview is not None
        assert preview["lines"] == ["a,b,c", "1,2,3"]

    def test_get_preview_for_json_type(self, tmp_path: Path) -> None:
        """get_preview should work for json type."""
        generator = ThumbnailGenerator(tmp_path)
        json_file = tmp_path / "test.json"
        json_file.write_text('{"key": "value"}')

        preview = generator.get_preview(json_file, "json")

        assert preview is not None

    def test_get_preview_returns_none_for_unsupported_type(self, tmp_path: Path) -> None:
        """get_preview should return None for unsupported types."""
        generator = ThumbnailGenerator(tmp_path)
        file = tmp_path / "test.bin"
        file.write_bytes(b"binary data")

        preview = generator.get_preview(file, "data_folder")

        assert preview is None

    def test_get_thumbnail_returns_none_for_unsupported_type(self, tmp_path: Path) -> None:
        """get_thumbnail should return None for unsupported types."""
        generator = ThumbnailGenerator(tmp_path)
        file = tmp_path / "test.txt"
        file.write_text("text")

        thumbnail = generator.get_thumbnail(file, "txt")

        assert thumbnail is None

    def test_get_image_thumbnail_returns_none_for_missing_file(self, tmp_path: Path) -> None:
        """get_image_thumbnail should return None for missing file."""
        generator = ThumbnailGenerator(tmp_path)
        missing = tmp_path / "missing.png"

        thumbnail = generator.get_image_thumbnail(missing)

        assert thumbnail is None

    def test_get_video_thumbnail_returns_none_for_missing_file(self, tmp_path: Path) -> None:
        """get_video_thumbnail should return None for missing file."""
        generator = ThumbnailGenerator(tmp_path)
        missing = tmp_path / "missing.mp4"

        thumbnail = generator.get_video_thumbnail(missing)

        assert thumbnail is None


class TestThumbnailEndpoint:
    """Tests for GET /api/thumbnail/{data_key} endpoint."""

    def test_thumbnail_no_config_returns_400(self) -> None:
        """Should return 400 when no config loaded."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.get("/api/thumbnail/test_data")

        assert response.status_code == 400
        assert "No config loaded" in response.json()["detail"]

    def test_thumbnail_unknown_data_key_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 for unknown data key."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  existing:
    type: image
    path: image.png
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/thumbnail/nonexistent")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    def test_thumbnail_unsupported_type_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 for non-image/video types."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  text_data:
    type: txt
    path: data.txt
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/thumbnail/text_data")

        assert response.status_code == 404
        assert "doesn't support thumbnails" in response.json()["detail"]

    def test_thumbnail_missing_file_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 when file doesn't exist."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  image_data:
    type: image
    path: missing.png
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/thumbnail/image_data")

        assert response.status_code == 404
        assert "does not exist" in response.json()["detail"]


class TestPreviewEndpoint:
    """Tests for GET /api/preview/{data_key} endpoint."""

    def test_preview_no_config_returns_400(self) -> None:
        """Should return 400 when no config loaded."""
        configure(config_path=None)
        client = TestClient(app)

        response = client.get("/api/preview/test_data")

        assert response.status_code == 400
        assert "No config loaded" in response.json()["detail"]

    def test_preview_unknown_data_key_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 for unknown data key."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  existing:
    type: txt
    path: data.txt
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/preview/nonexistent")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    def test_preview_unsupported_type_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 for non-text types."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  image_data:
    type: image
    path: image.png
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/preview/image_data")

        assert response.status_code == 404
        assert "doesn't support preview" in response.json()["detail"]

    def test_preview_missing_file_returns_404(self, tmp_path: Path) -> None:
        """Should return 404 when file doesn't exist."""
        config = tmp_path / "pipeline.yml"
        config.write_text("""
data:
  text_data:
    type: txt
    path: missing.txt
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/preview/text_data")

        assert response.status_code == 404
        assert "does not exist" in response.json()["detail"]

    def test_preview_success(self, tmp_path: Path) -> None:
        """Should return preview for existing text file."""
        config = tmp_path / "pipeline.yml"
        text_file = tmp_path / "data.txt"
        text_file.write_text("line1\nline2\nline3")

        config.write_text(f"""
data:
  text_data:
    type: txt
    path: {text_file}
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/preview/text_data")

        assert response.status_code == 200
        data = response.json()
        assert data["lines"] == ["line1", "line2", "line3"]
        assert data["truncated"] is False

    def test_preview_csv_success(self, tmp_path: Path) -> None:
        """Should return preview for CSV file."""
        config = tmp_path / "pipeline.yml"
        csv_file = tmp_path / "data.csv"
        csv_file.write_text("a,b,c\n1,2,3\n4,5,6")

        config.write_text(f"""
data:
  csv_data:
    type: csv
    path: {csv_file}
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/preview/csv_data")

        assert response.status_code == 200
        data = response.json()
        assert "a,b,c" in data["lines"][0]

    def test_preview_json_success(self, tmp_path: Path) -> None:
        """Should return preview for JSON file."""
        config = tmp_path / "pipeline.yml"
        json_file = tmp_path / "data.json"
        json_file.write_text('{"key": "value"}')

        config.write_text(f"""
data:
  json_data:
    type: json
    path: {json_file}
pipeline: []
""")
        configure(config_path=config)
        client = TestClient(app)

        response = client.get("/api/preview/json_data")

        assert response.status_code == 200
        data = response.json()
        assert len(data["lines"]) > 0

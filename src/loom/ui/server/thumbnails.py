"""Thumbnail and preview generation for data nodes."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, TypedDict

# Thumbnail configuration
THUMBNAIL_WIDTH = 120
THUMBNAIL_HEIGHT = 80
TEXT_PREVIEW_LINES = 6
TEXT_PREVIEW_COLS = 30
CACHE_DIR_NAME = ".loom-thumbnails"


class TextPreview(TypedDict):
    """Text preview response structure."""

    lines: list[str]
    truncated: bool


class ThumbnailGenerator:
    """Generates and caches thumbnails for data files."""

    def __init__(self, base_dir: Path) -> None:
        """Initialize thumbnail generator.

        Args:
            base_dir: Base directory for cache (typically pipeline directory)
        """
        self.base_dir = base_dir
        self.cache_dir = base_dir / CACHE_DIR_NAME

    def _get_cache_path(self, file_path: Path) -> Path:
        """Get cache path for a file's thumbnail.

        Uses a hash of the absolute path for unique cache filenames.
        """
        path_hash = hashlib.sha256(str(file_path.absolute()).encode()).hexdigest()[:16]
        return self.cache_dir / f"{path_hash}.png"

    def _is_cache_valid(self, file_path: Path, cache_path: Path) -> bool:
        """Check if cached thumbnail is still valid (not stale)."""
        if not cache_path.exists():
            return False
        return cache_path.stat().st_mtime >= file_path.stat().st_mtime

    def _ensure_cache_dir(self) -> None:
        """Create cache directory if it doesn't exist."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _resize_to_thumbnail(self, img: Any) -> Any:
        """Resize image to thumbnail dimensions while maintaining aspect ratio."""
        import cv2

        h, w = img.shape[:2]
        aspect = w / h

        # Calculate new dimensions maintaining aspect ratio
        if aspect > THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT:
            # Width is the limiting factor
            new_width = THUMBNAIL_WIDTH
            new_height = int(THUMBNAIL_WIDTH / aspect)
        else:
            # Height is the limiting factor
            new_height = THUMBNAIL_HEIGHT
            new_width = int(THUMBNAIL_HEIGHT * aspect)

        return cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)

    def get_image_thumbnail(self, file_path: Path) -> bytes | None:
        """Generate or retrieve cached thumbnail for an image file.

        Args:
            file_path: Path to the image file

        Returns:
            PNG bytes of the thumbnail, or None if generation fails
        """
        try:
            import cv2
        except ImportError:
            return None

        if not file_path.exists():
            return None

        cache_path = self._get_cache_path(file_path)

        # Return cached thumbnail if valid
        if self._is_cache_valid(file_path, cache_path):
            return cache_path.read_bytes()

        # Generate new thumbnail
        try:
            img = cv2.imread(str(file_path))
            if img is None:
                return None

            # Resize to thumbnail
            thumbnail = self._resize_to_thumbnail(img)

            # Save to cache
            self._ensure_cache_dir()
            cv2.imwrite(str(cache_path), thumbnail)

            return cache_path.read_bytes()
        except Exception:
            return None

    def get_video_thumbnail(self, file_path: Path) -> bytes | None:
        """Generate or retrieve cached thumbnail for a video file.

        Extracts a frame from the middle of the video.

        Args:
            file_path: Path to the video file

        Returns:
            PNG bytes of the thumbnail, or None if generation fails
        """
        try:
            import cv2
        except ImportError:
            return None

        if not file_path.exists():
            return None

        cache_path = self._get_cache_path(file_path)

        # Return cached thumbnail if valid
        if self._is_cache_valid(file_path, cache_path):
            return cache_path.read_bytes()

        # Generate new thumbnail from video
        try:
            cap = cv2.VideoCapture(str(file_path))
            if not cap.isOpened():
                return None

            # Get total frame count and seek to middle
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total_frames > 0:
                middle_frame = total_frames // 2
                cap.set(cv2.CAP_PROP_POS_FRAMES, middle_frame)

            ret, frame = cap.read()
            cap.release()

            if not ret or frame is None:
                return None

            # Resize to thumbnail
            thumbnail = self._resize_to_thumbnail(frame)

            # Save to cache
            self._ensure_cache_dir()
            cv2.imwrite(str(cache_path), thumbnail)

            return cache_path.read_bytes()
        except Exception:
            return None

    def get_text_preview(self, file_path: Path) -> TextPreview | None:
        """Generate text preview for a text file.

        Args:
            file_path: Path to the text file (txt, csv, json)

        Returns:
            TextPreview with lines and truncated flag, or None if read fails
        """
        if not file_path.exists():
            return None

        try:
            with open(file_path, encoding="utf-8", errors="replace") as f:
                lines: list[str] = []
                truncated = False

                for i, line in enumerate(f):
                    if i >= TEXT_PREVIEW_LINES:
                        truncated = True
                        break

                    # Strip newline and truncate long lines
                    line = line.rstrip("\n\r")
                    if len(line) > TEXT_PREVIEW_COLS:
                        line = line[:TEXT_PREVIEW_COLS] + "..."
                        truncated = True
                    lines.append(line)

                # Check if there's more content after the lines we read
                if not truncated:
                    try:
                        next_char = f.read(1)
                        if next_char:
                            truncated = True
                    except Exception:
                        pass

                return TextPreview(lines=lines, truncated=truncated)
        except Exception:
            return None

    def get_thumbnail(self, file_path: Path, data_type: str) -> bytes | None:
        """Get thumbnail for a file based on its data type.

        Args:
            file_path: Path to the file
            data_type: Data type (image, video, etc.)

        Returns:
            PNG bytes of the thumbnail, or None if not applicable/fails
        """
        if data_type == "image":
            return self.get_image_thumbnail(file_path)
        elif data_type == "video":
            return self.get_video_thumbnail(file_path)
        return None

    def get_preview(self, file_path: Path, data_type: str) -> TextPreview | None:
        """Get text preview for a file based on its data type.

        Args:
            file_path: Path to the file
            data_type: Data type (txt, csv, json, etc.)

        Returns:
            TextPreview, or None if not applicable/fails
        """
        if data_type in ("txt", "csv", "json"):
            return self.get_text_preview(file_path)
        return None

# Image Processing Pipeline

![screenshot](media/screenshot.png)

This example demonstrates **URL data sources** and basic image processing with OpenCV.

## What This Example Shows

1. **URL as Data Source** - The source image is loaded directly from a URL (Wikipedia's Lenna test image)
2. **Automatic Caching** - URL resources are downloaded and cached in `.loom-url-cache/`
3. **Branching Pipeline** - Grayscale output feeds into two parallel processing steps
4. **Image Thumbnails** - The visual editor shows thumbnails for each image

## Pipeline Structure

```
[URL: Lena image]
        |
        v
   [grayscale]
     /      \
    v        v
[edge_detect]  [blur]
    |            |
    v            v
edges.png   blurred.png
```

## Running the Example

```bash
# Navigate to the example directory
cd examples/image-processing

# Run the pipeline
loom pipeline.yml

# Or run the full pipeline
loom pipeline.yml --all
```

First run will download the image from Wikipedia and cache it locally. Subsequent runs use the cached version.

## Tasks

| Task | Description | Input | Output |
|------|-------------|-------|--------|
| `grayscale.py` | Convert to grayscale | Color image | Grayscale image |
| `edge_detect.py` | Canny edge detection | Grayscale image | Edge image |
| `blur.py` | Gaussian blur | Any image | Blurred image |

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `blur_radius` | 15 | Blur kernel size (pixels) |
| `edge_threshold_low` | 50 | Canny low threshold |
| `edge_threshold_high` | 150 | Canny high threshold |

## Clearing the URL Cache

To re-download the source image:

```bash
loom clean pipeline.yml
```

This removes both the generated outputs and the URL cache directory.

## Dependencies

- OpenCV (`opencv-python-headless` or `opencv-python`)

Install with:
```bash
pip install opencv-python-headless
```

Or install all example dependencies:
```bash
pip install -e ".[examples]"
```

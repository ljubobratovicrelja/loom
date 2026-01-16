# Parameters Example

Using parameters for configuration and overriding them at runtime with `--set`.

## What It Does

A simple signal processing pipeline that:
1. **generate_signal**: Creates a noisy sine wave
2. **smooth_signal**: Applies a moving average filter
3. **detect_peaks**: Finds peaks above a threshold

Parameters control the signal characteristics and processing settings.

## Run It

```bash
# Run with default parameters
loom-runner pipeline.yml

# Check outputs
cat data/signal.csv         # Raw noisy signal
cat data/smoothed.csv       # After smoothing
cat data/peaks.json         # Detected peaks

# Override parameters at runtime
loom-runner pipeline.yml --set window_size=10 threshold=0.5

# Try different noise levels
loom-runner pipeline.yml --set noise_level=0.5

# Preview what would run
loom-runner pipeline.yml --set window_size=20 --dry-run
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `num_points` | 200 | Number of data points to generate |
| `noise_level` | 0.2 | Amount of random noise (0-1) |
| `frequency` | 2.0 | Signal frequency (cycles per series) |
| `window_size` | 5 | Moving average window size |
| `threshold` | 0.3 | Peak detection threshold |

## Files

- `pipeline.yml` — Pipeline with parameterized configuration
- `tasks/generate_signal.py` — Generates noisy sine wave
- `tasks/smooth_signal.py` — Moving average smoothing
- `tasks/detect_peaks.py` — Peak detection

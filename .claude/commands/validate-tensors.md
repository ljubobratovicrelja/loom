---
description: Validate tensor shapes in model code against expected dimensions
allowed-tools: Read, Grep, Bash
---

# Tensor Shape Validation

Validate tensor shape consistency across the model pipeline. Check all files in `src/model/` for shape annotations and verify they match the expected dimensions.

## Expected Shapes (from docs/ARCHITECTURE.md)

| Stage | Tensor | Shape |
|-------|--------|-------|
| Input | video | `(B, 64, 3, 256, 256)` |
| Input | gaze | `(B, 64, 2)` normalized [0,1] |
| V-JEPA 2 raw | features | `(B, 8192, 1024)` |
| V-JEPA 2 reshaped | features | `(B, 32, 16, 16, 1024)` |
| Gaze extraction | foveal | `(B, 32, 1024)` |
| Classification | logits | `(B, 6)` |

## Validation Steps

1. Read each model file in `src/model/`
2. Check docstrings and comments for shape annotations
3. Verify reshape operations maintain consistency:
   - 8192 = 32 × 16 × 16 (temporal × spatial × spatial)
   - Gaze downsampling: 64 frames → 32 tubelets
4. Report any mismatches or missing shape documentation

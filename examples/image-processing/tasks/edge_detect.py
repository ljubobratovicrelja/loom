#!/usr/bin/env python3
"""Apply Canny edge detection to an image.

Uses OpenCV's Canny algorithm to detect edges.

---
inputs:
  image:
    type: image
    description: Input grayscale image
outputs:
  -o:
    type: image
    description: Output edge image
args:
  --low:
    type: int
    default: 50
    description: Lower threshold for hysteresis
  --high:
    type: int
    default: 150
    description: Upper threshold for hysteresis
---
"""

import argparse

import cv2


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply Canny edge detection")
    parser.add_argument("image", help="Input image path")
    parser.add_argument("-o", "--output", required=True, help="Output image path")
    parser.add_argument("--low", type=int, default=50, help="Lower threshold")
    parser.add_argument("--high", type=int, default=150, help="Upper threshold")
    args = parser.parse_args()

    # Read the image (grayscale)
    img = cv2.imread(args.image, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"Could not read image: {args.image}")

    # Apply Canny edge detection
    edges = cv2.Canny(img, args.low, args.high)

    # Save the result
    cv2.imwrite(args.output, edges)
    print(f"Edge detection (low={args.low}, high={args.high}): {args.image} -> {args.output}")


if __name__ == "__main__":
    main()

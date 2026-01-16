#!/usr/bin/env python3
"""Apply Gaussian blur to an image.

Uses OpenCV's Gaussian blur filter.

---
inputs:
  image:
    type: image
    description: Input image
outputs:
  -o:
    type: image
    description: Output blurred image
args:
  --radius:
    type: int
    default: 15
    description: Blur kernel size (must be odd)
---
"""

import argparse

import cv2


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply Gaussian blur")
    parser.add_argument("image", help="Input image path")
    parser.add_argument("-o", "--output", required=True, help="Output image path")
    parser.add_argument("--radius", type=int, default=15, help="Blur kernel size")
    args = parser.parse_args()

    # Read the image
    img = cv2.imread(args.image)
    if img is None:
        raise ValueError(f"Could not read image: {args.image}")

    # Ensure kernel size is odd
    ksize = args.radius
    if ksize % 2 == 0:
        ksize += 1

    # Apply Gaussian blur
    blurred = cv2.GaussianBlur(img, (ksize, ksize), 0)

    # Save the result
    cv2.imwrite(args.output, blurred)
    print(f"Gaussian blur (radius={ksize}): {args.image} -> {args.output}")


if __name__ == "__main__":
    main()

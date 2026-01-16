#!/usr/bin/env python3
"""Convert an image to grayscale.

Uses OpenCV to convert a color image to grayscale.

---
inputs:
  image:
    type: image
    description: Input color image
outputs:
  -o:
    type: image
    description: Output grayscale image
---
"""

import argparse

import cv2


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert image to grayscale")
    parser.add_argument("image", help="Input image path")
    parser.add_argument("-o", "--output", required=True, help="Output image path")
    args = parser.parse_args()

    # Read the image
    img = cv2.imread(args.image)
    if img is None:
        raise ValueError(f"Could not read image: {args.image}")

    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Save the result
    cv2.imwrite(args.output, gray)
    print(f"Converted to grayscale: {args.image} -> {args.output}")


if __name__ == "__main__":
    main()

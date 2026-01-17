#!/usr/bin/env python3
"""Generate synthetic noisy data from a known function.

Creates a CSV with x values and noisy y values following an exponential decay
model: y = a * exp(-b * x) + c

---
outputs:
  --output:
    type: csv
    description: Output CSV with x and y columns
args:
  --samples:
    type: int
    default: 50
    description: Number of data points to generate
  --noise:
    type: float
    default: 0.5
    description: Standard deviation of Gaussian noise
  --seed:
    type: int
    default: 42
    description: Random seed for reproducibility
---
"""

import argparse
import csv

import numpy as np


def exponential_decay(x, a, b, c):
    """Exponential decay model: y = a * exp(-b * x) + c"""
    return a * np.exp(-b * x) + c


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic curve data")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--samples", type=int, default=50, help="Number of samples")
    parser.add_argument("--noise", type=float, default=0.5, help="Noise level")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    np.random.seed(args.seed)

    # True parameters (unknown to the fitting step)
    true_a = 5.0
    true_b = 0.3
    true_c = 1.0

    # Generate x values
    x = np.linspace(0, 10, args.samples)

    # Generate y values with noise
    y_true = exponential_decay(x, true_a, true_b, true_c)
    y_noisy = y_true + np.random.normal(0, args.noise, size=x.shape)

    # Write to CSV
    with open(args.output, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["x", "y"])
        for xi, yi in zip(x, y_noisy):
            writer.writerow([round(xi, 6), round(yi, 6)])

    print(f"Generated {args.samples} samples with noise={args.noise}")
    print(f"True parameters: a={true_a}, b={true_b}, c={true_c}")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()

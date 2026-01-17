#!/usr/bin/env python3
"""Plot raw data points.

Reads a CSV file and creates a scatter plot of the data.

---
inputs:
  data:
    type: csv
    description: Input CSV with x and y columns
outputs:
  --output:
    type: image
    description: Output PNG image of the scatter plot
---
"""

import argparse
import csv

import matplotlib.pyplot as plt
import numpy as np


def main():
    parser = argparse.ArgumentParser(description="Plot raw data")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output PNG path")
    args = parser.parse_args()

    # Read data
    x_data = []
    y_data = []
    with open(args.data, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            x_data.append(float(row["x"]))
            y_data.append(float(row["y"]))

    x = np.array(x_data)
    y = np.array(y_data)

    # Create plot
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.scatter(x, y, alpha=0.7, s=50, c="steelblue", edgecolors="white", linewidth=0.5)
    ax.set_xlabel("x", fontsize=12)
    ax.set_ylabel("y", fontsize=12)
    ax.set_title("Raw Data Points", fontsize=14)
    ax.grid(True, alpha=0.3)

    # Save plot
    fig.savefig(args.output, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    print(f"Plotted {len(x)} data points -> {args.output}")


if __name__ == "__main__":
    main()

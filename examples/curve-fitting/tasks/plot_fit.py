#!/usr/bin/env python3
"""Plot data with fitted curve overlay.

Reads the original data and fitted parameters to create a comparison plot.

---
inputs:
  data:
    type: csv
    description: Input CSV with x and y columns
  params:
    type: json
    description: JSON with fitted parameters
outputs:
  --output:
    type: image
    description: Output PNG image showing data and fitted curve
---
"""

import argparse
import csv
import json

import matplotlib.pyplot as plt
import numpy as np


def exponential_decay(x, a, b, c):
    """Exponential decay model: y = a * exp(-b * x) + c"""
    return a * np.exp(-b * x) + c


def main():
    parser = argparse.ArgumentParser(description="Plot data with fitted curve")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("params", help="Fitted parameters JSON path")
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

    # Read fitted parameters
    with open(args.params) as f:
        fit_result = json.load(f)

    if not fit_result.get("success", False):
        print(f"Fitting was not successful: {fit_result.get('error', 'unknown')}")
        # Still create a plot with just the data
        fig, ax = plt.subplots(figsize=(10, 6))
        ax.scatter(x, y, alpha=0.7, s=50, c="steelblue", label="Data")
        ax.set_xlabel("x", fontsize=12)
        ax.set_ylabel("y", fontsize=12)
        ax.set_title("Data (Fitting Failed)", fontsize=14)
        ax.legend()
        ax.grid(True, alpha=0.3)
        fig.savefig(args.output, dpi=150, bbox_inches="tight", facecolor="white")
        plt.close(fig)
        return

    params = fit_result["parameters"]
    a, b, c = params["a"], params["b"], params["c"]
    stats = fit_result["statistics"]

    # Generate smooth curve for plotting
    x_smooth = np.linspace(min(x), max(x), 200)
    y_smooth = exponential_decay(x_smooth, a, b, c)

    # Create plot
    fig, ax = plt.subplots(figsize=(10, 6))

    # Plot data points
    ax.scatter(
        x,
        y,
        alpha=0.7,
        s=50,
        c="steelblue",
        edgecolors="white",
        linewidth=0.5,
        label="Data",
        zorder=2,
    )

    # Plot fitted curve
    ax.plot(x_smooth, y_smooth, "r-", linewidth=2, label="Fitted curve", zorder=1)

    # Add equation and stats to plot
    equation = f"y = {a:.3f} * exp(-{b:.3f} * x) + {c:.3f}"
    stats_text = f"R² = {stats['r_squared']:.4f}\nRMSE = {stats['rmse']:.4f}"
    ax.text(
        0.95,
        0.95,
        f"{equation}\n{stats_text}",
        transform=ax.transAxes,
        fontsize=10,
        verticalalignment="top",
        horizontalalignment="right",
        bbox=dict(boxstyle="round", facecolor="wheat", alpha=0.5),
    )

    ax.set_xlabel("x", fontsize=12)
    ax.set_ylabel("y", fontsize=12)
    ax.set_title("Exponential Decay Curve Fitting", fontsize=14)
    ax.legend(loc="upper left")
    ax.grid(True, alpha=0.3)

    # Save plot
    fig.savefig(args.output, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    print(f"Created comparison plot -> {args.output}")


if __name__ == "__main__":
    main()

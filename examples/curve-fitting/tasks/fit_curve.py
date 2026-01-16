#!/usr/bin/env python3
"""Fit an exponential decay model to data.

Uses scipy.optimize.curve_fit to find the best parameters for:
y = a * exp(-b * x) + c

---
inputs:
  data:
    type: csv
    description: Input CSV with x and y columns
outputs:
  --output:
    type: json
    description: Output JSON with fitted parameters and statistics
---
"""

import argparse
import csv
import json

import numpy as np
from scipy.optimize import curve_fit


def exponential_decay(x, a, b, c):
    """Exponential decay model: y = a * exp(-b * x) + c"""
    return a * np.exp(-b * x) + c


def main():
    parser = argparse.ArgumentParser(description="Fit exponential decay curve")
    parser.add_argument("data", help="Input CSV path")
    parser.add_argument("-o", "--output", required=True, help="Output JSON path")
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

    # Initial guess for parameters
    p0 = [max(y) - min(y), 0.1, min(y)]

    # Fit the curve
    try:
        popt, pcov = curve_fit(exponential_decay, x, y, p0=p0, maxfev=5000)
        a, b, c = popt

        # Calculate fit statistics
        y_pred = exponential_decay(x, *popt)
        residuals = y - y_pred
        ss_res = np.sum(residuals**2)
        ss_tot = np.sum((y - np.mean(y)) ** 2)
        r_squared = 1 - (ss_res / ss_tot)
        rmse = np.sqrt(np.mean(residuals**2))

        # Parameter uncertainties (standard errors)
        perr = np.sqrt(np.diag(pcov))

        result = {
            "model": "y = a * exp(-b * x) + c",
            "parameters": {"a": round(a, 6), "b": round(b, 6), "c": round(c, 6)},
            "uncertainties": {
                "a_std": round(perr[0], 6),
                "b_std": round(perr[1], 6),
                "c_std": round(perr[2], 6),
            },
            "statistics": {
                "r_squared": round(r_squared, 6),
                "rmse": round(rmse, 6),
                "n_points": len(x),
            },
            "success": True,
        }

        print(f"Fitted parameters: a={a:.4f}, b={b:.4f}, c={c:.4f}")
        print(f"R-squared: {r_squared:.4f}, RMSE: {rmse:.4f}")

    except Exception as e:
        result = {"success": False, "error": str(e)}
        print(f"Fitting failed: {e}")

    # Save results
    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()

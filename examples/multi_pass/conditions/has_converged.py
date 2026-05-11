"""Condition script: check if signal smoothing has converged."""

import csv


def evaluate(cleaned_csv: str, tolerance: float = 0.01) -> bool:
    """Return True to STOP iterating (convergence reached).

    Computes the mean absolute consecutive difference of the 'value' column.
    If this metric falls below the tolerance, the signal is considered smooth enough.
    """
    with open(cleaned_csv) as f:
        rows = list(csv.DictReader(f))

    values = [float(r["value"]) for r in rows]
    if len(values) < 2:
        return True

    diffs = [abs(values[i + 1] - values[i]) for i in range(len(values) - 1)]
    mean_diff = sum(diffs) / len(diffs)
    print(f"  [condition] mean_diff={mean_diff:.4f}  tolerance={tolerance}")
    return mean_diff < tolerance

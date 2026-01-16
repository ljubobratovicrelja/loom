#!/usr/bin/env python3
"""Generate synthetic sensor readings.

Creates a CSV with timestamp, temperature, and humidity columns.
Data includes some realistic variation and occasional spikes.

---
outputs:
  --output:
    type: csv
    description: Output CSV with sensor readings
args:
  --samples:
    type: int
    default: 100
    description: Number of data points to generate
---
"""

import argparse
import csv
import random
from datetime import datetime, timedelta


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic sensor data")
    parser.add_argument("-o", "--output", required=True, help="Output CSV path")
    parser.add_argument("--samples", type=int, default=100, help="Number of samples")
    args = parser.parse_args()

    random.seed(42)  # Reproducible output

    base_time = datetime(2024, 1, 1, 8, 0, 0)
    base_temp = 22.0
    base_humidity = 45.0

    rows = []
    for i in range(args.samples):
        timestamp = base_time + timedelta(minutes=i * 5)

        # Temperature: base + daily cycle + noise + occasional spikes
        hour_factor = abs(12 - timestamp.hour) / 12  # Cooler at noon
        temp = base_temp + (hour_factor * 3) + random.gauss(0, 0.5)
        if random.random() < 0.05:  # 5% chance of spike
            temp += random.uniform(2, 5)

        # Humidity: inverse relationship with temperature + noise
        humidity = base_humidity - (temp - base_temp) * 2 + random.gauss(0, 2)
        humidity = max(20, min(80, humidity))  # Clamp to realistic range

        rows.append({
            "timestamp": timestamp.isoformat(),
            "temperature": round(temp, 2),
            "humidity": round(humidity, 2)
        })

    with open(args.output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "temperature", "humidity"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {args.samples} samples -> {args.output}")


if __name__ == "__main__":
    main()

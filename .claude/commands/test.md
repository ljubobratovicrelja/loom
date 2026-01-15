---
description: Run pytest with optional path and coverage report
allowed-tools: Bash
argument-hint: [test_path]
---

# Run Tests

Run the test suite using pytest.

## Usage

- `/test` — Run all tests with coverage
- `/test tests/test_config.py` — Run specific test file
- `/test tests/test_model.py::test_forward` — Run specific test

## Command

```bash
source venv/bin/activate && pytest $ARGUMENTS --cov=src --cov-report=term-missing -v
```

If no arguments provided, run all tests in `tests/` directory.

Report results and highlight any failures.

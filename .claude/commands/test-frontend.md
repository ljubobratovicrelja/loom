---
description: Run frontend tests for the loom editor
allowed-tools: Bash
argument-hint: [test_path]
---

# Run Frontend Tests

Run the frontend test suite using Vitest.

## Usage

- `/test-frontend` — Run all frontend tests once
- `/test-frontend src/hooks/useHistory.test.ts` — Run specific test file
- `/test-frontend --watch` — Run in watch mode

## Command

```bash
cd src/editor/frontend && npm run test:run -- $ARGUMENTS
```

If `--watch` is passed, use `npm test` instead for interactive mode.

Report results and highlight any failures. For failing tests, show the relevant test code and the error message.

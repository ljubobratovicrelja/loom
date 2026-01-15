---
description: Stage, commit, and optionally push changes
allowed-tools: Bash, AskUserQuestion
---

# Commit Changes

Analyze changes, group them logically, and create commits with minimal messages.

## Workflow

1. Run `git status` and `git diff` to see all changes
2. Analyze the diff and group related changes into logical commits
3. For each group:
   - Stage the related files
   - Write a commit message:
     - One-liner for simple changes
     - Multi-line (still minimal) only for complex changes
     - Never add Co-Authored-By or credit Claude
   - Create the commit
4. After all commits, ask user if they want to push
5. If yes, push to origin

## Commit Message Style

- Imperative mood ("Add feature" not "Added feature")
- Lowercase after prefix if using conventional commits
- No period at end
- One-liner default, multi-line only when genuinely complex
- Examples:
  - `Fix null pointer in user validation`
  - `Replace decord with OpenCV for video loading`
  - `Add retry logic to API client`

## Grouping Strategy

Group by logical change:
- Files modified for the same feature/fix go together
- Config changes with their code changes
- Doc updates with their related code (if same feature)
- Unrelated changes get separate commits

## Important

- Never use `--no-verify` or skip hooks
- Never force push
- Always show the user what will be committed before committing

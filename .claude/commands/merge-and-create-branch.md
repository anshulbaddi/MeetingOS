Commit all uncommitted changes on the current branch, merge that branch into main, resolve any conflicts or issues that arise from the merge, then create and switch to a new branch named $ARGUMENTS.

Follow these steps in order:

## Step 1 — Commit current branch changes

1. Run `git status` to see what is staged, unstaged, and untracked.
2. Run `git diff` to review unstaged changes.
3. Stage all relevant changed and untracked files by name (avoid `git add -A` if any file looks like it could contain secrets).
4. Write a concise commit message summarising the changes, then commit.
5. If a pre-commit hook fails, fix the reported issue, re-stage, and create a fresh commit (never amend after a hook failure).

## Step 2 — Merge current branch into main

1. Note the name of the current branch (call it FEATURE_BRANCH).
2. Switch to `main`: `git checkout main`.
3. Pull latest main to make sure it is up to date: `git pull origin main`.
4. Merge the feature branch: `git merge FEATURE_BRANCH`.

## Step 3 — Resolve any merge issues

If the merge produces conflicts:
- Inspect each conflicted file with Read.
- Resolve by keeping the correct content (prefer the incoming changes from FEATURE_BRANCH unless the main version is clearly more correct).
- Stage resolved files and complete the merge with `git merge --continue` (using a HEREDOC for the commit message).

If the merge fails for any other reason (build errors, lint errors, test failures):
- Diagnose and fix the root cause.
- Stage the fixes and commit them on main before proceeding.

## Step 4 — Create and switch to the new branch

Run:
```
git checkout -b $ARGUMENTS
```

Confirm success by running `git branch --show-current` and report the final branch name to the user.

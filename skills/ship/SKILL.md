---
name: ship
description: Prove the current uncommitted work, then commit, push, open the PR, watch CI to green, and verify the change live. Use when the user types /ship or says "ship it" / "commit and push it all". `/ship check` runs only the proof gate and does not commit.
---

# /ship: prove, ship, then confirm it's live

Running `/ship` is the user's order to commit and push. `/ship check` (or "prove it") runs steps 1–2 only and stops before committing.

Work through the steps on your own. Stop and ask only when a step truly fails and the fix would change scope. Never say something passed unless you read its real exit code. A piped command like `cmd | tail` hides the exit code, so use `set -o pipefail` or check `$?`/`$LASTEXITCODE` directly.

## 1. Pre-flight: know what you're shipping
- `git status` and `git diff --stat`, including untracked files. List every changed file and say in one line why it changed.
- Look for things that must not ship: secrets and tokens, `.env` files, debug prints, stray scratch files, and regenerated files the project keeps out of commits (check memory, e.g. LeviOps `app/queueSnapshot.ts`).
- Read the full diff once, looking for bugs, not style. Fix anything real now and say what you fixed.
- If you're on `main` or a detached HEAD, plan a branch. Follow any branch convention the project memory records.

## 2. The proof gate: evidence, not claims
Run whichever of these the project has. Find the commands in package.json, the Makefile, CLAUDE.md, CI config, or memory:
- **Build** (e.g. `npm run build`) and **typecheck/lint** if configured.
- **Tests.** For each new or changed test, run a mutation check: break the code it covers, confirm the test fails, then restore the code. Report which tests were checked this way.
- **No ChatGPT second opinion.** Levi (2026-09-29): ChatGPT is for getting work done, not for reviewing it. Don't run `chatgpt_second_opinion.py` or send the diff to ChatGPT; the review is yours (step 1's diff read).
- **UI changes:** take screenshots of the changed screens (desktop, plus mobile if the app is used on a phone) with the browser pane, and send them with SendUserFile.
- **Any red check:** show whether it was already failing before your change. Run it on the base commit (`git stash -u` → run → `git stash pop`, or a worktree at `main`). If it fails there too, call it pre-existing and cite the output. If it doesn't, the failure is yours: fix it.

Produce a proof table: check | command | exit code | result. If anything is red and not pre-existing, stop here and fix it before continuing.

## 3. Commit and push
- Create or switch to the branch. Merge the latest base branch in first; in an app-made worktree, use the ccd_host `sync_with_base_branch` tool instead of merging by hand.
- Stage files explicitly, never with `git add -A` when step 1 found things to exclude. Write a commit message that explains why, not just what, with the attribution trailer from the system reminder.
- Push to the right remote. Check `git remote -v`, because it isn't always `origin` (LeviOps uses `github`).
- Open the PR with `gh pr create`. The body covers what changed, why, and the proof table, and ends with the PR attribution line. Leave the app's Auto-fix monitor off (Levi, 2026-10-08: it is not going to work); don't turn it on or offer it.

## 4. Watch CI to green
- Use the ccd_pr tools to read status; don't poll gh in a loop. If a check fails, read the log, then either fix and push or prove it's a pre-existing flake (the same failure shows on `main`).
- Note whether the repo auto-merges (e.g. a leviops `auto-merge.yml`). If it does, a green PR means it has shipped.

## 5. Verify live
Find how this project deploys (check memory). Verify the real running environment, not the source code. Examples:
- **LeviOps:** after the merge, run `npm run build` in the app folder, kill the PID on :3000 and let the supervisor respawn it, confirm a 200 from http://127.0.0.1:3000/, and check the changed behavior on the actual page. For sheet or data changes, run `scripts\refresh_snapshot.py` and expect `LIVE_FEED_PUSH_OK`.
- **Staging/prod web apps:** load the deployed URL and check the specific change (screenshot or response body), not just that the site is up.
- **If there's no deploy target** (a library, a script): say so plainly. "Merged and green" is then the end state.

## 6. Close out
- File follow-ups for leftovers found along the way: a spawn_task chip, or an issue if the repo uses them.
- If this project's ship steps held something non-obvious you had to figure out, save it to memory so the next /ship already knows it.
- Final report, short and plain:
  - **Shipped:** yes/no, PR link, merge commit
  - **Proof:** the table from step 2 plus CI result
  - **Live:** what you checked and what you saw
  - **Follow-ups:** a list, or "none"

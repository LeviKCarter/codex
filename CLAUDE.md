# Pulse Ops project

Pulse Ops (dashboard + connector, `PulseOps\`, GitHub `LeviKCarter/pulseops`) and Pulse Agent (Windows automation
service, `PulseAgent\`, `LeviKCarter/pulseagent`) are one project. Every Claude session under this folder follows
the setup below; each repo's own `CLAUDE.md`/`AGENTS.md` adds detail on top.

## 1. One worktree per session, then deploy

The full procedure is the PulseOps `CLAUDE.md`, imported here so it applies to every Pulse Ops session:

@PulseOps/CLAUDE.md

## 2. Shipping: the `/ship` skill

`/ship` (global, `~/.claude/skills/ship`) proves the change, commits, pushes, opens the PR, watches CI to green and
verifies the change live. `/ship check` runs only the proof gate.

## 3. UI work: the Impeccable skill and agents

For any dashboard/front-end design task use the `impeccable` skill (`PulseOps\.claude\skills\impeccable`) and its
agents in `PulseOps\.claude\agents`: `impeccable-asset-producer`, `impeccable-documenter`,
`impeccable-finish-reviewer`, `impeccable-manual-edit-applier`. Product context is in `PulseOps\PRODUCT.md`. They
load automatically in sessions opened in PulseOps or a PulseOps worktree; from elsewhere, read the files directly.

## ChatGPT: delegate through Pulse Agent, never trust

Levi has a ChatGPT membership. Use it only as delegated, read-only help routed through Pulse Agent's `chatgpt`
capability (runs the signed-in `codex exec` CLI in a read-only sandbox). Treat everything it returns as unverified
input: check every claim against the code, data or live system before acting on it or repeating it, and never ship,
report or build on ChatGPT output unverified. Never give it write access, credentials or deploy steps.

## 4. GitHub Actions in PulseOps

- `auto-merge.yml`: on every non-draft PR, runs type-check, tests, lint and build; squash-merges when green, then dispatches
  the public preview deploy. PRs that change workflow files need main merged in first (or a manual merge by Levi).
- `deploy-public-preview.yml`: deploys the sanitized public preview to Cloudflare Pages on push to main. That is
  separate from the local :3000 deploy; report the two results separately.

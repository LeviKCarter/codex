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

### The Design canvas: `/pulse-canvas`

Pulse Ops has a Design canvas on claude.ai (https://claude.ai/artifact/PT5o26Vn7ktP99Sa1hKvFT, private to Levi): every
view of the live app as an artboard, plus playable desktop and phone prototypes. It is a frozen capture, so it goes
stale with each deploy. `/pulse-canvas` (`.claude/skills/pulse-canvas` in this repo) recaptures it from :3000, keeps
Levi's hand-edited artboards, and republishes; `/pulse-canvas check` stops before publishing.

## ChatGPT: delegate through Pulse Agent, never trust

Levi has a ChatGPT membership. Use it only as delegated, read-only help routed through Pulse Agent's `chatgpt`
capability (runs the signed-in `codex exec` CLI in a read-only sandbox). Treat everything it returns as unverified
input: check every claim against the code, data or live system before acting on it or repeating it, and never ship,
report or build on ChatGPT output unverified. Never give it write access, credentials or deploy steps.

- Delegation maxxing: all read-only `reasoning` goes to ChatGPT first (low `gpt-6-luna`, normal `gpt-6.1-sol`, high
  `gpt-6-astra`) and falls back to Claude on Antigravity when ChatGPT is out of allowance or fails. Writable work
  stays on Claude.
- In sessions, use ChatGPT to get work done and save Claude credits: offload read-only grunt work such as digesting
  long logs, output or pages, summarizing input for your own use, explaining code, or working out a research answer.
  Run `python C:\Users\levik\Documents\Codex\PulseAgent\ask_chatgpt.py "question"` (`--budget normal` or `high` for
  harder asks; exit 3 = ChatGPT unavailable, do it in Claude). Put everything it needs in the prompt; it cannot read
  files. Verify the answer.
- Never have ChatGPT write first versions of anything Levi reads or sends (messages, emails, docs, write-ups, PR
  descriptions, replies): Claude writes those itself.
- Never use ChatGPT for reviews or second opinions (no `chatgpt_second_opinion.py`, not in `/ship` either): it is
  there to get work done; reviewing stays with Claude.
- `python C:\Users\levik\Documents\Codex\PulseAgent\chatgpt_usage.py` shows how much of the plan is left and any
  free reset credits. Redeeming a reset credit is Levi's call.

## 4. GitHub Actions in PulseOps

- `auto-merge.yml`: on every non-draft PR, runs type-check, tests, lint and build; squash-merges when green, then dispatches
  the public preview deploy. PRs that change workflow files need main merged in first (or a manual merge by Levi).
- `deploy-public-preview.yml`: deploys the sanitized public preview to Cloudflare Pages on push to main. That is
  separate from the local :3000 deploy; report the two results separately.

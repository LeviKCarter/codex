# Codex: all of Levi's projects

`C:\Users\levik\Documents\Codex` is the home of every project Levi has Claude work on. Every Claude session opened
under this folder follows this file, whatever project the work is on; each project's own `CLAUDE.md`/`AGENTS.md`
adds detail on top. The folder root is its own repo, `LeviKCarter/codex` (public: treat anything tracked here as
published), with an allowlist `.gitignore` because the folder also holds the other repos, secrets and scratch data.

## The projects

| Project | What it is | Where | Repo | Ships by |
| --- | --- | --- | --- | --- |
| Pulse Ops | Dashboard (:3000 and the phone app) and the claude.ai connector | `PulseOps\` is live and deploy-only; work in `PulseOps-worktrees\<name>` | `LeviKCarter/pulseops` | PR, merge by hand, `deploy_live.ps1` (see "Pulse Ops" below) |
| Pulse Mobile | Pulse Ops' Android app | `mobile\android` in the Pulse Ops repo | `LeviKCarter/pulseops` | `scripts\build_pulse_mobile.ps1` from the worktree builds, signs and publishes it |
| Pulse Agent | Windows automation service, one project with Pulse Ops | `PulseAgent\` is the source checkout the dashboard runs scripts from; work in `PulseAgent-worktrees\<name>` | `LeviKCarter/pulseagent` | PR, squash-merge by hand, then `git pull --ff-only origin main` in `PulseAgent\` |
| WoW tools | The WoW Forever shortcut, addon guard, hook patches, crash reports, item lookups, patch day | `wow\` | `LeviKCarter/codex` | PR, squash-merge by hand |
| Userscripts | Reddit Quick Mute (phone), Uber Trip History, Maps Links | `userscripts\` (details in `userscripts\AGENTS.md`) | `LeviKCarter/codex` | PR, squash-merge by hand; Maps Links is then copied to `Documents\Maps Links` |
| Block Filter | Reddit/YouTube/Instagram blocker extension and its phone userscript | `userscripts\block-filter\`, git-ignored on purpose | none (phone build in a secret Gist) | `python phone/publish.py`; the PC copy goes to `Documents\Block Filter` |
| Skills | `/ship`, `/archive-finished`, `/held-cart`, `/spotify-artists` (global), `/pulse-canvas` (this folder only) | `skills\`, `.claude\skills\` | `LeviKCarter/codex` | PR, squash-merge by hand, then `git pull --ff-only` in the main checkout (the global ones are junctions to it) |

Outside this folder: Personal Browser Tools, the Instagram video-controls extension, lives in
`G:\My Drive\Programs\instagram-video-controls-personal` (no git; back it up beside itself before editing).

`LeviAgent`, `LeviAgent-NodeRED` and `LeviOps-V11-6026-v10` are intentional junctions to the old names. The dated
folders (`2026-10-19` and so on) are scratch space.

### Adding a project

1. Give it a folder here. If it gets its own repo, create it under `LeviKCarter` and keep it private unless Levi says
   otherwise; if it lives in this repo, add `!path` lines to `.gitignore` for each file or folder it tracks.
2. Give it its own `CLAUDE.md` or `AGENTS.md` (how to test it, how it ships, where it runs live).
3. Add a row to the table above, in the same PR.

## Rules for every project

- **One worktree per session.** Never edit a live or shared checkout: `PulseOps\` (the live dashboard),
  `PulseAgent\` (the dashboard runs its scripts in place), or the main checkout of this repo (it often holds other
  sessions' uncommitted work; never stash or overwrite it). Pulse Ops and Pulse Agent have their own worktree
  folders above; work on this repo goes in a worktree of it (the app makes them under `.claude\worktrees`).
- **Ship with `/ship`.** `/ship` (global: `~/.claude/skills/ship` is a junction to `skills/ship` in this repo's main
  checkout, so edit it through a PR here) proves the change, commits, pushes, opens the PR, merges it by hand and
  verifies the change live. `/ship check` runs only the proof gate.
- **Merge by hand.** GitHub has started no Actions job on this account since 2026-10-05 (billing), so nothing merges
  itself: every session squash-merges its own PR as soon as it is open, with its local checks as the gate (Levi,
  2026-10-08: "always auto merge by hand", "merge it automatically from now on").
- **Tidy up with `/archive-finished`.** It (global, same junction setup, `skills/archive-finished`) archives the
  desktop sessions whose work is done and removes the PulseOps worktrees that merged work left behind.
  `/archive-finished check` changes nothing.

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

## Pulse Ops

Pulse Ops (dashboard + connector, `PulseOps\`, GitHub `LeviKCarter/pulseops`) and Pulse Agent (Windows automation
service, `PulseAgent\`, `LeviKCarter/pulseagent`) are one project.

### One worktree per session, then deploy

The full procedure is the PulseOps `CLAUDE.md`, imported here so a session started anywhere in this folder has it:

@PulseOps/CLAUDE.md

### UI work: the Impeccable skill and agents

For any dashboard/front-end design task use the `impeccable` skill (`PulseOps\.claude\skills\impeccable`) and its
agents in `PulseOps\.claude\agents`: `impeccable-asset-producer`, `impeccable-documenter`,
`impeccable-finish-reviewer`, `impeccable-manual-edit-applier`. Product context is in `PulseOps\PRODUCT.md`. They
load automatically in sessions opened in PulseOps or a PulseOps worktree; from elsewhere, read the files directly.

### The Design canvas: `/pulse-canvas`

Pulse Ops has a Design canvas on claude.ai (https://claude.ai/artifact/PT5o26Vn7ktP99Sa1hKvFT, private to Levi): every
view of the live app as an artboard, plus playable desktop and phone prototypes. It is a frozen capture, so it goes
stale with each deploy. `/pulse-canvas` (`.claude/skills/pulse-canvas` in this repo) recaptures it from :3000, keeps
Levi's hand-edited artboards, and republishes; `/pulse-canvas check` stops before publishing.

### GitHub Actions in PulseOps

- `auto-merge.yml`: on every non-draft PR, runs type-check, tests, lint and build; squash-merges when green, then dispatches
  the public preview deploy. PRs that change workflow files need main merged in first (or a manual merge by Levi).
  While Actions starts no jobs (see "Merge by hand" above) every run fails in seconds with no runner, so it merges
  nothing; the session merges its own PR (`/ship` step 4, and the PulseOps `CLAUDE.md`, "What's automatic").
- `deploy-public-preview.yml`: deploys the sanitized public preview to Cloudflare Pages on push to main. That is
  separate from the local :3000 deploy; report the two results separately.

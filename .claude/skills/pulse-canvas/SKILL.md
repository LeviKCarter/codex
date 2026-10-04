---
name: pulse-canvas
description: Refresh the Pulse Ops Design canvas on claude.ai from the live app on :3000, so its artboards and playable prototypes match what is deployed. Use when the user types /pulse-canvas or says "update the canvas", "refresh the Pulse Ops design", or "make the canvas match live". `/pulse-canvas check` captures and builds but does not publish.
---

# /pulse-canvas: recapture live Pulse Ops into the Design canvas

The canvas is https://claude.ai/artifact/PT5o26Vn7ktP99Sa1hKvFT (Design type, private to Levi). Each artboard is the
live app's rendered markup plus its compiled stylesheet, frozen at capture time; `Main.dc.html` and `Phone.dc.html`
are playable prototypes that switch between those artboards. The canvas cannot run the app's code, so "update" always
means recapture and rebuild.

Running `/pulse-canvas` is the go-ahead to publish (it puts Levi's real dashboard data on his private claude.ai
canvas; he approved that on 2026-10-03). `/pulse-canvas check` stops after step 4.

Scripts are beside this file in `scripts/`. Work in a fresh folder `<work>` in the session scratchpad.

## 1. Know what you are capturing

- `git -C C:\Users\levik\Documents\Codex\PulseOps log -1 --format="%h %s"` is what :3000 serves (the live folder only
  ever holds deployed main). Report that commit. Open PRs are not on the canvas; list them (`gh pr list`) so the
  report can say what is missing.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` must be 200.
- Other sessions deploy to :3000 while you work. Read the commit again after the capture; if it moved, say which
  commit each part came from, or recapture.

## 2. Protect hand edits on the canvas

Levi edits artboards by hand. Before overwriting anything:

1. Artifact `list` with `scope: "files"` and the canvas url, and `read` `project/canvas.json` (the saved copy lands
   under `artifact-files/<id>/project/canvas.json` in the scratchpad; pass that path to the build as `--index`).
2. Compare each `project/*.dc.html` size with `~/.claude/pulse-canvas/published.json` (written by the last run). A different size
   means it was edited since. `read` that file, work out what changed, and pass its name to the build's `--skip` so
   it is left alone. Tell Levi which artboards were kept and why; overwrite them only if he says so.
3. Positions, titles and notes in the index are his: the build keeps every existing `x`/`y` and only updates sizes.

## 3. Capture from the live app

1. Start the receiver in the background: `python scripts/capture_server.py <work>/captures` (127.0.0.1:4174, accepts
   posts from localhost:3000 only).
2. In the built-in browser: `navigate` to http://localhost:3000/, `resize_window` 1440x900, navigate again, wait 7 s.
   Then run this as `javascript_exec` text, once with `desktopVibe()` and once with `desktopClassic()`:

   ```js
   const src = await (await fetch('http://127.0.0.1:4174/capture.js')).text();
   await new (Object.getPrototypeOf(async function () {}).constructor)(src + ';return desktopVibe();')()
   ```
3. `resize_window` 390x844, navigate again, wait 7 s, run the same text with `phone()`.
4. Each run returns one row per view. Check them before building: every row must say `ok: true`, the `vibe`/`solo`
   columns must match the view's name, and any `MISSING` row is a control the script could not find. A missing
   control usually means the app renamed a lane or button: read the labels the row lists, fix `capture.js` and the
   lane tables at the top of `build.py`, and rerun that section. Do not build from a wrong capture.
5. Reset the viewport (`preset: "desktop"`), close the tab (music autoplays in it), stop the receiver.

Side effects to report: in the built-in browser's own profile the capture presses M and F and opens lanes, so its
saved view may change. It touches no dashboard data. Screenshots of :3000 time out in this pane; rely on the rows.

## 4. Build and test

```
python scripts/build.py --captures <work>/captures --out <work>/canvas --index <saved canvas.json> [--skip A.dc.html,…] [--remove B.dc.html,…]
node scripts/check.js <work>/canvas/project
```

`build.py` rewrites `html[data-…]` selectors onto the artboard root, pins `vh` to the frame height, drops remote
images and video (the canvas cannot load YouTube), wires lane buttons to the prototype, and prints the `files` map
for the publish. `check.js` must print no `MISSING` line and its scripted walk must end where the comments in it
say. A new view in the app needs an entry in `BOARDS` (and in the prototype view lists) in `build.py`. When the
app drops a view (the build prints `NO CAPTURE … left as it is`), pass its artboard to `--remove` so a stale copy
does not stay on the canvas, and say so in the report.

## 5. Publish and record

One Artifact `publish` call: `url` the canvas, `root` `<work>/canvas`, `file_path` `<work>/canvas/project/canvas.json`,
`files` the map the build printed (it carries `null` for anything passed to `--remove`). If the publish is
refused because a file changed, re-read that file, treat it as a hand edit (step 2), rebuild, publish again.

After a successful publish: `python scripts/record.py <work>/canvas/project` (updates `~/.claude/pulse-canvas/published.json`). Delete the
entries of anything you removed from that file.

## 6. Report

Say plainly: the commit captured, which artboards were added, renamed or removed, which hand-edited artboards were
kept, which open PRs are not shown, and that the result was not seen rendered unless you actually looked at it.
The morning run prompt only exists before 10 AM Denver on run days; outside that the old capture stays, labelled
with its date.

---
name: spotify-artists
description: Refresh the list of Spotify artists Levi follows or has liked songs by, which PulseAgent's daily "Pulse Ops Spotify Artist Shows" task matches against Songkick's Denver calendar to put their shows on his concerts list. Use when the user types /spotify-artists or says "refresh my Spotify artists", "update the artist list", or when spotify_artist_shows.py says the list is STALE. `/spotify-artists check` reads Spotify and reports what changed but writes nothing.
---

# /spotify-artists: refresh the Spotify artist list

Why this exists: there is no Spotify sign-in on Levi's PC (a Spotify developer app wants Premium), so the artists the
concert finder matches are a copy read off his Spotify web player in Chrome. An artist he follows or likes after the
last copy only gets a concert once this runs again (or once Songkick tracks the artist). The list lives in
`%LOCALAPPDATA%\PulseAgent\pulse\spotify_artists.json`; the finder is `PulseAgent\spotify_artist_shows.py`
(pulseagent#86), and a run of it says STALE when the copy is over 45 days old.

Running `/spotify-artists` is the go-ahead to read his Spotify pages, replace the list and add the new shows to the
ledger. `/spotify-artists check` stops after step 5.

Use the Bash tool for every shell step, not PowerShell (Levi, 2026-10-13).

## 1. Open Spotify in his Chrome

Read the `anthropic-skills:chrome-browser` skill, load the Chrome tools in one ToolSearch call (core set plus
`get_page_text` and `javascript_tool`), call `tabs_context_mcp`, and open a new tab on
`https://open.spotify.com/collection/tracks`. If Spotify shows a log-in button instead of Liked Songs, stop and tell
him: signing in is his to do. Never sign in, change anything on the account, or follow or unfollow anyone.

Do not try to capture the web player's access token (hooking `fetch` for the `authorization` header): the auto-mode
classifier refuses it as credential exploration, and the page itself has everything needed.

## 2. Read Liked Songs

The list is a virtual grid that only renders the rows on screen, so it is read while scrolling. Each call reads for
at most 30 s (a Chrome call times out at 45 s); call it again until it answers `done`.

```js
const grid = document.querySelector('[data-testid="track-list"]');
let sc = grid; while (sc && !(sc.scrollHeight > sc.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
const st = window.__liked ??= { artists: {}, rows: {}, last: -1, stall: 0, started: false };
if (!st.started) { sc.scrollTop = 0; st.started = true; await new Promise((r) => setTimeout(r, 800)); }
const until = Date.now() + 30000; let done = false;
while (Date.now() < until) {
  grid.querySelectorAll('[role="row"][aria-rowindex]').forEach((r) => {
    const ids = [...r.querySelectorAll('a[href*="/artist/"]')].map((a) => { const id = a.getAttribute('href').split('/artist/')[1].split('?')[0]; st.artists[id] ??= a.textContent.trim(); return id; });
    if (ids.length) st.rows[r.getAttribute('aria-rowindex')] = ids;
  });
  sc.scrollTop += 500; await new Promise((r) => setTimeout(r, 200));
  if (sc.scrollTop === st.last) { if (++st.stall > 10) { done = true; break; } } else st.stall = 0;
  st.last = sc.scrollTop;
}
`${done ? 'done' : 'more'}: ${Object.keys(st.rows).length} of ${Number(grid.getAttribute('aria-rowcount')) - 1} songs, ${Object.keys(st.artists).length} artists`
```

The song count in the header ("1,399 songs") is the total; a few dozen rows have no artist link (local files, songs
no longer on Spotify), so expect about 97% (1,359 of 1,399 on 2026-10-13). Under 90% means the scroll skipped rows:
reload the page, `delete window.__liked`, and read again. Then keep the result across the next page load:

```js
const st = window.__liked; const n = {}; for (const ids of Object.values(st.rows)) for (const id of ids) n[id] = (n[id] ?? 0) + 1;
sessionStorage.setItem('__liked', JSON.stringify(Object.entries(st.artists).map(([id, name]) => ({ id, name, n: n[id] ?? 0 }))));
'kept ' + Object.keys(st.artists).length
```

## 3. Read who he follows

His profile id looks like base64 to the tool's output filter, so never return it: go there from inside the page.

```js
location.href = [...document.querySelectorAll('a[href*="/user/"]')].map((a) => a.getAttribute('href').split('?')[0])[0] + '/following'; 'going'
```

Then, on the Following page (call until `done`):

```js
let sc = document.querySelector('main a[href*="/artist/"]');
while (sc && !(sc.scrollHeight > sc.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
const st = window.__follow ??= { artists: {}, last: -1, stall: 0 };
const until = Date.now() + 30000; let done = false;
while (Date.now() < until) {
  document.querySelectorAll('main a[href*="/artist/"]').forEach((a) => { const id = a.getAttribute('href').split('/artist/')[1].split('?')[0]; st.artists[id] ??= a.textContent.trim() || a.getAttribute('title') || ''; });
  sc.scrollTop += 500; await new Promise((r) => setTimeout(r, 200));
  if (sc.scrollTop === st.last) { if (++st.stall > 10) { done = true; break; } } else st.stall = 0;
  st.last = sc.scrollTop;
}
`${done ? 'done' : 'more'}: ${Object.keys(st.artists).length} followed`
```

The page is alphabetical and showed exactly 1,000 on 2026-10-13, which may be a cap of Spotify's: if it says 1,000
again and the last names are not at the end of the alphabet, say so in the report.

## 4. Get the list onto the PC

Build the file in the page, one artist a line, `followed<TAB>liked<TAB>name`:

```js
const L = JSON.parse(sessionStorage.getItem('__liked') || '[]'), F = window.__follow.artists, m = new Map();
for (const [id, name] of Object.entries(F)) m.set(id, { name, f: 1, l: 0 });
for (const x of L) { const v = m.get(x.id) ?? { name: x.name, f: 0, l: 0 }; v.l = x.n; m.set(x.id, v); }
window.__tsv = [...m.values()].filter((v) => v.name).map((v) => `${v.f}\t${v.l}\t${v.name}`).join('\n') + '\n';
`${m.size} artists, ${window.__tsv.length} characters`
```

Ask Levi in chat before downloading it ("Download spotify-artists.tsv, about N KB, made in the page from your
Spotify lists, to your Downloads folder?"): downloading a file needs his yes each time. On a yes:

```js
const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([window.__tsv], { type: 'text/tab-separated-values' })), download: 'spotify-artists.tsv' });
document.body.append(a); a.click(); a.remove(); 'saved'
```

and take the newest `spotify-artists*.tsv` in `~/Downloads` (Chrome adds ` (1)` when one is there already). If he
says no, put the text in the page and read it with `get_page_text`, then write the lines to a `.tsv` in the
scratchpad with the Write tool. That costs about 30k output tokens for 1,900 artists, so the download comes first.

```js
const pre = document.createElement('pre'); pre.textContent = window.__tsv; document.body.replaceChildren(pre); 'shown'
```

Do not try to post it to a localhost listener: from open.spotify.com that call hung (Chrome's local-network check)
until the tool timed out.

Close the tab you opened (`tabs_close_mcp`).

## 5. Compare with the list on the PC

From `C:\Users\levik\Documents\Codex\PulseAgent` (the live checkout the daily task runs):

```bash
python spotify_artist_shows.py --artists "<file>.tsv" --compare
```

It prints how many artists the file has against the current list, how many are new and how many are gone, and
names up to 30 of each, and writes nothing. A file with under 80% of the current count is almost always a scroll that
stopped early: read that page again rather than replacing the list. `/spotify-artists check` stops here and reports.

## 6. Replace the list and add the new shows

```bash
python spotify_artist_shows.py --artists "<file>.tsv"
python spotify_artist_shows.py --apply
```

The first writes the list (it refuses one under 80% of the current count; `--force-artists` overrides, and only
when Levi has said the list really shrank) and does a dry run. The second adds the shows, as the 11:45 AM task
would. Then delete the downloaded `.tsv` from Downloads (it is his data and has done its job).

## 7. Report

In a few lines: artists now (followed, liked-song only), how many are new since the last copy and a few of their
names, how many shows were added and the ones by new artists, and anything odd (the 1,000-follow cap, rows the
Liked Songs read missed). The shows reach the dashboard at the next snapshot refresh (every 15 minutes) and show under
Music > Concerts by genre (pulseops#1074).

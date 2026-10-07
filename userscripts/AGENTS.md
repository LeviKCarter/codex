# Reddit Quick Mute mobile script

The canonical published script is `Reddit-Quick-Mute-Mobile.user.js` in this directory. Edit this file when fixing the mobile Reddit extension. User authorization covers publishing subsequent requested fixes to the same permanent URL.

- Preserve the `levi.hbr.quick-mute.mobile` namespace and both permanent update URLs so installed copies update in place.
- Preserve PC behavior: subreddit mute, immediate local subreddit hiding, downvote-to-block, author buttons on posts/comments, and blocked-author hiding.
- Push requested changes to `main`. `.github/workflows/quick-mute-update.yml` validates syntax and automatically increases the patch version when content changes; it publishes the updated script at the existing raw URL.
- Do not manually change `@releaseHash`; the workflow maintains it. A version bump alone does not require another automatic bump.
- Verify the release workflow and public raw script before reporting an update as released. If publication fails, fix the failure or report it plainly.
- Do not distribute new ZIPs for ordinary updates. Tampermonkey obtains new versions from the permanent URL on its configured update schedule.

# Pulse Ops — Uber trip history script

`Uber-Trip-History.user.js` runs on drivers.uber.com and hands the trips on Uber's driver site (pay, tip, miles,
minutes, pickup and drop-off) to Pulse Ops on this PC, one Uber pay week at a time, for the weeks Pulse Ops says it
still lacks. Uber's payment download has the pay but no miles or minutes; the site's activity feed has both. Pulse
Ops keeps the trips in `uber-trips.json` (`app/uberTrips.ts`, `api/uber-trips` in `LeviKCarter/pulseops`).

- It needs Pulse Ops running on `http://localhost:3000`, with the `/api/uber-trips` that answers `?weeks=1` (the
  weeks it still needs, newest first), takes `{ rows, week: { start, end } }` and accepts the `x-uber-history`
  header from a request that is not the dashboard's own page. An older Pulse Ops turns it down (403) or answers
  without `weeks`, and the script stops there and says so without asking Uber anything.
- A run: `GET /api/uber-trips?weeks=1`, then for each week every page of `POST /earnings/api/getWebActivityFeed`
  (`startDateIso` a Monday, `endDateIso` the next Monday; at most 40 pages, stopping at a repeated cursor), then
  `POST /api/uber-trips` with the week's rows as Uber gave them (an empty week too, so it is noted as done). A
  failed hand-over stops the run.
- It talks to the PC only with `GM_xmlhttpRequest` to `localhost:3000` (header `x-uber-history: 1`), and to Uber only
  with the page's own same-origin `fetch`. Uber's rows go nowhere but localhost; keep it that way.
- Pacing: one Uber request at a time, 4 to 8 s apart (also across tabs and from one run to the next), and at most
  100 pages a run (checked between weeks; the rest come next run). The run stops at the first 403, 429, other
  non-2xx, non-JSON answer or `status` other than `success`, remembers when (`uberRefused` in Tampermonkey storage)
  and says so on the status line, which then stays until clicked. Nothing is asked of Uber again in that run. On
  2026-10-06 Uber's bot check answered 403 with a challenge after about 35 requests at three a second, and clearing
  it is Levi's. Do not shorten the gaps, raise the caps or add retries.
- It runs by itself at most once every six hours, 8 s after a drivers.uber.com page loads or when the tab comes back
  into view. A run cut short by leaving the page before it asked Uber anything does not count, so the next page
  carries on; once it has asked Uber it counts, and the weeks it did not hand over come in the next run, six hours
  on (without that, short page visits could ask Uber the same page over and over). One tab pulls at a
  time: a lock in Tampermonkey storage with a 15 s heartbeat, given up after 3 minutes without one (a hidden tab's
  timers can slow to one a minute). Tampermonkey's menu has "Pull Uber trips now" (runs whatever the clock says)
  and "Stop" (also stops a run in another tab). A click on the status line at the bottom left pauses and resumes; a
  run paused for half an hour ends, so it does not hold the lock.
- Its version is bumped by hand on each change (`@version`, major.minor.patch): `quick-mute-update.yml` releases only
  the Quick Mute script. Keep the `levi.pulseops.uber-history` namespace and both raw URLs so installed copies update
  in place.
- Plain ES2020 in one IIFE with no build step: run `node --check userscripts/Uber-Trip-History.user.js` before
  committing. Text reaches the page only through `textContent` (no `innerHTML`, for Trusted Types), and styles only
  through `style.setProperty`.

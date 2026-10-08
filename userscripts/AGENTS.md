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
  (`startDateIso` a Monday, `endDateIso` the next Monday, stopping at a repeated cursor), then
  `POST /api/uber-trips` with the week's rows as Uber gave them (an empty week too, so it is noted as done). A
  hand-over the PC turns down stops the run. A request the PC does not answer at all (Pulse Ops restarts at every
  deploy and is back within seconds) is sent again every 30 s, five times, before the run stops; that asks Uber
  nothing, and rows sent twice are kept once.
- A week is never handed over cut short by the script's own doing: the PC keeps a week it was handed as read and
  never asks for it again, so one handed over short loses its other trips for good. `PAGES_PER_WEEK` (100) is only
  a stop for a feed that never ends; a week that reaches it is not handed over, and each later run says so without
  asking Uber anything (and reads no other week) until the number is looked at. It was 40 until 1.0.1, which his
  busiest weeks look set to pass, though none has been read to its end yet: a week of middling size was at its
  25th page or later when Chrome cut the first run (ten to fifteen rows to a page; the site's own page gets
  thirty), and his busiest week had twice its trips. This repo is public: keep his trip and pay figures out of it.
- The week being read is kept in Tampermonkey storage after every page (`weekPlace`: its rows so far and the cursor
  for its next page; `whole` once it was read to its end), and dropped once the week is handed over. A run that
  stops partway, by a cut or by Uber, picks the week up from there, and that week is read first next time,
  ahead of any newer one, since there is only the one place. Kept whole, a hand-over the PC turned down is tried
  again without asking Uber anything.
- A cursor that is not fresh from Uber is not trusted to end a week: one from a kept place, or one used more than
  three minutes after the request that got it went out (a pause, a tab Chrome held back, also with that request's
  answer still on its way). An answer about the request itself on the
  first page asked from a kept place (not Uber's check, a sign-in page or a lost connection): the place is dropped
  and the run stops as at any refusal, so the week starts over next time. A week that ends without one new row
  since such a cursor (an empty page, or rows already read) cannot be told from a true end on an empty last page,
  so it is read again from its first page: once in the same run, and if it ends that way a second time the run
  ends and the next, six hours on, reads it first (a run has no other stop of its own, and a tab Chrome keeps
  holding back must not have one week asked over and over). Read again, it has to come to no fewer rows than it
  had (`least` in the place); with fewer it is not handed over and the run stops as at a refusal. Uber's cursor is two ten-digit numbers with a bar
  between them (seen 2026-10-07), which reads as two times in seconds, not a ticket that runs out; none has been
  seen to go stale, and nothing above leans on that.
- What is still taken on Uber's word, as in 1.0.0: a fresh read that Uber ends early. A first page with no rows is
  handed over as an empty week, and a feed that says there is more but gives no new cursor, or only rows already
  read, ends the week there. Whether a week that old really has no rows (the feed's answer has an `isBeforeCutoff`
  field, so it may stop some way back) is not known yet.
- A row with no `uuid` is told apart by all it says, so the same one is not taken twice.
- Tampermonkey keeps all of a script's values in one record and writes the whole record at each change (seen in its
  storage, 2026-10-07), so with a long week's rows in it every write is a few hundred KB; keep what is stored small
  and do not add writes.
- Chrome puts a background tab to sleep with no word to the page (15 minutes into the first run, 2026-10-07, in the
  middle of a week). So a run that has not ended by itself stays open (`openRun`: the pages it has asked for), and
  the next driver-site page, or any driver-site tab still open, carries it on: a cut costs no six hours. A run
  that ended by itself, was stopped by Uber, or was stopped or paused by him (Stop ends a cut run too, whichever
  tab it was in) is not carried on. Nor is
  one cut with a page asked and no answer seen (`openRun.at` later than `uberLastAt`): that answer may have been
  Uber's check, so it waits its six hours as every cut run did in 1.0.0, and short page visits cannot have one
  page asked over and over.
- It talks to the PC only with `GM_xmlhttpRequest` to `localhost:3000` (header `x-uber-history: 1`), and to Uber only
  with the page's own same-origin `fetch`. Uber's rows go nowhere but localhost; keep it that way.
- Pacing: one Uber request at a time, 30 to 60 s apart (also across tabs and from one run to the next), and a run
  goes on until every week the PC listed is in. That is Levi's word of 2026-10-08, "just do less per second", and
  1.1.0: up to 1.0.1 a run asked 4 to 8 s apart, stopped at 100 pages and waited six hours for its next 100. The gap
  is all that holds a run back now, so it is longer than any run before it used (about 30 s a page in a hidden tab
  under 1.0.1). The run stops at the first 403, 429, other
  non-2xx, non-JSON answer or `status` other than `success`, remembers when (`uberRefused` in Tampermonkey storage)
  and says so on the status line, which then stays until clicked. Nothing is asked of Uber again in that run. On
  2026-10-06 Uber's bot check answered 403 with a challenge after about 35 requests at three a second, and clearing
  it is Levi's. Where Uber's limit lies is not known: only that point has been measured. Do not shorten the gap,
  and do not add retries against Uber.
- It runs by itself at most once every six hours: 8 s after a drivers.uber.com page loads, when the tab comes back
  into view, or in a tab left open (it asks itself once a minute whether a run is due, so nobody has to look at
  it). Once Uber has stopped a run, a tab left open does not start the next by itself: that waits for a page load or
  a look at the tab, so Uber's check is not met again and again with nobody there to clear it. A stop by Uber that
  one tab learns of stops the run in whichever tab has it. The six hours count from when a run last started or
  ended, or from the last page asked of Uber, answered or not, if that is later (a run that was cut never ended).
  A run cut short by leaving the page before it asked Uber anything does not count, so the next page starts it
  afresh; once it has asked Uber it stays open and is carried on as above. One tab pulls at a
  time: a lock in Tampermonkey storage with a 15 s heartbeat, given up after 3 minutes without one (a hidden tab's
  timers can slow to one a minute). Tampermonkey's menu has "Pull Uber trips now" (runs whatever the clock says)
  and "Stop" (ends the run in whichever tab has it, awake, held back or asleep, and
  puts the next run by itself six hours on). A click on the status line at the bottom left pauses and resumes; a
  paused run is not carried on by another tab, and one paused for half an hour ends, so it does not hold the lock.
- Its version is bumped by hand on each change (`@version`, major.minor.patch): `quick-mute-update.yml` releases only
  the Quick Mute script. Keep the `levi.pulseops.uber-history` namespace and both raw URLs so installed copies update
  in place.
- Plain ES2020 in one IIFE with no build step: run `node --check userscripts/Uber-Trip-History.user.js` and
  `node userscripts/Uber-Trip-History.test.mjs` before committing. The tests run the whole script in a made-up tab
  (its own clock, a made-up Uber feed and PC, one Tampermonkey storage shared by a test's tabs) and reach neither
  Uber nor the PC; a path to another copy of the script may follow, to run them against it. Before a change to the
  script ships, also run `node userscripts/Uber-Trip-History.test.mjs --random=3000`: made-up histories of tabs
  opened, put to sleep, left, held back and paused, with Uber and the PC failing, each checked for a week handed
  over short or left out, two Uber requests less than 30 s apart, and a request inside six hours of a stop by Uber
  (a failure names its seed; `--seed=N --random=1` runs that one again). Text reaches the page
  only through `textContent` (no `innerHTML`, for Trusted Types), and styles only through `style.setProperty`.
- A hidden tab pulls more slowly still (Chrome lets its timers run as seldom as once a minute, so a page takes a
  minute or two against 30 to 60 s in view; a cursor is trusted for three minutes), and Chrome's Memory Saver
  puts a hidden tab to sleep; asleep, nothing runs until the tab is opened again. So that a pull needs nobody to
  look at it, drivers.uber.com is on this PC's Chrome list at Settings > Performance > "Always keep these sites
  active" (added 2026-10-07 at Levi's word). The setting is his; on another browser or profile it has to be added
  again.

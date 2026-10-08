// ==UserScript==
// @name         Pulse Ops — Uber trip history
// @namespace    levi.pulseops.uber-history
// @version      1.0.1
// @updateURL    https://raw.githubusercontent.com/LeviKCarter/codex/main/userscripts/Uber-Trip-History.user.js
// @downloadURL  https://raw.githubusercontent.com/LeviKCarter/codex/main/userscripts/Uber-Trip-History.user.js
// @description  Hands the trips on Uber's driver site (pay, tip, miles, minutes) to Pulse Ops on this PC, one pay week at a time and slowly, for the weeks Pulse Ops still lacks.
// @match        https://drivers.uber.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      localhost
// @connect      127.0.0.1
// @noframes
// ==/UserScript==

// Pulse Ops keeps the trips he drove before its offer grader was watching (uber-trips.json, through /api/uber-trips).
// Uber's payment download has each trip's pay but no miles or minutes; the driver site's activity feed has both. This
// asks the PC which pay weeks it still lacks, reads each from the feed the site's own Activity page uses, and hands the
// rows to the PC as Uber gave them. Uber's rows go to localhost:3000 and nowhere else.
// On 2026-10-06 Uber's bot check answered 403 after about 35 requests at three a second. So: one request at a time,
// 4 to 8 s apart, and the whole run stops at the first answer that is not plain data. Nothing is asked again in that
// run; the next run by itself comes six hours later at the soonest ("Pull Uber trips now" in the menu is his own call).
// Chrome puts a background tab to sleep partway through a run (it did, 15 minutes into the first one, on 2026-10-07),
// so the week being read is kept after every page and a run that was cut is carried on, within the same hundred
// pages, by the next page or by any driver-site tab still open.

(() => {
  "use strict";
  if (window.__pulseUberHistory) return;
  window.__pulseUberHistory = true;

  const PC = "http://localhost:3000";
  const PC_LABEL = "localhost:3000";
  const FEED = "/earnings/api/getWebActivityFeed?localeCode=en";

  const RUN_EVERY_MS = 6 * 60 * 60 * 1000; // a run by itself at most this often
  const START_DELAY_MS = 8000; // after the page loads, so the site's own requests go first
  const GAP_MIN_MS = 4000; // between Uber requests: 4 s plus up to 4 s more
  const GAP_SPREAD_MS = 4000;
  // Only a stop for a feed that never ends: a week that reaches it is not handed over at all, since handed over cut
  // short the PC would keep it as read and never ask for its other trips. It was 40, which his busiest weeks look
  // set to pass: a week of middling size was at its 25th page or later (ten to fifteen rows to a page) when
  // Chrome cut the first run, and his busiest week had twice its trips.
  const PAGES_PER_WEEK = 100;
  // Looked at before every page: a run that has had its pages stops there, in the middle of a week or not, and the
  // next run picks that week up at its place. (Up to 1.0.0 a run finished the week it was in, 139 pages at most.)
  const PAGES_PER_RUN = 100;
  const RECHECK_MS = 60 * 1000; // a tab left open asks itself this often whether a run is due
  const UBER_TIMEOUT_MS = 30000;
  const PC_TIMEOUT_MS = 30000;
  const LOCK_BEAT_MS = 15000;
  // A hidden tab's timers can slow to one a minute, so a lock is given up only after three minutes with no beat.
  const LOCK_STALE_MS = 3 * 60 * 1000;
  const LOCK_SETTLE_MS = 3000; // two tabs that write the lock at once both read it back after this
  const HIDE_AFTER_MS = 30000;
  const PAUSE_LIMIT_MS = 30 * 60 * 1000; // a run left paused this long ends, so it does not hold the lock for good
  const TICK_MS = 500;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Tampermonkey storage, shared by every drivers.uber.com tab.
  const KEY = {
    lastRun: "lastRun", // when a run last started or ended
    lock: "lock", // { id, beat }: the tab that is pulling
    stop: "stopAt", // a Stop given in a tab that is not the one pulling
    uberAt: "uberLastAt", // when Uber last answered a request, so the gap holds across runs and tabs
    refused: "uberRefused", // { at, status, week }: the last time Uber stopped a run
    // The run's record. { pages, at, paused } while it has not ended by itself: the pages it has asked Uber for and
    // when it asked the last. { closed, at } once it is over.
    open: "openRun",
    place: "weekPlace" // { start, end, rows, cursor, cursors, pages, whole, least }: the one week being read
  };

  const TAB = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  class Stopped extends Error {
    constructor(why) { super(why); this.why = why; }
  }
  class Problem extends Error {}

  let current = null; // the run in this tab
  let paused = false;
  let pausedAt = 0;
  let line = null; // the status line
  let lineText = "";
  let hideTimer = 0;

  // ---------- storage and the one-tab lock ----------

  function read(key, fallback) {
    try {
      const value = GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch { return fallback; }
  }
  const stamp = (key) => Number(read(key, 0)) || 0;

  function lockFresh(lock) {
    return !!lock && typeof lock.id === "string" && lock.id !== ""
      && Math.abs(Date.now() - (Number(lock.beat) || 0)) < LOCK_STALE_MS;
  }
  function ownsLock() {
    const lock = read(KEY.lock, null);
    return !!lock && lock.id === TAB;
  }

  async function takeLock() {
    const held = read(KEY.lock, null);
    if (lockFresh(held) && held.id !== TAB) return false;
    GM_setValue(KEY.lock, { id: TAB, beat: Date.now() });
    await tick(LOCK_SETTLE_MS);
    return ownsLock();
  }

  function releaseLock() {
    if (ownsLock()) GM_setValue(KEY.lock, { id: "", beat: 0 });
  }

  function beat(job) {
    if (job.ended) return;
    if (!job.stopped && stamp(KEY.stop) > job.startedAt) job.stopped = "user";
    else if (!job.stopped && !ownsLock()) job.stopped = "lost";
    if (job.stopped) {
      if (job.abort) job.abort();
      return;
    }
    GM_setValue(KEY.lock, { id: TAB, beat: Date.now() });
  }

  // The record of the run: open, paused or closed. It is kept when the run is over, for `at`.
  function runRecord() {
    const open = read(KEY.open, null);
    return open && typeof open === "object" ? open : null;
  }

  // When Uber was last asked for a page, answered or not, by this run or the one before.
  function askedAt() {
    const record = runRecord();
    return (record && Number(record.at)) || 0;
  }

  // The run is over. When it last asked Uber stays on record: the gap before the next request, and the six hours
  // to the next run by itself, count from there.
  function closeRun() {
    GM_setValue(KEY.open, { closed: true, at: askedAt() });
  }

  // Six hours from when a run last started or ended, or from the last page asked of Uber if that is later: a run
  // that was cut never ended, and its six hours count from its last page, not from when it began.
  function due() {
    const last = Math.max(stamp(KEY.lastRun), stamp(KEY.uberAt), askedAt());
    const now = Date.now();
    return last > now || now - last >= RUN_EVERY_MS;
  }

  // ---------- a run that was cut, and the place in its week ----------

  // Chrome puts a background tab to sleep with no word to the page, and a run can be cut by leaving the page too.
  // Such a run is still open: the next page (or a driver-site tab still open) carries it on with the pages it has
  // already asked counted, so a cut neither costs six hours nor buys a second hundred pages. Null once it has ended
  // by itself, was stopped or paused by him, or has had its pages; and null when it was cut with a page asked and
  // no answer seen, since that answer may have been Uber's check. The next run then waits its six hours.
  function openRun() {
    const record = runRecord();
    if (!record || record.closed === true || record.paused === true) return null;
    const pages = Number(record.pages);
    if (!Number.isInteger(pages) || pages < 0 || pages >= PAGES_PER_RUN) return null;
    return askedAt() > stamp(KEY.uberAt) ? null : { pages };
  }

  // `asking`: a page is going out now.
  function noteOpen(job, asking) {
    if (asking) job.askedAt = Date.now();
    // Not kept (storage full, say): the run goes on, and cut it waits its six hours as it used to.
    try { GM_setValue(KEY.open, { pages: job.pages, at: job.askedAt }); } catch { /* see above */ }
  }

  // The rows of a week read so far and the cursor for its next page, kept after every page so a cut run does not ask
  // Uber for the same pages again; `whole` once the week was read to its end, with only its hand-over left to do.
  // Uber's cursor is two ten-digit numbers with a bar between them (seen 2026-10-07), which reads as two times in
  // seconds and not as a ticket that runs out; readWeek does not lean on that. `least`: how many rows an earlier
  // read of the week had, when that read was not trusted and the week is being read again; a place with no pages
  // says only that. Null for another week's place, or one this can't read.
  function placeIn(week) {
    const place = read(KEY.place, null);
    if (!place || typeof place !== "object" || place.start !== week.start || place.end !== week.end) return null;
    const pages = Number(place.pages);
    const least = Number.isInteger(place.least) && place.least > 0 ? place.least : 0;
    if (!Array.isArray(place.rows) || !Array.isArray(place.cursors) || !Number.isInteger(pages) || pages < 0) return null;
    if (!pages) return least ? { rows: [], cursor: null, cursors: [], pages: 0, whole: false, least } : null;
    const whole = place.whole === true;
    if (!whole && (place.cursor === null || place.cursor === undefined || place.cursor === "")) return null;
    return {
      rows: place.rows.filter((row) => row && typeof row === "object"),
      cursor: whole ? null : place.cursor,
      cursors: place.cursors.filter((key) => typeof key === "string"),
      pages,
      whole,
      least
    };
  }

  function keepPlace(week, rows, cursor, cursors, pages, whole, least) {
    // Not kept: the run goes on, and cut it starts this week over.
    try { GM_setValue(KEY.place, { start: week.start, end: week.end, rows, cursor, cursors, pages, whole, least }); } catch { /* see above */ }
  }

  // That week's place only; with no week, whatever place is kept.
  function forgetPlace(week) {
    const place = read(KEY.place, null);
    if (place && (!week || (place.start === week.start && place.end === week.end))) GM_setValue(KEY.place, null);
  }

  // ---------- waiting, pausing and stopping ----------

  const tick = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  function stopCheck(job) {
    if (!job.stopped) {
      if (stamp(KEY.stop) > job.startedAt) job.stopped = "user";
      else if (job.locked && !ownsLock()) job.stopped = "lost";
      // Uber stopped the run in a tab that had lost it to this one, and only now got its answer.
      else if (Number((read(KEY.refused, null) || {}).at) > job.startedAt) job.stopped = "refused";
    }
    if (job.stopped) throw new Stopped(job.stopped);
  }

  async function wait(job, ms) {
    const until = Date.now() + ms;
    stopCheck(job);
    while (Date.now() < until) {
      await tick(Math.min(TICK_MS, until - Date.now()));
      stopCheck(job);
    }
  }

  async function checkpoint(job) {
    stopCheck(job);
    while (paused) {
      if (!job.stopped && Date.now() - pausedAt > PAUSE_LIMIT_MS) job.stopped = "paused";
      stopCheck(job);
      await tick(TICK_MS);
      stopCheck(job);
    }
  }

  // The gap runs from the end of the last Uber request, this run's or any tab's, or from when it went out if its
  // answer was never seen.
  async function pace(job) {
    const last = Math.max(job.lastAt, Math.min(Math.max(stamp(KEY.uberAt), askedAt()), Date.now()));
    if (last) await wait(job, last + GAP_MIN_MS + Math.random() * GAP_SPREAD_MS - Date.now());
  }

  // ---------- words ----------

  const clip = (value, size = 120) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, size);
  const trips = (count) => `${count} ${count === 1 ? "trip" : "trips"}`;
  const weeksWord = (count) => `${count} ${count === 1 ? "week" : "weeks"}`;

  function weekLabel(start) {
    const [year, month, day] = start.split("-").map(Number);
    return `${MONTHS[month - 1]} ${day}${year === new Date().getFullYear() ? "" : `, ${year}`}`;
  }

  function clock(ms) {
    const at = new Date(ms);
    const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return at.toDateString() === new Date().toDateString() ? time : `${time} tomorrow`;
  }

  function when(ms) {
    return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  const sentPart = (job) => (job.sent ? ` (${trips(job.sent)} sent)` : "");

  // ---------- the status line ----------

  function paint(element, styles) {
    for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value, "important");
  }

  function ensureLine() {
    if (!line) {
      line = document.createElement("div");
      line.setAttribute("role", "status");
      line.setAttribute("aria-live", "polite");
      line.tabIndex = 0;
      paint(line, {
        position: "fixed", left: "12px", bottom: "12px", "z-index": "2147483647",
        "max-width": "min(440px, calc(100vw - 24px))", "box-sizing": "border-box", margin: "0",
        padding: "7px 12px", "border-radius": "8px", background: "rgba(15, 23, 19, 0.92)", color: "#e8f0eb",
        font: "13px/1.4 system-ui, sans-serif", "letter-spacing": "normal", "text-align": "left",
        "box-shadow": "0 2px 12px rgba(0, 0, 0, 0.35)", "overflow-wrap": "anywhere", cursor: "pointer",
        "user-select": "none", "pointer-events": "auto"
      });
      line.addEventListener("click", onLineClick);
      line.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") onLineClick(event);
      });
    }
    // The site is a single-page app; put the line back if a page change took it off.
    if (!line.isConnected) (document.body || document.documentElement).appendChild(line);
    return line;
  }

  const pulling = (job) => !!job && job.locked && job.started && !job.ended && !job.stopped;

  function render() {
    if (!lineText) return;
    const element = ensureLine();
    const job = current;
    if (pulling(job) && paused) {
      element.textContent = `Pulse: paused${job.week ? ` at the week of ${weekLabel(job.week.start)}` : ""} · click to carry on`;
      element.title = "Click to carry on";
    } else {
      element.textContent = lineText;
      element.title = pulling(job) ? "Click to pause" : "Click to close";
    }
  }

  function show(text) {
    clearTimeout(hideTimer);
    hideTimer = 0;
    lineText = text;
    render();
  }

  // Shown, then gone after 30 s.
  function note(text) {
    show(text);
    hideTimer = setTimeout(hide, HIDE_AFTER_MS);
  }

  function hide() {
    clearTimeout(hideTimer);
    hideTimer = 0;
    lineText = "";
    if (line) line.remove();
  }

  function onLineClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (pulling(current)) {
      paused = !paused;
      pausedAt = Date.now();
      // A paused run is not open: if its tab is put to sleep or its page left while it waits, nothing carries it on.
      // (When it last asked Uber for a page stays on record, for the six hours to count from.)
      if (paused) GM_setValue(KEY.open, { pages: current.pages, at: current.askedAt, paused: true });
      else noteOpen(current, false);
      render();
    } else {
      hide();
    }
  }

  // ---------- the PC ----------

  function toPC(job, method, path, body) {
    return new Promise((resolve) => {
      let settled = false;
      let request = null;
      const done = (answer) => {
        if (settled) return;
        settled = true;
        job.abort = null;
        resolve(answer);
      };
      job.abort = () => {
        try { if (request && typeof request.abort === "function") request.abort(); } catch { /* already over */ }
        done({ status: 0 });
      };
      try {
        request = GM_xmlhttpRequest({
          method,
          url: PC + path,
          headers: { "x-uber-history": "1", "content-type": "application/json" },
          data: body === undefined ? undefined : JSON.stringify(body),
          anonymous: true,
          redirect: "error",
          timeout: PC_TIMEOUT_MS,
          onload: (response) => done({ status: response.status, text: response.responseText || "", url: response.finalUrl || "" }),
          onerror: () => done({ status: 0 }),
          ontimeout: () => done({ status: 0 }),
          onabort: () => done({ status: 0 })
        });
      } catch {
        done({ status: 0 });
      }
    });
  }

  async function askPC(job, method, path, body, where) {
    stopCheck(job);
    const answer = await toPC(job, method, path, body);
    if (!answer.status && job.stopped) throw new Stopped(job.stopped);
    const after = where ? ` Stopped at the week of ${weekLabel(where.start)}${sentPart(job)}.` : "";
    if (!answer.status) throw new Problem(`Pulse: can't reach the PC (${PC_LABEL}).${after}`);
    if (answer.url && !answer.url.startsWith(`${PC}/`)) {
      throw new Problem(`Pulse: the PC's answer came from somewhere else, so nothing more was sent.${after}`);
    }
    let json = null;
    try { json = JSON.parse(answer.text); } catch { json = null; }
    if (answer.status === 403) {
      throw new Problem(`Pulse: the PC turned it down (HTTP 403). Pulse Ops on ${PC_LABEL} may need its newer version.${after}`);
    }
    if (answer.status === 200 && json && typeof json === "object" && json.ok === true) return json;
    if (answer.status !== 200 || (json && typeof json.error === "string")) {
      const said = json && typeof json.error === "string" ? `: ${clip(json.error).replace(/[.!?]+$/, "")}` : "";
      throw new Problem(`Pulse: the PC answered HTTP ${answer.status}${said}.${after}`);
    }
    throw new Problem(`Pulse: the PC's answer wasn't one this reads. Pulse Ops on ${PC_LABEL} may need its newer version.${after}`);
  }

  function dayOf(text) {
    const match = typeof text === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
    if (!match) return null;
    const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Date(ms).toISOString().slice(0, 10) === text ? ms : null;
  }

  function isWeek(week) {
    if (!week || typeof week !== "object") return false;
    const start = dayOf(week.start);
    const end = dayOf(week.end);
    return start !== null && end !== null && new Date(start).getUTCDay() === 1 && end - start === 7 * DAY_MS;
  }

  function localDay(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // The weeks the PC asked for, newest first. One the PC names wrongly stops the run before Uber is asked anything.
  function weeksFrom(json) {
    if (!Array.isArray(json.weeks)) {
      throw new Problem(`Pulse: the PC didn't say which weeks it needs. Pulse Ops on ${PC_LABEL} may need its newer version.`);
    }
    const today = localDay(new Date());
    const seen = new Set();
    const weeks = [];
    for (const week of json.weeks) {
      if (!isWeek(week)) throw new Problem("Pulse: the PC named a week this can't read, so Uber was asked nothing.");
      // A week that has not ended yet would be noted as done with its last days missing.
      if (week.end > today || seen.has(week.start)) continue;
      seen.add(week.start);
      weeks.push({ start: week.start, end: week.end });
    }
    return weeks.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  }

  async function handOver(job, week, rows) {
    show(`Pulse: handing the week of ${weekLabel(week.start)} to the PC…`);
    const json = await askPC(job, "POST", "/api/uber-trips", { rows, week: { start: week.start, end: week.end } }, week);
    const pulled = json.pulled;
    if (!pulled || typeof pulled !== "object" || pulled.start !== week.start) {
      throw new Problem(`Pulse: the PC kept the trips but did not note the week of ${weekLabel(week.start)} as done. Pulse Ops on ${PC_LABEL} may need its newer version.`);
    }
    job.sent += rows.length;
    if (Number.isFinite(pulled.added)) job.added += pulled.added;
  }

  // ---------- Uber ----------

  function uberStop(week, status, kind, said) {
    const at = Date.now();
    GM_setValue(KEY.refused, { at, status, week: week.start });
    // The run is over for every tab, whichever of them has it by now: none carries it on, and one that is pulling
    // finds the stop at its next check.
    closeRun();
    const where = `the week of ${weekLabel(week.start)}`;
    const lead = kind === "check" ? `Uber's check stopped it at ${where} (HTTP ${status}).`
      : kind === "status" ? `Uber answered HTTP ${status} at ${where}, so it stopped.`
      : kind === "notjson" ? `Uber's answer at ${where} wasn't data (its check, or signed out), so it stopped.`
      : kind === "said" ? (said ? `Uber said "${said}" at ${where}, so it stopped.` : `Uber turned down ${where}, so it stopped.`)
      : kind === "shape" ? `Uber's answer at ${where} wasn't in the shape this reads, so it stopped.`
      : kind === "fewer" ? `Uber now gives fewer trips for ${where} than it gave before, so that week was not handed to the PC and it stopped.`
      : `couldn't reach Uber at ${where}, so it stopped.`;
    const problem = new Problem(`Pulse: ${lead} It carries on next time you open the driver site, after ${clock(at + RUN_EVERY_MS)}.`);
    // An answer that is about the request itself, which a kept cursor Uber no longer takes would get. Its check
    // (403, 429), a page that is not data and a lost connection say nothing about the cursor.
    problem.place = kind === "status" || kind === "said" || kind === "shape";
    return problem;
  }

  async function feedPage(job, week, cursor) {
    await pace(job);
    await checkpoint(job);
    const controller = new AbortController();
    job.abort = () => controller.abort();
    const timer = setTimeout(() => controller.abort(), UBER_TIMEOUT_MS);
    job.pages += 1; // counted as it goes out: a request cut off by leaving the page still reached Uber
    noteOpen(job, true);
    let status = 0;
    let text = null;
    try {
      const response = await fetch(location.origin + FEED, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": "x" },
        body: JSON.stringify({ startDateIso: week.start, endDateIso: week.end, paginationOption: cursor === null ? {} : { cursor } }),
        signal: controller.signal
      });
      status = response.status;
      text = await response.text();
    } catch {
      if (job.stopped) throw new Stopped(job.stopped);
      if (!status) throw uberStop(week, 0, "net");
      text = null; // the answer came but its body did not: judged by its status, then as not data
    } finally {
      clearTimeout(timer);
      job.abort = null;
      job.lastAt = Date.now();
      // Only an answer counts here. A request cut off with none (the page left, or no connection) stays as asked
      // and not answered in the open run, which is then not carried on.
      if (status) GM_setValue(KEY.uberAt, job.lastAt);
    }
    if (job.stopped) throw new Stopped(job.stopped);
    if (status === 403 || status === 429) throw uberStop(week, status, "check");
    if (status < 200 || status >= 300) throw uberStop(week, status, "status");
    let body;
    try { body = JSON.parse(text); } catch { throw uberStop(week, status, "notjson"); }
    if (!body || typeof body !== "object") throw uberStop(week, status, "notjson");
    if (body.status !== "success") {
      const message = body.data && typeof body.data === "object" ? body.data.message : body.message;
      throw uberStop(week, status, "said", clip(message));
    }
    const data = body.data;
    if (!data || typeof data !== "object") throw uberStop(week, status, "shape");
    const activities = data.activities == null ? [] : data.activities;
    if (!Array.isArray(activities)) throw uberStop(week, status, "shape");
    const pagination = data.pagination && typeof data.pagination === "object" ? data.pagination : {};
    // A tab Chrome held back may wake with this answer after another tab took the run over: its rows and place are
    // that tab's to keep now.
    stopCheck(job);
    return { activities, more: pagination.hasMoreData === true, next: pagination.nextCursor };
  }

  function progress(job, week, page, index, count) {
    const refused = read(KEY.refused, null);
    const tail = job.sent ? ` · ${trips(job.sent)} sent`
      : refused && Number(refused.at) > 0 ? ` · carrying on after Uber's stop at ${when(Number(refused.at))}`
      : "";
    const of = count > 1 ? ` (${index + 1} of ${count})` : "";
    show(`Pulse: week of ${weekLabel(week.start)}${of}, page ${page}${tail}`);
  }

  // One pay week, every page of it, each row once, from the place kept for it if a run stopped partway through.
  // Null when the run has had its pages before the week's end: the place is kept, and the next run goes on from it.
  async function readWeek(job, week, index, count) {
    const place = placeIn(week);
    if (place && place.whole) return place.rows; // read to its end already: only the hand-over is left
    let rows = place ? place.rows : [];
    let least = place ? place.least : 0;
    // A row with no id of its own is known by all it says, so the same one is not taken twice either.
    const idOf = (row) => (typeof row.uuid === "string" && row.uuid ? row.uuid : JSON.stringify(row));
    const ids = new Set(rows.map(idOf));
    const cursors = new Set(place ? place.cursors : []);
    let cursor = place ? place.cursor : null;
    const first = place ? place.pages + 1 : 1;
    // The week's end is taken on trust only from a cursor Uber has just given. One from a kept place, or one used
    // more than three minutes after the request that got it went out (a pause, or a tab Chrome held back, also
    // with that request's answer still on its way), may be answered with nothing, or with rows already read, and
    // that cannot be told from a true end on an empty last page.
    let old = cursor !== null;
    let gained = 0; // rows read since the cursor in hand stopped being a fresh one
    let gotBy = 0; // when the request that got the cursor in hand went out; 0 for a kept place's
    for (let page = first; page <= PAGES_PER_WEEK; page += 1) {
      if (job.pages >= PAGES_PER_RUN) return null;
      progress(job, week, page, index, count);
      let data;
      try {
        data = await feedPage(job, week, cursor);
      } catch (error) {
        // Uber turned down the first page asked from a kept place: the place may be no good any more, so the week
        // starts over next time. The run still stops here, as at any answer that is not plain data.
        if (place && page === first && cursor !== null && error instanceof Problem && error.place && ownsLock()) forgetPlace(week);
        throw error;
      }
      if (cursor !== null && gotBy && job.askedAt - gotBy > LOCK_STALE_MS) {
        old = true;
        gained = 0;
      }
      let fresh = 0;
      for (const row of data.activities) {
        if (!row || typeof row !== "object") continue;
        const id = idOf(row);
        if (ids.has(id)) continue;
        ids.add(id);
        rows.push(row);
        fresh += 1;
      }
      gained += fresh;
      // The week is over when Uber says there is no more. A feed that says there is more but hands back no new
      // cursor, or only rows already read, is going round, and is over too.
      const next = data.next;
      const key = next === null || next === undefined || next === "" ? "" : JSON.stringify(next);
      if (!data.more || !key || cursors.has(key) || (data.activities.length && !fresh)) {
        if (old && !gained) {
          // Over without one new row from a cursor that was not fresh. A week handed over is kept as read by the
          // PC, so this one is read again from its first page, and has to come to no fewer rows than it had: in
          // this run if it has the pages left for that, else in the next, which reads this week first.
          least = Math.max(least, rows.length);
          keepPlace(week, [], null, [], 0, false, least);
          if (PAGES_PER_RUN - job.pages < page) return null;
          rows = [];
          ids.clear();
          cursors.clear();
          cursor = null;
          gotBy = 0;
          old = false;
          gained = 0;
          page = 0;
          continue;
        }
        if (rows.length < least) throw uberStop(week, 200, "fewer");
        // Kept whole, so a hand-over that fails is tried again next run without asking Uber for anything.
        keepPlace(week, rows, null, [], page, true, least);
        return rows;
      }
      cursors.add(key);
      cursor = next;
      gotBy = job.askedAt;
      keepPlace(week, rows, cursor, [...cursors], page, false, least);
    }
    // Still more to come at the last page allowed. Its place stays and its week is read first, so each later run
    // says this again without asking Uber anything, until PAGES_PER_WEEK is looked at.
    throw new Problem(`Pulse: the week of ${weekLabel(week.start)} runs past ${PAGES_PER_WEEK} pages, so it was not handed to the PC. The script needs a look before it reads any more.`);
  }

  // ---------- a run ----------

  // A run that got through without Uber stopping it: the last stop is history.
  function forgetRefusal() {
    if (Number((read(KEY.refused, null) || {}).at) > 0) GM_setValue(KEY.refused, { at: 0, status: 0, week: "" });
  }

  async function pull(job) {
    show("Pulse: asking the PC which weeks it needs…");
    const weeks = weeksFrom(await askPC(job, "GET", "/api/uber-trips?weeks=1"));
    // There is one place, for one week. That week is read first, ahead of any newer one the PC has listed since, so
    // no other week's place is written over it. A place for a week the PC no longer asks for is of no use.
    const kept = read(KEY.place, null);
    const at = kept && typeof kept === "object" ? weeks.findIndex((week) => week.start === kept.start && week.end === kept.end) : -1;
    if (kept && at < 0) forgetPlace();
    if (at > 0) weeks.unshift(...weeks.splice(at, 1));
    for (let index = 0; index < weeks.length; index += 1) {
      const week = weeks[index];
      job.week = week;
      const rows = await readWeek(job, week, index, weeks.length);
      if (!rows) {
        forgetRefusal();
        const rest = weeks.length - index;
        return `Pulse: ${weeksWord(index)} in this time${sentPart(job)}; ${rest} more ${rest === 1 ? "week comes" : "weeks come"} next time.`;
      }
      await checkpoint(job);
      await handOver(job, week, rows);
      forgetPlace(week);
    }
    forgetRefusal();
    if (!weeks.length) return "Pulse: every week is in.";
    return `Pulse: every week is in (${trips(job.sent)} sent${job.added ? `, ${job.added} new` : ""}).`;
  }

  function end(job, text, problem) {
    job.ended = true;
    if (problem) show(text);
    else note(text);
  }

  async function run(forced) {
    if (current) {
      if (forced) render();
      return;
    }
    const job = {
      startedAt: Date.now(), stopped: "", locked: false, started: false, ended: false, abort: null, beat: 0,
      lastAt: 0, pages: 0, sent: 0, added: 0, week: null, prevLast: 0, carried: false, askedAt: 0
    };
    current = job;
    paused = false;
    try {
      job.locked = await takeLock();
      stopCheck(job); // a Stop while it waited for the lock
      if (!job.locked) {
        if (forced) end(job, "Pulse: another driver-site tab is pulling already.", false);
        return;
      }
      // "Pull Uber trips now" and a run that is due start afresh; otherwise a run that was cut is carried on.
      const open = forced || due() ? null : openRun();
      if (!forced && !open && !due()) return; // another tab ran it while this one waited for the lock
      job.prevLast = stamp(KEY.lastRun);
      job.started = true;
      job.carried = !!open;
      job.pages = open ? open.pages : 0;
      job.askedAt = askedAt(); // kept through a new run's start too: the gap to its first page counts from there
      if (!open) GM_setValue(KEY.lastRun, Date.now());
      noteOpen(job, false);
      job.beat = setInterval(() => beat(job), LOCK_BEAT_MS);
      end(job, await pull(job), false);
    } catch (error) {
      if (error instanceof Stopped) {
        if (error.why === "lost") end(job, `Pulse: another driver-site tab took over${sentPart(job)}.`, false);
        else if (error.why === "refused") {
          end(job, `Pulse: Uber stopped this run in another driver-site tab, so it stopped here too${sentPart(job)}. It carries on next time you open the driver site, after ${clock(Date.now() + RUN_EVERY_MS)}.`, true);
        }
        else if (error.why === "paused") {
          end(job, `Pulse: paused for half an hour, so it stopped${sentPart(job)}. It carries on next time you open the driver site, after ${clock(Date.now() + RUN_EVERY_MS)}.`, false);
        }
        // Left the page: nothing to say, and a page back from the back/forward cache must not keep the old progress.
        else if (error.why === "page") hide();
        else end(job, `Pulse: stopped${sentPart(job)}.`, false);
      } else if (error instanceof Problem) {
        end(job, error.message, true);
      } else {
        end(job, `Pulse: the script hit an error (${clip(error && error.message ? error.message : error)}), so it stopped.`, true);
      }
    } finally {
      clearInterval(job.beat);
      job.beat = 0;
      job.ended = true;
      job.abort = null;
      const mine = ownsLock();
      releaseLock(); // only ever this tab's own: it may have written the lock and lost it in the same moment
      // A run that ended by itself is over, and the next is six hours on. One cut by leaving the page stays open,
      // and so does one another tab has taken over, whether or not this tab had noticed: it is that tab's now.
      if (job.started && job.stopped !== "page") {
        GM_setValue(KEY.lastRun, Date.now());
        if (mine) closeRun();
      }
      if (current === job) current = null;
      paused = false;
      render();
    }
  }

  function stop() {
    // A run that was cut is still open and would be carried on. Stopped, it is over, whichever tab it was in and
    // whether that tab is asleep, gone or this one.
    const record = runRecord();
    const open = !!record && record.closed !== true;
    if (open) closeRun();
    // Stop means not now: the next run by itself is six hours on, also when the one stopped had not begun yet.
    GM_setValue(KEY.lastRun, Date.now());
    const job = current;
    if (job) {
      if (!job.stopped) job.stopped = "user";
      if (job.abort) job.abort();
      show("Pulse: stopping…");
      return;
    }
    // Left for any tab that is pulling to find, also one Chrome is holding back, whose lock has gone stale by now.
    GM_setValue(KEY.stop, Date.now());
    const lock = read(KEY.lock, null);
    if (lockFresh(lock) && lock.id !== TAB) note("Pulse: stopped. A driver-site tab that is pulling stops within a few seconds.");
    else note(open ? "Pulse: stopped the run that was cut." : "Pulse: nothing is pulling right now.");
  }

  function maybeRun() {
    if (!current && (due() || openRun())) run(false);
  }

  // Leaving the page mid-run lets go of the lock now. A run cut before it asked Uber anything does not count, so the
  // next page starts it afresh. Once Uber was asked, the run stays open with its pages counted and its place in the
  // week kept, and the next page carries it on from there: leaving pages cannot get more than a run's pages inside
  // six hours. A page left while its request was still out is another matter: its answer was never seen, so that
  // run is not carried on (openRun) and the next waits its six hours.
  window.addEventListener("pagehide", () => {
    const job = current;
    if (!job || job.ended) return;
    const cut = job.started && !job.stopped && !job.carried && !job.pages;
    if (!job.stopped) job.stopped = "page";
    if (job.abort) job.abort();
    clearInterval(job.beat);
    if (cut) {
      GM_setValue(KEY.lastRun, job.prevLast);
      closeRun();
    }
    releaseLock();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeRun();
  });

  // Back from the back/forward cache: the run cut by leaving settles within a few seconds, then one starts if it is due.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) setTimeout(maybeRun, START_DELAY_MS);
  });

  GM_registerMenuCommand("Pull Uber trips now", () => { run(true); });
  GM_registerMenuCommand("Stop", stop);

  setTimeout(maybeRun, START_DELAY_MS);
  // A tab left open carries on a run that was cut, and starts the next run when it is due, with no page load and
  // nobody looking at it. Not once Uber has stopped a run: the next then waits for the site to be opened or looked
  // at, as the line says, so Uber's check is not met again and again with nobody there to clear it.
  setInterval(() => {
    if (current) return;
    const refused = Number((read(KEY.refused, null) || {}).at) > 0;
    if (due() ? !refused : openRun()) run(false);
  }, RECHECK_MS);
})();

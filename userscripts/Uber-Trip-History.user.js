// ==UserScript==
// @name         Pulse Ops — Uber trip history
// @namespace    levi.pulseops.uber-history
// @version      1.0.0
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
  const PAGES_PER_WEEK = 40;
  const PAGES_PER_RUN = 100; // checked between weeks; the rest wait for the next run
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
    uberAt: "uberLastAt", // when the last Uber request ended, so the gap holds across runs and tabs
    refused: "uberRefused" // { at, status, week }: the last time Uber stopped a run
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

  function due() {
    const last = stamp(KEY.lastRun);
    const now = Date.now();
    return last > now || now - last >= RUN_EVERY_MS;
  }

  // ---------- waiting, pausing and stopping ----------

  const tick = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  function stopCheck(job) {
    if (!job.stopped) {
      if (stamp(KEY.stop) > job.startedAt) job.stopped = "user";
      else if (job.locked && !ownsLock()) job.stopped = "lost";
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

  // The gap runs from the end of the last Uber request, this run's or any tab's.
  async function pace(job) {
    const last = Math.max(job.lastAt, Math.min(stamp(KEY.uberAt), Date.now()));
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
      const said = json && typeof json.error === "string" ? `: ${clip(json.error)}` : "";
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
    const where = `the week of ${weekLabel(week.start)}`;
    const lead = kind === "check" ? `Uber's check stopped it at ${where} (HTTP ${status}).`
      : kind === "status" ? `Uber answered HTTP ${status} at ${where}, so it stopped.`
      : kind === "notjson" ? `Uber's answer at ${where} wasn't data (its check, or signed out), so it stopped.`
      : kind === "said" ? (said ? `Uber said "${said}" at ${where}, so it stopped.` : `Uber turned down ${where}, so it stopped.`)
      : kind === "shape" ? `Uber's answer at ${where} wasn't in the shape this reads, so it stopped.`
      : `couldn't reach Uber at ${where}, so it stopped.`;
    return new Problem(`Pulse: ${lead} It carries on next time you open the driver site, after ${clock(at + RUN_EVERY_MS)}.`);
  }

  async function feedPage(job, week, cursor) {
    await pace(job);
    await checkpoint(job);
    const controller = new AbortController();
    job.abort = () => controller.abort();
    const timer = setTimeout(() => controller.abort(), UBER_TIMEOUT_MS);
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
      job.pages += 1;
      job.lastAt = Date.now();
      GM_setValue(KEY.uberAt, job.lastAt);
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

  // One pay week, every page of it, each row once.
  async function readWeek(job, week, index, count) {
    const rows = [];
    const ids = new Set();
    const cursors = new Set();
    let cursor = null;
    for (let page = 1; page <= PAGES_PER_WEEK; page += 1) {
      progress(job, week, page, index, count);
      const data = await feedPage(job, week, cursor);
      let fresh = 0;
      for (const row of data.activities) {
        if (!row || typeof row !== "object") continue;
        const id = typeof row.uuid === "string" ? row.uuid : "";
        if (id) {
          if (ids.has(id)) continue;
          ids.add(id);
        }
        rows.push(row);
        fresh += 1;
      }
      if (!data.more) break;
      // A feed that says there is more but hands back no new cursor, or only rows already read, is going round.
      const next = data.next;
      if (next === null || next === undefined || next === "") break;
      const key = JSON.stringify(next);
      if (cursors.has(key) || (data.activities.length && !fresh)) break;
      cursors.add(key);
      cursor = next;
    }
    return rows;
  }

  // ---------- a run ----------

  // A run that got through without Uber stopping it: the last stop is history.
  function forgetRefusal() {
    if (Number((read(KEY.refused, null) || {}).at) > 0) GM_setValue(KEY.refused, { at: 0, status: 0, week: "" });
  }

  async function pull(job) {
    show("Pulse: asking the PC which weeks it needs…");
    const weeks = weeksFrom(await askPC(job, "GET", "/api/uber-trips?weeks=1"));
    for (let index = 0; index < weeks.length; index += 1) {
      if (job.pages >= PAGES_PER_RUN) {
        forgetRefusal();
        return `Pulse: ${weeksWord(index)} in this time${sentPart(job)}; the other ${weeksWord(weeks.length - index)} come next time.`;
      }
      const week = weeks[index];
      job.week = week;
      const rows = await readWeek(job, week, index, weeks.length);
      await checkpoint(job);
      await handOver(job, week, rows);
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
      lastAt: 0, pages: 0, sent: 0, added: 0, week: null, prevLast: 0
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
      if (!forced && !due()) return; // another tab ran it while this one waited for the lock
      job.prevLast = stamp(KEY.lastRun);
      job.started = true;
      GM_setValue(KEY.lastRun, Date.now());
      job.beat = setInterval(() => beat(job), LOCK_BEAT_MS);
      end(job, await pull(job), false);
    } catch (error) {
      if (error instanceof Stopped) {
        if (error.why === "lost") end(job, `Pulse: another driver-site tab took over${sentPart(job)}.`, false);
        else if (error.why === "paused") {
          end(job, `Pulse: paused for half an hour, so it stopped${sentPart(job)}. It carries on next time you open the driver site, after ${clock(Date.now() + RUN_EVERY_MS)}.`, false);
        }
        else if (error.why !== "page") end(job, `Pulse: stopped${sentPart(job)}.`, false);
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
      releaseLock(); // only ever this tab's own: it may have written the lock and lost it in the same moment
      if (job.started && job.stopped !== "page") GM_setValue(KEY.lastRun, Date.now());
      if (current === job) current = null;
      paused = false;
      render();
    }
  }

  function stop() {
    const job = current;
    if (job) {
      if (!job.stopped) job.stopped = "user";
      if (job.abort) job.abort();
      show("Pulse: stopping…");
      return;
    }
    const lock = read(KEY.lock, null);
    if (lockFresh(lock) && lock.id !== TAB) {
      GM_setValue(KEY.stop, Date.now());
      note("Pulse: asked the driver-site tab that is pulling to stop.");
      return;
    }
    note("Pulse: nothing is pulling right now.");
  }

  function maybeRun() {
    if (!current && due()) run(false);
  }

  // Leaving the page mid-run: let go of the lock now, and do not count the run, so the next page carries on.
  window.addEventListener("pagehide", () => {
    const job = current;
    if (!job || job.ended) return;
    const cut = job.started && !job.stopped;
    if (!job.stopped) job.stopped = "page";
    if (job.abort) job.abort();
    clearInterval(job.beat);
    if (cut) GM_setValue(KEY.lastRun, job.prevLast);
    releaseLock();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeRun();
  });

  GM_registerMenuCommand("Pull Uber trips now", () => { run(true); });
  GM_registerMenuCommand("Stop", stop);

  setTimeout(maybeRun, START_DELAY_MS);
})();

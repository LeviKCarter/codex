// Tests for Uber-Trip-History.user.js: `node userscripts/Uber-Trip-History.test.mjs` (a path to another copy of the
// script may follow, to run the same checks against it).
// The script is run whole, as Tampermonkey runs it, in a made-up browser tab: a clock that moves only when a test
// moves it, a made-up Uber feed (ten rows to a page, a cursor for the next), a made-up Pulse Ops, and one Tampermonkey
// storage shared by every tab of a test. Nothing here reaches Uber or the PC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const file = process.argv[2] ?? fileURLToPath(new URL("./Uber-Trip-History.user.js", import.meta.url));
const source = readFileSync(file, "utf8");

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const PAGE = 10;

const endOf = (start) => new Date(Date.parse(`${start}T00:00:00Z`) + 7 * 24 * HOUR).toISOString().slice(0, 10);
const rowsOf = (start, count) => Array.from({ length: count }, (_, i) => ({ uuid: `${start}#${i}`, type: "TRIP" }));

// weeks: { "2026-08-10": 300, ... } is how many feed rows Uber has for the pay week that starts that Monday.
function makeWorld(weeks) {
  const world = {
    now: Date.UTC(2026, 9, 7, 19, 0, 0),
    random: 0.5, // what Math.random gives the script: 0 is the shortest gap between Uber requests it ever leaves
    timers: [],
    timerId: 0,
    tabs: 0,
    store: new Map(),
    // latency: how long Uber takes to answer. epoch: raise it and every cursor given out before is an old one.
    // soft: how an old cursor is answered ("empty", "first" or "nodata"); null is an error, "Invalid cursor".
    // trailing: a week whose rows fill its pages exactly ends on one more page, with nothing on it.
    uber: { rows: new Map(), requests: [], epoch: 0, rule: null, latency: 0, soft: null, trailing: false },
    pc: { posts: [], tries: 0, pulled: new Set(), latency: 0, rule: null }
  };
  for (const [start, count] of Object.entries(weeks)) world.uber.rows.set(start, rowsOf(start, count));
  return world;
}

const stored = (world, key) => (world.store.has(key) ? JSON.parse(world.store.get(key)) : undefined);

function uberAnswer(world, request) {
  const count = world.uber.requests.length;
  const ruled = world.uber.rule ? world.uber.rule(request, count) : null;
  if (ruled) return ruled;
  const plain = (data) => ({ status: 200, text: JSON.stringify({ status: "success", data }) });
  const rows = world.uber.rows.get(request.week) ?? [];
  const page = (offset) => {
    const more = world.uber.trailing ? offset + PAGE <= rows.length : offset + PAGE < rows.length;
    return plain({ activities: rows.slice(offset, offset + PAGE), pagination: { hasMoreData: more, nextCursor: more ? `e${world.uber.epoch}:${offset + PAGE}` : null } });
  };
  if (request.cursor === null) return page(0);
  const match = /^e(\d+):(\d+)$/.exec(String(request.cursor));
  if (match && Number(match[1]) === world.uber.epoch) return page(Number(match[2]));
  if (world.uber.soft === "empty") return plain({ activities: [], pagination: { hasMoreData: false, nextCursor: null } });
  if (world.uber.soft === "first") return page(0);
  if (world.uber.soft === "nodata") return plain({});
  return { status: 200, text: JSON.stringify({ status: "failure", data: { message: "Invalid cursor" } }) };
}

function pcAnswer(world, method, path, body) {
  if (method === "GET" && path === "/api/uber-trips?weeks=1") {
    const weeks = [...world.uber.rows.keys()].filter((start) => !world.pc.pulled.has(start)).sort().reverse()
      .map((start) => ({ start, end: endOf(start), paid: 1, kept: 0 }));
    return { status: 200, text: JSON.stringify({ ok: true, weeks }) };
  }
  if (method === "POST" && path === "/api/uber-trips") {
    world.pc.tries += 1;
    const ruled = world.pc.rule ? world.pc.rule(world.pc.tries) : null;
    if (ruled) return ruled;
    const { rows, week } = JSON.parse(body);
    world.pc.posts.push({ start: week.start, rows: rows.length, ids: rows.map((row) => row.uuid), at: world.now });
    world.pc.pulled.add(week.start);
    return { status: 200, text: JSON.stringify({ ok: true, added: rows.length, known: 0, skipped: 0, pulled: { ...week, rows: rows.length, added: rows.length } }) };
  }
  return { status: 404, text: "{}" };
}

const prelude = `
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(__now()); }
    static now() { return __now(); }
  };
  Math.random = () => __random();
`;

// A tab on drivers.uber.com with the script running in it.
function openTab(world) {
  const tab = { id: ++world.tabs, dead: false, stalled: false, line: null, commands: {}, heard: { window: {}, document: {} } };
  const later = (fn, ms, every, net) => {
    const id = ++world.timerId;
    world.timers.push({ id, at: world.now + Math.max(0, Number(ms) || 0), fn, every: every ? Math.max(1, Number(ms) || 0) : 0, tab, net: !!net });
    return id;
  };
  const drop = (id) => { world.timers = world.timers.filter((timer) => timer.id !== id); };
  const hear = (who) => (type, fn) => { (tab.heard[who][type] ??= []).push(fn); };
  const element = () => ({
    isConnected: false, textContent: "", title: "", tabIndex: 0, style: { setProperty() {} }, heard: {},
    setAttribute() {}, addEventListener(type, fn) { this.heard[type] = fn; }, remove() { this.isConnected = false; }
  });
  const body = { appendChild(el) { el.isConnected = true; tab.line = el; } };
  tab.document = { visibilityState: "visible", body, documentElement: body, createElement: element, addEventListener: hear("document") };
  const context = vm.createContext({
    __now: () => world.now,
    __random: () => world.random,
    window: { addEventListener: hear("window") },
    document: tab.document,
    location: { origin: "https://drivers.uber.com" },
    crypto: { randomUUID: () => `tab-${tab.id}` },
    AbortController,
    setTimeout: (fn, ms) => later(fn, ms, false),
    setInterval: (fn, ms) => later(fn, ms, true),
    clearTimeout: drop,
    clearInterval: drop,
    fetch: (url, init) => new Promise((resolve, reject) => {
      const sent = JSON.parse(init.body);
      const cursor = sent.paginationOption && "cursor" in sent.paginationOption ? sent.paginationOption.cursor : null;
      const request = { week: sent.startDateIso, end: sent.endDateIso, cursor, at: world.now, tab: tab.id };
      world.uber.requests.push(request);
      const answer = uberAnswer(world, request);
      // { fail: true } from a test's rule: the request never gets an answer (no connection).
      const arrive = () => (answer.fail ? reject(new Error("no connection")) : resolve({ status: answer.status, text: () => Promise.resolve(answer.text) }));
      if (init.signal) init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      if (world.uber.latency) later(arrive, world.uber.latency, false, true);
      else arrive();
    }),
    GM_getValue: (key, fallback) => (world.store.has(key) ? JSON.parse(world.store.get(key)) : fallback),
    GM_setValue: (key, value) => { world.store.set(key, JSON.stringify(value === undefined ? null : value)); },
    GM_registerMenuCommand: (name, fn) => { tab.commands[name] = fn; },
    GM_xmlhttpRequest: (details) => {
      const path = details.url.replace("http://localhost:3000", "");
      let aborted = false;
      const answer = () => {
        if (aborted || tab.dead) return;
        const reply = pcAnswer(world, details.method, path, details.data);
        details.onload({ status: reply.status, responseText: reply.text, finalUrl: details.url });
      };
      if (world.pc.latency) later(answer, world.pc.latency, false, true);
      else Promise.resolve().then(answer);
      return { abort() { aborted = true; } };
    }
  });
  vm.runInContext(prelude, context);
  vm.runInContext(source, context, { filename: file });
  tab.status = () => (tab.line && tab.line.isConnected ? tab.line.textContent : "");
  // A click on the status line: pause, carry on, or close it.
  tab.click = () => tab.line.heard.click({ preventDefault() {}, stopPropagation() {} });
  return tab;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Chrome puts the tab to sleep: nothing in it runs again, and the page is told nothing.
const sleep = (tab) => { tab.dead = true; };
// The page is left (closed, reloaded, or gone to another site): it is told, what it was doing unwinds, and it is gone.
async function leave(tab) {
  for (const fn of tab.heard.window.pagehide ?? []) fn({ persisted: false });
  await settle();
  tab.dead = true;
}
// A background tab Chrome holds back for a while: nothing in it runs until it is let go, and then an answer from the
// network that came meanwhile is handed to the page ahead of its late timers.
function stall(world, tab, on) {
  tab.stalled = on;
  if (!on) for (const timer of world.timers) if (timer.tab === tab && timer.net && timer.at <= world.now) timer.at = 0;
}
// He looks at the tab again.
function visit(tab) {
  tab.document.visibilityState = "visible";
  for (const fn of tab.heard.document.visibilitychange ?? []) fn({});
}

async function advance(world, ms) {
  const end = world.now + ms;
  for (;;) {
    await settle();
    world.timers = world.timers.filter((timer) => !timer.tab.dead);
    const next = world.timers.filter((timer) => !timer.tab.stalled)
      .reduce((first, timer) => (!first || timer.at < first.at || (timer.at === first.at && timer.id < first.id) ? timer : first), null);
    if (!next || next.at > end) break;
    world.now = Math.max(world.now, next.at);
    if (next.every) next.at = world.now + next.every;
    else world.timers = world.timers.filter((timer) => timer !== next);
    next.fn();
  }
  world.now = end;
  await settle();
}

async function until(world, test, limit, what, step = 250) {
  const end = world.now + limit;
  while (!test()) {
    assert.ok(world.now < end, `never happened within ${Math.round(limit / MINUTE)} min: ${what}`);
    await advance(world, step);
  }
}

const asked = (world) => world.uber.requests.length;
const askedTwice = (world) => {
  const seen = new Set();
  return world.uber.requests.filter((r) => { const key = `${r.week}|${r.cursor}`; if (seen.has(key)) return true; seen.add(key); return false; }).length;
};
const post = (world, start) => world.pc.posts.filter((p) => p.start === start);
const whole = (world, start, count) => {
  const posts = post(world, start);
  assert.equal(posts.length, 1, `the week of ${start} is handed over once`);
  assert.equal(posts[0].rows, count, `the week of ${start} is handed over whole`);
  assert.equal(new Set(posts[0].ids).size, count, `no row of the week of ${start} twice`);
};
const none = (value) => value ?? null;
// Is a run on record as not over: one that may be carried on, or is paused.
const runOpen = (world) => { const record = stored(world, "openRun"); return !!record && record.closed !== true; };
const weeksOf = (starts, rows) => Object.fromEntries(starts.map((start) => [start, rows]));
const SEVEN = ["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];

// One thirty-page week, twelve pages asked and answered, and then the tab is put to sleep.
async function cutAtTwelve(world) {
  const tab = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "twelve pages asked");
  sleep(tab);
  return tab;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- a run, and its weeks ----------

test("short weeks are read newest first and handed over, and the run ends with nothing kept", async () => {
  const world = makeWorld({ "2026-08-03": 25, "2026-08-10": 5, "2026-08-17": 0 });
  openTab(world);
  await advance(world, 10 * MINUTE);
  assert.deepEqual(world.pc.posts.map((p) => [p.start, p.rows]), [["2026-08-17", 0], ["2026-08-10", 5], ["2026-08-03", 25]]);
  assert.equal(asked(world), 5);
  assert.equal(none(stored(world, "weekPlace")), null, "no place is kept once its week is handed over");
  assert.equal(runOpen(world), false, "a run that ended by itself is not open");
  assert.ok(stored(world, "lastRun") > 0);
});

test("a week longer than forty pages is handed over whole", async () => {
  const world = makeWorld({ "2026-08-10": 550 });
  openTab(world);
  await advance(world, 15 * MINUTE);
  whole(world, "2026-08-10", 550);
  assert.equal(asked(world), 55);
});

test("a run stops at a hundred pages, in the middle of a week, and the next run picks that week up", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  const tab = openTab(world);
  await advance(world, 3 * HOUR);
  assert.equal(asked(world), 100, "a hundred pages and no more, though the fourth week is ten pages in");
  assert.equal(world.pc.posts.length, 3);
  assert.equal(stored(world, "weekPlace").start, "2026-07-20");
  assert.equal(stored(world, "weekPlace").pages, 10);
  assert.equal(runOpen(world), false);
  assert.match(tab.status() || "gone", /gone|3 weeks in this time; 4 more weeks come next time/);
  const last = world.uber.requests[99].at;
  await advance(world, last + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 100, "nothing more for six hours");
  await advance(world, 3 * HOUR);
  assert.equal(asked(world), 200, "then the tab left open reads a hundred more by itself");
  assert.equal(askedTwice(world), 0);
  for (const start of SEVEN.slice(1)) whole(world, start, 300);
});

test("a week that runs past the page stop is not handed over, and Uber is not asked for it again", async () => {
  const world = makeWorld({ "2026-08-10": 1050 });
  const tab = openTab(world);
  await advance(world, 30 * MINUTE);
  assert.equal(world.pc.posts.length, 0, "a week cut short is never handed over");
  assert.equal(asked(world), 100);
  assert.match(tab.status(), /runs past 100 pages/);
  // A newer week ends meanwhile and is listed ahead of it. The stopped week still comes first, and is not read again.
  world.uber.rows.set("2026-08-17", rowsOf("2026-08-17", 30));
  await advance(world, 13 * HOUR);
  assert.equal(world.pc.posts.length, 0);
  assert.equal(asked(world), 100, "later runs ask Uber nothing");
  assert.match(tab.status(), /runs past 100 pages/);
});

// ---------- a run that is cut ----------

test("a run Chrome put to sleep is carried on by the next tab, with no page asked twice", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  await advance(world, 30 * SECOND);
  assert.equal(stored(world, "weekPlace").pages, 12, "the place is kept after every page");
  assert.equal(stored(world, "openRun").pages, 12, "the run is still open with its pages counted");
  // The sleeping tab's lock is still fresh for three minutes; the new tab waits it out by itself.
  openTab(world);
  await advance(world, 12 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
  assert.equal(askedTwice(world), 0);
  assert.equal(runOpen(world), false);
});

test("a run cut by leaving the page mid-week is carried on by the next page", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const first = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "twelve pages asked");
  await leave(first);
  openTab(world);
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
  assert.equal(askedTwice(world), 0);
});

test("a page back from the back/forward cache carries its run on", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "twelve pages asked");
  for (const fn of tab.heard.window.pagehide) fn({ persisted: true });
  await settle();
  stall(world, tab, true); // a page in the cache runs nothing
  await advance(world, 10 * MINUTE);
  assert.equal(asked(world), 12);
  stall(world, tab, false);
  for (const fn of tab.heard.window.pageshow) fn({ persisted: true });
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
});

test("a run cut with a page out and no answer seen is not carried on: it waits six hours, as Uber may have said no", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  const first = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "the twelfth page asked", 100);
  await leave(first); // its answer never reaches the page
  const last = world.uber.requests[11].at;
  assert.equal(stored(world, "weekPlace").pages, 11);
  openTab(world);
  await advance(world, last + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 12, "short visits cannot have the same page asked over and over");
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 31);
  assert.equal(askedTwice(world), 1, "the page whose answer was never seen is asked once more, six hours on");
});

test("the six hours count from the last page asked, also when its answer was never seen", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  const tab = openTab(world);
  await until(world, () => stored(world, "weekPlace")?.pages === 12, 5 * MINUTE, "twelve pages answered", 100);
  tab.click(); // paused
  await advance(world, 20 * MINUTE);
  tab.click(); // carried on
  await until(world, () => asked(world) === 13, MINUTE, "the thirteenth page asked", 100);
  sleep(tab); // with that page out, twenty minutes after Uber last answered
  const last = world.uber.requests[12].at;
  openTab(world);
  await advance(world, last + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 13);
  await advance(world, 4 * MINUTE);
  assert.ok(asked(world) > 13);
});

test("the six hours count from the last page asked, also when the run was paused with that page out", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 15 * SECOND;
  const tab = openTab(world);
  await until(world, () => stored(world, "weekPlace")?.pages === 12, 10 * MINUTE, "twelve pages answered", 100);
  stall(world, tab, true); // held back for twenty minutes, then let go: its next page goes out at once
  await advance(world, 20 * MINUTE);
  stall(world, tab, false);
  await until(world, () => asked(world) === 13, MINUTE, "the thirteenth page asked", 100);
  tab.click(); // paused, with that page out
  sleep(tab);
  const last = world.uber.requests[12].at;
  openTab(world);
  await advance(world, last + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 13);
  await advance(world, 4 * MINUTE);
  assert.ok(asked(world) > 13);
});

test("a run started from the menu right after a request that got no answer still leaves four seconds after it", async () => {
  const world = makeWorld({ "2026-08-10": 30 });
  world.random = 0;
  world.uber.rule = (request, count) => (count === 1 ? { fail: true } : null);
  const tab = openTab(world);
  await until(world, () => asked(world) === 1, MINUTE, "the first page asked", 50);
  await advance(world, 200);
  assert.match(tab.status(), /couldn't reach Uber/);
  tab.commands["Pull Uber trips now"]();
  await advance(world, MINUTE);
  const gap = world.uber.requests[1].at - world.uber.requests[0].at;
  assert.ok(gap >= 4 * SECOND, `the new run's first request came ${gap} ms after the one that failed`);
});

test("a run started from the menu right after a page was cut off still leaves four seconds after it", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  world.random = 0;
  const first = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "the twelfth page asked", 50);
  await leave(first);
  openTab(world).commands["Pull Uber trips now"]();
  await advance(world, MINUTE);
  const gap = world.uber.requests[12].at - world.uber.requests[11].at;
  assert.ok(gap >= 4 * SECOND, `the new run's first request came ${gap} ms after the one cut off`);
});

test("a run that is cut gets no more pages than one that is not, and the next waits six hours from its last page", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  let tab = openTab(world);
  for (const pages of [17, 45, 71, 99]) {
    await until(world, () => asked(world) === pages, 30 * MINUTE, `${pages} pages asked`);
    sleep(tab);
    await advance(world, 4 * MINUTE);
    tab = openTab(world);
  }
  await advance(world, 3 * HOUR);
  assert.equal(asked(world), 100, "cut four times, the run still stops at a hundred pages");
  assert.equal(askedTwice(world), 0);
  assert.equal(world.pc.posts.length, 3);
  const last = world.uber.requests[99].at;
  await advance(world, last + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 100, "the next run waits six hours");
  await advance(world, 4 * MINUTE);
  assert.ok(asked(world) > 100, "and then starts by itself in the tab left open");
});

test("a run cut with its hundredth page out is not carried on, and the next waits six hours from its last answer", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  world.uber.latency = SECOND;
  const first = openTab(world);
  await until(world, () => asked(world) === 100, 30 * MINUTE, "the hundredth page asked", 100);
  sleep(first);
  assert.equal(stored(world, "openRun").pages, 100);
  const last = stored(world, "uberLastAt");
  await advance(world, 5 * MINUTE);
  openTab(world);
  await advance(world, last + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 100, "nothing is asked until six hours after Uber last answered");
  await advance(world, 4 * MINUTE);
  assert.ok(asked(world) > 100, "then the next run starts by itself");
});

test("six hours after a cut run's last page, the next run starts with its own hundred pages", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  const first = openTab(world);
  await until(world, () => asked(world) === 45, 30 * MINUTE, "45 pages asked");
  sleep(first);
  await advance(world, 7 * HOUR);
  assert.equal(asked(world), 45, "with no tab open, nothing runs");
  openTab(world);
  await advance(world, 2 * HOUR);
  assert.equal(asked(world), 145);
  assert.equal(askedTwice(world), 0);
});

test("\"Pull Uber trips now\" does not carry a cut run's pages on", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  const first = openTab(world);
  await until(world, () => asked(world) === 45, 30 * MINUTE, "45 pages asked");
  sleep(first);
  await advance(world, 4 * MINUTE);
  openTab(world).commands["Pull Uber trips now"]();
  await advance(world, 2 * HOUR);
  assert.equal(asked(world), 145);
  assert.equal(askedTwice(world), 0);
});

test("\"Pull Uber trips now\" starts a new run with its own pages", async () => {
  const world = makeWorld(weeksOf(SEVEN.slice(1), 400));
  const tab = openTab(world);
  await advance(world, HOUR);
  assert.equal(asked(world), 100);
  tab.commands["Pull Uber trips now"]();
  await advance(world, HOUR);
  assert.equal(asked(world), 200);
  assert.equal(world.pc.posts.length, 5);
});

test("a place kept for a week the PC no longer asks for is dropped", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  world.pc.pulled.add("2026-08-10"); // read in some other way meanwhile
  await advance(world, 4 * MINUTE);
  const tab = openTab(world);
  await advance(world, 20 * SECOND);
  assert.match(tab.status(), /every week is in/);
  assert.equal(asked(world), 12);
  assert.equal(none(stored(world, "weekPlace")), null);
});

// ---------- the place in a week ----------

for (const soft of ["empty", "first", "nodata"]) {
  test(`a week carried on that Uber ends with nothing new (${soft}) is read again from its first page, not handed over short`, async () => {
    const world = makeWorld({ "2026-08-10": 300 });
    await cutAtTwelve(world);
    world.uber.epoch += 1; // the kept cursor is an old one now
    world.uber.soft = soft; // and Uber answers it with plain data, not an error
    await advance(world, 4 * MINUTE);
    openTab(world);
    await advance(world, 6 * MINUTE);
    whole(world, "2026-08-10", 300);
    assert.equal(asked(world), 12 + 1 + 30);
  });
}

test("a carry-on that meets a true empty last page reads the week again, and hands it over whole", async () => {
  const world = makeWorld({ "2026-08-10": 20 });
  world.uber.trailing = true; // 10 rows, 10 rows, and a third page with nothing on it
  const first = openTab(world);
  await until(world, () => asked(world) === 2, MINUTE, "two pages asked");
  sleep(first);
  await advance(world, 4 * MINUTE);
  openTab(world);
  await advance(world, 2 * MINUTE);
  whole(world, "2026-08-10", 20);
  assert.equal(asked(world), 2 + 1 + 3);
});

test("a cursor that waited through a twenty-minute pause is not trusted to end the week either", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "twelve pages asked");
  tab.click(); // paused
  await advance(world, 20 * MINUTE);
  world.uber.epoch += 1;
  world.uber.soft = "empty";
  tab.click(); // carried on: the cursor in hand is answered with an empty last page
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 12 + 1 + 30);
});

test("a cursor whose answer was ten minutes on its way to a held-back tab is not trusted to end the week", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 15 * SECOND;
  const tab = openTab(world);
  await until(world, () => asked(world) === 1, MINUTE, "the first page asked", 100);
  stall(world, tab, true); // with that page's answer, and the cursor in it, on its way
  await advance(world, 10 * MINUTE);
  world.uber.epoch += 1;
  world.uber.soft = "nodata";
  world.uber.latency = 150;
  stall(world, tab, false);
  await advance(world, 15 * MINUTE);
  whole(world, "2026-08-10", 300);
});

test("a week read again that comes to fewer rows than it had is not handed over, and its rows' count is not forgotten", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  await advance(world, 4 * MINUTE);
  // For a while Uber answers everything with success and no rows.
  const blank = { status: 200, text: JSON.stringify({ status: "success", data: { activities: [], pagination: { hasMoreData: false } } }) };
  world.uber.rule = () => blank;
  const tab = openTab(world);
  await advance(world, 5 * MINUTE);
  assert.equal(world.pc.posts.length, 0, "a week that had 120 rows is not handed over with none");
  assert.match(tab.status(), /fewer trips/);
  assert.equal(asked(world), 12 + 2, "the kept cursor, then the first page: nothing after that");
  assert.equal(stored(world, "weekPlace").least, 120);
  await advance(world, 48 * HOUR);
  assert.equal(asked(world), 14, "and nothing by itself, as after any stop by Uber");
  world.uber.rule = null;
  visit(tab);
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 300);
});

test("a week of a hundred requests whose carry-on meets its empty last page still gets in", async () => {
  // A one-page week, then a week of 99 full pages that ends on a hundredth with nothing on it, then a three-page one.
  const world = makeWorld({ "2026-08-17": 5, "2026-08-10": 990, "2026-08-03": 25 });
  world.uber.trailing = true;
  openTab(world);
  await advance(world, 30 * HOUR);
  whole(world, "2026-08-17", 5);
  whole(world, "2026-08-10", 990);
  whole(world, "2026-08-03", 25);
  // 1 + 99, the run's hundred. Then the empty page, which ends that run: too few pages left to read the week again.
  // Then the week from its first page, all hundred. Then the last week's three.
  assert.equal(asked(world), 100 + 1 + 100 + 3);
});

test("a hand-over the PC turns down is tried again next run without asking Uber anything", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.pc.rule = (tries) => (tries === 1 ? { status: 500, text: JSON.stringify({ ok: false, error: "Could not keep the trips." }) } : null);
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  assert.equal(asked(world), 30);
  assert.equal(world.pc.posts.length, 0);
  assert.match(tab.status(), /the PC answered HTTP 500/);
  assert.equal(stored(world, "weekPlace").whole, true, "the week read to its end is kept whole");
  await advance(world, 6.5 * HOUR);
  whole(world, "2026-08-10", 300);
  assert.equal(world.pc.tries, 2);
  assert.equal(asked(world), 30, "Uber is asked nothing for a week already read");
  assert.equal(none(stored(world, "weekPlace")), null);
});

test("a newer week listed ahead of a kept place does not wipe it", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.rule = (request, count) => (count === 8 ? { status: 403, text: "<html>challenge</html>" } : null);
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  assert.equal(stored(world, "weekPlace").pages, 7);
  world.uber.rows.set("2026-08-17", rowsOf("2026-08-17", 30)); // a pay week ends, and the PC lists it first
  await advance(world, 6.5 * HOUR);
  visit(tab);
  await advance(world, 10 * MINUTE);
  assert.deepEqual(world.pc.posts.map((p) => [p.start, p.rows]), [["2026-08-10", 300], ["2026-08-17", 30]], "the week with the place is read first");
  assert.equal(asked(world), 8 + 23 + 3);
  assert.equal(askedTwice(world), 1, "only the page Uber refused is asked a second time");
});

// ---------- Uber's refusals ----------

test("Uber's check stops the run and keeps the place; nothing starts again by itself, and a look at the tab picks the week up", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.rule = (request, count) => (count === 8 ? { status: 403, text: "<html>challenge</html>" } : null);
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  assert.equal(asked(world), 8, "nothing is asked again in that run");
  assert.match(tab.status(), /Uber's check stopped it/);
  assert.equal(world.pc.posts.length, 0);
  assert.equal(stored(world, "weekPlace").pages, 7);
  assert.equal(runOpen(world), false, "a run Uber stopped has ended, and is not carried on");
  await advance(world, 48 * HOUR);
  assert.equal(asked(world), 8, "two days with the tab open and nobody there: Uber is not asked again");
  visit(tab);
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 8 + 23, "the week is picked up at its eighth page");
});

test("a look at the tab sooner than six hours after Uber's check starts nothing", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.rule = (request, count) => (count === 8 ? { status: 403, text: "<html>challenge</html>" } : null);
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  for (let hour = 1; hour <= 5; hour += 1) {
    await advance(world, HOUR);
    visit(tab);
    openTab(world);
  }
  await advance(world, 30 * MINUTE);
  assert.equal(asked(world), 8);
});

test("Uber's check on the first page from a kept place leaves the place where it is", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  await advance(world, 4 * MINUTE);
  world.uber.rule = (request, count) => (count === 13 ? { status: 429, text: "slow down" } : null);
  const tab = openTab(world);
  await advance(world, 5 * MINUTE);
  assert.equal(asked(world), 13);
  assert.match(tab.status(), /Uber's check stopped it/);
  assert.equal(stored(world, "weekPlace").pages, 12, "its check says nothing about the place");
  await advance(world, 6.5 * HOUR);
  assert.equal(asked(world), 13);
  visit(tab);
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 13 + 18);
});

test("a sign-in page on the first page from a kept place leaves the place where it is", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  await advance(world, 4 * MINUTE);
  world.uber.rule = (request, count) => (count === 13 ? { status: 200, text: "<html>Sign in</html>" } : null);
  const tab = openTab(world);
  await advance(world, 5 * MINUTE);
  assert.equal(asked(world), 13);
  assert.match(tab.status(), /wasn't data/);
  assert.equal(stored(world, "weekPlace").pages, 12);
  await advance(world, 6.5 * HOUR);
  visit(tab);
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 13 + 18);
});

test("a page back from the back/forward cache after Uber's stop picks the week up, six hours on", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.rule = (request, count) => (count === 8 ? { status: 403, text: "<html>challenge</html>" } : null);
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  assert.equal(asked(world), 8);
  for (const fn of tab.heard.window.pagehide) fn({ persisted: true });
  await settle();
  stall(world, tab, true);
  await advance(world, 6.5 * HOUR);
  // Back: the page's late timers do nothing while Uber's stop stands; the page coming back is what starts the run.
  for (const timer of world.timers) if (timer.tab === tab && timer.every) timer.at = world.now + timer.every;
  stall(world, tab, false);
  for (const fn of tab.heard.window.pageshow) fn({ persisted: true });
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 8 + 23);
});

test("an error partway through a carried-on week keeps the place", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  await advance(world, 4 * MINUTE);
  world.uber.rule = (request, count) => (count === 20 ? { status: 500, text: "{}" } : null);
  const tab = openTab(world);
  await advance(world, 5 * MINUTE);
  assert.equal(asked(world), 20);
  assert.match(tab.status(), /Uber answered HTTP 500/);
  assert.equal(stored(world, "weekPlace").pages, 19);
  await advance(world, 6.5 * HOUR);
  visit(tab);
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 20 + 11);
});

test("a kept place Uber no longer takes is dropped, the run stops, and the week starts over at the next look", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  world.uber.epoch += 1; // every cursor Uber gave out before now is refused
  await advance(world, 4 * MINUTE);
  const tab = openTab(world);
  await advance(world, 5 * MINUTE);
  assert.equal(asked(world), 13, "one page asked from the place, and nothing after Uber said no");
  assert.match(tab.status(), /Invalid cursor/);
  assert.equal(none(stored(world, "weekPlace")), null);
  assert.equal(world.pc.posts.length, 0);
  await advance(world, 6.5 * HOUR);
  visit(tab);
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 13 + 30);
});

// ---------- Stop, and a pause ----------

test("Stop in the tab that is pulling ends the run, and no other tab carries it on", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "twelve pages asked");
  const puller = world.uber.requests[0].tab === tab.id ? tab : null;
  assert.ok(puller, "the first tab is the one pulling");
  tab.commands.Stop();
  await advance(world, 30 * MINUTE);
  assert.equal(asked(world), 12);
  assert.equal(runOpen(world), false);
});

test("Stop given for a run whose tab is asleep ends it: nothing carries it on", async () => {
  // Given while the sleeping tab's lock still looks fresh.
  const soon = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(soon);
  await advance(soon, 20 * SECOND);
  const other = openTab(soon);
  other.commands.Stop();
  assert.match(other.status(), /stopped\. A driver-site tab that is pulling stops within a few seconds/);
  await advance(soon, 30 * MINUTE);
  assert.equal(asked(soon), 12);

  // Given after that lock has gone stale.
  const late = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(late);
  await advance(late, 4 * MINUTE);
  const tab = openTab(late);
  tab.commands.Stop();
  assert.match(tab.status(), /stopped the run that was cut/);
  await advance(late, 30 * MINUTE);
  assert.equal(asked(late), 12);
});

test("Stop given in another tab reaches the tab that is pulling, awake or held back", async () => {
  const awake = makeWorld({ "2026-08-10": 300 });
  const puller = openTab(awake);
  const other = openTab(awake);
  await until(awake, () => asked(awake) === 12, 5 * MINUTE, "twelve pages asked");
  assert.equal(awake.uber.requests[0].tab, puller.id);
  other.commands.Stop();
  await advance(awake, 30 * MINUTE);
  assert.equal(asked(awake), 12);
  assert.match(puller.status() || "Pulse: stopped.", /stopped/);

  // Held back by Chrome for longer than its lock stays fresh, then let go.
  const held = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(held);
  await until(held, () => asked(held) === 12, 5 * MINUTE, "twelve pages asked");
  stall(held, tab, true);
  await advance(held, 4 * MINUTE);
  openTab(held).commands.Stop();
  stall(held, tab, false);
  await advance(held, 30 * MINUTE);
  assert.equal(asked(held), 12, "let go, the held tab finds the Stop and asks nothing more");
});

test("Stop given while a run is still settling its lock holds: nothing starts by itself for six hours", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  await advance(world, 9 * SECOND); // the run began at 8 s and takes 3 s over its lock
  tab.commands.Stop();
  await advance(world, 5 * HOUR);
  assert.equal(asked(world), 0);
  await advance(world, 2 * HOUR);
  assert.ok(asked(world) > 0, "six hours on, the tab left open starts the run");
});

test("a paused run is not carried on when its tab is put to sleep, and carries on in its own tab at a click", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "twelve pages asked");
  tab.click();
  assert.match(tab.status(), /paused/);
  await advance(world, 5 * MINUTE);
  assert.equal(asked(world), 12);
  tab.click();
  await until(world, () => asked(world) === 15, 5 * MINUTE, "carried on after the click");
  tab.click();
  sleep(tab);
  openTab(world);
  await advance(world, 30 * MINUTE);
  assert.equal(asked(world), 15, "another tab leaves a paused run alone");
});

// ---------- more than one tab ----------

test("a tab held back long enough to lose the run to another leaves that run open", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const first = openTab(world);
  await until(world, () => asked(world) === 12, 5 * MINUTE, "twelve pages asked");
  stall(world, first, true);
  await advance(world, 4 * MINUTE); // past the three minutes its lock stays fresh
  const second = openTab(world);
  await until(world, () => asked(world) === 20, 5 * MINUTE, "the second tab carried the run on");
  stall(world, first, false);
  await advance(world, SECOND);
  assert.match(first.status(), /another driver-site tab took over/);
  sleep(second);
  assert.equal(stored(world, "openRun").pages, 20, "the run the first tab lost is still open");
  await advance(world, 4 * MINUTE);
  openTab(world);
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
});

test("a tab held back with an answer on its way does not write its old place over the new tab's", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  const first = openTab(world);
  await until(world, () => asked(world) === 13, 5 * MINUTE, "the thirteenth page asked", 100);
  stall(world, first, true); // with that page's answer still on its way
  await advance(world, 4 * MINUTE);
  // A run with a page out and no answer is not carried on, so the second tab takes it over from the menu.
  openTab(world).commands["Pull Uber trips now"]();
  await until(world, () => stored(world, "weekPlace").pages === 19, 5 * MINUTE, "the second tab is seven pages on");
  stall(world, first, false);
  await advance(world, 500);
  assert.match(first.status(), /another driver-site tab took over/);
  assert.equal(stored(world, "weekPlace").pages, 19, "the place is still the second tab's");
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 300);
});

test("Uber's stop, learned by a tab that had lost the run while the next was still settling its lock, ends the run for all", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  world.uber.rule = (request, count) => (count === 13 ? { status: 429, text: "slow down" } : null);
  const first = openTab(world);
  await until(world, () => asked(world) === 13, 5 * MINUTE, "the thirteenth page asked", 100);
  stall(world, first, true); // Uber's check is on its way to a tab Chrome is holding back
  await advance(world, 4 * MINUTE);
  openTab(world); // a third tab, only open
  const second = openTab(world);
  second.commands["Pull Uber trips now"](); // takes the run over, and is three seconds settling its lock
  await advance(world, SECOND);
  stall(world, first, false); // the first tab learns of Uber's stop now
  await advance(world, 30 * MINUTE);
  assert.match(first.status(), /Uber's check stopped it/);
  assert.equal(asked(world), 13, "neither the tab settling its lock nor the one left open asks Uber anything");
  assert.equal(runOpen(world), false);
});

test("Uber's stop, learned late by a tab that had lost the run, stops the tab that has it", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  world.uber.rule = (request, count) => (count === 13 ? { status: 403, text: "<html>challenge</html>" } : null);
  const first = openTab(world);
  await until(world, () => asked(world) === 13, 5 * MINUTE, "the thirteenth page asked", 100);
  stall(world, first, true); // Uber's check is on its way to a tab Chrome is holding back
  await advance(world, 4 * MINUTE);
  const second = openTab(world);
  second.commands["Pull Uber trips now"]();
  await until(world, () => asked(world) === 20, 5 * MINUTE, "the second tab asks on");
  stall(world, first, false);
  await advance(world, SECOND);
  assert.match(first.status(), /Uber's check stopped it/);
  const then = asked(world);
  await advance(world, 30 * MINUTE);
  assert.ok(asked(world) - then <= 1, "at most the page already on its way");
  assert.match(second.status(), /Uber stopped this run in another driver-site tab/);
  assert.equal(runOpen(world), false);
});

test("two tabs open at once: one pulls, and its Uber requests are four to eight seconds apart", async () => {
  // Math.random at its least and at its most: the shortest and the longest gap the script leaves.
  for (const random of [0, 0.999]) {
    const world = makeWorld({ "2026-08-03": 300, "2026-08-10": 300 });
    world.random = random;
    openTab(world);
    openTab(world);
    await advance(world, 20 * MINUTE);
    whole(world, "2026-08-10", 300);
    whole(world, "2026-08-03", 300);
    assert.equal(asked(world), 60);
    assert.equal(new Set(world.uber.requests.map((r) => r.tab)).size, 1);
    const gaps = world.uber.requests.slice(1).map((r, i) => r.at - world.uber.requests[i].at);
    assert.ok(Math.min(...gaps) >= 4 * SECOND, `closest two requests with random ${random}: ${Math.min(...gaps)} ms`);
    assert.ok(Math.max(...gaps) <= 8.5 * SECOND, `two requests furthest apart with random ${random}: ${Math.max(...gaps)} ms`);
    if (random) assert.ok(Math.min(...gaps) >= 7.5 * SECOND, `the gap grows with the random number: ${Math.min(...gaps)} ms`);
  }
});

test("a run handed from one tab to another keeps the four seconds between Uber requests", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.random = 0;
  const first = openTab(world);
  await until(world, () => asked(world) === 5, 5 * MINUTE, "five pages asked", 50);
  // Requests now come every 4 s exactly. The second tab's first look for a run is timed to come just after the
  // seventh, and the first tab is closed in between.
  const fifth = world.uber.requests[4].at;
  await advance(world, fifth + 150 - world.now);
  openTab(world); // looks for a run 8 s from now
  await advance(world, fifth + 8100 - world.now);
  assert.equal(asked(world), 7);
  await leave(first);
  await advance(world, MINUTE);
  const gap = world.uber.requests[7].at - world.uber.requests[6].at;
  assert.equal(world.uber.requests[7].tab, 2);
  assert.ok(gap >= 4 * SECOND, `the second tab's first request came ${gap} ms after the first tab's last`);
});

// ---------- before Uber is asked anything ----------

test("leaving the page before Uber was asked anything does not count as a run", async () => {
  const world = makeWorld({ "2026-08-10": 30 });
  world.pc.latency = 2 * SECOND;
  const first = openTab(world);
  await advance(world, 12 * SECOND); // started at 11 s (8 s, then 3 s settling the lock); the PC has not answered yet
  assert.ok(stored(world, "lastRun") > 0);
  await leave(first);
  assert.equal(stored(world, "lastRun"), 0, "the time of the last run is put back");
  assert.equal(runOpen(world), false);
  assert.equal(asked(world), 0);
  openTab(world);
  await advance(world, 2 * MINUTE);
  whole(world, "2026-08-10", 30);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${String(error && error.message ? error.message : error).split("\n").join("\n      ")}`);
  }
}
console.log(`${tests.length - failed} of ${tests.length} passed (${file})`);
process.exit(failed ? 1 : 0);

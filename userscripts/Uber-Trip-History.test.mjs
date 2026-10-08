// Tests for Uber-Trip-History.user.js: `node userscripts/Uber-Trip-History.test.mjs` (a path to another copy of the
// script may follow, to run the same checks against it).
// The script is run whole, as Tampermonkey runs it, in a made-up browser tab: a clock that moves only when a test
// moves it, a made-up Uber feed (ten rows to a page, a cursor for the next), a made-up Pulse Ops, and one Tampermonkey
// storage shared by every tab of a test. Nothing here reaches Uber or the PC.
// `--random=300` runs a random-events pass in place of the tests: that many made-up histories, each with tabs opened,
// put to sleep, left, held back, paused, Uber and the PC failing, and at the end one tab left open; then it checks
// that no week was handed over short, every week got in, and Uber was never asked twice within thirty seconds.
// `--seed=7` starts the histories there (a failure names its seed). Run it before a change to the script ships.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const args = process.argv.slice(2);
const flag = (name) => { const arg = args.find((a) => a.startsWith(`--${name}=`)); return arg ? Number(arg.slice(name.length + 3)) : null; };
const file = args.find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("./Uber-Trip-History.user.js", import.meta.url));
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
    // down: the PC answers nothing at all, as while it restarts.
    pc: { posts: [], tries: 0, pulled: new Set(), latency: 0, rule: null, down: false }
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
  if (world.pc.down) return { status: 0, text: "" };
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
  await until(world, () => asked(world) === 12, 15 * MINUTE, "twelve pages asked");
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
  await advance(world, HOUR);
  whole(world, "2026-08-10", 550);
  assert.equal(asked(world), 55);
});

test("a run goes on until every week is in, with no stop at a hundred pages, and the next comes six hours on", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  openTab(world);
  await advance(world, 3 * HOUR);
  assert.equal(asked(world), 210, "seven thirty-page weeks in the one run");
  assert.equal(askedTwice(world), 0);
  for (const start of SEVEN) whole(world, start, 300);
  assert.equal(none(stored(world, "weekPlace")), null);
  assert.equal(runOpen(world), false);
  const gaps = world.uber.requests.slice(1).map((r, i) => r.at - world.uber.requests[i].at);
  assert.ok(Math.min(...gaps) >= 30 * SECOND, `closest two requests: ${Math.min(...gaps)} ms`);
  // A pay week ends meanwhile. Nothing reads it until six hours after the run ended.
  world.uber.rows.set("2026-08-17", rowsOf("2026-08-17", 30));
  const ended = stored(world, "lastRun");
  await advance(world, ended + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 210, "nothing more for six hours");
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-17", 30);
  assert.equal(asked(world), 213, "then the tab left open reads the new week by itself");
});

test("a week that runs past the page stop is not handed over, and Uber is not asked for it again", async () => {
  const world = makeWorld({ "2026-08-10": 1050 });
  const tab = openTab(world);
  await advance(world, 2 * HOUR);
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
  await advance(world, 25 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
  assert.equal(askedTwice(world), 0);
  assert.equal(runOpen(world), false);
});

test("a run cut by leaving the page mid-week is carried on by the next page", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const first = openTab(world);
  await until(world, () => asked(world) === 12, 15 * MINUTE, "twelve pages asked");
  await leave(first);
  openTab(world);
  await advance(world, 20 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
  assert.equal(askedTwice(world), 0);
});

test("a page back from the back/forward cache carries its run on", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  await until(world, () => asked(world) === 12, 15 * MINUTE, "twelve pages asked");
  for (const fn of tab.heard.window.pagehide) fn({ persisted: true });
  await settle();
  stall(world, tab, true); // a page in the cache runs nothing
  await advance(world, 10 * MINUTE);
  assert.equal(asked(world), 12);
  stall(world, tab, false);
  for (const fn of tab.heard.window.pageshow) fn({ persisted: true });
  await advance(world, 20 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
});

test("a run cut with a page out and no answer seen is not carried on: it waits six hours, as Uber may have said no", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  const first = openTab(world);
  await until(world, () => asked(world) === 12, 15 * MINUTE, "the twelfth page asked", 100);
  await leave(first); // its answer never reaches the page
  const last = world.uber.requests[11].at;
  assert.equal(stored(world, "weekPlace").pages, 11);
  openTab(world);
  await advance(world, last + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 12, "short visits cannot have the same page asked over and over");
  await advance(world, 25 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 31);
  assert.equal(askedTwice(world), 1, "the page whose answer was never seen is asked once more, six hours on");
});

test("the six hours count from the last page asked, also when its answer was never seen", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  const tab = openTab(world);
  await until(world, () => stored(world, "weekPlace")?.pages === 12, 15 * MINUTE, "twelve pages answered", 100);
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
  await until(world, () => stored(world, "weekPlace")?.pages === 12, 20 * MINUTE, "twelve pages answered", 100);
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

test("a run started from the menu right after a request that got no answer still leaves thirty seconds after it", async () => {
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
  assert.ok(gap >= 30 * SECOND, `the new run's first request came ${gap} ms after the one that failed`);
});

test("a run started from the menu right after a page was cut off still leaves thirty seconds after it", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  world.random = 0;
  const first = openTab(world);
  await until(world, () => asked(world) === 12, 15 * MINUTE, "the twelfth page asked", 50);
  await leave(first);
  openTab(world).commands["Pull Uber trips now"]();
  await advance(world, MINUTE);
  const gap = world.uber.requests[12].at - world.uber.requests[11].at;
  assert.ok(gap >= 30 * SECOND, `the new run's first request came ${gap} ms after the one cut off`);
});

test("a run that is cut again and again is carried on each time, and reads every week", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  let tab = openTab(world);
  for (const pages of [17, 45, 71, 99]) {
    await until(world, () => asked(world) === pages, HOUR, `${pages} pages asked`);
    sleep(tab);
    await advance(world, 4 * MINUTE);
    tab = openTab(world);
  }
  await advance(world, 2 * HOUR);
  assert.equal(asked(world), 210, "cut four times, the one run still reads all seven weeks");
  assert.equal(askedTwice(world), 0);
  for (const start of SEVEN) whole(world, start, 300);
  assert.equal(runOpen(world), false);
});

test("a cut run nobody came back to for six hours is picked up at its place by the next tab", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  const first = openTab(world);
  await until(world, () => asked(world) === 45, HOUR, "45 pages asked");
  sleep(first);
  await advance(world, 7 * HOUR);
  assert.equal(asked(world), 45, "with no tab open, nothing runs");
  openTab(world);
  await advance(world, 3 * HOUR);
  assert.equal(asked(world), 210);
  assert.equal(askedTwice(world), 0);
});

test("\"Pull Uber trips now\" after a cut run picks its week up at its place", async () => {
  const world = makeWorld(weeksOf(SEVEN, 300));
  const first = openTab(world);
  await until(world, () => asked(world) === 45, HOUR, "45 pages asked");
  sleep(first);
  await advance(world, 4 * MINUTE);
  openTab(world).commands["Pull Uber trips now"]();
  await advance(world, 3 * HOUR);
  assert.equal(asked(world), 210);
  assert.equal(askedTwice(world), 0);
});

test("\"Pull Uber trips now\" starts a run though the last one ended less than six hours ago", async () => {
  const world = makeWorld({ "2026-08-10": 30 });
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 30);
  world.uber.rows.set("2026-08-17", rowsOf("2026-08-17", 30)); // a pay week ends
  await advance(world, 2 * HOUR);
  assert.equal(asked(world), 3, "by itself, nothing for six hours");
  tab.commands["Pull Uber trips now"]();
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-17", 30);
  assert.equal(asked(world), 6);
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
    await advance(world, 30 * MINUTE);
    whole(world, "2026-08-10", 300);
    assert.equal(asked(world), 12 + 1 + 30);
  });
}

test("a carry-on that meets a true empty last page reads the week again, and hands it over whole", async () => {
  const world = makeWorld({ "2026-08-10": 20 });
  world.uber.trailing = true; // 10 rows, 10 rows, and a third page with nothing on it
  const first = openTab(world);
  await until(world, () => asked(world) === 2, 3 * MINUTE, "two pages asked");
  sleep(first);
  await advance(world, 4 * MINUTE);
  openTab(world);
  await advance(world, 5 * MINUTE);
  whole(world, "2026-08-10", 20);
  assert.equal(asked(world), 2 + 1 + 3);
});

test("a week that ends untrusted a second time in one run is left for the next run, which reads it first", async () => {
  const world = makeWorld({ "2026-08-10": 20 });
  world.uber.trailing = true; // 10 rows, 10 rows, and a third page with nothing on it
  const first = openTab(world);
  await until(world, () => asked(world) === 2, 3 * MINUTE, "two pages asked");
  sleep(first);
  await advance(world, 4 * MINUTE);
  const tab = openTab(world);
  // Carried on: the empty third page from the kept cursor, then the week again from its first page.
  await until(world, () => asked(world) === 5, 5 * MINUTE, "the week's first two pages read again");
  stall(world, tab, true); // held back past the three minutes a cursor is trusted for
  await advance(world, 4 * MINUTE);
  stall(world, tab, false);
  await advance(world, 5 * SECOND);
  assert.equal(asked(world), 6, "the empty last page, from a cursor that waited");
  assert.match(tab.status(), /0 weeks in this time; 1 more week comes next time/);
  assert.equal(world.pc.posts.length, 0);
  assert.equal(runOpen(world), false);
  assert.equal(stored(world, "weekPlace").least, 20);
  const ended = stored(world, "lastRun");
  await advance(world, ended + 6 * HOUR - MINUTE - world.now);
  assert.equal(asked(world), 6, "the week is not read a third time for six hours");
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 20);
  assert.equal(asked(world), 6 + 3);
});

test("a cursor that waited through a twenty-minute pause is not trusted to end the week either", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  await until(world, () => asked(world) === 12, 15 * MINUTE, "twelve pages asked");
  tab.click(); // paused
  await advance(world, 20 * MINUTE);
  world.uber.epoch += 1;
  world.uber.soft = "empty";
  tab.click(); // carried on: the cursor in hand is answered with an empty last page
  await advance(world, 30 * MINUTE);
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
  await advance(world, 30 * MINUTE);
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
  await advance(world, 30 * MINUTE);
  whole(world, "2026-08-10", 300);
});

test("a week of a hundred requests, the last with nothing on it, gets in", async () => {
  // A one-page week, then a week of 99 full pages that ends on a hundredth with nothing on it, then a three-page one.
  const world = makeWorld({ "2026-08-17": 5, "2026-08-10": 990, "2026-08-03": 25 });
  world.uber.trailing = true;
  openTab(world);
  await advance(world, 2 * HOUR);
  whole(world, "2026-08-17", 5);
  whole(world, "2026-08-10", 990);
  whole(world, "2026-08-03", 25);
  assert.equal(asked(world), 1 + 100 + 3, "all in the one run, each page asked once");
});

test("a hand-over the PC turns down is tried again next run without asking Uber anything", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.pc.rule = (tries) => (tries === 1 ? { status: 500, text: JSON.stringify({ ok: false, error: "Could not keep the trips." }) } : null);
  const tab = openTab(world);
  await advance(world, 30 * MINUTE);
  assert.equal(asked(world), 30);
  assert.equal(world.pc.posts.length, 0);
  assert.match(tab.status(), /the PC answered HTTP 500/);
  assert.equal(world.pc.tries, 1, "an answer that says no is not sent again in that run");
  assert.equal(stored(world, "weekPlace").whole, true, "the week read to its end is kept whole");
  await advance(world, 6.5 * HOUR);
  whole(world, "2026-08-10", 300);
  assert.equal(world.pc.tries, 2);
  assert.equal(asked(world), 30, "Uber is asked nothing for a week already read");
  assert.equal(none(stored(world, "weekPlace")), null);
});

test("a PC that does not answer for a moment, restarting at a deploy, does not end the run", async () => {
  const world = makeWorld({ "2026-08-03": 30, "2026-08-10": 30 });
  world.pc.rule = (tries) => (tries <= 2 ? { status: 0, text: "" } : null);
  const tab = openTab(world);
  await until(world, () => world.pc.tries === 1, 5 * MINUTE, "the first week's hand-over tried");
  assert.match(tab.status(), /can't reach the PC \(localhost:3000\), trying again/);
  await advance(world, 10 * MINUTE);
  whole(world, "2026-08-10", 30);
  whole(world, "2026-08-03", 30);
  assert.equal(world.pc.tries, 4, "the first week's hand-over went three times, the second's once");
  assert.equal(asked(world), 6, "and Uber was asked for no page twice");
  assert.equal(runOpen(world), false);
});

test("a PC that stays out of reach ends the run, and the week read is handed over next run without asking Uber", async () => {
  const world = makeWorld({ "2026-08-10": 30 });
  let down = true;
  world.pc.rule = () => (down ? { status: 0, text: "" } : null);
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  assert.equal(world.pc.tries, 6, "sent once, then five times more, half a minute apart");
  assert.match(tab.status(), /can't reach the PC \(localhost:3000\)\. Stopped at the week of Aug 10\./);
  assert.equal(stored(world, "weekPlace").whole, true);
  assert.equal(runOpen(world), false);
  down = false;
  await advance(world, 6.5 * HOUR);
  whole(world, "2026-08-10", 30);
  assert.equal(asked(world), 3);
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
  await advance(world, 30 * MINUTE);
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
  await advance(world, 25 * MINUTE);
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
  await advance(world, 20 * MINUTE);
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
  await advance(world, 20 * MINUTE);
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
  await advance(world, 25 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 8 + 23);
});

test("an error partway through a carried-on week keeps the place", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  await cutAtTwelve(world);
  await advance(world, 4 * MINUTE);
  world.uber.rule = (request, count) => (count === 20 ? { status: 500, text: "{}" } : null);
  const tab = openTab(world);
  await advance(world, 10 * MINUTE);
  assert.equal(asked(world), 20);
  assert.match(tab.status(), /Uber answered HTTP 500/);
  assert.equal(stored(world, "weekPlace").pages, 19);
  await advance(world, 6.5 * HOUR);
  visit(tab);
  await advance(world, 15 * MINUTE);
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
  await advance(world, 30 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 13 + 30);
});

// ---------- Stop, and a pause ----------

test("Stop in the tab that is pulling ends the run, and no other tab carries it on", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(world);
  openTab(world);
  await until(world, () => asked(world) === 12, 15 * MINUTE, "twelve pages asked");
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
  await until(awake, () => asked(awake) === 12, 15 * MINUTE, "twelve pages asked");
  assert.equal(awake.uber.requests[0].tab, puller.id);
  other.commands.Stop();
  await advance(awake, 30 * MINUTE);
  assert.equal(asked(awake), 12);
  assert.match(puller.status() || "Pulse: stopped.", /stopped/);

  // Held back by Chrome for longer than its lock stays fresh, then let go.
  const held = makeWorld({ "2026-08-10": 300 });
  const tab = openTab(held);
  await until(held, () => asked(held) === 12, 15 * MINUTE, "twelve pages asked");
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
  await until(world, () => asked(world) === 12, 15 * MINUTE, "twelve pages asked");
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
  await until(world, () => asked(world) === 12, 15 * MINUTE, "twelve pages asked");
  stall(world, first, true);
  await advance(world, 4 * MINUTE); // past the three minutes its lock stays fresh
  const second = openTab(world);
  await until(world, () => asked(world) === 20, 10 * MINUTE, "the second tab carried the run on");
  stall(world, first, false);
  await advance(world, SECOND);
  assert.match(first.status(), /another driver-site tab took over/);
  sleep(second);
  assert.equal(stored(world, "openRun").pages, 20, "the run the first tab lost is still open");
  await advance(world, 4 * MINUTE);
  openTab(world);
  await advance(world, 12 * MINUTE);
  whole(world, "2026-08-10", 300);
  assert.equal(asked(world), 30);
});

test("a tab held back with an answer on its way does not write its old place over the new tab's", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  const first = openTab(world);
  await until(world, () => asked(world) === 13, 15 * MINUTE, "the thirteenth page asked", 100);
  stall(world, first, true); // with that page's answer still on its way
  await advance(world, 4 * MINUTE);
  // A run with a page out and no answer is not carried on, so the second tab takes it over from the menu.
  openTab(world).commands["Pull Uber trips now"]();
  await until(world, () => stored(world, "weekPlace").pages === 19, 10 * MINUTE, "the second tab is seven pages on");
  stall(world, first, false);
  await advance(world, 500);
  assert.match(first.status(), /another driver-site tab took over/);
  assert.equal(stored(world, "weekPlace").pages, 19, "the place is still the second tab's");
  await advance(world, 12 * MINUTE);
  whole(world, "2026-08-10", 300);
});

test("Uber's stop, learned by a tab that had lost the run while the next was still settling its lock, ends the run for all", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.uber.latency = 2 * SECOND;
  world.uber.rule = (request, count) => (count === 13 ? { status: 429, text: "slow down" } : null);
  const first = openTab(world);
  await until(world, () => asked(world) === 13, 15 * MINUTE, "the thirteenth page asked", 100);
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
  await until(world, () => asked(world) === 13, 15 * MINUTE, "the thirteenth page asked", 100);
  stall(world, first, true); // Uber's check is on its way to a tab Chrome is holding back
  await advance(world, 4 * MINUTE);
  const second = openTab(world);
  second.commands["Pull Uber trips now"]();
  await until(world, () => asked(world) === 20, 10 * MINUTE, "the second tab asks on");
  stall(world, first, false);
  await advance(world, SECOND);
  assert.match(first.status(), /Uber's check stopped it/);
  const then = asked(world);
  await advance(world, 30 * MINUTE);
  assert.ok(asked(world) - then <= 1, "at most the page already on its way");
  assert.match(second.status(), /Uber stopped this run in another driver-site tab/);
  assert.equal(runOpen(world), false);
});

test("two tabs open at once: one pulls, and its Uber requests are thirty to sixty seconds apart", async () => {
  // Math.random at its least and at its most: the shortest and the longest gap the script leaves.
  for (const random of [0, 0.999]) {
    const world = makeWorld({ "2026-08-03": 300, "2026-08-10": 300 });
    world.random = random;
    openTab(world);
    openTab(world);
    await advance(world, 75 * MINUTE);
    whole(world, "2026-08-10", 300);
    whole(world, "2026-08-03", 300);
    assert.equal(asked(world), 60);
    assert.equal(new Set(world.uber.requests.map((r) => r.tab)).size, 1);
    const gaps = world.uber.requests.slice(1).map((r, i) => r.at - world.uber.requests[i].at);
    assert.ok(Math.min(...gaps) >= 30 * SECOND, `closest two requests with random ${random}: ${Math.min(...gaps)} ms`);
    assert.ok(Math.max(...gaps) <= 60.5 * SECOND, `two requests furthest apart with random ${random}: ${Math.max(...gaps)} ms`);
    if (random) assert.ok(Math.min(...gaps) >= 59.5 * SECOND, `the gap grows with the random number: ${Math.min(...gaps)} ms`);
  }
});

test("a run handed from one tab to another keeps the thirty seconds between Uber requests", async () => {
  const world = makeWorld({ "2026-08-10": 300 });
  world.random = 0;
  const first = openTab(world);
  await until(world, () => asked(world) === 5, 5 * MINUTE, "five pages asked", 50);
  // Requests now come every 30 s exactly. The second tab's first look for a run is timed to come just after the
  // sixth, and the first tab is closed in between.
  const fifth = world.uber.requests[4].at;
  await advance(world, fifth + 22150 - world.now);
  openTab(world); // looks for a run 8 s from now
  await advance(world, fifth + 30100 - world.now);
  assert.equal(asked(world), 6);
  await leave(first);
  await advance(world, 2 * MINUTE);
  const gap = world.uber.requests[6].at - world.uber.requests[5].at;
  assert.equal(world.uber.requests[6].tab, 2);
  assert.ok(gap >= 30 * SECOND, `the second tab's first request came ${gap} ms after the first tab's last`);
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

// ---------- a random-events pass ----------

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One made-up history. What it must hold to, whatever happens in it:
// no week is handed over with fewer rows than Uber has for it, or twice; no two Uber requests are less than thirty
// seconds apart, whichever tabs they came from; once Uber has stopped a run nothing is asked for six hours, unless he
// pulls from the menu; and with one tab left open and looked at now and then, every week gets in.
async function randomRun(seed) {
  const rand = seeded(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (low, high) => low + rand() * (high - low);
  const starts = SEVEN.slice(0, 2 + Math.floor(rand() * 5));
  const weeks = Object.fromEntries(starts.map((start) => [start, rand() < 0.15 ? 0 : Math.floor(rand() * 350)]));
  const world = makeWorld(weeks);
  world.uber.trailing = rand() < 0.5;
  world.uber.latency = pick([0, 0, 150, 2 * SECOND, 15 * SECOND]);
  world.pc.latency = pick([0, 0, 300]);
  const began = world.now;
  const log = [];
  const say = (what) => log.push(`${Math.round((world.now - began) / SECOND)}s ${what}`);

  // When a stop by Uber was put on record, and when he pulled from the menu.
  const refusals = [];
  const forced = [];
  const set = world.store.set.bind(world.store);
  world.store.set = (key, value) => {
    const at = key === "uberRefused" ? Number((JSON.parse(value) || {}).at) : 0;
    if (at > 0) refusals.push(at);
    return set(key, value);
  };

  // Up to two of Uber's requests are answered with a stop of some kind, and one of the PC's hand-overs with an error.
  const pages = Object.values(weeks).reduce((sum, rows) => sum + Math.ceil(rows / PAGE) + 1, 0);
  const stops = new Map();
  for (let left = Math.floor(rand() * 3); left > 0; left -= 1) {
    stops.set(1 + Math.floor(rand() * pages), pick([
      { status: 403, text: "<html>challenge</html>" }, { status: 429, text: "slow down" }, { status: 500, text: "{}" },
      { status: 200, text: "<html>Sign in</html>" }, { fail: true }
    ]));
  }
  world.uber.rule = (request, count) => stops.get(count) ?? null;
  const failAt = rand() < 0.3 ? 1 + Math.floor(rand() * starts.length) : 0;
  world.pc.rule = (tries) => (tries === failAt ? { status: 500, text: JSON.stringify({ ok: false, error: "Could not keep the trips." }) } : null);

  const tabs = [openTab(world)];
  const alive = () => tabs.filter((tab) => !tab.dead);
  const awake = () => alive().filter((tab) => !tab.stalled);
  const held = [];
  let pcUpAt = 0;
  // Time passes, with a tab Chrome held back let go, and the PC back up, when their time comes.
  const pass = async (ms) => {
    const end = world.now + ms;
    while (world.now < end) {
      const next = Math.min(end, pcUpAt > world.now ? pcUpAt : end, ...held.filter((h) => h.until > world.now).map((h) => h.until));
      await advance(world, next - world.now);
      for (const h of held.splice(0)) {
        if (h.until > world.now) held.push(h);
        else if (!h.tab.dead) stall(world, h.tab, false);
      }
      if (pcUpAt && pcUpAt <= world.now) { world.pc.down = false; pcUpAt = 0; }
    }
  };
  const events = [
    [3, "a tab is opened", () => { tabs.push(openTab(world)); }],
    [3, "a tab is put to sleep", () => { const tab = pick(alive()); if (tab) sleep(tab); }],
    [2, "a page is left", async () => { const tab = pick(awake()); if (tab) await leave(tab); }],
    [3, "a tab is held back", () => { const tab = pick(awake()); if (tab) { stall(world, tab, true); held.push({ tab, until: world.now + between(20 * SECOND, 10 * MINUTE) }); } }],
    [2, "the status line is clicked", () => { const tab = pick(awake().filter((t) => t.line && t.line.isConnected)); if (tab) tab.click(); }],
    [2, "a tab is looked at", () => { const tab = pick(awake()); if (tab) visit(tab); }],
    [2, "the PC goes down", () => { world.pc.down = true; pcUpAt = world.now + between(5 * SECOND, 4 * MINUTE); }],
    [0.5, "Stop from the menu", () => { const tab = pick(awake()); if (tab) tab.commands.Stop(); }],
    [1, "Pull Uber trips now", () => { const tab = pick(awake()); if (tab) { forced.push(world.now); tab.commands["Pull Uber trips now"](); } }],
    // Every cursor Uber gave out is an old one now. Only with every tab gone for four minutes: a cursor still fresh
    // that Uber answers with nothing is taken on Uber's word, which is the script's stated limit and not looked for here.
    [0.7, "Uber's cursors go stale", async () => { for (const tab of alive()) sleep(tab); await pass(4 * MINUTE); world.uber.epoch += 1; world.uber.soft = pick([null, "empty", "first", "nodata"]); }]
  ];
  const weight = events.reduce((sum, [w]) => sum + w, 0);
  for (let left = 5 + Math.floor(rand() * 20); left > 0; left -= 1) {
    const kind = rand();
    await pass(kind < 0.7 ? between(5 * SECOND, 10 * MINUTE) : kind < 0.95 ? between(10 * MINUTE, HOUR) : between(HOUR, 7 * HOUR));
    world.random = rand();
    let at = rand() * weight;
    const event = events.find(([w]) => (at -= w) < 0) ?? events[0];
    say(event[1]);
    await event[2]();
  }

  // Then every tab is gone but a new one, the PC and Uber answer plainly, and he looks at the tab now and then.
  for (const tab of alive()) sleep(tab);
  held.length = 0;
  world.pc.down = false;
  world.pc.rule = null;
  world.uber.rule = null;
  const last = openTab(world);
  say("one tab left open");
  for (let look = 0; look < 12 && world.pc.pulled.size < starts.length; look += 1) {
    await advance(world, 6.5 * HOUR);
    visit(last);
  }
  await advance(world, 6.5 * HOUR);

  const wrong = [];
  for (const sent of world.pc.posts) {
    if (sent.rows !== weeks[sent.start] || new Set(sent.ids).size !== sent.rows) wrong.push(`the week of ${sent.start} was handed over with ${sent.rows} of its ${weeks[sent.start]} rows`);
  }
  for (const start of starts) {
    const times = post(world, start).length;
    if (times !== 1) wrong.push(`the week of ${start} was handed over ${times} times`);
  }
  const requests = world.uber.requests;
  for (let i = 1; i < requests.length; i += 1) {
    const gap = requests[i].at - requests[i - 1].at;
    if (gap < 30 * SECOND) wrong.push(`requests ${i} and ${i + 1} were ${gap} ms apart (tabs ${requests[i - 1].tab} and ${requests[i].tab})`);
  }
  for (const stop of refusals) {
    const early = requests.find((r) => r.at > stop && r.at < stop + 6 * HOUR && !forced.some((at) => at >= stop && at <= r.at));
    if (early) wrong.push(`Uber was asked ${Math.round((early.at - stop) / MINUTE)} min after it stopped a run, with no pull from the menu`);
  }
  if (requests.length > 10 * pages + 50) wrong.push(`${requests.length} requests for ${pages} pages`);
  return { wrong, log, requests: requests.length, pages, stops: refusals.length };
}

const runs = flag("random");
if (runs) {
  const first = flag("seed") ?? 1;
  let bad = 0; let requests = 0; let stopped = 0;
  for (let seed = first; seed < first + runs; seed += 1) {
    const result = await randomRun(seed);
    requests += result.requests;
    stopped += result.stops;
    if (!result.wrong.length) continue;
    bad += 1;
    console.log(`FAIL  seed ${seed}\n      ${[...new Set(result.wrong)].slice(0, 6).join("\n      ")}\n      what happened: ${result.log.join("; ")}`);
  }
  console.log(`${runs - bad} of ${runs} random histories held (seeds ${first} to ${first + runs - 1}; ${requests} Uber requests, ${stopped} stops by Uber) (${file})`);
  process.exit(bad ? 1 : 0);
}

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

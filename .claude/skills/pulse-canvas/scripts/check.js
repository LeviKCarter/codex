// node check.js <canvas>/project
// Evaluates every artboard's logic class the way the canvas runtime would, reports template holes with no value,
// then walks both prototypes through a scripted run. Expected ends are in the comments below.
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
class DCLogic { setState(x) { this.state = { ...this.state, ...x }; } }
global.DCLogic = DCLogic;
let failed = false;
const load = (file) => {
  const s = fs.readFileSync(path.join(dir, file), 'utf8');
  const script = s.match(/data-dc-script[^>]*>([\s\S]*?)<\/script>/)[1];
  const Component = eval('(' + script.trim() + ')');
  const c = new Component();
  c.props = {};
  const vals = c.renderVals();
  JSON.parse(s.match(/data-props='([^']*)'/)[1]);
  const missing = [...new Set([...s.matchAll(/\{\{ ?([\w.]+) ?\}\}/g)].map((m) => m[1]))].filter((h) => !(h in vals) && h !== 'true' && h !== 'false');
  if (missing.length) { failed = true; console.log(file, 'MISSING', missing); }
  for (const name of [...s.matchAll(/<dc-import name="([^"]+)"/g)].map((m) => m[1])) {
    if (!fs.existsSync(path.join(dir, name + '.dc.html'))) console.log(file, 'imports', name, '(not built this run; must already be on the canvas)');
  }
  return c;
};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.dc.html'))) load(f);
const now = (c) => { const r = c.renderVals(); return Object.keys(r).filter((k) => k.startsWith('is_') && r[k]).join().replace('is_', ''); };
const walk = (c, steps) => steps.map((s) => {
  const v = c.renderVals();
  if (s[0] === 'wheel') v.onWheel({ deltaY: s[1] }); else if (s[0] === 'key') v.onKey({ key: s[1], preventDefault() {} }); else v.nav(s[1], s[2]);
  return s.slice(1).join(' ') + '>' + now(c);
}).join(' | ');
const expect = (name, got, want) => { if (got !== want) { failed = true; console.log(name, 'ENDED AT', got, 'expected', want); } };

const desktop = load('Main.dc.html');
// wallpaper -> scrolled feed -> a lane from its cards -> back; F to lanes; rail to a lane and back to the dashboard; to-do; classic.
console.log('desktop:', now(desktop), walk(desktop, [['wheel', 40], ['nav', 'open', 'events'], ['nav', 'close', 'events'], ['wheel', 40], ['wheel', -40],
  ['key', 'f'], ['nav', 'open', 'work'], ['nav', 'close', 'work'], ['nav', 'wall', 'wall'], ['key', 'b'], ['key', 'b'], ['key', 'm'], ['nav', 'open', 'deals'], ['key', 'm'], ['key', 'Escape']]));
expect('desktop', now(desktop), 'lanes');
const phone = load('Phone.dc.html');
console.log('phone:', now(phone), walk(phone, [['nav', 'open', 'work'], ['nav', 'close', 'work'], ['nav', 'open', 'music'], ['nav', 'close', 'music']]));
expect('phone', now(phone), 'wall');
process.exit(failed ? 1 : 0);

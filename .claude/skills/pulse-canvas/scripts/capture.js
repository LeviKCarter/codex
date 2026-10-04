// The capture functions for /pulse-canvas. capture_server.py serves this file; the page loads and runs one section:
//   desktopVibe()   desktopClassic()   (1440x900)      phone()   (390x844)
// Each posts the rendered body of every view back to the server and returns one row per view.
const post = (name, body) => fetch('http://127.0.0.1:4174/save?name=' + name, { method: 'POST', body }).then((r) => r.ok);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const D = () => document.documentElement.dataset;
const vibe = () => D().vibe || 'classic';
const vis = () => [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
const byLabel = (label) => vis().find((b) => b.getAttribute('aria-label') === label);
const labels = (re) => [...new Set(vis().map((b) => b.getAttribute('aria-label') || '').filter((l) => re.test(l)))];
const key = (k) => { for (const t of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(t, { key: k, bubbles: true, cancelable: true })); };
const wheel = (dy) => (document.querySelector('.vibe-root') || document.body).dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
const until = async (test, tries = 8) => { for (let i = 0; i < tries && !test(); i++) await wait(500); return test(); };

// The page as it stands: scripts, styles, players and video out; the <html> attributes kept for the build.
const cap = async (name) => {
  window.scrollTo(0, 0);
  await wait(150);
  const c = document.body.cloneNode(true);
  c.querySelectorAll('script,noscript,link,style').forEach((e) => e.remove());
  c.querySelectorAll('iframe,video').forEach((e) => { const d = document.createElement('div'); d.className = e.className; d.setAttribute('data-was', e.tagName.toLowerCase()); e.replaceWith(d); });
  const meta = { html: [...document.documentElement.attributes].map((a) => [a.name, a.value]), w: innerWidth, h: document.documentElement.scrollHeight };
  const ok = await post(name + '.html', '<!--META ' + JSON.stringify(meta) + ' -->\n' + c.innerHTML);
  return { view: name, ok, vibe: vibe(), solo: D().solo || '', h: meta.h };
};
const css = async () => {
  const text = await (await fetch(document.querySelector('link[rel=stylesheet]').href)).text();
  return { view: 'app.css', ok: await post('app.css', text), bytes: text.length };
};
const toWall = async () => { if (vibe() === 'classic') { key('m'); await wait(1500); } if (vibe() !== 'wall') { key('f'); await until(() => vibe() === 'wall'); await wait(800); } };

async function desktopVibe() {
  const out = [await css(), { start: vibe(), width: innerWidth, dialogs: [...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute('aria-label')) }];
  await toWall();
  out.push(await cap('wall'));
  wheel(40); await wait(1500);
  out.push({ ...(await cap('wall-feed')), deckOpen: !!document.querySelector('.vibe-deck.is-open') });
  wheel(-40); await wait(1000);
  // Q W E R open one lane each from the wallpaper. Most open as a single pane over it (data-solo); a lane may instead
  // open on the lanes page, expanded. Which lane a key opens depends on the monitor flip, so name files by what opened.
  const keys = {};
  for (const k of ['q', 'w', 'e', 'r']) {
    key(k); await until(() => !!D().solo || vibe() === 'lanes'); await wait(1200);
    const wide = labels(/^Collapse the .* lane$/).map((l) => l.replace(/^Collapse the | lane$/g, '').toLowerCase());
    const name = D().solo ? 'solo-' + D().solo : 'lanes-' + (wide[0] || 'MISSING-' + k);
    keys[k] = name;
    out.push({ ...(await cap(name)), key: k, wide });
    key('Escape'); await wait(600);
    await toWall();
  }
  out.push({ view: 'keys.json', ok: await post('keys.json', JSON.stringify(keys)), keys });
  key('f'); await until(() => vibe() === 'lanes'); await wait(900);
  out.push(await cap('lanes'));
  window.dispatchEvent(new Event('leviops:vibe-tasks')); await wait(1500);
  out.push(await cap('tasks'));
  window.dispatchEvent(new Event('leviops:vibe-tasks')); await wait(800);
  await toWall();
  return out;
}

async function desktopClassic() {
  const out = [{ start: vibe() }];
  if (vibe() !== 'classic') { if (vibe() === 'wall') { key('f'); await wait(1200); } key('m'); await until(() => vibe() === 'classic'); await wait(1200); }
  const pulse = byLabel('Expand the Pulse lane'); if (pulse) { pulse.click(); await wait(1000); }
  out.push(await cap('classic'));
  const lanes = labels(/^Expand the .* lane$/).map((l) => l.replace(/^Expand the | lane$/g, ''));
  for (const lane of lanes) {
    key('Escape'); await wait(400);
    const b = byLabel('Expand the ' + lane + ' lane');
    if (!b) { out.push({ view: 'classic-' + lane.toLowerCase(), MISSING: labels(/^(Expand|Collapse) the/) }); continue; }
    b.click(); await until(() => !!byLabel('Collapse the ' + lane + ' lane')); await wait(1000);
    out.push({ ...(await cap('classic-' + lane.toLowerCase())), open: labels(/^Collapse the/) });
  }
  key('Escape'); await wait(400);
  const back = byLabel('Expand the Pulse lane'); if (back) { back.click(); await wait(800); }
  key('m'); await wait(1500);
  await toWall();
  out.push({ end: vibe() });
  return out;
}

async function phone() {
  const out = [{ start: vibe(), width: innerWidth }, await css()];
  out.push(await cap('phone-wall'));
  const lanes = labels(/^Open the .* lane$/).map((l) => l.replace(/^Open the | lane$/g, ''));
  for (const lane of lanes) {
    const b = byLabel('Open the ' + lane + ' lane');
    if (!b) { out.push({ view: 'phone-' + lane.toLowerCase(), MISSING: labels(/lane$/) }); continue; }
    b.click(); await until(() => vibe() === 'lanes'); await wait(1200);
    out.push(await cap('phone-' + lane.toLowerCase()));
    const hide = byLabel('Hide the ' + lane + ' lane') || byLabel('Close ' + lane);
    if (hide) hide.click();
    await until(() => vibe() === 'wall'); await wait(500);
  }
  // The Music view opens on a hold of the music bar.
  const bar = vis().find((b) => (b.getAttribute('aria-label') || '').startsWith('Music options'));
  if (!bar) out.push({ view: 'phone-music', MISSING: 'music bar' });
  else {
    const r = bar.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true };
    bar.dispatchEvent(new PointerEvent('pointerdown', o)); await wait(1100); bar.dispatchEvent(new PointerEvent('pointerup', o));
    if (await until(() => !!byLabel('Close the Music view'), 4)) { out.push(await cap('phone-music')); byLabel('Close the Music view').click(); await wait(800); }
    else out.push({ view: 'phone-music', MISSING: 'the hold did not open the Music view' });
  }
  return out;
}

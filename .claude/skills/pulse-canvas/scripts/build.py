"""Turns /pulse-canvas captures into Design-canvas artboards and the two playable prototypes.

    python build.py --captures <dir> --out <dir> --index <canvas.json read from the canvas> [--skip A.dc.html,…] [--remove B.dc.html,…]

Writes <out>/project/*.dc.html, the two stylesheets and canvas.json, then prints the `files` map for the publish.
Existing artboards keep their position and title; --skip leaves hand-edited artboards untouched; --remove drops the
artboard of a view the app no longer has (nothing is removed unless named there).
"""
import argparse
import json
import os
import re

ap = argparse.ArgumentParser()
ap.add_argument('--captures', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--index', required=True)
ap.add_argument('--skip', default='')
ap.add_argument('--remove', default='')
args = ap.parse_args()
CAP = args.captures
P = os.path.join(args.out, 'project')
os.makedirs(P, exist_ok=True)
SKIP = {s for s in args.skip.split(',') if s}
REMOVE = [s for s in args.remove.split(',') if s]

# capture name -> (artboard file, title, row, default x). Rows: 0 vibe desktop, 1 classic desktop, 2 phone.
# Solo captures are named by the app's data-solo ids (food = Deals, jobs = Work).
BOARDS = [
    ('lanes', 'Vibe-Lanes.dc.html', 'Vibe · Glass lanes', 0, 0),
    ('tasks', 'Vibe-Tasks.dc.html', 'Vibe · To-do list open', 0, 1520),
    ('wall', 'Vibe-Wall.dc.html', 'Vibe · Wallpaper dashboard', 0, 3040),
    ('solo-pulse', 'Vibe-Solo-Pulse.dc.html', 'Vibe · Pulse pane', 0, 4560),
    ('solo-events', 'Vibe-Solo-Events.dc.html', 'Vibe · Events pane', 0, 6080),
    ('solo-food', 'Vibe-Solo-Deals.dc.html', 'Vibe · Deals pane', 0, 7600),
    ('solo-jobs', 'Vibe-Solo-Work.dc.html', 'Vibe · Work pane', 0, 9120),
    ('wall-feed', 'Vibe-Wall-Feed.dc.html', 'Vibe · Wallpaper, scrolled down (lane cards)', 0, 12160),
    ('lanes-events', 'Vibe-Lanes-Events.dc.html', 'Vibe · Events beside Pulse', 0, 13680),
    ('classic', 'Classic.dc.html', 'Classic · Pulse open', 1, 0),
    ('classic-events', 'Classic-Events.dc.html', 'Classic · Events open', 1, 1520),
    ('classic-work', 'Classic-Work.dc.html', 'Classic · Work open', 1, 3040),
    ('classic-deals', 'Classic-Deals.dc.html', 'Classic · Deals open', 1, 4560),
    ('phone-wall', 'Phone-Wall.dc.html', 'Phone · Wallpaper', 2, 0),
    ('phone-pulse', 'Phone-Pulse.dc.html', 'Phone · Pulse', 2, 470),
    ('phone-events', 'Phone-Events.dc.html', 'Phone · Events', 2, 940),
    ('phone-work', 'Phone-Work.dc.html', 'Phone · Work', 2, 1410),
    ('phone-deals', 'Phone-Deals.dc.html', 'Phone · Deals', 2, 1880),
    ('phone-music', 'Phone-Music.dc.html', 'Phone · Music view', 2, 2350),
]
ROW_Y = [0, 4500, 9500]
# Prototype views: (state name, artboard). The first is where the prototype starts.
DESKTOP_VIEWS = [('wall', 'Vibe-Wall'), ('wall-feed', 'Vibe-Wall-Feed'), ('lanes', 'Vibe-Lanes'), ('tasks', 'Vibe-Tasks'),
                 ('solo-pulse', 'Vibe-Solo-Pulse'), ('solo-events', 'Vibe-Solo-Events'), ('solo-deals', 'Vibe-Solo-Deals'), ('solo-work', 'Vibe-Solo-Work'),
                 ('lanes-pulse', 'Vibe-Lanes-Pulse'), ('lanes-events', 'Vibe-Lanes-Events'), ('lanes-deals', 'Vibe-Lanes-Deals'), ('lanes-work', 'Vibe-Lanes-Work'),
                 ('classic', 'Classic'), ('classic-events', 'Classic-Events'), ('classic-work', 'Classic-Work'), ('classic-deals', 'Classic-Deals')]
PHONE_VIEWS = [('wall', 'Phone-Wall'), ('pulse', 'Phone-Pulse'), ('events', 'Phone-Events'), ('work', 'Phone-Work'), ('deals', 'Phone-Deals'), ('music', 'Phone-Music')]
# Lane names as the app's button labels say them, and its data-solo ids -> the prototype's lane names.
LABEL_LANE = {'Pulse': 'pulse', 'Events': 'events', 'Deals': 'deals', 'Work': 'work', 'Jobs': 'work'}
SOLO_LANE = {'pulse': 'pulse', 'events': 'events', 'food': 'deals', 'jobs': 'work', 'deals': 'deals', 'work': 'work'}

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&amp;family=Geist+Mono:wght@100..900&amp;display=swap">'


def read(path):
    with open(path, encoding='utf8') as f:
        return f.read()


def write(name, text):
    with open(os.path.join(P, name), 'w', encoding='utf8', newline='\n') as f:
        f.write(text)


# The app styles hang off <html data-…>; an artboard has no <html> of its own, so its root div carries them.
css = read(os.path.join(CAP, 'app.css'))
css = re.sub(r'html:not\((\[data-[^\]]+\])\)', r'html:not(:has(.po-root\1))', css)
css = re.sub(r'html((?:\[data-[^\]]+\])+)', r'html:has(.po-root\1)', css)
css += "\n:root{--font-geist-sans:'Geist',Arial,Helvetica,sans-serif;--font-geist-mono:'Geist Mono',ui-monospace,monospace}\n"
left = set(re.findall(r'[^{},;]*\bhtml\[data-[^{},]*', css))
assert not left, 'selectors still on html[data-…]: %s' % sorted(left)[:5]


def pin_vh(px):
    # On the canvas 100vh is the frame, not a screen: pin viewport heights to the size the view was captured at.
    return re.sub(r'(?<![\w.-])(\d+(?:\.\d+)?)[dsl]?vh\b', lambda m: '%gpx' % (float(m.group(1)) * px / 100), css)


write('pulseops.css', pin_vh(900))
write('pulseops-phone.css', pin_vh(844))
built = ['pulseops.css', 'pulseops-phone.css']


def wire(m):
    tag = m.group(0)
    label = re.search(r'aria-label="([^"]*)"', tag)
    if not label:
        return tag
    label = label.group(1)
    lane = re.match(r'(Open|Expand|Collapse|Hide) the (%s) lane$' % '|'.join(LABEL_LANE), label)
    if lane:
        hole = ('open_' if lane.group(1) in ('Open', 'Expand') else 'close_') + LABEL_LANE[lane.group(2)]
    elif label == 'Close Pulse':
        hole = 'close_pulse'
    elif label == 'Back to the dashboard':
        hole = 'go_wall'
    elif label.startswith('Music options'):
        hole = 'open_music'
    elif label == 'Close the Music view':
        hole = 'close_music'
    else:
        return tag
    return tag[:-1] + ' onClick="{{ %s }}">' % hole


ARTBOARD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pulse Ops · %(title)s</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="./%(css)s">
</head>
<body>
<x-dc>
<helmet>
%(fonts)s
<style>
body{margin:0}
%(extra)s
[role=dialog][aria-label="Before you run"]{display:none}
</style>
</helmet>
<div class="po-root antialiased" %(attrs)s>
%(body)s
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"nav":{"editor":null},"$preview":{"width":%(w)d,"height":%(h)d}}'>
class Component extends DCLogic {
renderVals() {
const nav = this.props.nav;
const f = (a, l) => () => { if (typeof nav === 'function') nav(a, l); };
const vals = { go_wall: f('wall', 'wall') };
['pulse', 'events', 'work', 'deals', 'music'].forEach((l) => { vals['open_' + l] = f('open', l); vals['close_' + l] = f('close', l); });
return vals;
}
}
</script>
</body>
</html>
'''

index = json.loads(read(args.index))
for fn in REMOVE:
    index['boards'].pop(fn, None)
    if fn in index['order']:
        index['order'].remove(fn)
    print('REMOVED', fn)
for cap, fn, title, row, x in BOARDS:
    src = os.path.join(CAP, cap + '.html')
    if fn in SKIP:
        print('KEPT (hand-edited)', fn)
        continue
    if not os.path.exists(src):
        print('NO CAPTURE for', cap, '- left as it is on the canvas' if fn in index['boards'] else '- not on the canvas')
        continue
    phone = row == 2
    h = read(src)
    meta = json.loads(re.match(r'<!--META (.*?) -->\n', h).group(1))
    h = h[h.index('\n') + 1:]
    assert '{{' not in h, cap + ' contains {{, which the canvas would read as a hole'
    h = re.sub(r'<!--.*?-->', '', h, flags=re.S)
    h = re.sub(r'<img\b[^>]*>', '', h)  # the canvas loads no outside images (video stills, avatars)
    h = re.sub(r'<button\b[^>]*>', wire, h)
    attrs = ' '.join('%s="%s"' % (k, v.replace('"', '&quot;')) for k, v in meta['html'] if k.startswith('data-'))
    style = dict(meta['html']).get('style')  # the music tint's custom properties
    w = 390 if phone else 1440
    height = max(meta['h'], 844 if phone else 900)
    write(fn, ARTBOARD % dict(title=title, css='pulseops-phone.css' if phone else 'pulseops.css', fonts=FONTS, attrs=attrs,
                              extra=':root{%s}' % style if style else '', body=h, w=w, h=height))
    built.append(fn)
    old = index['boards'].get(fn, {})
    board = dict(old, x=old.get('x', x), y=old.get('y', ROW_Y[row]), w=w, h=height)
    board.setdefault('title', title)
    if not phone:
        board['expand'] = 'fill'
    index['boards'][fn] = board
    if fn not in index['order']:
        index['order'].append(fn)
    print('%-28s h=%-5d wired=%-3d %s' % (fn, height, h.count('onClick='), attrs))

have = lambda views: [(v, n) for v, n in views if n + '.dc.html' in index['boards']]
flag = lambda v: 'is_' + v.replace('-', '_')


def shell(title, cssf, handlers, style, views, hint, props, js):
    branches = '\n'.join('<sc-if value="{{ %s }}" hint-placeholder-val="{{ %s }}"><dc-import name="%s" nav="{{ nav }}" hint-size="%s"></dc-import></sc-if>'
                         % (flag(v), 'true' if i == 0 else 'false', n, hint) for i, (v, n) in enumerate(views))
    flags = '\n'.join("vals.%s = view === '%s';" % (flag(v), v) for v, n in views)
    return '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pulse Ops · %s</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="./%s">
</head>
<body>
<x-dc>
<helmet>
%s
<style>
body{margin:0}
</style>
</helmet>
<div %sstyle="%s">
%s
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='%s'>
class Component extends DCLogic {
renderVals() {
%s
%s
return vals;
}
}
</script>
</body>
</html>
''' % (title, cssf, FONTS, handlers, style, branches, props, js, flags)


# Q W E R follow the lane order on screen (Shift+F flips it); the capture records what each key opened.
keys = {'q': 'pulse', 'w': 'events', 'e': 'deals', 'r': 'work'}
keys_file = os.path.join(CAP, 'keys.json')
if os.path.exists(keys_file):
    seen = {k: SOLO_LANE[v.split('-', 1)[-1]] for k, v in json.loads(read(keys_file)).items() if v.split('-', 1)[-1] in SOLO_LANE}
    if len(seen) == 4:
        keys = seen
# From the wallpaper a lane opens either as one pane over it (solo-…) or on the lanes page, expanded (lanes-…).
lane_view = {}
for lane in ('pulse', 'events', 'deals', 'work'):
    for kind, stem in (('lanes-', 'Vibe-Lanes-'), ('solo-', 'Vibe-Solo-')):
        fn = stem + lane.capitalize() + '.dc.html'
        if fn in index['boards'] and (lane not in lane_view or fn in built):
            lane_view[lane] = kind + lane
print('lane keys', keys, 'lane views', lane_view)

DESKTOP_JS = '''const view = (this.state && this.state.view) || this.props.start || 'wall';
const back = (this.state && this.state.back) || 'wall';
const go = (v, b) => this.setState({ view: v, back: b || back });
const classic = view.indexOf('classic') === 0;
const laneView = %s;
const solo = view.indexOf('solo-') === 0 || view.indexOf('lanes-') === 0;
const base = () => (view === 'wall' || view === 'wall-feed') ? 'wall' : 'lanes';
const openLane = (lane) => {
if (classic) { const t = lane === 'pulse' ? 'classic' : 'classic-' + lane; go(view === t ? 'classic' : t, back); return; }
const t = laneView[lane];
if (!t) return;
if (view === t) go(back, back); else go(t, t.indexOf('lanes-') === 0 ? 'lanes' : (solo || view === 'tasks' ? back : base()));
};
const nav = (action, lane) => {
if (lane === 'music') return;
if (action === 'wall') { go('wall', 'wall'); return; }
if (action === 'open') { openLane(lane); return; }
go(classic ? 'classic' : (solo ? back : 'lanes'), back);
};
const lanes = %s;
const onKey = (e) => {
if (e.ctrlKey || e.metaKey || e.altKey) return;
const k = (e.key || '').toLowerCase();
let done = true;
if (k === 'm') go(classic ? 'lanes' : 'classic', 'lanes');
else if (k === 'f') { const t = (view === 'wall' || view === 'wall-feed') ? 'lanes' : 'wall'; go(t, t); }
else if (k === 'b' && !classic) { if (view === 'tasks') go(back, back); else go('tasks', solo ? back : base()); }
else if (lanes[k]) openLane(lanes[k]);
else if (k === 'escape') go(classic ? 'classic' : (view === 'wall-feed' ? 'wall' : (solo || view === 'tasks' ? back : view)), back);
else done = false;
if (done) e.preventDefault();
};
const onWheel = (e) => {
if (view === 'wall' && e.deltaY >= 4) go('wall-feed', 'wall');
else if (view === 'wall-feed' && e.deltaY <= -4) go('wall', 'wall');
};
const vals = { nav: nav, onKey: onKey, onWheel: onWheel, focusMe: (e) => e.currentTarget.focus({ preventScroll: true }) };''' % (json.dumps(lane_view), json.dumps(keys))
PHONE_JS = '''const view = (this.state && this.state.view) || 'wall';
const nav = (action, lane) => this.setState({ view: action === 'open' && view !== lane ? lane : 'wall' });
const vals = { nav: nav };'''

PROTOTYPES = [
    ('Main.dc.html', 'Working prototype · scroll the wallpaper, click lanes, keys M F Q W E R B Esc', dict(x=-1520, y=0, w=1440, h=2000, expand='fill'),
     shell('Working prototype', 'pulseops.css', 'tabIndex="0" onKeyDown="{{ onKey }}" onWheel="{{ onWheel }}" onMouseEnter="{{ focusMe }}" ', 'outline: none; min-height: 900px',
           have(DESKTOP_VIEWS), '100%,900px', '{"start":{"editor":"enum","options":["wall","lanes","classic"],"default":"wall"},"$preview":{"width":1440,"height":2000}}', DESKTOP_JS)),
    ('Phone.dc.html', 'Phone prototype · tap the lanes and the music bar', dict(x=-470, y=ROW_Y[2], w=390, h=index['boards'].get('Phone-Wall.dc.html', {}).get('h', 844)),
     shell('Phone prototype', 'pulseops-phone.css', '', 'width: 390px; min-height: 844px', have(PHONE_VIEWS), '390px,844px', '{"$preview":{"width":390,"height":844}}', PHONE_JS)),
]
for fn, title, frame, source in PROTOTYPES:
    if fn in SKIP:
        print('KEPT (hand-edited)', fn)
        continue
    write(fn, source)
    built.append(fn)
    old = index['boards'].get(fn, {})
    index['boards'][fn] = dict(frame, **{k: old[k] for k in ('x', 'y') if k in old}, title=old.get('title', title), is_interactive=True)
    if fn not in index['order']:
        index['order'].insert(0, fn)

assert set(index['order']) == set(index['boards']), 'index order and boards disagree'
with open(os.path.join(P, 'canvas.json'), 'w', encoding='utf8') as f:
    json.dump(index, f, ensure_ascii=False, indent=1)
print(len(index['boards']), 'artboards in the index;', len(built), 'files built')
print('FILES', json.dumps(dict({'project/' + f: 'project/' + f for f in sorted(built)}, **{'project/' + f: None for f in REMOVE})))

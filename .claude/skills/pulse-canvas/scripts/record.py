"""After a successful publish: remember what each canvas file looked like, so the next run can spot hand edits.

    python record.py <canvas>/project
"""
import hashlib
import json
import os
import sys

src = sys.argv[1]
# Kept outside the repo: the skill runs from whichever worktree the session is in, and the record must outlive it.
state = os.path.join(os.path.expanduser('~'), '.claude', 'pulse-canvas', 'published.json')
os.makedirs(os.path.dirname(state), exist_ok=True)
known = {}
if os.path.exists(state):
    with open(state, encoding='utf8') as f:
        known = json.load(f)
for name in sorted(os.listdir(src)):
    with open(os.path.join(src, name), 'rb') as f:
        data = f.read()
    known['project/' + name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
with open(state, 'w', encoding='utf8') as f:
    json.dump(known, f, indent=1)
print(len(known), 'files recorded in', state)

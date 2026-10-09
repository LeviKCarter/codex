"""Tells Levi when the WoW Forever beta is back after it goes down.

Blizzard has no status page for the beta and posted nothing for the 2026-10-09 restart, and the world server
cannot be asked without logging in. What does show an outage within minutes is the official forum: players open
"servers down?" topics when it drops and say "I'm in" when it returns. This job reads the forum's public JSON:

* While the beta is up, the newest topics are read every 2 minutes. Two topics about the servers being down,
  opened within 15 minutes of each other, mean it is down.
* While it is down, those topics' newest posts and the new topics are read every 30 seconds. A topic titled as
  "back up" counts 2, a post by a player saying they are in counts 1 (once per player); 4 within 8 minutes mean it
  is back. Notify-Back.ps1 then shows the Windows notification and puts the red dot on the taskbar shortcut.
* Nothing for 12 hours ends the wait quietly, so one missed return does not hide the next outage.

The numbers are tuned on the outages of 2026-10-08 and 2026-10-09 (fixtures/outages-2026-10.json, replayed by
test_watch_beta.py). Forum text is only matched against fixed patterns; nothing in it is run or passed on.

Run by the scheduled task "WoW Forever Back Up Watch" (register_watch_task.ps1). `--once` does one reading and ends.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

FORUM = "https://us.forums.blizzard.com/en/wow"
USER_AGENT = "Mozilla/5.0"
STATE_FILE = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "PulseAgent" / "wow-forever-watch.json"
NOTIFY = Path(__file__).with_name("Notify-Back.ps1")
POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

UP_POLL_SECONDS, DOWN_POLL_SECONDS = 120, 30
DOWN_TOPICS, DOWN_WINDOW = 2, timedelta(minutes=15)
BACK_POINTS, BACK_WINDOW = 4, timedelta(minutes=8)
TOPIC_POINTS = 2
GIVE_UP = timedelta(hours=12)
TRACKED = 8  # topics whose posts are read while it is down
TEXT_CHARS = 110  # a post is judged on its first words

DOWN_TITLE = re.compile(
    r"\bserv?ers?\b.*\b(down|shut ?downs?|offline|restart\w*)\b|\bworld server\b|\bmaintenance\b"
    r"|\bshut ?down incoming\b|there goes the server", re.I)
UP_TEXT = re.compile(
    r"\b(back up|back online|(it'?s|is|are|they'?re|servers?) (back|up|live)\b|i'?m (logged )?in\b|we'?re (in|back)\b"
    r"|got in\b|let me (back )?in\b|logged in\b|in game now|up now|came (back )?up|working (again|now))", re.I)
NOT_UP = re.compile(
    r"\?|\bnot\b|n't|\bcant\b|\bnever\b|\bwhen\b|\bstill\b|\bshould\b|\bwill\b|\bif\b|\buntil\b|\bhope|\bwait"
    r"|\bdown\b|\bchar(acter)?s? (select|screen)|\b(by|at) \d|\bsoon\b|\banyone\b|\bonce\b|\bbefore\b|\bafter\b", re.I)
QUOTED = re.compile(r'"[^"]*"')


def log(text: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {text}", flush=True)


def stamp(when: datetime) -> str:
    return when.strftime("%Y-%m-%dT%H:%M:%S")


def moment(text: str) -> datetime:
    return datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")


def clean(cooked: str) -> str:
    """A post's HTML as the plain words its author wrote: no quoted posts, straight quotes, first words only."""
    text = re.sub(r"<aside.*?</aside>|<blockquote.*?</blockquote>", " ", cooked, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    for a, b in (("&amp;", "&"), ("&#39;", "'"), ("&quot;", '"'), ("\u2019", "'"), ("\u2018", "'"), ("\u201c", '"'), ("\u201d", '"')):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip().encode("ascii", "replace").decode()[:TEXT_CHARS]


def says_down(title: str) -> bool:
    return bool(DOWN_TITLE.search(title)) and not says_up(title)


def says_up(text: str) -> bool:
    """Someone saying the beta is up or that they are in, not asking, hoping or quoting."""
    said = QUOTED.sub(" ", text)
    return bool(UP_TEXT.search(said)) and not NOT_UP.search(said)


def step(state: dict, now: datetime, topics: list[dict], posts_for: Callable[[int], list]) -> str | None:
    """One reading. Changes `state` and returns 'down', 'back', 'gave up' or None.

    topics: the newest topics as {"id", "created", "title"}. posts_for(id): that topic's newest posts as
    [created, author, text] rows. Times are UTC, "YYYY-MM-DDTHH:MM:SS".
    """
    if state.get("phase") != "down":
        after = now - DOWN_WINDOW
        if state.get("last_up"):
            after = max(after, moment(state["last_up"]))
        fresh = [t for t in topics if after < moment(t["created"]) <= now and says_down(t["title"])]
        if len(fresh) < DOWN_TOPICS:
            return None
        state.update(phase="down", since=stamp(now), tracked=[t["id"] for t in fresh][:TRACKED])
        return "down"

    since = moment(state["since"])
    if now - since > GIVE_UP:
        state.update(phase="up", last_up=stamp(now), tracked=[])
        return "gave up"
    tracked = state.setdefault("tracked", [])
    for t in topics:
        if moment(t["created"]) > since - DOWN_WINDOW and says_down(t["title"]) and t["id"] not in tracked and len(tracked) < TRACKED:
            tracked.append(t["id"])
    window = max(now - BACK_WINDOW, since - DOWN_WINDOW)
    points = TOPIC_POINTS * sum(1 for t in topics if window < moment(t["created"]) <= now and says_up(t["title"]))
    players = set()
    for topic_id in tracked:
        for created, author, text in posts_for(topic_id):
            if window < moment(created) <= now and says_up(text):
                players.add(author)
    if points + len(players) < BACK_POINTS:
        return None
    state.update(phase="up", last_up=stamp(now), tracked=[])
    return "back"


def http_json(path: str) -> dict:
    request = urllib.request.Request(FORUM + path, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as answer:
        return json.load(answer)


def newest_topics() -> list[dict]:
    rows = http_json("/latest.json?order=created")["topic_list"]["topics"]
    return [{"id": t["id"], "created": t["created_at"][:19], "title": clean(t["title"])} for t in rows]


def newest_posts(topic_id: int) -> list:
    try:
        rows = http_json(f"/t/{topic_id}/last.json")["post_stream"]["posts"]
    except Exception as error:  # one unread topic is not a reason to stop the reading
        log(f"topic {topic_id} not read: {error}")
        return []
    return [[p["created_at"][:19], p["username"], clean(p["cooked"])] for p in rows]


def load_state(state_file: Path) -> dict:
    try:
        return json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"phase": "up"}


def save_state(state_file: Path, state: dict) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state), encoding="utf-8")


def notify() -> None:
    done = subprocess.run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(NOTIFY)],
                          capture_output=True, text=True, timeout=120, creationflags=NO_WINDOW)
    log(f"Notify-Back exit {done.returncode}: {(done.stdout + done.stderr).strip()[:300]}")


def read_once(state_file: Path, tell: Callable[[], None] = notify) -> dict:
    state = load_state(state_file)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = step(state, now, newest_topics(), newest_posts)
    if result:
        log(f"{result}: {state}")
        save_state(state_file, state)
        if result == "back":
            tell()
    return state


def watch(state_file: Path) -> None:
    log(f"watching the forum; state {load_state(state_file)}")
    while True:
        phase = "up"
        try:
            phase = read_once(state_file).get("phase", "up")
        except Exception as error:  # the forum not answering is not a verdict; read again next time
            log(f"reading failed: {error}")
        time.sleep(DOWN_POLL_SECONDS if phase == "down" else UP_POLL_SECONDS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--once", action="store_true", help="one reading, print the state, end")
    parser.add_argument("--state", type=Path, default=STATE_FILE)
    args = parser.parse_args()
    if args.once:
        print(json.dumps(read_once(args.state)))
        return 0
    watch(args.state)
    return 0


if __name__ == "__main__":
    sys.exit(main())

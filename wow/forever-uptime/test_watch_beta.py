"""python -m unittest wow/forever-uptime/test_watch_beta.py. No network, no notification: the forum of 2026-10-08
and 2026-10-09 (fixtures/outages-2026-10.json, authors renamed) is replayed one reading every 30 seconds."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import watch_beta as job

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "outages-2026-10.json").read_text(encoding="ascii"))


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def replay(start: str, end: str, state: dict | None = None, seconds: int = 30) -> list[tuple[str, str]]:
    """Every change the watcher makes between two times, as (time, what). Each reading sees what the forum showed
    then: the 30 newest topics and each topic's last 20 posts."""
    state = state if state is not None else {"phase": "up"}
    now, changes = job.moment(start), []
    while now <= job.moment(end):
        at = job.stamp(now)
        topics = [t for t in FIXTURE["topics"] if t["created"] <= at][-30:]
        posts_for = lambda topic_id: [p for p in FIXTURE["posts"].get(str(topic_id), []) if p[0] <= at][-20:]
        result = job.step(state, now, topics, posts_for)
        if result:
            changes.append((at, result))
        now += timedelta(seconds=seconds)
    return changes


class Replay(unittest.TestCase):
    def test_restart_of_october_9(self):
        # First "shutdown incoming" topic 22:37; players report the world server up from 23:18.
        changes = replay("2026-10-09T12:00:00", "2026-10-09T23:30:00")
        self.assertEqual([what for _, what in changes], ["down", "back"])
        (down, _), (back, _) = changes
        self.assertTrue("2026-10-09T22:42:00" <= down <= "2026-10-09T22:46:00", down)
        self.assertTrue("2026-10-09T23:17:30" <= back <= "2026-10-09T23:19:30", back)

    def test_maintenance_of_october_8(self):
        # The capture starts mid-maintenance; "back up" topics from 21:48.
        changes = replay("2026-10-08T19:22:00", "2026-10-09T12:00:00")
        self.assertEqual([what for _, what in changes], ["down", "back"])
        (down, _), (back, _) = changes
        self.assertTrue("2026-10-08T19:48:00" <= down <= "2026-10-08T19:50:00", down)
        self.assertTrue("2026-10-08T21:48:00" <= back <= "2026-10-08T21:53:00", back)

    def test_the_whole_capture_has_two_outages_and_no_more(self):
        changes = replay("2026-10-08T19:22:00", "2026-10-09T23:30:00", seconds=60)
        self.assertEqual([what for _, what in changes], ["down", "back", "down", "back"])

    def test_a_wait_of_twelve_hours_ends_quietly(self):
        state = {"phase": "down", "since": "2026-10-09T00:00:00", "tracked": []}
        self.assertEqual(job.step(state, job.moment("2026-10-09T12:00:30"), [], lambda _: []), "gave up")
        self.assertEqual(state["phase"], "up")


class Rules(unittest.TestCase):
    def test_titles_that_mean_down(self):
        for title in ("Servers down?", "Server shutdown incoming", "More Maintenance?", "Are beta servers down?",
                      "World Server is Down", "Bonk! there goes the server"):
            self.assertTrue(job.says_down(title), title)
        for title in ("Unable to log in", "Tram down?", "Heals scaling down or something?", "Hardmode Server",
                      "Will the racial tuning be in before Beta is down?", "Server Uptime", "Servers back up"):
            self.assertFalse(job.says_down(title), title)

    def test_words_that_mean_back(self):
        for text in ("Logged in!", "It just let me back in!", "Im in game now", "I'm in Orgrimmar! LETS GOOOO!",
                     "world servers just came up", "Game is up!", "The server is back up again"):
            self.assertTrue(job.says_up(text), text)
        for text in ("Servers Up At 3pm PDT 10/8 -Reposted for convenience", "SERVER SHOULD BE UP BY 3pm PST",
                     "is it back up?", "world server still down i'm stuck lookin at my pretty chars",
                     '"Intern, yeah servers are back up!" "Team lead, Ok see you on Tuesday"',
                     "Am logged into the Character Selection Screen but when I try logging in I get a message",
                     "once the comments stop for a few minutes, then the servers are up"):
            self.assertFalse(job.says_up(text), text)

    def test_one_player_counts_once(self):
        state = {"phase": "down", "since": "2026-10-09T22:45:00", "tracked": [1]}
        posts = [["2026-10-09T23:00:0%d" % i, "u1", "I'm in"] for i in range(6)]
        self.assertIsNone(job.step(state, job.moment("2026-10-09T23:00:30"), [], lambda _: posts))

    def test_a_down_topic_from_before_the_return_does_not_start_a_new_outage(self):
        state = {"phase": "up", "last_up": "2026-10-09T23:18:30"}
        topics = [{"id": 1, "created": "2026-10-09T23:10:09", "title": "World Server is Down"},
                  {"id": 2, "created": "2026-10-09T23:11:42", "title": "World server down stuck in instance"},
                  {"id": 3, "created": "2026-10-09T23:18:59", "title": "World server down?"}]
        self.assertIsNone(job.step(state, job.moment("2026-10-09T23:20:00"), topics, lambda _: []))


class Reading(unittest.TestCase):
    def test_back_is_told_once_and_the_state_is_kept(self):
        told = []
        with tempfile.TemporaryDirectory() as folder:
            state_file = Path(folder) / "sub" / "state.json"
            job.save_state(state_file, {"phase": "down", "since": job.stamp(utc_now() - timedelta(minutes=30)), "tracked": [7]})
            recent = job.stamp(utc_now() - timedelta(minutes=1))
            real = (job.newest_topics, job.newest_posts)
            job.newest_topics = lambda: []
            job.newest_posts = lambda _: [[recent, f"u{i}", "I'm in"] for i in range(4)]
            try:
                job.read_once(state_file, tell=lambda: told.append(1))
                job.read_once(state_file, tell=lambda: told.append(1))
            finally:
                job.newest_topics, job.newest_posts = real
            self.assertEqual(told, [1])
            self.assertEqual(job.load_state(state_file)["phase"], "up")


if __name__ == "__main__":
    unittest.main()

"""Tests for patch_day.py: python test_patch_day.py (exit 0 = all pass). Uses temp folders; no network, no Claude."""
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import patch_day as pd  # noqa: E402

checks = 0
failures = []


def check(ok, message):
    global checks
    checks += 1
    if not ok:
        failures.append(message)
        print("FAIL", message)


T0 = datetime(2026, 10, 20, 15, 0, 0)
tmp = Path(tempfile.mkdtemp(prefix="patchday-test-"))
pd.NOTES_CACHE = tmp / "cache"
pd.log = lambda text: None

# ---- the version list ----
versions = ("Region!STRING:0|BuildConfig!HEX:16|CDNConfig!HEX:16|KeyRing!HEX:16|BuildId!DEC:4|VersionsName!String:0\n"
            "## seqn = 1\nus|84bea4233331e390fda8724c6f91ffa5|f065eade5276a5ac05606e60a4c5a1f7||70450|1.60.1.70450|x\n")
check(pd.current_build(versions) == "1.60.1.70450", "build read from the us row")
check(pd.current_build("garbage") is None, "no us row: no build")

# ---- a post's HTML ----
cooked = ('<p>Today, we updated.</p>\n<h2><a name="x" class="anchor" href="#x"></a>Change Log</h2>\n<ul>\n'
          '<li><strong>Bugfixes</strong>\n<ul>\n<li>Fixed &amp; tuned <code>GetItemInfo</code>.</li>\n</ul>\n</li>\n</ul>')
text = pd.html_text(cooked)
check("## Change Log" in text, "heading kept: " + text)
check("- Bugfixes" in text and "  - Fixed & tuned GetItemInfo." in text, "nested list indented, entities read: " + text)

# ---- deciding when to run ----
notes1 = {"id": 11, "title": "Beta Client Update - October 20", "version": 1, "text": "Fixed the bank."}
state = {}
check(pd.look(state, T0, "1.60.1.1", [notes1]) is None, "first look runs nothing")
check(state["build"] == "1.60.1.1" and state["notes"] == {"11": 1}, "first look takes note of what is out")
check(pd.look(state, T0 + timedelta(minutes=15), "1.60.1.1", [notes1]) is None and "pending" not in state,
      "nothing new: nothing pending")

# a build alone waits for notes, then is dropped without a run
s = dict(state, notes=dict(state["notes"]))
check(pd.look(s, T0, "1.60.1.2", []) is None and s["pending"]["build_to"] == "1.60.1.2", "new build is pending")
check(pd.look(s, T0 + pd.SETTLE + timedelta(minutes=1), "1.60.1.2", []) is None, "build alone waits for notes")
check(pd.look(s, T0 + pd.NOTES_WAIT + timedelta(minutes=1), "1.60.1.2", []) is None, "no notes in time: no run")
check(s["build"] == "1.60.1.2" and "pending" not in s, "build with no notes is marked handled")

# a build and its notes are one run, after they settle
s = dict(state, notes=dict(state["notes"]))
notes2 = {"id": 12, "title": "Beta Client Update - October 21", "version": 1, "text": "Mail changed."}
check(pd.look(s, T0, "1.60.1.3", []) is None, "build first")
check(pd.look(s, T0 + timedelta(minutes=10), "1.60.1.3", [notes1, notes2]) is None, "notes arrive: settle again")
due = pd.look(s, T0 + timedelta(minutes=29), "1.60.1.3", [notes1, notes2])
check(due is None, "still inside the settle time after the notes")
due = pd.look(s, T0 + timedelta(minutes=31), "1.60.1.3", [notes1, notes2])
check(due and due["build_to"] == "1.60.1.3" and [t["id"] for t in due["topics"]] == [12], "build + new notes run once")
pd.finish(s, due)
check(s["build"] == "1.60.1.3" and s["notes"]["12"] == 1 and "pending" not in s, "run marked handled")
check(pd.look(s, T0 + timedelta(hours=2), "1.60.1.3", [notes1, notes2]) is None, "handled patch is not run again")

# an edited dev-notes post (new revision) is a patch too, and its new lines are marked
pd.remember_text({"id": 20, "text": "## Change Log\n- Fixed casters."})
s["notes"]["20"] = 3
edited = {"id": 20, "title": "WoW Forever Beta Development Notes - Updated October 22", "version": 4,
          "text": "## Change Log\n- Fixed casters.\n- The bank now has 8 tabs."}
pd.look(s, T0 + timedelta(hours=3), "1.60.1.3", [notes1, notes2, edited])
due = pd.look(s, T0 + timedelta(hours=4), "1.60.1.3", [notes1, notes2, edited])
check(due and due["topics"][0]["version"] == 4 and not due.get("build_to"), "edited post runs without a build")
md = pd.notes_markdown(due)
check(">> - The bank now has 8 tabs." in md and "   - Fixed casters." in md, "new lines marked: " + md)

# ---- reading the forum ----
pages = {
    f"/c/{pd.CATEGORY}.json?order=created": {"topic_list": {"topics": [
        {"id": 1, "title": "Beta Client Update - October 22", "created_at": "2026-10-20T14:00:00Z"},
        {"id": 2, "title": "Update broke my fps", "created_at": "2026-10-20T14:10:00Z"},
        {"id": 3, "title": "Warlock feedback", "created_at": "2026-10-20T14:20:00Z"},
        {"id": 4, "title": "Old patch thread", "created_at": "2026-09-01T00:00:00Z"}]}},
    f"/c/{pd.CATEGORY}.json": {"topic_list": {"topics": [
        {"id": 5, "title": "WoW Forever Beta Development Notes - Updated October 22",
         "created_at": "2026-09-24T00:00:00Z", "bumped_at": "2026-10-20T13:00:00Z"}]}},
}
staff = lambda tid, title, ver: {"title": title, "post_stream": {"posts": [{"staff": True, "version": ver, "cooked": "<p>x</p>"}]}}
pages["/t/1.json"] = staff(1, "Beta Client Update - October 22", 1)
pages["/t/2.json"] = {"title": "Update broke my fps", "post_stream": {"posts": [{"staff": False, "cooked": "<p>help</p>"}]}}
pages["/t/5.json"] = staff(5, "WoW Forever Beta Development Notes - Updated October 22", 7)
read = []


def get(path):
    read.append(path)
    return pages[path]


fs = {}
found = pd.staff_topics(fs, T0, get)
check(sorted(t["id"] for t in found) == [1, 5], f"staff topics only: {[t['id'] for t in found]}")
check("/t/3.json" not in read and "/t/4.json" not in read, "unrelated and old topics are not opened")
check(fs["skip"] == [2] and fs["tracked"] == [5], f"player topic skipped, dev notes tracked: {fs}")
fs["notes"] = {"1": 1, "5": 7}
read.clear()
pages[f"/c/{pd.CATEGORY}.json"] = {"topic_list": {"topics": []}}
found = pd.staff_topics(fs, T0, get)
check(read.count("/t/5.json") == 1 and "/t/1.json" not in read and "/t/2.json" not in read,
      f"later looks re-read only the dev notes: {read}")

# ---- one run, with a fake Claude and a fake suite ----
root = tmp / "AddOns"
(root / "MyAddon").mkdir(parents=True)
(root / "MyAddon" / "MyAddon.toc").write_text("## Interface: 16001\n## Version: 1\nMain.lua\n", encoding="utf-8")
(root / "MyAddon" / "Main.lua").write_text("local x = 1\nreturn x\n", encoding="utf-8")
(root / "BigData").mkdir()
(root / "BigData" / "Data.lua").write_bytes(b"-- " + b"x" * (pd.DATA_ADDON_BYTES + 10))
pending = {"build_from": "1.60.1.1", "build_to": "1.60.1.2", "topics": [notes2]}
main = root / "MyAddon" / "Main.lua"
original = main.read_text(encoding="utf-8")
shown = []
tell = lambda title, text, opens: shown.append((title, text, opens))
GOOD = "SUMMARY: Fixed the mail button.\n## What in the patch touches your addons\nMail.\n## Fixed\nMain.lua:1\n## Check in game\nNothing\n## Not affected\nRest."


def run(asks, suite_after=frozenset(), suite_before=frozenset({"old/test"})):
    """asks: one function per Claude call, each editing the addon and returning the answer."""
    calls = iter(asks)
    folders_seen = []
    runs = []

    def ask(bundle, folders, prompt):
        folders_seen.append([f.name for f in folders])
        runs.append(prompt)
        return next(calls)()

    def suite(r):
        changed = main.read_text(encoding="utf-8") != original
        return (set(suite_before) | (set(suite_after) if changed else set()), "suite output")

    shown.clear()
    bundle = pd.check_patch(pending, root=root, reports=tmp / "reports", backups=tmp / "backups",
                            ask=ask, suite=suite, tell=tell)
    return bundle, folders_seen, runs


def edit(text, answer=GOOD):
    def go():
        main.write_text(text, encoding="utf-8")
        return answer
    return go


def fail_ask():
    main.write_text("local x = 2\n", encoding="utf-8")  # half made
    raise pd.NoAnswer("Claude took longer than 45 minutes")


bundle, seen, prompts = run([edit("local x = 2\nreturn x\n")])
report = (bundle / "report.md").read_text(encoding="utf-8")
check(seen == [["MyAddon"]], f"big data addon is not offered: {seen}")
check(main.read_text(encoding="utf-8") == "local x = 2\nreturn x\n", "good fix is kept")
check("modified" not in report and "changed: MyAddon" in report.replace("\\", "/"), "report lists the changed file: " + report)
check("old/test" in prompts[0] and "Mail changed." in prompts[0], "Claude gets the notes and the failing-before tests")
check(shown and shown[0][1] == "Fixed the mail button." and shown[0][2].name == "report.md", f"notification: {shown}")
check((tmp / "backups" / bundle.name / "MyAddon" / "Main.lua").read_text(encoding="utf-8") == original, "backup made first")

main.write_text(original, encoding="utf-8")
bundle, seen, prompts = run([edit("local x = = 2\n"), edit("local x = 3\nreturn x\n")])
check(len(prompts) == 2 and "Main.lua" in prompts[1] and "found a problem" in prompts[1], "compile error sent back once")
check(main.read_text(encoding="utf-8") == "local x = 3\nreturn x\n", "second try that compiles is kept")

main.write_text(original, encoding="utf-8")
bundle, seen, prompts = run([edit("local x = = 2\n"), edit("local x = = 3\n")])
report = (bundle / "report.md").read_text(encoding="utf-8")
check(main.read_text(encoding="utf-8") == original and "Rolled back" in report, "still broken: put back from the backup")

main.write_text(original, encoding="utf-8")
bundle, seen, prompts = run([edit("local x = 4\nreturn x\n"), edit("local x = 5\nreturn x\n")], suite_after={"AFP/test_mail"})
check(main.read_text(encoding="utf-8") == original and "AFP/test_mail" in prompts[1], "new test failure: retried, then put back")

main.write_text(original, encoding="utf-8")
(root / "MyAddon" / "New.lua").unlink(missing_ok=True)


def adds_file():
    (root / "MyAddon" / "New.lua").write_text("x = = 1\n", encoding="utf-8")
    return GOOD


bundle, seen, prompts = run([adds_file, adds_file])
check(not (root / "MyAddon" / "New.lua").exists(), "a broken new file is removed on roll back")

main.write_text(original, encoding="utf-8")
bundle, seen, prompts = run([fail_ask])
report = (bundle / "report.md").read_text(encoding="utf-8")
check(main.read_text(encoding="utf-8") == original, "no answer: half-made change put back")
check("not checked" in shown[0][1] and "45 minutes" in shown[0][1], f"no answer is told: {shown}")

pending_notes = {"build_from": None, "build_to": None, "topics": [notes2]}
main.write_text(original, encoding="utf-8")
shown.clear()
pd.check_patch(pending_notes, root=root, reports=tmp / "reports", backups=tmp / "backups",
               ask=lambda b, f, p: "SUMMARY: Nothing needed fixing.\n## Fixed\nNothing\n## Check in game\nNothing\n",
               suite=lambda r: (set(), ""), tell=tell)
check(not shown, "notes-only run that found nothing stays quiet")
check(len([p for p in (tmp / "reports").iterdir()]) <= pd.KEPT, "old reports pruned")

# while a run on the real addons is going, the shortcut can see it; a test copy never holds the shortcut
pd.RUNNING = tmp / "running.txt"
during = []
ask_marker = lambda b, f, p: during.append(pd.RUNNING.read_text(encoding="ascii") if pd.RUNNING.exists() else "") \
    or "SUMMARY: ok\n## Check in game\nNothing\n"
pd.check_patch(pending, root=root, reports=tmp / "reports", backups=tmp / "backups", ask=ask_marker,
               suite=lambda r: (set(), ""), tell=None)
check(not during[0].startswith("1.60") and not pd.RUNNING.exists(), f"a copy writes no marker: {during}")
saved_addons, pd.ADDONS = pd.ADDONS, root
during.clear()
pd.check_patch(pending, root=root, reports=tmp / "reports", backups=tmp / "backups", ask=ask_marker,
               suite=lambda r: (set(), ""), tell=None)
check(during and during[0].startswith("1.60.1.2|") and not pd.RUNNING.exists(), f"marker while running, gone after: {during}")
during.clear()


def ask_crash(b, f, p):
    raise RuntimeError("boom")


try:
    pd.check_patch(pending, root=root, reports=tmp / "reports", backups=tmp / "backups", ask=ask_crash,
                   suite=lambda r: (set(), ""), tell=None)
except RuntimeError:
    pass
check(not pd.RUNNING.exists(), "a run that crashes still removes the marker")
pd.ADDONS = saved_addons

check(pd.compile_errors([main]) == [], "real Lua compiles")
bad = root / "MyAddon" / "Bad.lua"
bad.write_text("if then\n", encoding="utf-8")
check(len(pd.compile_errors([bad])) == 1, "broken Lua is caught")
bad.unlink()

print(f"{checks} checks, {len(failures)} failed")
sys.exit(1 if failures else 0)

"""python -m unittest test_addon_guard.py (from this folder)

Runs the guard on made-up addons in a temp folder, with a stand-in for Claude, the patcher and the test suites, and
on the installed Spoken_Quests file of 2026-10-17 (skipped where it is not kept). Nothing installed is changed.
"""

import json
import os
import shutil
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import addon_guard as guard

KEPT_TRACKER = guard.GAME / "hook-patch-backups" / "Spoken_Quests-3.5.0" / "Compatibility.lua"

# A patcher stand-in: applies patches.json ([{addon, file, old, new}]) like the real one; exit 0.
FAKE_PATCHER = textwrap.dedent('''
    import json, sys
    from pathlib import Path
    here = Path(__file__).parent
    addons = Path(sys.argv[sys.argv.index("--addons") + 1])
    for p in json.loads((here / "patches.json").read_text(encoding="utf-8")):
        path = addons / p["addon"] / p["file"]
        text = path.read_text(encoding="utf-8")
        if p["old"] in text:
            path.write_text(text.replace(p["old"], p["new"]), encoding="utf-8")
        elif p["new"] not in text:
            print(f"{p['addon']} 1.0 {p['file']}: NOT PATCHED, the addon changed here")
            sys.exit(2)
''')

HOOK = 'hooksecurefunc(QuestObjectiveTracker, "AddBlock", Dress)'
FIXED = '-- Forever patch: reads the blocks on a timer instead'


class Folder(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.addons = root / "AddOns"
        self.patcher = root / "patcher"
        self.patcher.mkdir()
        (self.patcher / "patch_addon_hooks.py").write_text(FAKE_PATCHER, encoding="utf-8")
        (self.patcher / "test_patch_addon_hooks.py").write_text("# tests\n", encoding="utf-8")
        (self.patcher / "patches.json").write_text("[]", encoding="utf-8")
        self.accepted = root / "accepted.json"
        self.accepted.write_text("[]", encoding="utf-8")
        self.reports, self.backups, self.marker = root / "reports", root / "backups", root / "running.txt"
        self.reports.mkdir()
        self.backups.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, addon, name, text):
        path = self.addons / addon / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(text), encoding="utf-8")
        return path


class Scan(Folder):
    def test_each_rule_is_found_and_harmless_lines_are_not(self):
        self.write("Cf", "a.lua", f"""\
            local x = 1
            {HOOK}
            hooksecurefunc("QuestLog_Update", Refresh)          -- a global function: fine
            -- hooksecurefunc(WorldMapFrame, "SetAlpha", f)     a comment
            WorldMapFrame:AddDataProvider(provider)
            AceConfigDialog:Open("Thing", frame)
            StaticPopup_Show("THING")
            SmartNavigation:SetTargetButtonForFrame(bag, b)
            Menu.ModifyMenu("MENU_X", f)
            function hooksecurefunc(table, name, hook) end
            function overlay:AcquirePin(icon) end
        """)
        self.write("Cf", "tests/mock.lua", f"{HOOK}\n")
        self.write("Cf", "data.lua", HOOK + "\n" + "-- " + "x" * guard.MAX_FILE_BYTES)
        self.write("Blizzard_Thing", "b.lua", f"{HOOK}\n")
        found = [(f.file, f.line, f.rule) for f in guard.scan(self.addons)]
        self.assertEqual(found, [("a.lua", 2, "method-hook"), ("a.lua", 5, "map-pins"), ("a.lua", 6, "ace-dialog"),
                                 ("a.lua", 7, "popup"), ("a.lua", 8, "smart-nav"), ("a.lua", 9, "menu-modify")])

    def test_accepted_lines_and_lines_tried_on_this_file_are_not_new(self):
        self.write("Cf", "a.lua", f"{HOOK}\nStaticPopup_Show('X')\n")
        self.accepted.write_text(json.dumps([{"addon": "Cf", "file": "a.lua", "text": "StaticPopup_Show('X')",
                                              "reason": "test"}]), encoding="utf-8")
        state = {}
        digest = lambda f: guard.file_digest(self.addons, f)
        job = guard.plan(state, guard.scan(self.addons), guard.load_accepted(self.accepted), [], digest)
        self.assertEqual([f["text"] for f in job["findings"]], [HOOK])
        guard.handled(state, job)
        self.assertIsNone(guard.plan(state, guard.scan(self.addons), guard.load_accepted(self.accepted), [], digest))
        self.write("Cf", "a.lua", f"local updated = true\n{HOOK}\nStaticPopup_Show('X')\n")  # an update: try again
        again = guard.plan(state, guard.scan(self.addons), guard.load_accepted(self.accepted), [], digest)
        self.assertEqual([(f["text"], f["line"]) for f in again["findings"]], [(HOOK, 2)])

    @unittest.skipUnless(KEPT_TRACKER.is_file(), "the 2026-10-17 Spoken_Quests file is not kept here")
    def test_the_hook_that_broke_x_on_2026_10_17_would_have_been_caught(self):
        shutil.copy(KEPT_TRACKER, self.write("Spoken_Quests", "Compatibility.lua", ""))
        job = guard.plan({}, guard.scan(self.addons), guard.load_accepted(guard.ACCEPTED), [],
                         lambda f: guard.file_digest(self.addons, f))
        texts = [f["text"] for f in job["findings"]]
        self.assertIn('hooksecurefunc(module, "AddBlock", function(_, block) Dress(block) end)', texts)
        self.assertEqual(len(texts), 1, texts)

    def test_the_installed_addons_have_nothing_new(self):
        if not guard.ADDONS.is_dir():
            self.skipTest("no game here")
        new = [f for f in guard.scan() if f.key not in guard.load_accepted()]
        self.assertEqual(new, [])


SAVED = """
AuctionatorForeverPricesSettings = {
  ["controllerBlocked"] = {
    {["at"] = "2026-10-17 12:00:00 1.00", ["blamed"] = "Old", ["call"] = "InteractUnit()", ["event"] = "ADDON_ACTION_BLOCKED"},
    {["at"] = "2026-10-17 13:00:00 2.00", ["blamed"] = "Spoken_Quests", ["call"] = "SetPreferredGamepadInteractTarget()",
     ["event"] = "ADDON_ACTION_FORBIDDEN", ["stack"] = "[C]: in function 'SetPreferredGamepadInteractTarget'"},
    {["at"] = "2026-10-17 13:00:01 3.00", ["blamed"] = "Auction", ["call"] = "PlaceBid()"},
    {["at"] = "2026-10-17 13:00:02 4.00", ["blamed"] = "secret", ["call"] = "InteractUnit()"},
  },
  ["controllerTaintTimeline"] = {
    {["at"] = "2026-10-17 13:00:00 2.00", ["field"] = "catcher", ["from"] = "secure", ["to"] = "Spoken_Quests",
     ["events"] = {"MAIL_SHOW", "PLAYER_INTERACTION_MANAGER_FRAME_HIDE"}},
  },
}
"""


class Evidence(Folder):
    def test_only_new_controller_blocks_with_a_blamed_addon_count(self):
        saved = Path(self.tmp.name) / "saved.lua"
        saved.write_text(SAVED, encoding="utf-8")
        settings = guard.saved_settings(saved)
        blocks = guard.new_blocks(settings, "2026-10-17 12:30:00")
        self.assertEqual([(b["blamed"], b["call"]) for b in blocks],
                         [("Spoken_Quests", "SetPreferredGamepadInteractTarget()")])
        text = guard.evidence_text(settings, blocks)
        self.assertIn("blamed on Spoken_Quests", text)
        self.assertIn("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", text)

    def test_the_first_run_starts_from_the_newest_block_and_later_blocks_make_a_job(self):
        self.write("Cf", "a.lua", "local x = 1\n")
        saved = Path(self.tmp.name) / "saved.lua"
        saved.write_text(SAVED, encoding="utf-8")
        state = {}
        self.assertIsNone(guard.scan_now(state, self.addons, saved, self.accepted))
        self.assertEqual(state["evidence_until"], "2026-10-17 13:00:02 4.00")
        saved.write_text(SAVED.replace("13:00:00 2.00", "14:00:00 9.00"), encoding="utf-8")
        job = guard.scan_now(state, self.addons, saved, self.accepted)
        self.assertEqual((job["label"], len(job["blocks"])), ("addons Spoken_Quests", 1))
        guard.handled(state, job)
        self.assertIsNone(guard.scan_now(state, self.addons, saved, self.accepted))

    def test_a_half_written_saved_file_is_no_evidence(self):
        saved = Path(self.tmp.name) / "saved.lua"
        saved.write_text("AuctionatorForeverPricesSettings = { [", encoding="utf-8")
        self.assertEqual(guard.new_blocks(guard.saved_settings(saved), ""), [])


class Fix(Folder):
    def setUp(self):
        super().setUp()
        self.hooked = self.write("Cf", "a.lua", f"local x = 1\n{HOOK}\n")
        self.write("Own", "b.lua", "local y = 2\n")
        self.asked, self.seen_marker = [], []
        state = {}
        self.job = guard.plan(state, guard.scan(self.addons), {}, [], lambda f: guard.file_digest(self.addons, f))
        self.job["evidence"] = ""

    def run_fix(self, *answers, patcher_tests=None, suite=None):
        answers = list(answers)

        def ask(bundle, dirs, prompt):
            self.seen_marker.append(self.marker.exists())
            self.asked.append(prompt)
            step = answers.pop(0)
            if isinstance(step, Exception):
                raise step
            step()
            return "SUMMARY: done\n\n## Fixed\n\nSomething"

        return guard.fix(self.job, addons=self.addons, managed={"Cf"}, reports=self.reports, backups=self.backups,
                         patcher=self.patcher, accepted_file=self.accepted, ask=ask,
                         suite=suite or (lambda root: (set(), "")),
                         patcher_tests=patcher_tests or (lambda: (set(), "")), tell=None, marker=self.marker,
                         apply=True)

    def patch_entry(self):
        (self.patcher / "patches.json").write_text(json.dumps(
            [{"addon": "Cf", "file": "a.lua", "old": HOOK, "new": FIXED}]), encoding="utf-8")

    def hand_edit(self):
        self.hooked.write_text("local x = 1\n" + FIXED + "\n", encoding="utf-8")

    def accept(self):
        self.accepted.write_text(json.dumps([{"addon": "Cf", "file": "a.lua", "text": HOOK,
                                              "reason": "runs only on 1.12"}]), encoding="utf-8")

    def report(self, bundle):
        return (bundle / "report.md").read_text(encoding="utf-8")

    def test_a_patcher_entry_fixes_it_and_the_game_waits_meanwhile(self):
        bundle = self.run_fix(self.patch_entry)
        self.assertEqual(self.seen_marker, [True])
        self.assertFalse(self.marker.exists())
        self.assertIn(FIXED, self.hooked.read_text(encoding="utf-8"))
        self.assertIn("The checks passed", self.report(bundle))
        self.assertIn("Cf/a.lua:2 [method-hook]", (bundle / "findings.md").read_text(encoding="utf-8") +
                      self.report(bundle))
        self.assertIn("CurseForge manages it", self.asked[0])

    def test_a_hand_edit_of_a_curseforge_addon_is_sent_back_then_put_back(self):
        bundle = self.run_fix(self.hand_edit, self.hand_edit)
        self.assertEqual(len(self.asked), 2)
        self.assertIn("edited by hand", self.asked[1])
        self.assertIn(HOOK, self.hooked.read_text(encoding="utf-8"))
        self.assertIn("Put back", self.report(bundle))

    def test_a_retry_that_fixes_it_through_the_patcher_is_kept(self):
        def undo_and_patch():
            self.hooked.write_text(f"local x = 1\n{HOOK}\n", encoding="utf-8")
            self.patch_entry()
        bundle = self.run_fix(self.hand_edit, undo_and_patch)
        self.assertIn(FIXED, self.hooked.read_text(encoding="utf-8"))
        self.assertIn("The checks passed", self.report(bundle))

    def test_an_accepted_finding_with_a_reason_passes(self):
        bundle = self.run_fix(self.accept)
        self.assertIn(HOOK, self.hooked.read_text(encoding="utf-8"))
        self.assertIn("The checks passed", self.report(bundle))

    def test_a_finding_left_alone_is_sent_back_then_everything_is_put_back(self):
        nothing = lambda: None
        bundle = self.run_fix(self.patch_entry_broken, nothing)
        self.assertIn("Still there", self.asked[1])
        self.assertEqual(json.loads((self.patcher / "patches.json").read_text(encoding="utf-8")), [])
        self.assertIn("Put back", self.report(bundle))

    def test_a_patch_that_swaps_the_hook_for_another_is_not_a_fix(self):
        other = 'hooksecurefunc(QuestObjectiveTracker, "Update", Dress)'

        def swap():
            (self.patcher / "patches.json").write_text(json.dumps(
                [{"addon": "Cf", "file": "a.lua", "old": HOOK, "new": other}]), encoding="utf-8")
        bundle = self.run_fix(swap, swap)
        self.assertIn("Still there", self.asked[1])
        self.assertIn(other, self.asked[1])
        self.assertIn("Put back", self.report(bundle))
        self.assertIn(HOOK, self.hooked.read_text(encoding="utf-8"))

    def patch_entry_broken(self):
        (self.patcher / "patches.json").write_text(json.dumps(
            [{"addon": "Cf", "file": "a.lua", "old": "no such text", "new": FIXED}]), encoding="utf-8")

    def test_new_patcher_test_failures_are_sent_back(self):
        calls = []

        def tests():
            calls.append(1)
            return ({"test_old"}, "") if len(calls) == 1 else ({"test_old", "test_new"}, "FAIL: test_new (x)")
        bundle = self.run_fix(self.patch_entry, self.patch_entry, patcher_tests=tests)
        self.assertIn("test_new", self.asked[1])
        self.assertNotIn("test_old", self.asked[1].split("fail now:")[1].split("\n")[0])
        self.assertIn("Put back", self.report(bundle))
        self.assertIn(HOOK, self.hooked.read_text(encoding="utf-8"))
        # What the patcher applied at the first check is not taken for a hand edit at the second.
        self.assertNotIn("edited by hand", self.report(bundle))

    def test_an_own_addon_edit_that_does_not_compile_is_sent_back(self):
        self.job["findings"] = []
        self.job["blocks"] = [{"at": "x", "blamed": "Own", "call": "InteractUnit()", "event": "", "stack": ""}]
        own = self.addons / "Own" / "b.lua"
        bundle = self.run_fix(lambda: own.write_text("local y = (\n", encoding="utf-8"),
                              lambda: own.write_text("local y = 3\n", encoding="utf-8"))
        self.assertIn("no longer compiles", self.asked[1])
        self.assertEqual(own.read_text(encoding="utf-8"), "local y = 3\n")
        self.assertIn("The checks passed", self.report(bundle))

    def test_no_answer_puts_everything_back(self):
        def half_then_fail():
            self.patch_entry()
            raise guard.patch_day.NoAnswer("timed out")
        bundle = self.run_fix(half_then_fail)
        self.assertEqual(json.loads((self.patcher / "patches.json").read_text(encoding="utf-8")), [])
        self.assertIn("could not look at it", self.report(bundle))
        self.assertFalse(self.marker.exists())



class Report(Fix):
    """--fix without --apply (the default since 2026-10-20): Claude reads, nothing changes, the game does not wait."""

    def report_run(self, step):
        def ask(bundle, dirs, prompt):
            self.seen_marker.append(self.marker.exists())
            self.asked.append(prompt)
            step()
            return "SUMMARY: AmmoKeeper hooks the tracker\n\n## Suggested fix\n\nA PATCHES entry"

        return guard.fix(self.job, addons=self.addons, managed={"Cf"}, reports=self.reports, backups=self.backups,
                         patcher=self.patcher, accepted_file=self.accepted, ask=ask, tell=None, marker=self.marker)

    def test_it_reports_and_changes_nothing_and_the_game_does_not_wait(self):
        bundle = self.report_run(lambda: None)
        self.assertEqual(self.seen_marker, [False])
        self.assertIn("change nothing", self.asked[0])
        self.assertIn(HOOK, self.hooked.read_text(encoding="utf-8"))
        self.assertEqual(json.loads((self.patcher / "patches.json").read_text(encoding="utf-8")), [])
        report = self.report(bundle)
        self.assertIn("Suggested fix", report)
        self.assertIn("only reports", report)
        self.assertIn("Cf/a.lua:2 [method-hook]", report)

    def test_an_edit_made_anyway_is_put_back(self):
        bundle = self.report_run(self.hand_edit)
        self.assertIn(HOOK, self.hooked.read_text(encoding="utf-8"))
        self.assertIn("put back", self.report(bundle))

    def test_no_answer_still_reports(self):
        def fail():
            raise guard.patch_day.NoAnswer("Claude could not be run")
        bundle = self.report_run(fail)
        self.assertIn("could not look at it", self.report(bundle))

    def test_the_cli_gets_no_edit_tools(self):
        with mock.patch.object(guard.patch_day, "ask_claude", return_value="x") as ask:
            guard.read_only_ask(self.reports, [], "")
        self.assertIs(ask.call_args.kwargs["edits"], False)


if __name__ == "__main__":
    unittest.main()

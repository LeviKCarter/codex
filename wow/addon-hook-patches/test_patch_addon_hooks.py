"""python -m unittest wow/addon-hook-patches/test_patch_addon_hooks.py

The first class runs the patcher on made-up addons in a temp folder. The second copies the installed MapUtils and
DungeonJourney (WOW_ADDONS, or the beta client's AddOns folder) into a temp folder and patches the copy; it is
skipped where they are not installed, and needs lupa (Lua 5.1) for the Lua checks. Nothing installed is changed.
"""

import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import patch_addon_hooks as job

INSTALLED = Path(os.environ.get("WOW_ADDONS", job.DEFAULT_ADDONS))
HARNESS = Path(__file__).parent / "mapframe_harness.lua"

OLD = 'hooksecurefunc(Frame, "Show", Go)\n'
NEW = 'Frame:HookScript("OnShow", Go) -- Forever patch\n'
SAMPLE = {"Sample": {"a.lua": [("show", OLD, NEW), ("second", "two()\n", "two() -- Forever patch\n")]}}


class Mechanics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addons = Path(self.tmp.name) / "_classic_beta_" / "Interface" / "AddOns"
        self.file = self.addons / "Sample" / "a.lua"
        self.file.parent.mkdir(parents=True)
        (self.addons / "Sample" / "Sample.toc").write_text("## Interface: 16001\n## Version: 1.2.3\n", encoding="utf-8")
        self.original = ("local x = 1\r\n" + OLD.replace("\n", "\r\n") + "two()\r\n").encode("utf-8")
        self.file.write_bytes(self.original)
        self.backups = Path(self.tmp.name) / "_classic_beta_" / "hook-patch-backups"

    def tearDown(self):
        self.tmp.cleanup()

    def test_patches_keeps_line_ends_and_the_original(self):
        code, lines = job.run(self.addons, patches=SAMPLE)
        self.assertEqual(code, 0)
        self.assertIn("Sample 1.2.3 a.lua: patched 2 (show; second)", lines)
        self.assertEqual(self.file.read_bytes(),
                         ("local x = 1\r\n" + NEW.replace("\n", "\r\n") + "two() -- Forever patch\r\n").encode("utf-8"))
        self.assertEqual((self.backups / "Sample-1.2.3" / "a.lua").read_bytes(), self.original)

    def test_second_run_changes_nothing(self):
        job.run(self.addons, patches=SAMPLE)
        patched, stamp = self.file.read_bytes(), self.file.stat().st_mtime_ns
        code, lines = job.run(self.addons, patches=SAMPLE)
        self.assertEqual((code, lines), (0, ["Sample 1.2.3 a.lua: already patched"]))
        self.assertEqual((self.file.read_bytes(), self.file.stat().st_mtime_ns), (patched, stamp))

    def test_an_update_puts_the_hook_back_and_the_next_run_takes_it_out(self):
        job.run(self.addons, patches=SAMPLE)
        self.file.write_bytes(self.original)
        code, lines = job.run(self.addons, patches=SAMPLE)
        self.assertEqual(code, 0)
        self.assertIn(b"Forever patch", self.file.read_bytes())
        self.assertEqual((self.backups / "Sample-1.2.3" / "a.lua").read_bytes(), self.original)

    def test_a_changed_addon_is_left_alone_and_reported_once(self):
        changed = b"local x = 1\nhooksecurefunc(Frame, \"Show\", GoElsewhere)\ntwo()\n"
        self.file.write_bytes(changed)
        code, lines = job.run(self.addons, patches=SAMPLE)
        self.assertEqual(code, 2)
        self.assertEqual(lines, ["Sample 1.2.3 a.lua: NOT PATCHED, the addon changed here: show"])
        self.assertEqual(self.file.read_bytes(), changed, "one patch fit, but a file is patched whole or not at all")
        self.assertEqual(job.run(self.addons, patches=SAMPLE)[0], 0, "the same file is not reported twice")
        self.file.write_bytes(changed + b"-- another update\n")
        self.assertEqual(job.run(self.addons, patches=SAMPLE)[0], 2, "a new version of the file is reported again")

    def test_check_writes_nothing(self):
        code, lines = job.run(self.addons, check=True, patches=SAMPLE)
        self.assertEqual((code, lines), (0, ["Sample 1.2.3 a.lua: would patch 2 (show; second)"]))
        self.assertEqual(self.file.read_bytes(), self.original)
        self.assertFalse(self.backups.exists())

    def test_an_addon_that_is_not_installed_is_no_failure(self):
        code, lines = job.run(self.addons, patches={"Gone": {"a.lua": [("show", OLD, NEW)]}})
        self.assertEqual((code, lines), (0, ["Gone: not installed"]))

    def test_a_retired_patch_is_taken_out_and_the_addon_is_as_it_came(self):
        job.run(self.addons, patches=SAMPLE)
        code, lines = job.run(self.addons, patches={}, retired=SAMPLE)
        self.assertEqual((code, lines), (0, ["Sample 1.2.3 a.lua: took out 2 (show; second)"]))
        self.assertEqual(self.file.read_bytes(), self.original)
        stamp = self.file.stat().st_mtime_ns
        self.assertEqual(job.run(self.addons, patches={}, retired=SAMPLE), (0, []))
        self.assertEqual(self.file.stat().st_mtime_ns, stamp, "an addon without the patch is not rewritten")

    def test_check_takes_nothing_out(self):
        job.run(self.addons, patches=SAMPLE)
        patched = self.file.read_bytes()
        code, lines = job.run(self.addons, check=True, patches={}, retired=SAMPLE)
        self.assertEqual((code, lines), (0, ["Sample 1.2.3 a.lua: would take out 2 (show; second)"]))
        self.assertEqual(self.file.read_bytes(), patched)

    def test_no_file_is_both_patched_and_retired(self):
        def files(table):
            return {(addon, name) for addon, names in table.items() for name in names}
        self.assertFalse(files(job.PATCHES) & files(job.RETIRED))

    def test_every_patch_carries_the_mark_and_differs_from_what_it_replaces(self):
        for addon, files in {**job.PATCHES, **job.RETIRED}.items():
            for name, patches in files.items():
                for what, old, new in patches:
                    self.assertIn(job.MARK, new, f"{addon}/{name}: {what}")
                    self.assertNotIn(new, old, f"{addon}/{name}: {what}")


# The two small map watchers: what each puts in place of its hook, run on a mocked map. `calls` counts how
# often the addon's own callback ran.
WATCHER_ENV = """
calls = 0
local function Count() calls = calls + 1 end
local onUpdate
WorldMapFrame = { mapID = 1, alpha = 1 }
function WorldMapFrame:GetMapID() return self.mapID end
function WorldMapFrame:GetAlpha() return self.alpha end
function CreateFrame() return { SetScript = function(_, _, fn) onUpdate = fn end } end
function Frames(count) for _ = 1, count do onUpdate() end end
local MapHUDChanged = Count
local button, lib, map = { Refresh = Count }, { SetPoints = function() end }, WorldMapFrame
"""
WATCHERS = [("Questie", "Libs/Krowi_WorldMapButtons/Krowi_WorldMapButtons.lua", "mapID", 2),
            ("QuestieForeverGamepad", "TrackerBridge.lua", "mapID", 2)]


class Watchers(unittest.TestCase):
    def play(self, snippet, field, value):
        from lupa.lua51 import LuaRuntime
        lua = LuaRuntime()
        lua.execute(WATCHER_ENV + snippet)
        counts = []
        for change in (None, None, value, None):
            if change is not None:
                lua.execute(f"WorldMapFrame.{field} = {change}")
            lua.execute("Frames(10)")
            counts.append(lua.globals().calls)
        return counts

    def test_each_runs_its_callback_once_per_change_and_not_in_between(self):
        for addon, name, field, value in WATCHERS:
            (_, _, new), = job.PATCHES[addon][name]
            self.assertEqual(self.play(new, field, value), [1, 1, 2, 2], f"{addon}/{name}")

    def test_a_watcher_that_forgets_what_it_saw_is_caught(self):
        for addon, name, field, value in WATCHERS:
            (_, _, new), = job.PATCHES[addon][name]
            broken = re.sub(r"\n\s*seen\w+ ?= ?\w+;?\n", "\n", new)
            self.assertNotEqual(broken, new)
            self.assertNotEqual(self.play(broken, field, value), [1, 1, 2, 2], f"{addon}/{name}")


CHARACTER_ENV = """
shows, hides = 0, 0
local onUpdate
CharacterFrame = { shown = false }
function CharacterFrame:IsShown() return self.shown end
function CharacterFrame:HookScript() error("hooked the character frame") end
function CreateFrame() return { SetScript = function(_, _, fn) onUpdate = fn end } end
function Frames(count) for _ = 1, count do onUpdate() end end
local function Callback(set, action)
\treturn function() if action == 'Show' then shows = shows + 1 else hides = hides + 1 end end
end
"""


class BagBrotherPanels(unittest.TestCase):
    """BagBrother's script hooks on Blizzard panels: no hook is left, and the character frame watcher fires its
    show and hide callbacks once per open and once per close."""

    def setUp(self):
        self.patches = {name: patches for name, patches in job.PATCHES["BagBrother"].items()}

    def play(self, snippet):
        from lupa.lua51 import LuaRuntime
        lua = LuaRuntime()
        lua.execute(CHARACTER_ENV + snippet)
        seen = []
        for shown in (None, True, None, False, None):
            if shown is not None:
                lua.execute(f"CharacterFrame.shown = {str(shown).lower()}")
            lua.execute("Frames(10)")
            seen.append((lua.globals().shows, lua.globals().hides))
        return seen

    def test_no_script_hook_on_a_blizzard_panel_is_left(self):
        for name in ("core/core.lua", "core/features/displayEvents.lua"):
            (_, _, new), = self.patches[name]
            self.assertNotIn("HookScript", new, name)

    def test_the_character_frame_watcher_follows_each_open_and_close_once(self):
        (_, _, new), = self.patches["core/features/displayEvents.lua"]
        self.assertEqual(self.play(new), [(0, 0), (1, 0), (1, 0), (1, 1), (1, 1)])

    def test_a_watcher_that_forgets_what_it_saw_is_caught(self):
        (_, _, new), = self.patches["core/features/displayEvents.lua"]
        broken = re.sub(r"\n\s*seenShown = shown\n", "\n", new)
        self.assertNotEqual(broken, new)
        self.assertNotEqual(self.play(broken), [(0, 0), (1, 0), (1, 0), (1, 1), (1, 1)])

    def test_the_settings_patch_leaves_no_config_load_in_settings_show(self):
        (_, old, new), = self.patches["core/core.lua"]
        self.assertIn("LoadAddOn", old)
        self.assertNotIn("LoadAddOn(", new)


# A hook on a frame's own method: hooksecurefunc(<not a string>, ...), also through pcall.
METHOD_HOOK = re.compile(r"hooksecurefunc\s*[(,]\s*(?!\")[\w.\[\]\"]+\s*,\s*[\w\"]")
# Method hooks that never run on Forever: Spoken_Quests' shim and hooks inside its 1.12 / 2.4 blocks
# (`if Version.IsLegacyVanilla`, `if Version.IsLegacyVanilla or Version.IsLegacyBurningCrusade`), and the
# hook on its own Addon object.
LEGACY_ONLY = {
    "Spoken_Quests/Compatibility.lua": (
        "function hooksecurefunc(table, name, hook)",
        "hooksecurefunc(GameTooltip, \"SetOwner\", function(self, owner, anchor)",
        "hooksecurefunc(Addon, \"OnInitialize\", function()",
    ),
}


@unittest.skipUnless((INSTALLED / "MapUtils").is_dir(), f"MapUtils is not installed in {INSTALLED}")
class Installed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addons = Path(cls.tmp.name) / "_classic_beta_" / "Interface" / "AddOns"
        for addon in job.PATCHES:
            if (INSTALLED / addon).is_dir():
                shutil.copytree(INSTALLED / addon, cls.addons / addon)
        # The installed copy may be patched already: put the kept originals back first.
        kept = INSTALLED.parent.parent / "hook-patch-backups"
        for addon, files in job.PATCHES.items():
            version = job.addon_version(cls.addons / addon) if (cls.addons / addon).is_dir() else ""
            for name in files:
                if (kept / f"{addon}-{version}" / name).is_file():
                    shutil.copyfile(kept / f"{addon}-{version}" / name, cls.addons / addon / name)
        cls.before = {name: (cls.addons / "MapUtils" / name).read_text(encoding="utf-8") for name in job.PATCHES["MapUtils"]}
        cls.code, cls.lines = job.run(cls.addons)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def text(self, addon, name):
        return (self.addons / addon / name).read_text(encoding="utf-8")

    def test_every_file_fits_its_patches(self):
        self.assertEqual(self.code, 0, "\n".join(self.lines))
        self.assertFalse([line for line in self.lines if ": patched " not in line], "\n".join(self.lines))

    def test_no_hook_on_a_frame_method_is_left_in_a_patched_file(self):
        for addon, files in job.PATCHES.items():
            for name in files:
                if (self.addons / addon / name).is_file():
                    self.assertTrue(METHOD_HOOK.search(self.before[name]) if addon == "MapUtils" else True)
                    left = [line.strip() for line in self.text(addon, name).splitlines()
                            if METHOD_HOOK.search(line.split("--")[0])
                            and line.strip() not in LEGACY_ONLY.get(f"{addon}/{name}", ())]
                    self.assertEqual(left, [], f"{addon}/{name}")

    def test_patched_files_are_still_lua(self):
        from lupa.lua51 import LuaRuntime
        load = LuaRuntime().eval("function(src, name) local fn, err = loadstring(src, name) return err end")
        for addon, files in job.PATCHES.items():
            for name in files:
                if name.endswith(".lua") and (self.addons / addon / name).is_file():
                    self.assertIsNone(load(self.text(addon, name), f"@{name}"), f"{addon}/{name}")

    def harness(self, source, hooked_call_fails):
        from lupa.lua51 import LuaRuntime
        lua = LuaRuntime()
        lua.globals().SRC, lua.globals().HOOKED_CALL_FAILS = source.replace("\r\n", "\n"), hooked_call_fails
        return lua.execute(HARNESS.read_text(encoding="utf-8"))

    def test_the_map_lands_where_blizzard_put_it_scaled(self):
        patched = self.text("MapUtils", "mapframe.lua")
        self.assertEqual(self.harness(patched, True), "")
        self.assertEqual(self.harness(patched, False), "")

    def test_the_unpatched_file_does_the_same_until_a_hooked_call_fails(self):
        original = self.before["mapframe.lua"]
        self.assertEqual(self.harness(original, False), "", "the harness and the original addon disagree")
        self.assertIn("attempt to call a nil value", self.harness(original, True))

    def test_a_patch_that_forgets_its_own_placement_is_caught(self):
        patched = self.text("MapUtils", "mapframe.lua").replace("\r\n", "\n")
        anchor = "\tUpdateGrip()\n\tRememberPlacement()\nend\n"
        self.assertEqual(patched.count(anchor), 1)
        self.assertNotEqual(self.harness(patched.replace(anchor, "\tUpdateGrip()\nend\n"), True), "")

    def test_a_patch_that_never_reads_the_map_is_caught(self):
        patched = self.text("MapUtils", "mapframe.lua").replace("\r\n", "\n")
        anchor = '\tCreateFrame("FRAME", nil, frame):SetScript("OnUpdate", WatchBlizzard)\n'
        self.assertEqual(patched.count(anchor), 1)
        self.assertNotEqual(self.harness(patched.replace(anchor, ""), True), "")


BAG_FILE = "core/features/uiOverrides.lua"


@unittest.skipUnless((INSTALLED / "BagBrother" / BAG_FILE).is_file(), f"BagBrother is not installed in {INSTALLED}")
class InstalledBags(unittest.TestCase):
    """BagBrother's bag overrides, as installed (or as kept, once patched) and with the patches in."""

    @classmethod
    def setUpClass(cls):
        kept = INSTALLED.parent.parent / "hook-patch-backups" / f"BagBrother-{job.addon_version(INSTALLED / 'BagBrother')}" / BAG_FILE
        source = kept if kept.is_file() else INSTALLED / "BagBrother" / BAG_FILE
        cls.original = source.read_bytes().decode("utf-8").replace("\r\n", "\n")
        cls.patched, cls.done, cls.misfits = job.plan(cls.original, job.PATCHES["BagBrother"][BAG_FILE])

    def harness(self, source, hooked_call_fails):
        from lupa.lua51 import LuaRuntime
        lua = LuaRuntime()
        lua.globals().SRC, lua.globals().HOOKED_CALL_FAILS = source, hooked_call_fails
        return lua.execute((Path(__file__).parent / "bag_harness.lua").read_text(encoding="utf-8"))

    def test_both_patches_fit(self):
        self.assertEqual((len(self.done), self.misfits), (2, []))

    def test_bags_and_the_money_row_end_up_where_bagbrother_puts_them(self):
        self.assertEqual(self.harness(self.patched, True), "")
        self.assertEqual(self.harness(self.patched, False), "")

    def test_the_unpatched_file_does_the_same_until_a_hooked_call_fails(self):
        self.assertEqual(self.harness(self.original, False), "", "the harness and the original addon disagree")
        self.assertIn("attempt to call a nil value", self.harness(self.original, True))

    def mutant(self, old, new):
        self.assertEqual(self.patched.count(old), 1, old)
        return self.harness(self.patched.replace(old, new), True)

    def test_a_patch_that_misses_the_same_bag_opened_again_is_caught(self):
        self.assertNotEqual(self.mutant("if bag ~= seenBag[i] or (shown and not seenShown[i]) then", "if bag ~= seenBag[i] then"), "")

    def test_a_patch_that_moves_frames_before_the_game_opens_a_bag_is_caught(self):
        self.assertNotEqual(self.mutant("\t\tseenBag[i], seenShown[i] = frame:GetID(), frame:IsShown()\n", ""), "")

    def test_a_patch_that_places_the_money_row_every_frame_is_caught(self):
        self.assertNotEqual(self.mutant("math.abs(BackpackTokenFrame:GetWidth() - width) < 0.5 then return end", "false then return end"), "")

    def test_a_patch_that_never_places_the_money_row_is_caught(self):
        self.assertNotEqual(self.mutant("\t\t\t\tBackpackTokenFrame:ClearAllPoints()\n\t\t\t\tBackpackTokenFrame:SetWidth(width)\n", ""), "")


SKY = "SkyborneLeyLineConvergenceMarker"
SKY_KEPT = INSTALLED.parent.parent / "hook-patch-backups" / f"{SKY}-0.4.0"


@unittest.skipUnless((SKY_KEPT / f"{SKY}.lua").is_file(), f"no kept {SKY} 0.4.0 in {SKY_KEPT.parent}")
class Skyborne(unittest.TestCase):
    """The ley line marker 0.4.0 as it came, with the patches in, run on a mocked map (skyborne/test_overlay.py).
    A file the patcher has not rewritten yet is not kept, so it is read as installed."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(__file__).parent / "skyborne"))
        import test_overlay
        cls.overlay = test_overlay
        cls.results = {}
        for name in job.PATCHES[SKY]:
            source = SKY_KEPT / name if (SKY_KEPT / name).is_file() else INSTALLED / SKY / name
            original = source.read_bytes().decode("utf-8").replace("\r\n", "\n")
            if name.endswith(".toc"):
                assert re.search(r"^## Version: 0\.4\.0$", original, re.M), f"{source} is not 0.4.0"
            cls.results[name] = (original, *job.plan(original, job.PATCHES[SKY][name]))

    def test_every_patch_fits_0_4_0(self):
        for name, (_, _, done, misfits) in self.results.items():
            self.assertEqual(misfits, [], name)
            self.assertEqual(len(done), len(job.PATCHES[SKY][name]), name)

    def test_the_patched_addon_draws_its_pins_without_touching_the_map(self):
        self.overlay.run(src=self.results[f"{SKY}.lua"][1])

    def test_the_original_uses_the_map(self):
        with self.assertRaisesRegex(self.overlay.lupa.LuaError, "map method used: AddDataProvider"):
            self.overlay.run(src=self.results[f"{SKY}.lua"][0])

    def test_the_toc_no_longer_loads_the_pin_template(self):
        toc = self.results[f"{SKY}.toc"][1]
        self.assertNotIn("\nPins.xml", toc)
        self.assertIn("\nComm.lua\nScan.lua\n# Forever patch: Pins.xml not loaded", toc)


SPQ_OPTIONS = "Options.lua"


def ace_opens(source):
    """The functions of Spoken_Quests' Options.lua that call AceConfigDialog:Open (top level = the file itself)."""
    found, current = [], "top level"
    for line in source.splitlines():
        name = re.match(r"\s*function\s+([\w.:]+)\s*\(", line)
        if name:
            current = name.group(1)
        if "AceConfigDialog:Open(" in line.split("--")[0]:
            found.append(current)
    return found


@unittest.skipUnless((INSTALLED / "Spoken_Quests" / SPQ_OPTIONS).is_file(), f"Spoken_Quests is not installed in {INSTALLED}")
class InstalledSpokenQuests(unittest.TestCase):
    """Spoken_Quests' options, as installed (or as kept, once patched) and with the patch in."""

    @classmethod
    def setUpClass(cls):
        kept = (INSTALLED.parent.parent / "hook-patch-backups"
                / f"Spoken_Quests-{job.addon_version(INSTALLED / 'Spoken_Quests')}" / SPQ_OPTIONS)
        source = kept if kept.is_file() else INSTALLED / "Spoken_Quests" / SPQ_OPTIONS
        cls.original = source.read_bytes().decode("utf-8").replace("\r\n", "\n")
        cls.patched, cls.done, cls.misfits = job.plan(cls.original, job.PATCHES["Spoken_Quests"][SPQ_OPTIONS])

    def test_the_patch_fits(self):
        self.assertEqual((len(self.done), self.misfits), (1, []))

    def test_the_window_is_filled_only_when_the_player_opens_it(self):
        self.assertEqual(ace_opens(self.patched), ["Options:OpenConfigWindow"])

    def test_the_original_fills_it_at_login(self):
        self.assertEqual(ace_opens(self.original), ["Options:Initialize", "Options:OpenConfigWindow"])

    def test_the_patched_file_is_still_lua(self):
        from lupa.lua51 import LuaRuntime
        load = LuaRuntime().eval("function(src, name) local fn, err = loadstring(src, name) return err end")
        self.assertIsNone(load(self.patched, "@Options.lua"))


SPQ_COMPAT = "Compatibility.lua"
# Spoken_Quests' tracker block (`do local MODULES ... end`) run on a mocked tracker. `dressed` counts the
# blocks bound to a quest, `hooks` the hooks put on a module, `Tick(s)` runs the frames' OnUpdate.
TRACKER_ENV = r"""
dressed, hooks, updates = 0, 0, {}
local function Button()
  local b = {}
  for _, m in ipairs({"SetSize", "SetHitRectInsets", "SetBox", "SetFrameLevel", "SetPoint", "Show", "Hide"}) do
    b[m] = function() end
  end
  b.CreateTexture = function() return {SetPoint = function() end, SetColorTexture = function() end} end
  return b
end
function CreateFrame()
  local f = {RegisterEvent = function() end}
  function f:SetScript(script, fn) if script == "OnUpdate" then table.insert(updates, fn) end end
  return f
end
function hooksecurefunc() hooks = hooks + 1 end
function Tick(seconds) for _, fn in ipairs(updates) do fn(nil, seconds) end end
Spoken = {DressBoxButton = function() end}
Addon = {IsPartOn = function() return true end}
DataModules = {PrepareSound = function() return true end}
Utils = {CreateDetachedFrame = function() return Button() end}
Debug = {Record = function() end}
Enums = {SoundEvent = {QuestAccept = 1}}
C_QuestLog = {GetTitleForQuestID = function() return "Quest" end}
QuestOverlayUI = {BindPlayButton = function() dressed = dressed + 1 end, SetPlayButtonState = function() end}
local function Block(id) return {id = id, GetFrameLevel = function() return 1 end} end
first, second = Block(101), Block(102)
QuestObjectiveTracker = {AddBlock = function() end, usedBlocks = {QuestTemplate = {a = first, b = second}}}
"""


@unittest.skipUnless((INSTALLED / "Spoken_Quests" / SPQ_COMPAT).is_file(), f"Spoken_Quests is not installed in {INSTALLED}")
class InstalledSpokenQuestsTracker(unittest.TestCase):
    """Spoken_Quests' objective tracker Play buttons, as installed (or as kept) and with the patch in."""

    @classmethod
    def setUpClass(cls):
        kept = (INSTALLED.parent.parent / "hook-patch-backups"
                / f"Spoken_Quests-{job.addon_version(INSTALLED / 'Spoken_Quests')}" / SPQ_COMPAT)
        source = kept if kept.is_file() else INSTALLED / "Spoken_Quests" / SPQ_COMPAT
        cls.original = source.read_bytes().decode("utf-8").replace("\r\n", "\n")
        cls.patched, cls.done, cls.misfits = job.plan(cls.original, job.PATCHES["Spoken_Quests"][SPQ_COMPAT])

    @staticmethod
    def block(source):
        start = source.index("do\n    local MODULES")
        return source[start:source.index("\nend\n", start) + 5]

    def play(self, source):
        from lupa.lua51 import LuaRuntime
        lua = LuaRuntime()
        lua.execute(TRACKER_ENV)
        lua.execute(self.block(source))
        g = lua.globals()
        counts = [(g.dressed, g.hooks)]
        lua.execute("Tick(0.1)")
        counts.append((g.dressed, g.hooks))
        lua.execute("Tick(0.2)")
        counts.append((g.dressed, g.hooks))
        lua.execute("Tick(1)")
        counts.append((g.dressed, g.hooks))
        lua.execute("second.id = 103; Tick(1)")
        counts.append((g.dressed, g.hooks))
        return counts

    def test_both_patches_fit(self):
        self.assertEqual((len(self.done), self.misfits), (2, []))

    def test_the_original_hooks_the_tracker(self):
        self.assertEqual(self.play(self.original)[0], (2, 1))

    def test_blocks_are_dressed_without_a_hook_and_again_when_they_show_another_quest(self):
        # At load the sweep dresses both; the first watched pass dresses them once more (it has not seen
        # them yet), then only the block whose quest changed.
        self.assertEqual(self.play(self.patched), [(2, 0), (2, 0), (4, 0), (4, 0), (5, 0)])

    def test_a_watcher_that_forgets_what_it_dressed_is_caught(self):
        broken = self.patched.replace("dressed[block] = block.id\n", "")
        self.assertNotEqual(broken, self.patched)
        self.assertNotEqual(self.play(broken), [(2, 0), (2, 0), (4, 0), (4, 0), (5, 0)])


if __name__ == "__main__":
    unittest.main()

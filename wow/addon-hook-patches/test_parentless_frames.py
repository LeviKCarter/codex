"""python -m unittest wow/addon-hook-patches/test_parentless_frames.py

The parentless_frames patch shadows CreateFrame in one add-on file: a frame asked for with a parent is made with no
parent and then put on it, because Blizzard's SmartNavigation hooks CreateFrame and, for a parent inside an open
panel (the world map), refreshes that panel's controller buttons in the add-on's run (MapUtils, 2026-10-22).
"""

import unittest

import patch_addon_hooks as hooks

MOCK = """
MADE = {}
_G.CreateFrame = function(kind, name, parent, template)
  MADE[#MADE + 1] = { kind = kind, name = name, parent = parent, template = template }
  local f = { kind = kind, name = name }
  function f:SetParent(p) self.parent = p end
  return f
end
Canvas = {}
"""


def entries():
    for addon, files in hooks.PATCHES.items():
        for name, patches in files.items():
            for what, old, new in patches:
                if what == "frames made before they are parented":
                    yield f"{addon}/{name}", old, new


@unittest.skipUnless(__import__("importlib").util.find_spec("lupa"), "needs lupa")
class ParentlessFrames(unittest.TestCase):
    def run_file(self, old, new, body):
        from lupa.lua51 import LuaRuntime
        lua = LuaRuntime()
        lua.execute(MOCK)
        text, done, misfits = hooks.plan(old + body, [("frames made before they are parented", old, new)])
        self.assertEqual(misfits, [])
        lua.execute(text)
        return lua

    def test_every_file_makes_frames_with_no_parent_then_parents_them(self):
        found = list(entries())
        self.assertGreaterEqual(len(found), 4)
        for label, old, new in found:
            with self.subTest(label):
                lua = self.run_file(old, new, 'Pin = CreateFrame("Button", nil, Canvas, "Template")\nLoose = CreateFrame("Frame")\n')
                self.assertIsNone(lua.eval("MADE[1].parent"))
                self.assertEqual(lua.eval("MADE[1].template"), "Template")
                self.assertTrue(lua.eval("Pin.parent == Canvas"))
                self.assertIsNone(lua.eval("Loose.parent"))

    def test_patched_once(self):
        for label, old, new in entries():
            with self.subTest(label):
                text, done, _ = hooks.plan(old + "x = 1\n", [("p", old, new)])
                again, done_again, _ = hooks.plan(text, [("p", old, new)])
                self.assertEqual((done, done_again, again), (["p"], [], text))


if __name__ == "__main__":
    unittest.main()

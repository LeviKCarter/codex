"""python -m unittest wow/addon-hook-patches/gathermate2/test_hbd_pins.py

Runs the patched world map block of GatherMate2's HereBeDragons-Pins (hbd-pins.patched.lua) in Lua 5.1 (lupa) on a
mocked world map, with an icon added the way Pulse Ops Pin adds its Now card star (AddWorldMapIconMap). The icon must
show while the map is open on its zone or continent, follow zoom, go when it is removed or the map closes, and the map
must only be read: no pin pool, data provider or pin of Blizzard's.
"""

import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCHED = (HERE / "hbd-pins.patched.lua").read_text(encoding="utf-8")
ORIGINAL = (HERE / "hbd-pins.original.lua").read_text(encoding="utf-8")

PRELUDE = """
calls = {}
local onUpdates = {}
local function NewFrame(kind, parent)
  local f = { kind = kind, parent = parent, shown = true, scripts = {}, level = 0, scale = 1, points = {} }
  function f:Show() self.shown = true end
  function f:Hide() self.shown = false end
  function f:IsShown() return self.shown end
  function f:SetScript(name, fn) self.scripts[name] = fn; if name == "OnUpdate" then onUpdates[#onUpdates + 1] = self end end
  function f:SetSize() end
  function f:SetFrameLevel(l) self.level = l end
  function f:SetScale(s) self.scale = s end
  function f:ClearAllPoints() self.points = {} end
  function f:SetPoint(...) self.points = { ... } end
  function f:SetParent(p) self.parent = p end
  return f
end
MADE_ON_CANVAS = 0
function CreateFrame(kind, name, parent) if parent ~= nil and parent == Canvas then MADE_ON_CANVAS = MADE_ON_CANVAS + 1 end return NewFrame(kind, parent) end
function Frames(n) for _ = 1, n do for _, f in ipairs(onUpdates) do if f.shown then f.scripts.OnUpdate(f, 0.2) end end end end
UIParent = NewFrame("Frame")

local canvas = NewFrame("Frame")
canvas.width, canvas.height, canvas.zoom = 1000, 600, 1
function canvas:GetWidth() return self.width end
function canvas:GetHeight() return self.height end
function canvas:GetScale() return self.zoom end
function canvas:GetFrameLevel() return 10 end
Canvas = canvas

local READS = { IsShown = true, GetMapID = true, GetCanvas = true, GetPinFrameLevelsManager = true }
local map = { shown = false, mapID = 1429 }
function map.IsShown(self) return self.shown end
function map.GetMapID(self) return self.mapID end
function map.GetCanvas() return canvas end
function map.GetPinFrameLevelsManager() return { GetValidFrameLevel = function() return 2100 end } end
WorldMapFrame = setmetatable({}, {
  __index = function(_, k)
    calls[#calls + 1] = k
    if READS[k] then return function(_, ...) return map[k](map, ...) end end
    return function() error("map method called: " .. k) end
  end,
  __newindex = function(_, k) error("map field written: " .. k) end,
})
function MapState(shown, id) map.shown = shown; map.mapID = id or map.mapID end

Enum = { UIMapType = { Cosmic = 0, World = 1, Continent = 2, Zone = 3, Dungeon = 4, Micro = 5 } }
HBD_PINS_WORLDMAP_SHOW_HIDE, HBD_PINS_WORLDMAP_SHOW_PARENT, HBD_PINS_WORLDMAP_SHOW_CONTINENT, HBD_PINS_WORLDMAP_SHOW_WORLD = 0, 1, 2, 3
local HBD = {
  mapData = { [1415] = { mapType = 2, parent = 947 }, [1429] = { mapType = 3, parent = 1415 }, [1433] = { mapType = 3, parent = 1415 } },
  -- world coordinates are the zone's own here; the continent shows them at half
  GetZoneCoordinatesFromWorldInstance = function(_, x, y, _, uiMapID)
    if uiMapID == 1415 then return x / 2, y / 2 end
    return x, y
  end,
  GetAzerothWorldMapCoordinatesFromWorld = function(_, x, y) return x, y end,
}
local pins = {}
local worldmapPins, worldmapPinRegistry = {}, { PulseOpsPin = {} }
local worldmapProvider = {}
local worldmapProviderPin = {}
local worldmapPinsPool = {}
Provider = worldmapProvider
function AddIcon(icon, uiMapID, x, y, show)
  worldmapPinRegistry.PulseOpsPin[icon] = true
  worldmapPins[icon] = { instanceID = 0, x = x, y = y, uiMapID = uiMapID, worldMapShowFlag = show or 0 }
  worldmapProvider:HandlePin(icon, worldmapPins[icon])
end
function RemoveIcon(icon)
  worldmapPinRegistry.PulseOpsPin[icon] = nil
  worldmapPins[icon] = nil
  worldmapProvider:RemovePinByIcon(icon)
end
Star = NewFrame("Frame")
Star:Hide()
"""


def lua_with(block):
    from lupa.lua51 import LuaRuntime
    lua = LuaRuntime()
    lua.execute(PRELUDE + block)
    return lua


def star_on_map(lua):
    return lua.eval("Star.shown and Star.parent ~= UIParent and Star.parent.shown")


@unittest.skipUnless(__import__("importlib").util.find_spec("lupa"), "needs lupa")
class HereBeDragonsPins(unittest.TestCase):
    def setUp(self):
        self.lua = lua_with(PATCHED)

    def test_the_star_follows_the_map(self):
        lua = self.lua
        lua.execute("AddIcon(Star, 1429, 0.4, 0.6, 2) Frames(3)")
        self.assertFalse(star_on_map(lua))  # map closed
        lua.execute("MapState(true) Frames(3)")
        self.assertTrue(star_on_map(lua))
        self.assertEqual(lua.eval("Star.parent.points[4]"), 400)
        lua.execute("MapState(true, 1433) Frames(3)")  # another zone
        self.assertFalse(star_on_map(lua))
        lua.execute("MapState(true, 1415) Frames(3)")  # its continent
        self.assertTrue(star_on_map(lua))
        self.assertEqual(lua.eval("Star.parent.points[4]"), 200)
        lua.execute("MapState(false) Frames(3)")
        self.assertFalse(star_on_map(lua))

    def test_added_while_open_and_removed(self):
        lua = self.lua
        lua.execute("MapState(true) Frames(3) AddIcon(Star, 1429, 0.4, 0.6, 2)")
        self.assertTrue(star_on_map(lua))
        lua.execute("RemoveIcon(Star)")
        self.assertFalse(star_on_map(lua))
        lua.execute("Frames(3) MapState(true, 1415) Frames(3)")
        self.assertFalse(star_on_map(lua))

    def test_zoom_keeps_the_on_screen_size(self):
        lua = self.lua
        lua.execute("AddIcon(Star, 1429, 0.4, 0.6, 2) MapState(true) Frames(3) Canvas.zoom = 2 Frames(3)")
        self.assertEqual(lua.eval("Star.parent.scale"), 0.5)
        self.assertEqual(lua.eval("Star.parent.points[4]"), 0.4 * 1000 * 2)

    def test_no_frame_is_made_on_the_canvas(self):
        # SmartNavigation hooks CreateFrame: a frame made with the open map's canvas as its parent refreshes the map's
        # controller panel in this add-on's run. Pins are made with no parent and then put on the canvas.
        lua = self.lua
        lua.execute("AddIcon(Star, 1429, 0.4, 0.6, 2) MapState(true) Frames(3) MapState(true, 1415) Frames(3)")
        self.assertTrue(star_on_map(lua))
        self.assertEqual(lua.eval("MADE_ON_CANVAS"), 0)

    def test_the_map_is_only_read(self):
        lua = self.lua
        lua.execute("AddIcon(Star, 1429, 0.4, 0.6, 2) MapState(true) Frames(3) MapState(true, 1415) Frames(3)"
                    " RemoveIcon(Star) MapState(false) Frames(3)")
        called = set(lua.eval("calls").values())
        self.assertLessEqual(called, {"IsShown", "GetMapID", "GetCanvas", "GetPinFrameLevelsManager"})

    def test_the_original_uses_the_map(self):
        with self.assertRaises(Exception):
            lua_with(ORIGINAL.replace("Mixin(frame, worldmapProviderPin)", "frame"))


if __name__ == "__main__":
    unittest.main()

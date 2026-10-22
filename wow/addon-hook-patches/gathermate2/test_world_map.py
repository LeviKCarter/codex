"""python -m unittest wow/addon-hook-patches/gathermate2/test_world_map.py

Runs GatherMate2's patched world map block (world-map.patched.lua) in Lua 5.1 (lupa) on a mocked world map and
plays the map opening, changing zone, zooming and closing. The pins must follow the map while it is open, honor
worldMapIconsInteractive, redraw on UpdateWorldMap, and never call anything on the map but reads.
"""

import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCHED = (HERE / "world-map.patched.lua").read_text(encoding="utf-8")
ORIGINAL = (HERE / "world-map.original.lua").read_text(encoding="utf-8")

PRELUDE = """
calls, frames = {}, {}
local onUpdates = {}
local function NewFrame(kind, parent)
  local f = { kind = kind, parent = parent, shown = true, scripts = {}, mouse = nil, level = 0, scale = 1, points = {} }
  function f:Show() self.shown = true end
  function f:Hide() self.shown = false end
  function f:IsShown() return self.shown end
  function f:SetScript(name, fn) self.scripts[name] = fn; if name == "OnUpdate" then onUpdates[#onUpdates + 1] = self end end
  function f:CreateTexture() return { SetAllPoints = function() end, SetTexture = function(t, v) t.file = v end,
    SetTexCoord = function() end, SetVertexColor = function() end } end
  function f:RegisterForClicks() end
  function f:SetSize(w, h) self.w, self.h = w, h end
  function f:SetAlpha() end
  function f:EnableMouse(on) self.mouse = on end
  function f:SetFrameLevel(l) self.level = l end
  function f:SetScale(s) self.scale = s end
  function f:ClearAllPoints() self.points = {} end
  function f:SetPoint(...) self.points = { ... } end
  frames[#frames + 1] = f
  return f
end
function CreateFrame(kind, name, parent) return NewFrame(kind, parent) end
function Frames(n) for _ = 1, n do for _, f in ipairs(onUpdates) do if f.shown then f.scripts.OnUpdate(f, 0.2) end end end end

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
  __newindex = function(_, k, v) if k == "shown" or k == "mapID" then map[k] = v else error("map field written: " .. k) end end,
})
function MapState(shown, id) map.shown = shown; map.mapID = id or map.mapID end

GameTooltip = { GetOwner = function() return nil end, Hide = function() end }
local nodes = { [1429] = { [101] = 1, [102] = 2, [103] = 1 }, [1411] = { [201] = 3 } }
local GatherMate = {
  db_types = { "Herb Gathering" }, Visible = { ["Herb Gathering"] = true }, phasing = {}, nodeIDReplacementMap = {},
  DecodeLoc = function(_, coord) return (coord % 100) / 10, 0.5 end,
  GetNameForNode = function(_, _, id) return "Node " .. id end,
  GetNodesForZone = function(_, zone) return pairs(nodes[zone] or {}) end,
}
local Display = { UpdateVisibility = function() end }
DisplayModule = Display
db = { scale = 1, alpha = 1, showWorldMap = true, worldMapIconsInteractive = false }
local db = db
local nodeTextures = setmetatable({}, { __index = function() return {} end })
local worldmapPins = {}
WorldmapPins = worldmapPins
local function showPin() end
local function hidePin() end
local function pinClick() end
"""


def lua_with(block):
    from lupa.lua51 import LuaRuntime
    lua = LuaRuntime()
    lua.execute(PRELUDE + block + "\nfunction Display_UpdateWorldMap() DisplayModule.WorldMapDataProvider:RefreshAllData() end")
    return lua


def shown_pins(lua):
    return lua.eval("(function() local n = 0 for _, p in ipairs(WorldmapPins) do if p.shown then n = n + 1 end end return n end)()")


@unittest.skipUnless(__import__("importlib").util.find_spec("lupa"), "needs lupa")
class WorldMap(unittest.TestCase):
    def setUp(self):
        self.lua = lua_with(PATCHED)
        self.lua.execute("DisplayModule.worldmapWatcher:Show()")

    def test_pins_follow_the_map_opening_changing_zone_and_closing(self):
        lua = self.lua
        lua.execute("Frames(3)")
        self.assertEqual(shown_pins(lua), 0)
        lua.execute("MapState(true) Frames(3)")
        self.assertEqual(shown_pins(lua), 3)
        lua.execute("MapState(true, 1411) Frames(3)")
        self.assertEqual(shown_pins(lua), 1)
        lua.execute("MapState(false) Frames(3)")
        self.assertEqual(shown_pins(lua), 0)

    def test_update_world_map_redraws_while_open(self):
        lua = self.lua
        lua.execute("MapState(true) Frames(3)")
        lua.execute("DisplayModule.worldmapWatcher:Hide() db.showWorldMap = false Display_UpdateWorldMap()")
        self.assertEqual(shown_pins(lua), 0)
        lua.execute("db.showWorldMap = true Display_UpdateWorldMap()")
        self.assertEqual(shown_pins(lua), 3)

    def test_pins_honor_world_map_icons_interactive(self):
        lua = self.lua
        lua.execute("MapState(true) Frames(3)")
        self.assertEqual(lua.eval("WorldmapPins[1].mouse"), False)
        lua.execute("db.worldMapIconsInteractive = true Display_UpdateWorldMap()")
        self.assertEqual(lua.eval("WorldmapPins[1].mouse"), True)

    def test_zoom_keeps_the_on_screen_size(self):
        lua = self.lua
        lua.execute("MapState(true) Frames(3) Canvas.zoom = 2 Frames(3)")
        self.assertEqual(lua.eval("WorldmapPins[1].scale"), 0.5)

    def test_the_map_is_only_read(self):
        lua = self.lua
        lua.execute("MapState(true) Frames(3) MapState(true, 1411) Frames(3) MapState(false) Frames(3)")
        called = set(lua.eval("calls").values())
        self.assertLessEqual(called, {"IsShown", "GetMapID", "GetCanvas", "GetPinFrameLevelsManager"})

    def test_the_original_uses_the_map(self):
        lua = lua_with(ORIGINAL.replace("CreateFromMixins(MapCanvasDataProviderMixin)", "{ GetMap = function() return WorldMapFrame end }")
                       .replace("CreateFromMixins(MapCanvasPinMixin)", "{}"))
        lua.execute("MapState(true)")
        with self.assertRaises(Exception):
            lua.execute("Display_UpdateWorldMap()")


if __name__ == "__main__":
    unittest.main()

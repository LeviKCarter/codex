"""Loads the patched Skyborne marker (0.4.0) against mocked WoW frames and checks the private pin overlay.

The map may only be read: any other use of WorldMapFrame fails the run (registering a data provider or
acquiring pins on it is what tainted the controller bindings). Run: python test_overlay.py [addon .lua]
"""
import io, sys
from lupa import lua51 as lupa

ADDON = sys.argv[1] if len(sys.argv) > 1 else r"D:\Games\World of Warcraft\_classic_beta_\Interface\AddOns\SkyborneLeyLineConvergenceMarker\SkyborneLeyLineConvergenceMarker.lua"
MOCK = r'''
format = string.format
frames = {}
local function Texture()
  local t = {}
  function t:SetAllPoints() end
  function t:SetAtlas(a) self.atlas = a end
  function t:SetDesaturated(d) self.desat = d end
  function t:SetVertexColor(r, g, b) self.color = { r, g, b } end
  function t:SetAlpha(a) self.alpha = a end
  return t
end
local function Frame(parent)
  local f = { shown = true, scripts = {}, parent = parent }
  function f:SetSize(w, h) self.w, self.h = w, h end
  function f:CreateTexture() return Texture() end
  function f:EnableMouse() end
  function f:SetScript(n, fn) self.scripts[n] = fn end
  function f:RegisterEvent() end
  function f:RegisterUnitEvent() end
  function f:SetFrameLevel(l) self.level = l end
  function f:GetFrameLevel() return 1 end
  function f:SetScale(s) self.scale = s end
  function f:ClearAllPoints() self.point = nil end
  function f:SetPoint(p, rel, rp, x, y) self.point = { p, rel, rp, x, y } end
  function f:Show() self.shown = true end
  function f:Hide() self.shown = false end
  function f:IsShown() return self.shown end
  return f
end
function CreateFrame(kind, name, parent) local f = Frame(parent); frames[#frames + 1] = f; return f end
canvas = Frame(); canvasScale = 1
function canvas:GetWidth() return 1000 end
function canvas:GetHeight() return 600 end
function canvas:GetScale() return canvasScale end
mapID = 10
WorldMapFrame = setmetatable({}, {
  __index = function(_, key)
    if key == "IsShown" then return function() return mapShown end end
    if key == "GetMapID" then return function() return mapID end end
    if key == "GetCanvas" then return function() return canvas end end
    -- reading the map's frame levels is allowed; nothing on the manager may be changed
    if key == "GetPinFrameLevelsManager" then return function() return levels end end
    error("map method used: " .. tostring(key))
  end,
  __newindex = function(_, key) error("map field written: " .. tostring(key)) end,
})
mapShown = false
levels = setmetatable({}, {
  __index = function(_, key)
    if key == "GetValidFrameLevel" then return function(_, kind) return kind == "PIN_FRAME_LEVEL_AREA_POI" and 2040 or 2000 end end
    error("frame level manager method used: " .. tostring(key))
  end,
  __newindex = function(_, key) error("frame level manager written: " .. tostring(key)) end,
})
function UnitFactionGroup() return "Alliance" end
function UnitRace() return "Skyborne", "Skyborne" end
function InCombatLockdown() return false end
now = 0
function GetTime() return now end
function GetServerTime() return 100000 end
auraLeft = nil
C_UnitAuras = { GetPlayerAuraBySpellID = function(id)
  if auraLeft and id == 1259691 then return { duration = 900, expirationTime = now + auraLeft } end
end }
C_Timer = { After = function() end }
C_Map = { GetWorldPosFromMapPos = function(_, v) return 0, { x = v.x * 1000, y = v.y * 1000 } end, GetMapInfo = function() return { name = "Zone" } end }
function CreateVector2D(x, y) return { x = x, y = y } end
function CreateFromMixins() return {} end
MapCanvasPinMixin, MapCanvasDataProviderMixin = {}, {}
GameTooltip = { SetOwner = function(t, o) t.owner = o end, GetOwner = function(t) return t.owner end, SetText = function(t, s) t.text = s end,
  AddLine = function(t, s) t.lines[#t.lines + 1] = s end, Show = function(t) t.shown = true end, Hide = function(t) t.shown = false; t.owner = nil end, lines = {} }
SlashCmdList = {}
StaticPopupDialogs = {}
MinimalSliderWithSteppersMixin = { Label = { Right = 1 } }
local any = setmetatable({}, { __index = function() return function() end end })
Settings = setmetatable({ VarType = { Boolean = "boolean", Number = "number" } }, { __index = function() return function() return any end end })
SLLCM_Data = { LeyLines = { [10] = { { 0.25, 0.5 }, { 0.75, 0.1 } }, [11] = { { 0.5, 0.5 } } }, ElementalConvergences = {} }
SkyborneMarkerDB = nil
crowd = {}
ns = { CrowdReports = function(m) return crowd[m] or {} end, CrowdAge = function() return 0 end, CrowdMinutes = function() return 60 end }
function Tick(n) for _ = 1, n or 1 do for _, f in ipairs(frames) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 0.11) end end end end
function Fire(event, ...) for _, f in ipairs(frames) do if f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end end end
function Pins() local t = {}; for _, f in ipairs(frames) do if f.reticlePinsHover and f.shown then t[#t + 1] = f end end; return t end
function Shown() return #Pins() end
'''
SCENARIO = r'''
Fire("ADDON_LOADED", "SkyborneLeyLineConvergenceMarker")
Tick(3); assert(Shown() == 0, "no pins while the map is closed")
mapShown = true; Tick(1)
assert(Shown() == 2, "both known points drawn when the map opens, got " .. Shown())
local pin = Pins()[1]
assert(pin.parent == canvas and pin.point[2] == canvas and pin.point[3] == "TOPLEFT", "pin sits on the canvas")
assert(pin.point[4] == 250 and pin.point[5] == -300, "pin placed at x*width, -y*height")
assert(pin.level == 2040, "pin at the map's area-POI level, above explored areas, got " .. tostring(pin.level))
assert(pin.Icon.alpha == 1 and not pin.Icon.desat, "plain pin with sharing off")
pin.scripts.OnEnter(pin); assert(GameTooltip.shown and GameTooltip.text == "Ley Line", "tooltip on hover")
pin.scripts.OnLeave(pin); assert(not GameTooltip.shown, "tooltip hidden on leave")
canvasScale = 2; Tick(1)
assert(pin.scale == 0.5 and pin.point[4] == 500 and pin.point[5] == -600, "pin keeps its place and size when the map zooms")
canvasScale = 1; Tick(1)
function canvas:GetWidth() return 1200 end; Tick(1)
assert(pin.point[4] == 300, "pin follows a canvas size change")
function canvas:GetWidth() return 1000 end; Tick(1)
mapID = 11; Tick(1); assert(Shown() == 1, "pins follow a map change")
mapID = 12; Tick(1); assert(Shown() == 0, "no pins on a map without data")
mapID = 10; Tick(1); assert(Shown() == 2, "pins reused when coming back")
mapShown = false; Tick(1); assert(Shown() == 0, "pins removed when the map closes")
mapShown = true; Tick(1); assert(Shown() == 2, "pins return when the map reopens")

-- shared sightings: one on a known node (tinted green), one somewhere new (extra pin)
SkyborneMarkerDB.crowd = true
crowd[10] = { { x = 0.25, y = 0.5, t = 99000 }, { x = 0.5, y = 0.9, t = 99000 } }
ns.Provider:RefreshAllData()
assert(Shown() == 3, "a sighting at an unknown spot adds a pin, got " .. Shown())
local tinted, faded = 0, 0
for _, p in ipairs(Pins()) do
  if p.Icon.desat and p.Icon.color[2] == 1 then tinted = tinted + 1 end
  if p.Icon.alpha == 0.4 then faded = faded + 1 end
end
assert(tinted == 2 and faded == 1, "fresh sightings green, unseen node faint")
for _, p in ipairs(Pins()) do
  if p.report and p.x == 0.25 then
    GameTooltip.lines = {}; p.scripts.OnEnter(p)
    assert(GameTooltip.lines[2] and GameTooltip.lines[2]:find("Seen in your phase"), "sighting age in tooltip")
  end
end
crowd[10] = nil; SkyborneMarkerDB.crowd = false; ns.Provider:RefreshAllData()

-- hide while the buff has more than the chosen minutes left
SkyborneMarkerDB.hideMinutes = 5; auraLeft = 600
Fire("UNIT_AURA", "player"); assert(Shown() == 0, "pins hidden while the buff has 10 min left")
auraLeft = 200; Fire("UNIT_AURA", "player"); assert(Shown() == 2, "pins back under 5 min")
'''


def run(mutate=None, src=None):
    lua = lupa.LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    lua.execute("print = function() end")
    if src is None:
        src = io.open(ADDON, encoding="utf-8").read()
    if mutate:
        changed = mutate(src)
        assert changed != src, "mutation did not apply"
        src = changed
    lua.eval("loadstring")(src)("SkyborneLeyLineConvergenceMarker", lua.eval("ns"))
    lua.execute(SCENARIO)


if __name__ == "__main__":
    run()
    print("PASS: all checks")
    mutants = {
        "register with the map again": lambda s: s.replace("Provider = {}", "Provider = {}\nWorldMapFrame:AddDataProvider(Provider)"),
        "no y flip": lambda s: s.replace("-pin.y * canvas:GetHeight()", "pin.y * canvas:GetHeight()"),
        "ignore map change": lambda s: s.replace("if WorldMapFrame:GetMapID() ~= shownMapID then", "if false then"),
        "keep pins when the map closes": lambda s: s.replace("      Provider:RemoveAllData()\n      shownMapID = nil", "      shownMapID = nil"),
        "ignore buff hiding": lambda s: s.replace("  if hidden then return end\n  local canvas", "  local canvas"),
        "drop new-spot sightings": lambda s: s.replace("if not used[i] then AddPin(", "if false then AddPin("),
        "pins just above the canvas": lambda s: s.replace("pin:SetFrameLevel(PinLevel(canvas))", "pin:SetFrameLevel(canvas:GetFrameLevel() + 20)"),
        "ignore canvas size": lambda s: s.replace("if scale ~= shownScale or width ~= shownWidth or height ~= shownHeight then", "if scale ~= shownScale then"),
    }
    failed = False
    for name, m in mutants.items():
        try:
            run(m)
            print("MUTANT SURVIVED:", name)
            failed = True
        except lupa.LuaError as e:
            print("mutant caught (%s): %s" % (name, str(e).splitlines()[0][-60:]))
    sys.exit(1 if failed else 0)

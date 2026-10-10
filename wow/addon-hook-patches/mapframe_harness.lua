-- Runs MapUtils' mapframe.lua (source in SRC) on a mocked world map and plays Blizzard placing
-- the map, with the map scaled by the addon and its "move" option off. Returns the lines
-- of what went wrong; none means the map ended up where it should every time.
--
-- HOOKED_CALL_FAILS models this client: the game's call to a method an addon wrapped with
-- hooksecurefunc throws "attempt to call a nil value".

local SRC, HOOKED_CALL_FAILS = SRC, HOOKED_CALL_FAILS
local problems = {}
local function Problem(text) problems[#problems + 1] = text end

local IN_ADDON = false
local UI_W, UI_H = 1600, 900
local NOT_METHODS = { BorderFrame = true, TitleCanvasSpacerFrame = true, MiniBorderFrame = true, ScrollContainer = true,
	SynchronizeDisplayState = true, TitleContainer = true }
local function noop() end
local created = {}

local function NewFrame()
	local scripts, hooks = {}, {}
	local object = setmetatable({}, { __index = function(_, key) if not NOT_METHODS[key] then return noop end end })
	object.scripts, object.hooks = scripts, hooks
	function object:SetScript(name, fn) scripts[name] = fn end
	function object:GetScript(name) return scripts[name] end
	function object:HookScript(name, fn) hooks[name] = hooks[name] or {}; table.insert(hooks[name], fn) end
	function object:Run(name, ...)
		if scripts[name] then scripts[name](self, ...) end
		for _, fn in ipairs(hooks[name] or {}) do fn(self, ...) end
	end
	created[#created + 1] = object
	return object
end

UIParent = NewFrame()
function UIParent:GetWidth() return UI_W end
function UIParent:GetHeight() return UI_H end
function UIParent:GetEffectiveScale() return 1 end

local map = NewFrame()
local scale, anchor, setPoints, shown = 1, nil, 0, false
function map:GetScale() return scale end
function map:SetScale(value) scale = value end
function map:GetEffectiveScale() return scale end
function map:GetWidth() return 800 end
function map:GetHeight() return 500 end
function map:GetParent() return UIParent end
function map:IsShown() return shown end
function map:ClearAllPoints() anchor = nil end
function map:SetPoint(point, relativeTo, relativePoint, x, y)
	setPoints = setPoints + 1
	anchor = { point, relativeTo, relativePoint, x, y }
end
function map:GetPoint() if anchor then return unpack(anchor) end end
function map:GetLeft() return anchor and anchor[4] end
function map:GetTop()
	if not anchor then return nil end
	return anchor[3] == "BOTTOMLEFT" and anchor[5] or UI_H / scale + anchor[5]
end
WorldMapFrame = map

function hooksecurefunc(target, name, hook)
	if type(target) == "string" then return end
	local original = target[name]
	target[name] = function(...)
		if HOOKED_CALL_FAILS and not IN_ADDON then error("attempt to call a nil value (" .. name .. " is wrapped)", 2) end
		original(...)
		local was = IN_ADDON
		IN_ADDON = true
		hook(...)
		IN_ADDON = was
	end
end

function CreateFrame() return NewFrame() end
function InCombatLockdown() return false end
function GetCursorPosition() return 0, 0 end
function GetTime() return 0 end
max, min, tinsert = math.max, math.min, table.insert
C_Timer = { After = noop }
MAUTTAB = { WORLDMAPSCALEVALUE = 1.5, WORLDMAPMOVE = false }

local fadeOptions
local MapUtils = {}
function MapUtils:CreateSizeGrip() return NewFrame() end
function MapUtils:RaiseSizeGrip() end
function MapUtils:CreateMoveFader(_, options) fadeOptions = options; return { Reset = noop, Debug = noop } end
function MapUtils:RegisterEvent() end
function MapUtils:IsAddOnActive() return false end
function MapUtils:IsForever() return false end
function MapUtils:SV(tab, key, value) tab[key] = value end
function MapUtils:GetConfig(_, default) return default end

-- Everything the addon runs is addon code; what the game does below is not.
local function Addon(fn, ...)
	IN_ADDON = true
	local ok, err = pcall(fn, ...)
	IN_ADDON = false
	if not ok then Problem("addon error: " .. tostring(err)) end
end
local function Game(label, fn, ...)
	local ok, err = pcall(fn, ...)
	if not ok then Problem(label .. ": " .. tostring(err)) end
end

Addon(assert(loadstring(SRC, "@mapframe.lua")), "MapUtils", MapUtils)
for _, object in ipairs(created) do
	if object ~= map and object.scripts.OnEvent then Addon(object.scripts.OnEvent, object, "PLAYER_LOGIN") end
end

local function Frames(count)
	for _ = 1, count do
		for _, object in ipairs(created) do
			if shown and object.scripts.OnUpdate then Addon(object.scripts.OnUpdate, object, 0.016) end
		end
	end
end
local function Near(a, b) return a ~= nil and math.abs(a - b) < 0.001 end
local function Expect(label, x, y, wantScale)
	wantScale = wantScale or 1.5
	if not anchor or not Near(anchor[4], x) or not Near(anchor[5], y) or not Near(scale, wantScale) then
		Problem(("%s: map at %s, %s scale %s, wanted %.3f, %.3f scale %s"):format(label, tostring(anchor and anchor[4]),
			tostring(anchor and anchor[5]), tostring(scale), x, y, tostring(wantScale)))
	end
end
local function Place(x, y) Game("the game places the map", function() map:SetPoint("TOPLEFT", UIParent, "TOPLEFT", x, y) end) end

if fadeOptions and fadeOptions.hookSetAlpha and HOOKED_CALL_FAILS then
	Problem("the fader wraps the map's SetAlpha: attempt to call a nil value when the game fades the map")
end

-- The game opens the map: it places it, then shows it.
Place(16, -116)
shown = true
Addon(map.Run, map, "OnShow")
Frames(1)
Expect("opened", 16 / 1.5, -116 / 1.5)

local before = setPoints
Frames(30)
Expect("thirty frames later", 16 / 1.5, -116 / 1.5)
if setPoints ~= before then Problem("the map was placed " .. (setPoints - before) .. " more times while nothing changed") end

-- The game places it at the same spot again (another panel opened), then somewhere else.
Place(16, -116)
Frames(1)
Expect("placed again at the same spot", 16 / 1.5, -116 / 1.5)
Place(120, -150)
Frames(1)
Expect("moved by the game", 120 / 1.5, -150 / 1.5)
Frames(10)
Expect("ten frames after the move", 120 / 1.5, -150 / 1.5)

-- Closed and opened again at the first spot.
shown = false
Addon(map.Run, map, "OnHide")
Place(16, -116)
shown = true
Addon(map.Run, map, "OnShow")
Frames(2)
Expect("opened again", 16 / 1.5, -116 / 1.5)

-- He changes the map's scale in the addon's settings while it is open.
MAUTTAB.WORLDMAPSCALEVALUE = 1.25
Addon(MapUtils.RefreshWorldMapFrame, MapUtils)
Frames(5)
Expect("scale changed in the settings", 16 / 1.25, -116 / 1.25, 1.25)

return table.concat(problems, "\n")

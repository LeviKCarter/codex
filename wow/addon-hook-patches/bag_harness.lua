-- Runs BagBrother's core/features/uiOverrides.lua (source in SRC) on mocked bag frames and plays
-- the game opening bags and laying out the backpack's money row. Returns the lines of what went
-- wrong; none means every bag frame ended up under the right parent and the money row where
-- BagBrother puts it.
--
-- HOOKED_CALL_FAILS models this client: the game's call to a method an addon wrapped with
-- hooksecurefunc throws "attempt to call a nil value".

local SRC, HOOKED_CALL_FAILS = SRC, HOOKED_CALL_FAILS
local problems = {}
local function Problem(text) problems[#problems + 1] = text end

local IN_ADDON = false
local created = {}

local function NewFrame(name, parent)
	local object = { name = name, parent = parent, shown = true, id = 0, points = {}, width = 0, scripts = {}, setPoints = 0 }
	function object:SetParent(to) self.parent = to end
	function object:GetParent() return self.parent end
	function object:SetID(id) self.id = id end
	function object:GetID() return self.id end
	function object:Show() self.shown = true end
	function object:Hide() self.shown = false end
	function object:IsShown() return self.shown end
	function object:IsVisible() return self.shown and (self.parent == nil or self.parent:IsVisible()) end
	function object:SetAllPoints() end
	function object:SetScale() end
	function object:SetScript(script, fn) self.scripts[script] = fn end
	function object:GetScript(script) return self.scripts[script] end
	function object:ClearAllPoints() self.points = {} end
	function object:SetPoint(point, a, b, c)
		self.setPoints = self.setPoints + 1
		-- (point, x, y) anchors to the parent; (point, frame, relativePoint, x, y) to that frame.
		local anchor = type(a) == "table" and a or self.parent
		for _, existing in ipairs(self.points) do
			if existing[1] == point then existing[2] = anchor return end
		end
		self.points[#self.points + 1] = { point, anchor }
	end
	function object:GetPoint(index) local p = self.points[index] if p then return p[1], p[2] end end
	function object:GetNumPoints() return #self.points end
	function object:SetWidth(width) self.width = width end
	function object:GetWidth() return self.width end
	function object:GetChildren() end
	function object:GetName() return self.name end
	created[#created + 1] = object
	return object
end

UIParent = NewFrame("UIParent")
ContainerFrameContainer = NewFrame("ContainerFrameContainer", UIParent)
NUM_CONTAINER_FRAMES = 3
for i = 1, NUM_CONTAINER_FRAMES do
	local frame = NewFrame("ContainerFrame" .. i, ContainerFrameContainer)
	frame.shown = false
	_G["ContainerFrame" .. i] = frame
end
BackpackTokenFrame = NewFrame("BackpackTokenFrame", ContainerFrame1)
ContainerFrame1.MoneyFrame = NewFrame("MoneyFrame", ContainerFrame1)
local tokenShown = false
-- The game's own layout (Mainline ContainerFrame.lua, UpdateCurrencyFrames).
function ContainerFrame1:UpdateCurrencyFrames()
	local money = self.MoneyFrame
	if tokenShown then
		BackpackTokenFrame:ClearAllPoints()
		BackpackTokenFrame:SetPoint("BOTTOMLEFT", self, "BOTTOMLEFT", 8, 8)
		BackpackTokenFrame:SetPoint("BOTTOMRIGHT", self, "BOTTOMRIGHT", -8, 8)
		money:ClearAllPoints()
		money:SetPoint("BOTTOMRIGHT", BackpackTokenFrame, "TOPRIGHT", 0, 3)
		money:SetPoint("BOTTOMLEFT", BackpackTokenFrame, "TOPLEFT", 0, 3)
	else
		money:ClearAllPoints()
		money:SetPoint("BOTTOMLEFT", self, "BOTTOMLEFT", 8, 8)
		money:SetPoint("BOTTOMRIGHT", self, "BOTTOMRIGHT", -8, 8)
	end
end

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

function CreateFrame(_, name, parent) return NewFrame(name, parent) end
function InCombatLockdown() return false end
function debugstack() return "" end
C_CVar = { SetCVar = function() end, SetCVarBitfield = function() end }

local bagnonHasBags = true
local Overrides = { RegisterEvent = function() end, Delay = function() end, SendSignal = function() end }
local Addon = { NumBags = 4, CurrencyLimit = 3, NewModule = function() return Overrides end }
Addon.Frames = {
	HasBag = function() return bagnonHasBags end,
	IsEnabled = function() return bagnonHasBags end,
}

local function Addon_(fn, ...)
	IN_ADDON = true
	local ok, err = pcall(fn, ...)
	IN_ADDON = false
	if not ok then Problem("addon error: " .. tostring(err)) end
end
local function Game(label, fn)
	local ok, err = pcall(fn)
	if not ok then Problem(label .. ": " .. tostring(err)) end
end
local function Frames(count)
	for _ = 1, count do
		for _, object in ipairs(created) do
			if object.scripts.OnUpdate and object:IsVisible() then Addon_(object.scripts.OnUpdate, object, 0.016) end
		end
	end
end

Addon_(assert(loadstring(SRC, "@uiOverrides.lua")), "BagBrother", Addon)
Addon_(Overrides.OnLoad, Overrides)
Frames(2)
local disabled = Overrides.Disabled
for i = 1, NUM_CONTAINER_FRAMES do
	if _G["ContainerFrame" .. i].parent ~= ContainerFrameContainer then Problem("ContainerFrame" .. i .. " was moved before the game opened any bag") end
end

local function Open(frame, bag) Game("the game opens bag " .. bag, function() frame:SetID(bag) frame:Show() end) end
local function Where(label, frame, parent)
	if frame.parent ~= parent then Problem(label .. ": " .. frame.name .. " is under " .. tostring(frame.parent and frame.parent.name)) end
end

-- Bagnon shows the bags: the game's own bag frames go under the hidden parent.
Open(ContainerFrame2, 1)
Frames(1)
Where("a bag Bagnon shows", ContainerFrame2, disabled)
Open(ContainerFrame3, 2)
Frames(1)
Where("a second bag Bagnon shows", ContainerFrame3, disabled)

-- He switches to the game's own bags; the same bag opens again in the same frame.
ContainerFrame2:Hide()
Frames(1)
bagnonHasBags = false
Open(ContainerFrame2, 1)
Frames(1)
Where("the same bag once Bagnon no longer shows it", ContainerFrame2, ContainerFrameContainer)
Where("a frame the game has not opened again", ContainerFrame3, disabled)

-- The backpack with a watched currency: the game lays the money row on the token row, BagBrother
-- puts it back on the backpack and takes the token row's anchors off.
local function Money(label)
	local money = ContainerFrame1.MoneyFrame
	local ok = #money.points == 2 and money.points[1][2] == ContainerFrame1 and money.points[2][2] == ContainerFrame1
	if not ok or BackpackTokenFrame:GetNumPoints() ~= 0 or BackpackTokenFrame:GetWidth() ~= 150 then
		Problem(("%s: money row on the backpack %s, token row anchors %d, width %s"):format(label, tostring(ok),
			BackpackTokenFrame:GetNumPoints(), tostring(BackpackTokenFrame:GetWidth())))
	end
end
Open(ContainerFrame1, 0)
tokenShown = true
Game("the game lays out the backpack", function() ContainerFrame1:UpdateCurrencyFrames() end)
Frames(1)
Where("the backpack with the game's own bags", ContainerFrame1, ContainerFrameContainer)
Money("with a watched currency")
local before = ContainerFrame1.MoneyFrame.setPoints
Frames(20)
if ContainerFrame1.MoneyFrame.setPoints ~= before then Problem("the money row was placed again while nothing changed") end
tokenShown = false
Game("the game lays out the backpack again", function() ContainerFrame1:UpdateCurrencyFrames() end)
Frames(1)
Money("with no watched currency")

return table.concat(problems, "\n")

-- World Map Data Provider

-- Forever patch (2026-10-22): the world map pins were Blizzard map pins (AddDataProvider / AcquirePin). That runs
-- this addon's code inside the map's own, and with the controller UI the taint reached the gamepad bindings:
-- SetPreferredGamepadInteractTarget(), TargetUnit() and ClearTarget() blocked, blamed on GatherMate2, after the map
-- was opened (the first flip came in the frame the map opened, 2026-10-21 23:09:46). The pins are now plain frames
-- of this addon's own on the map canvas, and the map is only read. UpdateWorldMap and DataUpdate still redraw them.
-- A pin is made with no parent and then put on the canvas: with the controller UI, Blizzard's SmartNavigation hooks
-- CreateFrame and refreshes the open panel a new frame's parent belongs to in the caller's run, so a pin made on the open
-- map with the canvas as its parent refreshed the map's panel as GatherMate2.

local worldmapUnused = {}
local shownMapID, shownScale, shownWidth, shownHeight

-- The map's own layers sit near frame level 2000, above the canvas itself; use the level the template had.
local function worldmapPinLevel(canvas)
	local ok, level = pcall(function()
		return WorldMapFrame:GetPinFrameLevelsManager():GetValidFrameLevel("PIN_FRAME_LEVEL_AREA_POI")
	end)
	return ok and type(level) == "number" and level or canvas:GetFrameLevel() + 2000
end

local function placeWorldmapPin(pin, canvas, scale)
	-- Keep a constant on-screen size while the canvas zooms; offsets are in the pin's own scale.
	pin:SetScale(1 / scale)
	pin:ClearAllPoints()
	pin:SetPoint("CENTER", canvas, "TOPLEFT", pin.x * canvas:GetWidth() * scale, -pin.y * canvas:GetHeight() * scale)
end

local function addWorldmapPin(canvas, scale, level, coord, nodeID, nodeType, pinZone)
	local pin = table.remove(worldmapUnused)
	if not pin then
		-- Made with no parent, then put on the canvas: see the note above.
		pin = CreateFrame("Button")
		pin:SetParent(canvas)
		pin.texture = pin:CreateTexture(nil, "OVERLAY")
		pin.texture:SetAllPoints(pin)
		pin:RegisterForClicks("RightButtonUp")
		pin:SetScript("OnEnter", showPin)
		pin:SetScript("OnLeave", hidePin)
		pin:SetScript("OnClick", pinClick)
	end
	pin.x, pin.y = GatherMate:DecodeLoc(coord)
	pin.coords = coord
	pin.nodeID = GatherMate.nodeIDReplacementMap[nodeID] or nodeID
	pin.title = GatherMate:GetNameForNode(nodeType, pin.nodeID)
	pin.zone = pinZone
	pin.nodeType = nodeType
	pin.worldmap = true

	pin:SetSize(12 * db.scale, 12 * db.scale)
	pin:SetAlpha(db.alpha)
	pin.texture:SetTexture(nodeTextures[nodeType][pin.nodeID])
	pin.texture:SetTexCoord(0, 1, 0, 1)
	pin.texture:SetVertexColor(1, 1, 1, 1)
	pin:EnableMouse(db.worldMapIconsInteractive and true or false)
	pin:SetFrameLevel(level)
	placeWorldmapPin(pin, canvas, scale)
	pin:Show()
	table.insert(worldmapPins, pin)
end

Display.WorldMapDataProvider = {}

function Display.WorldMapDataProvider:RemoveAllData()
	for i = #worldmapPins, 1, -1 do
		local pin = worldmapPins[i]
		if GameTooltip:GetOwner() == pin then hidePin(pin) end
		pin:Hide()
		worldmapPins[i] = nil
		worldmapUnused[#worldmapUnused + 1] = pin
	end
end

function Display.WorldMapDataProvider:RefreshAllData(fromOnShow)
	self:RemoveAllData()
	shownMapID = WorldMapFrame:IsShown() and WorldMapFrame:GetMapID() or nil
	if not shownMapID then return end -- drawn when the map next opens

	if not db.showWorldMap then return end

	-- update visibility for archaeology blobs
	Display:UpdateVisibility()

	local uiMapID = shownMapID
	if GatherMate.phasing[uiMapID] then uiMapID = GatherMate.phasing[uiMapID] end

	local canvas = WorldMapFrame:GetCanvas()
	local scale = canvas:GetScale()
	shownScale, shownWidth, shownHeight = scale, canvas:GetWidth(), canvas:GetHeight()
	local level = worldmapPinLevel(canvas)

	-- iterate databases and add nodes
	for i,db_type in pairs(GatherMate.db_types) do
		if GatherMate.Visible[db_type] then
			for coord, nodeID in GatherMate:GetNodesForZone(uiMapID, db_type) do
				addWorldmapPin(canvas, scale, level, coord, nodeID, db_type, uiMapID)
			end
		end
	end
end

-- No hook on the map: poll it while it is open, and only while the module is enabled.
Display.worldmapWatcher = CreateFrame("Frame")
Display.worldmapWatcher:Hide()
local sinceWorldmapCheck = 0
Display.worldmapWatcher:SetScript("OnUpdate", function(_, elapsed)
	sinceWorldmapCheck = sinceWorldmapCheck + elapsed
	if sinceWorldmapCheck < 0.1 then return end
	sinceWorldmapCheck = 0
	if not WorldMapFrame:IsShown() then
		if shownMapID then
			Display.WorldMapDataProvider:RemoveAllData()
			shownMapID = nil
		end
		return
	end
	if WorldMapFrame:GetMapID() ~= shownMapID then
		Display.WorldMapDataProvider:RefreshAllData()
		return
	end
	local canvas = WorldMapFrame:GetCanvas()
	local scale, width, height = canvas:GetScale(), canvas:GetWidth(), canvas:GetHeight()
	if scale ~= shownScale or width ~= shownWidth or height ~= shownHeight then
		shownScale, shownWidth, shownHeight = scale, width, height
		for _, pin in ipairs(worldmapPins) do placeWorldmapPin(pin, canvas, scale) end
	end
end)

-- GatherMate2.xml still names this mixin in its (now unused) pin template.
GatherMate2WorldMapPinMixin = {}

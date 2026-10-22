-- World Map Data Provider

Display.WorldMapDataProvider = CreateFromMixins(MapCanvasDataProviderMixin)

function Display.WorldMapDataProvider:RemoveAllData()
	self:GetMap():RemoveAllPinsByTemplate("GatherMate2WorldMapPinTemplate")
	wipe(worldmapPins)
end

function Display.WorldMapDataProvider:RefreshAllData(fromOnShow)
	self:RemoveAllData()

	if not db.showWorldMap then return end

	-- update visibility for archaeology blobs
	Display:UpdateVisibility()

	local map = self:GetMap()
	local uiMapID = map:GetMapID()
	if not uiMapID then return end

	if GatherMate.phasing[uiMapID] then uiMapID = GatherMate.phasing[uiMapID] end

	-- iterate databases and add nodes
	for i,db_type in pairs(GatherMate.db_types) do
		if GatherMate.Visible[db_type] then
			for coord, nodeID in GatherMate:GetNodesForZone(uiMapID, db_type) do
				local pin = map:AcquirePin("GatherMate2WorldMapPinTemplate", coord,  nodeID, db_type, uiMapID)
				table.insert(worldmapPins, pin)
			end
		end
	end
end

--[[ Handy Notes WorldMap Pin ]]--
GatherMate2WorldMapPinMixin = CreateFromMixins(MapCanvasPinMixin)

function GatherMate2WorldMapPinMixin:OnLoad()
	self:UseFrameLevelType("PIN_FRAME_LEVEL_AREA_POI")
	self:SetScalingLimits(1, 1.0, 1.2);
end

function GatherMate2WorldMapPinMixin:OnAcquired(coord, nodeID, nodeType, pinZone)
	local x,y = GatherMate:DecodeLoc(coord)
	self:SetPosition(x, y)

	self.coords = coord
	self.nodeID = GatherMate.nodeIDReplacementMap[nodeID] or nodeID
	self.title = GatherMate:GetNameForNode(nodeType, self.nodeID)
	self.zone = pinZone
	self.nodeType = nodeType
	self.worldmap = true

	self:SetHeight(12 * db.scale)
	self:SetWidth(12 * db.scale)
	self:SetAlpha(db.alpha)
	self.texture:SetTexture(nodeTextures[nodeType][self.nodeID])
	self.texture:SetTexCoord(0, 1, 0, 1)
	self.texture:SetVertexColor(1, 1, 1, 1)
	self:EnableMouse(db.worldMapIconsInteractive)

	-- enable right-click interactivity
	if db.worldMapIconsInteractive and self.SetPassThroughButtons then
		self:SetPassThroughButtons("")
	end
end

function GatherMate2WorldMapPinMixin:OnMouseEnter()
	return showPin(self)
end

function GatherMate2WorldMapPinMixin:OnMouseLeave()
	return hidePin(self)
end

function GatherMate2WorldMapPinMixin:OnClick(button)
	return pinClick(self, button)
end

-- hack to avoid error in combat in 10.1.5
GatherMate2WorldMapPinMixin.SetPassThroughButtons = function() end

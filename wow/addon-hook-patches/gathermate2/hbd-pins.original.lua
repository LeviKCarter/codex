-- setup pin pool
worldmapPinsPool.parent = WorldMapFrame:GetCanvas()
worldmapPinsPool.createFunc = function()
    local frame = CreateFrame("Frame", nil, WorldMapFrame:GetCanvas())
    frame:SetSize(1, 1)
    return Mixin(frame, worldmapProviderPin)
end
worldmapPinsPool.resetFunc = function(pinPool, pin)
    pin:Hide()
    pin:ClearAllPoints()
    pin:OnReleased()

    pin.pinTemplate = nil
    pin.owningMap = nil
end

-- pre-11.x func names
worldmapPinsPool.creationFunc = worldmapPinsPool.createFunc
worldmapPinsPool.resetterFunc = worldmapPinsPool.resetFunc

-- register pin pool with the world map
WorldMapFrame.pinPools["HereBeDragonsPinsTemplate"] = worldmapPinsPool

-- provider base API
function worldmapProvider:RemoveAllData()
    self:GetMap():RemoveAllPinsByTemplate("HereBeDragonsPinsTemplate")
end

function worldmapProvider:RemovePinByIcon(icon)
    for pin in self:GetMap():EnumeratePinsByTemplate("HereBeDragonsPinsTemplate") do
        if pin.icon == icon then
            self:GetMap():RemovePin(pin)
        end
    end
end

function worldmapProvider:RemovePinsByRef(ref)
    for pin in self:GetMap():EnumeratePinsByTemplate("HereBeDragonsPinsTemplate") do
        if pin.icon and worldmapPinRegistry[ref][pin.icon] then
            self:GetMap():RemovePin(pin)
        end
    end
end

function worldmapProvider:RefreshAllData(fromOnShow)
    self:RemoveAllData()

    for icon, data in pairs(worldmapPins) do
        self:HandlePin(icon, data)
    end
end

function worldmapProvider:HandlePin(icon, data)
    local uiMapID = self:GetMap():GetMapID()

    -- check for a valid map
    if not uiMapID then return end

    local x, y
    if uiMapID == WORLD_MAP_ID then
        -- should this pin show on the world map?
        if uiMapID ~= data.uiMapID and data.worldMapShowFlag ~= HBD_PINS_WORLDMAP_SHOW_WORLD then return end

        -- translate to the world map
        x, y = HBD:GetAzerothWorldMapCoordinatesFromWorld(data.x, data.y, data.instanceID)
    else
        -- check that there is data
        if not HBD.mapData[uiMapID] then return end

        if uiMapID ~= data.uiMapID then
            local mapType = HBD.mapData[uiMapID].mapType
            if not data.uiMapID then
                if mapType == Enum.UIMapType.Continent and data.worldMapShowFlag >= HBD_PINS_WORLDMAP_SHOW_CONTINENT then
                    -- pass
                elseif mapType ~= Enum.UIMapType.Zone and mapType ~= Enum.UIMapType.Dungeon and mapType ~= Enum.UIMapType.Micro then
                    -- fail
                    return
                end
            else
                local show = false
                local parentMapID = HBD.mapData[data.uiMapID].parent
                while parentMapID and HBD.mapData[parentMapID] do
                    if parentMapID == uiMapID then
                        local parentMapType = HBD.mapData[parentMapID].mapType
                        -- show on any parent zones if they are normal zones
                        if data.worldMapShowFlag >= HBD_PINS_WORLDMAP_SHOW_PARENT and
                            (parentMapType == Enum.UIMapType.Zone or parentMapType == Enum.UIMapType.Dungeon or parentMapType == Enum.UIMapType.Micro) then
                            show = true
                        -- show on the continent
                        elseif data.worldMapShowFlag >= HBD_PINS_WORLDMAP_SHOW_CONTINENT and
                            parentMapType == Enum.UIMapType.Continent then
                            show = true
                        end
                        break
                        -- worldmap is handled above already
                    else
                        parentMapID = HBD.mapData[parentMapID].parent
                    end
                end

                if not show then return end
            end
        end

        -- translate coordinates
        x, y = HBD:GetZoneCoordinatesFromWorldInstance(data.x, data.y, data.instanceID, uiMapID)
    end
    if x and y then
        self:GetMap():AcquirePin("HereBeDragonsPinsTemplate", icon, x, y, data.frameLevelType)
    end
end

--  map pin base API
function worldmapProviderPin:OnLoad()
    self:UseFrameLevelType("PIN_FRAME_LEVEL_AREA_POI")
    self:SetScalingLimits(1, 1.0, 1.2)
end

function worldmapProviderPin:OnAcquired(icon, x, y, frameLevelType)
    self:UseFrameLevelType(frameLevelType or "PIN_FRAME_LEVEL_AREA_POI")
    self:SetPosition(x, y)

    self.icon = icon
    icon:SetParent(self)
    icon:ClearAllPoints()
    icon:SetPoint("CENTER", self, "CENTER")
    icon:Show()
end

function worldmapProviderPin:OnReleased()
    if self.icon then
        self.icon:Hide()
        self.icon:SetParent(UIParent)
        self.icon:ClearAllPoints()
        self.icon = nil
    end
end

-- hack to avoid in-combat error on 10.1.5
worldmapProviderPin.SetPassThroughButtons = function() end

-- register with the world map
WorldMapFrame:AddDataProvider(worldmapProvider)

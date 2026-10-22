-- Forever patch (2026-10-22): this library's world map icons were Blizzard map pins (a pin pool written into
-- WorldMapFrame.pinPools, AddDataProvider, AcquirePin). GatherMate2's copy is the only "HereBeDragons-Pins-2.0" loaded,
-- so every add-on's icons ran through it (Pulse Ops Pin's Now card star), and with the controller UI the map's own
-- code ran this file's: SetPreferredGamepadInteractTarget() blocked, blamed on GatherMate2, the moment the map closed
-- (2026-10-22 09:09:29 local, after GatherMate2's own pins were already off the map). The icons now sit on frames of
-- this library's own on the map canvas, and the map is only read; nothing of Blizzard's is written or registered.
-- (First tried 2026-10-22 as codex#60, reverted the same hour after a flood of errors in game that this file's own
-- full-load test could not reproduce; the watch now stops on a failure and names it once in chat.)

local canvasPins, unusedCanvasPins = {}, {}
local shownMapID, shownScale, shownWidth, shownHeight

local function canvasPinLevel(canvas)
    local ok, level = pcall(function()
        return WorldMapFrame:GetPinFrameLevelsManager():GetValidFrameLevel("PIN_FRAME_LEVEL_AREA_POI")
    end)
    return ok and type(level) == "number" and level or canvas:GetFrameLevel() + 2000
end

local function placeCanvasPin(pin, canvas, scale)
    -- Same on-screen size at every zoom, as the template's scaling limits kept it; offsets are in the pin's own scale.
    pin:SetScale(1 / scale)
    pin:ClearAllPoints()
    pin:SetPoint("CENTER", canvas, "TOPLEFT", pin.x * canvas:GetWidth() * scale, -pin.y * canvas:GetHeight() * scale)
end

-- provider base API, on the library's own table (it is never given to the map)
function worldmapProvider:GetMap()
    return WorldMapFrame
end

function worldmapProvider:Place(icon, x, y)
    if not WorldMapFrame:IsShown() then return end
    local canvas = WorldMapFrame:GetCanvas()
    local pin = table.remove(unusedCanvasPins)
    if not pin then
        -- Made with no parent, then put on the canvas: Blizzard's SmartNavigation hooks CreateFrame and refreshes the
        -- open panel a new frame's parent belongs to in the caller's run, so a frame made with the open map's canvas as
        -- its parent refreshes the map's controller panel as this file's add-on.
        pin = CreateFrame("Frame")
        pin:SetParent(canvas)
    end
    pin:SetSize(1, 1)
    pin:SetFrameLevel(canvasPinLevel(canvas))
    pin.x, pin.y, pin.icon = x, y, icon
    placeCanvasPin(pin, canvas, canvas:GetScale())
    pin:Show()
    icon:SetParent(pin)
    icon:ClearAllPoints()
    icon:SetPoint("CENTER", pin, "CENTER")
    icon:Show()
    canvasPins[#canvasPins + 1] = pin
end

local function releaseCanvasPin(i)
    local pin = table.remove(canvasPins, i)
    pin:Hide()
    if pin.icon then
        pin.icon:Hide()
        pin.icon:SetParent(UIParent)
        pin.icon:ClearAllPoints()
        pin.icon = nil
    end
    unusedCanvasPins[#unusedCanvasPins + 1] = pin
end

function worldmapProvider:RemoveAllData()
    for i = #canvasPins, 1, -1 do releaseCanvasPin(i) end
end

function worldmapProvider:RemovePinByIcon(icon)
    for i = #canvasPins, 1, -1 do
        if canvasPins[i].icon == icon then releaseCanvasPin(i) end
    end
end

function worldmapProvider:RemovePinsByRef(ref)
    for i = #canvasPins, 1, -1 do
        local icon = canvasPins[i].icon
        if icon and worldmapPinRegistry[ref][icon] then releaseCanvasPin(i) end
    end
end

function worldmapProvider:RefreshAllData(fromOnShow)
    self:RemoveAllData()
    shownMapID = WorldMapFrame:IsShown() and WorldMapFrame:GetMapID() or nil
    if not shownMapID then return end -- drawn when the map next opens

    local canvas = WorldMapFrame:GetCanvas()
    shownScale, shownWidth, shownHeight = canvas:GetScale(), canvas:GetWidth(), canvas:GetHeight()
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
        self:Place(icon, x, y)
    end
end

-- No hook on the map and no data provider: watch it while it is open.
pins.worldmapWatcher = pins.worldmapWatcher or CreateFrame("Frame")
local sinceWorldmapCheck = 0
local watchFailed
local function watchWorldmap()
    if not WorldMapFrame:IsShown() then
        if shownMapID then
            worldmapProvider:RemoveAllData()
            shownMapID = nil
        end
        return
    end
    if WorldMapFrame:GetMapID() ~= shownMapID then
        worldmapProvider:RefreshAllData()
        return
    end
    local canvas = WorldMapFrame:GetCanvas()
    local scale, width, height = canvas:GetScale(), canvas:GetWidth(), canvas:GetHeight()
    if scale ~= shownScale or width ~= shownWidth or height ~= shownHeight then
        shownScale, shownWidth, shownHeight = scale, width, height
        for _, pin in ipairs(canvasPins) do placeCanvasPin(pin, canvas, scale) end
    end
end
pins.worldmapWatcher:SetScript("OnUpdate", function(_, elapsed)
    sinceWorldmapCheck = sinceWorldmapCheck + elapsed
    if sinceWorldmapCheck < 0.1 or watchFailed then return end
    sinceWorldmapCheck = 0
    -- A failure stops the watch and is said once in chat, not every tenth of a second.
    local ok, err = pcall(watchWorldmap)
    if not ok then
        watchFailed = true
        if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("HereBeDragons-Pins (GatherMate2, Forever patch): map icons stopped: " .. tostring(err)) end
    end
end)

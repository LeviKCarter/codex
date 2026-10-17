-- Forever patch (2026-10-13, as on 2026-10-03 for 0.2; the 0.3.1 update undid it): the pins used to be
-- registered with Blizzard's map (AddDataProvider / AcquirePin). That runs this addon's code inside the
-- map's own, and with the controller UI the taint reached the gamepad bindings: RunBinding(),
-- DescendStop() and SetPreferredGamepadInteractTarget() blocked, blamed on this addon, so the face
-- buttons stopped working after opening the map. The pins are now plain frames of our own on the map
-- canvas. The map is only read.

local PIN_SIZE = 20
local active, unused = {}, {}
local shownMapID, shownScale, shownWidth, shownHeight

-- The map's own layers (explored areas, POIs) sit near frame level 2000, far above the canvas itself, so
-- pins just above the canvas were hidden under explored areas. Use the level the addon's template had.
local function PinLevel(canvas)
  local ok, level = pcall(function()
    return WorldMapFrame:GetPinFrameLevelsManager():GetValidFrameLevel("PIN_FRAME_LEVEL_AREA_POI")
  end)
  return ok and type(level) == "number" and level or canvas:GetFrameLevel() + 2000
end

local function OnPinEnter(self)
  GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
  GameTooltip:SetText(Faction().name)
  GameTooltip:AddLine(format("%.1f, %.1f", self.x * 100, self.y * 100), 1, 1, 1)
  if self.report then
    local minutes = math.floor((GetServerTime() - self.report.t) / 60)
    GameTooltip:AddLine(minutes < 60 and format("Seen in your phase %d min ago", minutes)
      or format("Seen in your phase %d h ago", math.floor(minutes / 60)), 0.4, 1, 0.4)
  elseif db and db.crowd then
    GameTooltip:AddLine(format("Not seen in over %d mins", ns.CrowdMinutes()), 0.6, 0.6, 0.6)
  end
  GameTooltip:Show()
end

local function OnPinLeave(self)
  if GameTooltip:GetOwner() == self then GameTooltip:Hide() end
end

local function PlacePin(pin, canvas, scale)
  -- Keep a constant on-screen size while the canvas zooms; offsets are in the pin's own scale.
  pin:SetScale(1 / scale)
  pin:ClearAllPoints()
  pin:SetPoint("CENTER", canvas, "TOPLEFT", pin.x * canvas:GetWidth() * scale, -pin.y * canvas:GetHeight() * scale)
end

-- report: a current-phase crowd sighting near this pin, if any
local function AddPin(canvas, scale, x, y, report)
  local pin = table.remove(unused)
  if not pin then
    pin = CreateFrame("Frame", nil, canvas)
    pin:SetSize(PIN_SIZE, PIN_SIZE)
    pin.Icon = pin:CreateTexture(nil, "ARTWORK")
    pin.Icon:SetAllPoints(pin)
    pin:EnableMouse(true)
    pin:SetScript("OnEnter", OnPinEnter)
    pin:SetScript("OnLeave", OnPinLeave)
    pin.reticlePinsHover = true -- lets the Reticle Pins addon show the tooltip under the gamepad reticle
  end
  pin.x, pin.y, pin.report = x, y, report
  pin.Icon:SetAtlas(Faction().atlas)
  if report then
    -- green and solid when fresh, through yellow, to red and faded as it ages out
    local age = ns.CrowdAge(report)
    pin.Icon:SetDesaturated(true)
    pin.Icon:SetVertexColor(math.min(1, age * 2), math.min(1, (1 - age) * 2), 0)
    pin.Icon:SetAlpha(1 - age * (1 - RED_ALPHA))
  else
    -- with sharing on, nodes nobody has seen lately sit back, fainter than an expiring sighting
    pin.Icon:SetDesaturated(false)
    pin.Icon:SetVertexColor(1, 1, 1)
    pin.Icon:SetAlpha(db and db.crowd and UNSEEN_ALPHA or 1)
  end
  pin:SetFrameLevel(PinLevel(canvas))
  PlacePin(pin, canvas, scale)
  pin:Show()
  active[#active + 1] = pin
end

Provider = {}

function Provider:RemoveAllData()
  for i = #active, 1, -1 do
    local pin = active[i]
    OnPinLeave(pin)
    pin:Hide()
    active[i] = nil
    unused[#unused + 1] = pin
  end
end

function Provider:RefreshAllData()
  self:RemoveAllData()
  shownMapID = WorldMapFrame:IsShown() and WorldMapFrame:GetMapID() or nil
  if not shownMapID then return end -- drawn when the map next opens
  if db and not db.showNonSkyborne and not IsSkyborne() then return end
  if hidden then return end
  local canvas = WorldMapFrame:GetCanvas()
  local scale = canvas:GetScale()
  shownScale, shownWidth, shownHeight = scale, canvas:GetWidth(), canvas:GetHeight()
  local key = Faction().key
  local mapID = shownMapID
  local mine = db and db.found[key][mapID]
  local crowd, used = ns.CrowdReports(mapID), {}

  local function Pin(x, y)
    local report
    for i, r in ipairs(crowd) do
      if Near(mapID, r.x, r.y, x, y) then
        used[i], report = true, r
        break
      end
    end
    AddPin(canvas, scale, x, y, report)
  end

  if not (db and db.selfOnly) then
    for _, p in ipairs(SLLCM_Data[key][mapID] or {}) do
      Pin(p[1], p[2])
    end
    -- self-found points not already in the list
    for _, p in ipairs(mine or {}) do
      if not FindNear(SLLCM_Data[key][mapID], mapID, p[1], p[2]) then
        Pin(p[1], p[2])
      end
    end
    -- points learned from other players' sightings, not in either
    for _, p in ipairs(db and db.shared[key][mapID] or {}) do
      if not FindNear(SLLCM_Data[key][mapID], mapID, p[1], p[2]) and not FindNear(mine, mapID, p[1], p[2]) then
        Pin(p[1], p[2])
      end
    end
  else
    for _, p in ipairs(mine or {}) do
      Pin(p[1], p[2])
    end
  end
  -- sightings that match nothing we know: new locations, so not when showing self-found only
  if not (db and db.selfOnly) then
    for i, r in ipairs(crowd) do
      if not used[i] then AddPin(canvas, scale, r.x, r.y, r) end
    end
  end
end

-- No hook on the map: poll it while it is open.
local watcher, sinceCheck = CreateFrame("Frame"), 0
watcher:SetScript("OnUpdate", function(_, elapsed)
  sinceCheck = sinceCheck + elapsed
  if sinceCheck < 0.1 then return end
  sinceCheck = 0
  if not WorldMapFrame:IsShown() then
    if shownMapID then
      Provider:RemoveAllData()
      shownMapID = nil
    end
    return
  end
  if WorldMapFrame:GetMapID() ~= shownMapID then
    Provider:RefreshAllData()
    return
  end
  local canvas = WorldMapFrame:GetCanvas()
  local scale, width, height = canvas:GetScale(), canvas:GetWidth(), canvas:GetHeight()
  if scale ~= shownScale or width ~= shownWidth or height ~= shownHeight then
    shownScale, shownWidth, shownHeight = scale, width, height
    for _, pin in ipairs(active) do PlacePin(pin, canvas, scale) end
  end
end)

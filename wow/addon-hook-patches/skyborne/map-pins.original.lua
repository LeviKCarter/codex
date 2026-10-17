LeyLineMarkerPinMixin = CreateFromMixins(MapCanvasPinMixin)

function LeyLineMarkerPinMixin:OnLoad()
  self:UseFrameLevelType("PIN_FRAME_LEVEL_AREA_POI")
  self:SetScalingLimits(1, 1.0, 1.2)
  self.Icon:SetAtlas(Faction().atlas)
end

-- report: a current-phase crowd sighting near this pin, if any
function LeyLineMarkerPinMixin:OnAcquired(x, y, report)
  self.x, self.y, self.report = x, y, report
  self:SetPosition(x, y)
  if report then
    -- green and solid when fresh, through yellow, to red and faded as it ages out
    local age = ns.CrowdAge(report)
    self.Icon:SetDesaturated(true)
    self.Icon:SetVertexColor(math.min(1, age * 2), math.min(1, (1 - age) * 2), 0)
    self.Icon:SetAlpha(1 - age * (1 - RED_ALPHA))
  else
    -- with sharing on, nodes nobody has seen lately sit back, fainter than an expiring sighting
    self.Icon:SetDesaturated(false)
    self.Icon:SetVertexColor(1, 1, 1)
    self.Icon:SetAlpha(db and db.crowd and UNSEEN_ALPHA or 1)
  end
end

function LeyLineMarkerPinMixin:CheckMouseButtonPassthrough(...)
  if not InCombatLockdown() then
    MapCanvasPinMixin.CheckMouseButtonPassthrough(self, ...)
  end
end

function LeyLineMarkerPinMixin:OnMouseEnter()
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

function LeyLineMarkerPinMixin:OnMouseLeave()
  GameTooltip:Hide()
end

Provider = CreateFromMixins(MapCanvasDataProviderMixin)

function Provider:RemoveAllData()
  self:GetMap():RemoveAllPinsByTemplate(PIN)
end

function Provider:RefreshAllData()
  self:RemoveAllData()
  if db and not db.showNonSkyborne and not IsSkyborne() then return end
  if hidden then return end
  local key = Faction().key
  local mapID = self:GetMap():GetMapID()
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
    self:GetMap():AcquirePin(PIN, x, y, report)
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
      if not used[i] then self:GetMap():AcquirePin(PIN, r.x, r.y, r) end
    end
  end
end

WorldMapFrame:AddDataProvider(Provider)

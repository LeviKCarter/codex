"""Takes other people's addons off Blizzard's own frame methods in the WoW Forever beta client.

On this client, once an addon has wrapped a method of one of the game's frames with hooksecurefunc, the game's
own call to that method can fail with "attempt to call a nil value" (the world map's SetPoint, SetAlpha and
SetMapID, the area label's EvaluateLabels, the exploration pin's RemoveAllData, the damage meter's SetIsEditing).
Each patch below swaps such a hook for a script hook or a per-frame read of the same state. An addon update
writes the hooks back, so the WoW Forever shortcut runs this before every launch (Start-WoWForever.ps1).

usage: python patch_addon_hooks.py [--addons <Interface\\AddOns folder>] [--check]
A file is rewritten only when every patch for it fits; the original goes to hook-patch-backups beside
Interface, under the addon's version. --check changes nothing. Exit code 0: every file is patched, or its
misfit was already reported for that exact file. Exit code 2: a file no longer fits its patches (the addon
changed) and this is the first run to see it. Tests: test_patch_addon_hooks.py.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

DEFAULT_ADDONS = Path(r"D:\Games\World of Warcraft\_classic_beta_\Interface\AddOns")
MARK = "Forever patch"

# addon -> file -> [(what, old text, new text)]. Text uses \n; the file's own line ends are kept.
PATCHES: dict[str, dict[str, list[tuple[str, str, str]]]] = {
    "MapUtils": {
        "core.lua": [
            (
                "the map's Show",
                'hooksecurefunc(WorldMapFrame, "Show", function()\n',
                'WorldMapFrame:HookScript("OnShow", function() -- Forever patch: was hooksecurefunc(WorldMapFrame, "Show")\n',
            ),
        ],
        "mapframe.lua": [
            (
                "placement memory",
                "local function Apply()\n\tif not ready or applying or sizing ~= nil or dragging then return end\n",
                "-- Forever patch: the map's placement as this file last left it.\n"
                "local placed = {}\n"
                "local function RememberPlacement()\n"
                "\tplaced.point, placed.relativeTo, placed.relativePoint, placed.x, placed.y = frame:GetPoint(1)\n"
                "\tplaced.maximized, placed.width, placed.height = IsMaximized(), frame:GetWidth(), frame:GetHeight()\n"
                "end\n"
                "\n"
                "local function SamePlacement(point, relativeTo, relativePoint, x, y)\n"
                "\tif point ~= placed.point or relativeTo ~= placed.relativeTo or relativePoint ~= placed.relativePoint then return false end\n"
                "\n"
                "\treturn math.abs((x or 0) - (placed.x or 0)) < 0.01 and math.abs((y or 0) - (placed.y or 0)) < 0.01\n"
                "end\n"
                "\n"
                "local function Apply()\n\tif not ready or applying or sizing ~= nil or dragging then return end\n",
            ),
            (
                "the map's SetPoint",
                "\tapplying = false\n"
                "\tUpdateGrip()\n"
                "end\n"
                "\n"
                "local function OnBlizzardPoint(_, ...)\n"
                "\tif applying or sizing ~= nil or dragging then return end\n"
                "\tblizzardPoint = {NormalizePoint(...)}\n"
                "\tApply()\n"
                "end\n",
                "\tapplying = false\n"
                "\tUpdateGrip()\n"
                "\tRememberPlacement()\n"
                "end\n"
                "\n"
                "-- Forever patch: reads where Blizzard put the map on every frame it is shown, in place of\n"
                "-- hooks on the map's SetPoint and SynchronizeDisplayState.\n"
                "local function WatchBlizzard()\n"
                "\tif applying or sizing ~= nil or dragging then return end\n"
                "\tlocal point, relativeTo, relativePoint, x, y = frame:GetPoint(1)\n"
                "\tlocal moved = point ~= nil and not SamePlacement(point, relativeTo, relativePoint, x, y)\n"
                "\tif not moved and IsMaximized() == placed.maximized and frame:GetWidth() == placed.width and frame:GetHeight() == placed.height then return end\n"
                "\tif moved then blizzardPoint = {NormalizePoint(point, relativeTo, relativePoint, x, y)} end\n"
                "\tApply()\n"
                "\tRememberPlacement()\n"
                "end\n",
            ),
            (
                "drag end",
                "\tif left ~= nil then MapUtils:SV(MAUTTAB, \"WORLDMAPPOS\", {[\"x\"] = left, [\"y\"] = top}) end\n"
                "\tApply()\n"
                "end\n"
                "\n"
                "local function GetCursorUi()\n",
                "\tif left ~= nil then MapUtils:SV(MAUTTAB, \"WORLDMAPPOS\", {[\"x\"] = left, [\"y\"] = top}) end\n"
                "\tApply()\n"
                "\tRememberPlacement() -- Forever patch\n"
                "end\n"
                "\n"
                "local function GetCursorUi()\n",
            ),
            (
                "sizing end",
                "\tApply()\nend\n\nlocal function StartSizing(_, button)\n",
                "\tApply()\n\tRememberPlacement() -- Forever patch\nend\n\nlocal function StartSizing(_, button)\n",
            ),
            (
                "the map's SetPoint and SynchronizeDisplayState hooks",
                "\thooksecurefunc(frame, \"SetPoint\", OnBlizzardPoint)\n"
                "\tif frame.SynchronizeDisplayState ~= nil then hooksecurefunc(frame, \"SynchronizeDisplayState\", Apply) end\n"
                "\tframe:HookScript(\"OnShow\", Apply)\n",
                "\t-- Forever patch: no hooks on the map's own methods (see WatchBlizzard).\n"
                "\tframe:HookScript(\"OnShow\", WatchBlizzard)\n"
                "\tframe:HookScript(\"OnShow\", Apply)\n"
                "\tCreateFrame(\"FRAME\", nil, frame):SetScript(\"OnUpdate\", WatchBlizzard)\n",
            ),
            (
                "the map's SetAlpha",
                "\t\t\t[\"hookSetAlpha\"] = true,\n",
                "\t\t\t[\"hookSetAlpha\"] = false, -- Forever patch: no hook on the map's SetAlpha\n",
            ),
            (
                "wheel zoom: another zoom since the wheel",
                "\tif WheelZoom.foreignTime ~= nil and WheelZoom.foreignTime >= pending.time then return end\n",
                "\tif WheelZoom.foreignTime ~= nil and WheelZoom.foreignTime >= pending.time then return end\n"
                "\tif container.targetScale ~= pending.target then return end -- Forever patch: something else asked for a zoom\n",
            ),
            (
                "wheel zoom: the zoom asked for at the wheel",
                "\t\t[\"scale\"] = container:GetCanvasScale(),\n\t}\n",
                "\t\t[\"scale\"] = container:GetCanvasScale(),\n\t\t[\"target\"] = container.targetScale, -- Forever patch\n\t}\n",
            ),
            (
                "the map's zoom methods",
                "\tfor _, method in ipairs(WheelZoom.zoomMethods) do\n"
                "\t\tif type(container[method]) == \"function\" then hooksecurefunc(container, method, WheelZoom.MarkForeign) end\n"
                "\tend\n",
                "\t-- Forever patch: no hooks on the map's zoom methods; WheelZoom.Apply compares targetScale.\n",
            ),
        ],
        "reveal.lua": [
            (
                "the exploration pin's RefreshOverlays and RemoveAllData",
                "\t\t\tGetState(pin)\n"
                "\t\t\thooksecurefunc(pin, \"RefreshOverlays\", RefreshPin)\n"
                "\t\t\thooksecurefunc(pin, \"RemoveAllData\", ClearPin)\n"
                "\t\t\tRefreshPin(pin)\n",
                "\t\t\tGetState(pin)\n"
                "\t\t\t-- Forever patch: no hooks on the pin's own methods (see WatchPins).\n"
                "\t\t\tRefreshPin(pin)\n",
            ),
            (
                "pin watcher",
                "function MapUtils:RefreshReveal()\n",
                "-- Forever patch: redraws a shown pin when its map, zoom layer or explored areas change, in\n"
                "-- place of hooks on the pin's RefreshOverlays and RemoveAllData.\n"
                "local exploredChanged = false\n"
                "local function WatchPins()\n"
                "\tfor pin, state in pairs(states) do\n"
                "\t\tif not pin:IsVisible() then\n"
                "\t\t\tstate.watching = false\n"
                "\t\telse\n"
                "\t\t\tlocal map = pin:GetMap()\n"
                "\t\t\tlocal mapID = map and map:GetMapID()\n"
                "\t\t\tlocal layer = map and GetLayerIndex(map)\n"
                "\t\t\tif exploredChanged or not state.watching or state.mapID ~= mapID or state.layer ~= layer then\n"
                "\t\t\t\tstate.watching, state.mapID, state.layer = true, mapID, layer\n"
                "\t\t\t\tRefreshPin(pin)\n"
                "\t\t\tend\n"
                "\t\tend\n"
                "\tend\n"
                "\n"
                "\texploredChanged = false\n"
                "end\n"
                "\n"
                "local watcher = CreateFrame(\"FRAME\")\n"
                "watcher:SetScript(\"OnUpdate\", WatchPins)\n"
                "watcher:SetScript(\"OnEvent\", function() exploredChanged = true end)\n"
                "pcall(watcher.RegisterEvent, watcher, \"MAP_EXPLORATION_UPDATED\")\n"
                "\n"
                "function MapUtils:RefreshReveal()\n",
            ),
        ],
        "zonelevels.lua": [
            (
                "the area label's EvaluateLabels",
                "\t\t\thooksecurefunc(label, \"EvaluateLabels\", AppendZoneLevel)\n",
                "\t\t\tlabel:HookScript(\"OnUpdate\", AppendZoneLevel) -- Forever patch: was hooksecurefunc(label, \"EvaluateLabels\")\n",
            ),
        ],
        "libs/D4Lib/D4Waypoints.lua": [
            (
                "the map's OnMapChanged and OnCanvasScaleChanged",
                "    if WorldMapFrame.OnMapChanged ~= nil then hooksecurefunc(WorldMapFrame, \"OnMapChanged\", Update) end\n"
                "    if WorldMapFrame.OnCanvasScaleChanged ~= nil then hooksecurefunc(WorldMapFrame, \"OnCanvasScaleChanged\", Update) end\n",
                "    -- Forever patch: reads the map and its zoom on every frame it is shown, in place of hooks on\n"
                "    -- the map's OnMapChanged and OnCanvasScaleChanged.\n"
                "    local seenMap, seenScale\n"
                "    CreateFrame(\"Frame\", nil, WorldMapFrame):SetScript(\"OnUpdate\", function()\n"
                "        local mapID, scale = WorldMapFrame:GetMapID(), WorldMapFrame:GetCanvasScale()\n"
                "        if mapID == seenMap and scale == seenScale then return end\n"
                "        seenMap, seenScale = mapID, scale\n"
                "        Update()\n"
                "    end)\n",
            ),
        ],
    },
    "DungeonJourney": {
        "API/MapPins.lua": [
            (
                "the map's SetMapID",
                "        if WorldMapFrame.SetMapID then pcall(hooksecurefunc,WorldMapFrame,\"SetMapID\",function() DJ.MapPins:Refresh() end) end\n",
                "        -- Forever patch: no hook on the map's SetMapID; the 1s ticker covers a map change.\n",
            ),
        ],
    },
    "Spoken_Zones": {
        "UI/MapPanel.lua": [
            (
                "the map's SetAlpha",
                "\tif hooksecurefunc then hooksecurefunc(WorldMapFrame, \"SetAlpha\", FollowAlpha) end\n",
                "\t-- Forever patch: reads the map's alpha on every frame it is shown, in place of a hook on its SetAlpha.\n"
                "\tlocal seenAlpha\n"
                "\tCreateFrame(\"Frame\", nil, WorldMapFrame):SetScript(\"OnUpdate\", function()\n"
                "\t\tlocal alpha = WorldMapFrame:GetAlpha()\n"
                "\t\tif alpha == seenAlpha then return end\n"
                "\t\tseenAlpha = alpha\n"
                "\t\tFollowAlpha()\n"
                "\tend)\n",
            ),
        ],
        "Core.lua": [
            (
                "the map's OnMapChanged",
                "\thooksecurefunc(WorldMapFrame, \"OnMapChanged\", function()\n"
                "\t\tDispatch(SpokenZones.mapChangedCallbacks, WorldMapFrame.mapID)\n"
                "\tend)\n",
                "\t-- Forever patch: reads the map on every frame it is shown, in place of a hook on its OnMapChanged.\n"
                "\tlocal seenMap\n"
                "\tCreateFrame(\"Frame\", nil, WorldMapFrame):SetScript(\"OnUpdate\", function()\n"
                "\t\tlocal mapID = WorldMapFrame.mapID\n"
                "\t\tif mapID == seenMap then return end\n"
                "\t\tseenMap = mapID\n"
                "\t\tDispatch(SpokenZones.mapChangedCallbacks, mapID)\n"
                "\tend)\n",
            ),
        ],
    },
    "Questie": {
        "Libs/Krowi_WorldMapButtons/Krowi_WorldMapButtons.lua": [
            (
                "the map's OnMapChanged",
                "\thooksecurefunc(WorldMapFrame, \"OnMapChanged\", function()\n"
                "\t\tbutton:Refresh();\n"
                "\t\tlib.SetPoints();\n"
                "\tend);\n",
                "\t-- Forever patch: reads the map on every frame it is shown, in place of a hook on its OnMapChanged.\n"
                "\tlocal seenMap;\n"
                "\tCreateFrame(\"Frame\", nil, WorldMapFrame):SetScript(\"OnUpdate\", function()\n"
                "\t\tlocal mapID = WorldMapFrame:GetMapID();\n"
                "\t\tif mapID == seenMap then return; end\n"
                "\t\tseenMap = mapID;\n"
                "\t\tbutton:Refresh();\n"
                "\t\tlib.SetPoints();\n"
                "\tend);\n",
            ),
        ],
    },
    "QuestieForeverGamepad": {
        "TrackerBridge.lua": [
            (
                "the map's OnMapChanged",
                "        hooksecurefunc(map,\"OnMapChanged\",MapHUDChanged)\n",
                "        -- Forever patch: reads the map on every frame it is shown, in place of a hook on its OnMapChanged.\n"
                "        local seenMap\n"
                "        CreateFrame(\"Frame\",nil,map):SetScript(\"OnUpdate\",function()\n"
                "            local mapID=map:GetMapID()\n"
                "            if mapID==seenMap then return end\n"
                "            seenMap=mapID\n"
                "            MapHUDChanged()\n"
                "        end)\n",
            ),
        ],
    },
}


def plan(text: str, patches: list[tuple[str, str, str]]) -> tuple[str, list[str], list[str]]:
    """The text with every patch in, the patches newly put in, and the ones that fit nowhere."""
    done, misfits = [], []
    for what, old, new in patches:
        if new in text:
            continue
        if text.count(old) == 1:
            text = text.replace(old, new)
            done.append(what)
        else:
            misfits.append(what)
    return text, done, misfits


def addon_version(folder: Path) -> str:
    for toc in sorted(folder.glob("*.toc")):
        found = re.search(r"^## Version:\s*(\S+)", toc.read_text(encoding="utf-8", errors="replace"), re.M)
        if found:
            return re.sub(r"[^\w.\-]", "_", found.group(1))
    return "unknown"


def run(addons: Path, check: bool = False, patches: dict | None = None) -> tuple[int, list[str]]:
    patches = PATCHES if patches is None else patches
    backups = addons.parent.parent / "hook-patch-backups"
    state_file = backups / "state.json"
    try:
        reported = json.loads(state_file.read_text(encoding="utf-8"))["misfits"]
    except (OSError, ValueError, KeyError):
        reported = {}
    lines, misfit_now, new_misfit = [], {}, False

    for addon, files in patches.items():
        folder = addons / addon
        if not folder.is_dir():
            lines.append(f"{addon}: not installed")
            continue
        version = addon_version(folder)
        for name, file_patches in files.items():
            path, label = folder / name, f"{addon} {version} {name}"
            try:
                raw = path.read_bytes()
            except OSError:
                lines.append(f"{label}: file is gone")
                continue
            crlf = b"\r\n" in raw
            text = raw.decode("utf-8").replace("\r\n", "\n")
            patched, done, misfits = plan(text, file_patches)
            if misfits:
                digest = hashlib.sha256(raw).hexdigest()
                misfit_now[f"{addon}/{name}"] = digest
                new_misfit |= reported.get(f"{addon}/{name}") != digest
                lines.append(f"{label}: NOT PATCHED, the addon changed here: {'; '.join(misfits)}")
            elif not done:
                lines.append(f"{label}: already patched")
            elif check:
                lines.append(f"{label}: would patch {len(done)} ({'; '.join(done)})")
            else:
                keep = backups / f"{addon}-{version}" / name
                if not keep.exists():
                    keep.parent.mkdir(parents=True, exist_ok=True)
                    keep.write_bytes(raw)
                path.write_bytes((patched.replace("\n", "\r\n") if crlf else patched).encode("utf-8"))
                lines.append(f"{label}: patched {len(done)} ({'; '.join(done)})")

    if not check and misfit_now != reported:
        backups.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"misfits": misfit_now}, indent=1), encoding="utf-8")
    return (2 if new_misfit else 0), lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--addons", type=Path, default=DEFAULT_ADDONS)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    code, lines = run(args.addons, args.check)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main())

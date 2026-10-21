# Rules for editing Levi's WoW Forever addons

Learned in earlier sessions. Keep this current when a patch-day run teaches something new.

- The game is WoW Forever (`## Interface: 16001` for client 1.60.1): the beta in `_classic_beta_` until 2026-10-23, then
  the new client in `_forever_` (`wow\wow_client.py` picks). Levi plays with a
  controller (gamepad UI). Every button or panel must work with the controller, and anything that taints the
  interface makes his controller buttons stop working.
- Never hook a Blizzard object's method: no `hooksecurefunc(WorldMapFrame, ...)`, no `hooksecurefunc(GameTooltip,
  "SetOwner"/"Hide"/"ClearLines")`. On Forever this breaks Blizzard's own calls ("attempt to call a nil value"
  with no addon in the stack). `HookScript` on frames, `TooltipDataProcessor` calls and `EventRegistry` callbacks are
  safe. It can also taint the controller without any error: Spoken_Quests' `hooksecurefunc(QuestObjectiveTracker,
  "AddBlock")` (2026-10-17) made X open one NPC or mailbox per /reload. The fix that worked: read the same state on a
  timer (`module.usedBlocks` four times a second) instead of hooking.
- Forever's own SmartNavigation hooks the global `CreateFrame` and rebuilds an open panel's buttons in the taint of
  whoever made the frame: create a frame with no parent, then `SetParent` it (Spoken's `Utils:CreateDetachedFrame`).
- Never register with Blizzard's world map (`WorldMapFrame:AddDataProvider`, native pins): it taints the gamepad
  action bar. Map addons draw their own frames on `WorldMapFrame:GetCanvas()` and poll.
- `C_TradeSkillUI.CraftRecipe` only works inside a button's OnClick on Forever, never from a timer.
- Several Claude sessions edit AuctionatorForeverPrices and ForeverAutoMailer. Change only the lines the patch makes
  wrong. Leave `## Version:` lines alone and do not make `.bak` files: the patch job keeps its own backup.
- File line endings differ (most are LF, Context.lua and the mailer README are CRLF). Keep whatever the file has.
- `## Interface:` numbers: only change them when the notes or the build number show a new interface version
  (1.60.1 -> 16001, so 1.60.2 would be 16002), and change every addon's TOC the same way. Say it is unverified until
  Levi logs in.
- Third-party addons (Questie, Bagnon, MapUtils, DungeonJourney, Spoken*) can be fixed too, but their updates
  overwrite the fix. `..\addon-hook-patches\patch_addon_hooks.py` already re-applies the hook fixes before every
  launch; mention in the report when a third-party fix will need the same treatment.

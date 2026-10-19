# What is known about WoW crashes and hangs on this PC

Given to Claude with every crash report (watch_crashes.py). Keep it short and current: add what a session proves,
remove what turns out wrong, and say when something is only a suspicion.

## The game

- WoW Classic "Forever" beta, `D:\Games\World of Warcraft\_classic_beta_`, program `WowB.exe`. Levi plays with a
  controller (8BitDo Ultimate 2) and the game's own controller interface.
- The taint log is on at level 2 when the game is started from the "WoW Forever" taskbar shortcut. A start from
  Battle.net leaves it as it was, so a missing taint log does not mean nothing was tainted.

## The hang seen since 2026-09-30 (more than 49 times by 2026-10-09)

- Windows logs "Application Hang" for WowB.exe; Blizzard writes no crash text.
- Mechanism read from taint logs: an addon's code taints the controller interface's shared state
  (GamepadSharedUtility: InputBindingManager, FrameControlsManager, SmartNavigation). After that every popup or panel
  that shows or hides calls the protected `SetPreferredGamepadInteractTarget()`, which is blocked, hundreds of times a
  second, until the game stops answering and Windows closes it.
- It often starts when a menu closes: the game menu, Settings, a popup.
- Build 1.60.1.70291 (2026-10-08) reworked the controller interface and the hangs came back in a burst that
  evening. 70334 (2026-10-09) still hangs.
- Addons blamed in a log so far: whichever addon's global was read first by the tainted path. The name in "taint
  from X" is the addon whose value was touched, which is not always the addon whose code is wrong.
- One hang (2026-10-08 22:25) was caused by a `/run` command typed in chat: `/run` and `/script` taint whatever they
  touch.
- Bagnon is not the cause. It and its parts (Bagnon, Bagnon_Bank, Bagnon_Config, Bagnon_GuildBank, BagBrother) were
  switched off for both characters at 18:10 on 2026-10-09, after the 17:54 hang's log blamed Bagnon. The game hung
  again at 18:59, under four minutes after a start, with no Bagnon line in the taint log. That log blames
  Spoken_Zones 1176 times, starting when the world map closed (`TOGGLEWORLDMAP`).
- So the blamed addon changes from hang to hang (Bagnon on closing Settings, Spoken_Zones on closing the map) while
  the failure stays the same. Do not call the blamed addon the cause on the log's word alone.
- The 18:59 log has no "Execution tainted by Spoken_Zones" line, so it does not show how Spoken_Zones got into the
  controller code. What it does show: `FrameControlsManager.lua:641` reads the manager's `focusedFrame` and is
  tainted there on every pass, so that field was written while Spoken_Zones' taint was live.
- What repeats in the 18:59 log: `StaticPopup1:Hide()` 1173 times in 13 seconds, each reached from
  `SetUIFocusState(false)` in the `GLOBAL_REGION_MOUSE_DOWN` handler (`FrameControlsManager.lua:686`), each ending
  in the blocked call. The log does not show what makes it repeat.
- The 19:02 hang the same evening was the same again: one minute into the session, on closing the world map,
  Spoken_Zones blamed 1878 times. At 18:07 that day our own launch patcher (`wow\addon-hook-patches`) had rewritten
  two Spoken_Zones hooks on the map (SetAlpha, OnMapChanged) as per-frame readers that are children of the map. No
  log from before 18:07 blames Spoken_Zones for a blocked call, and both sessions after it hung on a map close.
  How those readers would taint the map is not shown by any file. The patch was taken out that evening (the
  patcher puts Spoken_Zones' own code back at the next start from the WoW Forever shortcut). Test running from
  then: a hang on closing the map that still blames Spoken_Zones means the addon as its author wrote it does this,
  not our patch; say which it is. Questie (Krowi_WorldMapButtons), QuestieForeverGamepad and MapUtils still carry
  the same kind of patch: say so if a log blames one of them on a map close.
- 2026-10-12 10:50: with Spoken_Zones' own SetAlpha hook back, the game's movement fader failed on the open map every
  frame ("attempt to call a nil value", PlayerMovementFrameFader.lua:9, 118 times). From then on the patcher only
  removes that hook and adds no per-frame reader on the map (its OnMapChanged hook in Core.lua is still as the author
  wrote it). A hang on closing the map that blames Spoken_Zones after this is not the old reader.
- 2026-10-12 11:19:38 hang, build 70338: within about 20 s of a /reload (Levi: "reload>crash"), the reload that
  loaded Forever Shared Prices 2026-10-12.3 (its Discard/Sell and Unignore bag buttons moved into a holder outside
  the bag window). The reload before, with only Unignore moved (.2), did not hang. The taint log was empty: the game
  writes it in batches, so a hang loses the last lines. Main.lua was put back as before .2 (version .4). A hang on
  a reload with .4 or later means .3 was not the cause.
- 2026-10-15.22 of Forever Shared Prices moves Blizzard's bag search box (BagItemSearchBox) to the right end of its
  line, from a per-frame watcher on the open combined bag, because the game puts it back on every bag update. No hook;
  only the box's anchor changes. Untested in the game when made: a hang or controller fault with the bag open, or on
  focusing its search, after that version is a suspect for it; say so.
- SkyborneLeyLineConvergenceMarker puts its pins into the world map (AddDataProvider / AcquirePin). With the
  controller interface, opening the map then taints the gamepad bindings: RunBinding(), DescendStop() and
  SetPreferredGamepadInteractTarget() blocked, blamed on it, and the face buttons stop working. Hand-patched on
  2026-10-03 to draw its own pins on the map canvas. The 0.3.1 update (installed 2026-10-12 09:38) undid that,
  and it came back 2026-10-13. Since then the launch patcher (`wow\addon-hook-patches`) applies the patch, so an
  update that still fits gets it back at the next start, and one that doesn't is reported as NOT PATCHED. The first
  overlay put the pins just above the canvas, under the map's explored-area layer (frame levels near 2000), so pins
  in explored areas were hidden. They now use the map's area-POI level, as the addon's own template did.
- Not yet done: a session with every addon off, to separate Blizzard's own bug from addon taint.

## Crashes with a crash text (Errors folder)

- 2026-10-03 and 2026-10-04, build 70205: "ERROR #8 Out of Memory ... CPUIntermediateTextureAllocator". Not looked
  into; none since.

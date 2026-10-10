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
- Not yet done: a session with every addon off, to separate Blizzard's own bug from addon taint.

## Crashes with a crash text (Errors folder)

- 2026-10-03 and 2026-10-04, build 70205: "ERROR #8 Out of Memory ... CPUIntermediateTextureAllocator". Not looked
  into; none since.

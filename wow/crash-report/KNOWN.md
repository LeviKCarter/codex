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
- Not yet done: a session with every addon off, to separate Blizzard's own bug from addon taint.

## Crashes with a crash text (Errors folder)

- 2026-10-03 and 2026-10-04, build 70205: "ERROR #8 Out of Memory ... CPUIntermediateTextureAllocator". Not looked
  into; none since.

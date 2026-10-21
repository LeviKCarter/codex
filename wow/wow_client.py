"""Which WoW Forever client the wow tools work on, the beta or the new one.

The Forever beta (`_classic_beta_`, WowB.exe, Battle.net product wow_classic_beta) closes on 2026-10-23; the stress
test of 2026-10-21 and the 2026-11-04 launch run on the client Battle.net installs as `_forever_` (Wow.exe, product
wowf), with the same 1.60.1 build line, so `## Interface: 16001` holds for both.

%LOCALAPPDATA%\\PulseAgent\\wow-client.txt says which one: `forever` or `beta`. With no file (or anything else in
it), the new client once its Wow.exe is installed, else the beta. ..\\wow\\forever-uptime\\ForeverCommon.ps1 reads the
same file the same way, and Set-WoWClient.ps1 there writes it.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

WOW_ROOT = Path(r"D:\Games\World of Warcraft")
# name: (folder in WOW_ROOT, program, Battle.net product)
CLIENTS = {
    "forever": ("_forever_", "Wow.exe", "wowf"),
    "beta": ("_classic_beta_", "WowB.exe", "wow_classic_beta"),
}
CHOICE_FILE = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "PulseAgent" / "wow-client.txt"


def client(root: Path = WOW_ROOT, choice: Path = CHOICE_FILE) -> str:
    try:
        said = choice.read_text(encoding="utf-8-sig").strip().lower()
    except OSError:
        said = ""
    if said in CLIENTS:
        return said
    folder, exe, _ = CLIENTS["forever"]
    return "forever" if (root / folder / exe).is_file() else "beta"


def game_dir(root: Path = WOW_ROOT, choice: Path = CHOICE_FILE) -> Path:
    return root / CLIENTS[client(root, choice)][0]


def addons_dir(root: Path = WOW_ROOT, choice: Path = CHOICE_FILE) -> Path:
    return game_dir(root, choice) / "Interface" / "AddOns"


def product(root: Path = WOW_ROOT, choice: Path = CHOICE_FILE) -> str:
    return CLIENTS[client(root, choice)][2]

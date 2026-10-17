"""Full suite: AFP tests + ForeverAutoMailer tests. python run_suite.py [AFP folder] [mailer folder]

Exit code 0 only when every test file exits 0. stdin is closed and each test has a timeout.
"""
import subprocess
import sys
from pathlib import Path

ADDONS = Path(r"D:\Games\World of Warcraft\_classic_beta_\Interface\AddOns")
afp = Path(sys.argv[1]) if len(sys.argv) > 1 else ADDONS / "AuctionatorForeverPrices"
mailer = Path(sys.argv[2]) if len(sys.argv) > 2 else ADDONS / "ForeverAutoMailer"
PY = r"C:\Users\levik\miniforge3\python.exe"
QUEST = {"test_await", "test_quest_reward", "test_autolookup", "test_lookup", "test_pad_lookup"}
MAIN = {"test_merchant", "test_tooltip_errors", "test_recipe_merchant"}

failed, ran = [], 0
for folder, tests in ((afp, sorted((afp / "tests").glob("test_*.py"))), (mailer, sorted((mailer / "tests").glob("test_*.py")))):
    for test in tests:
        name = test.stem
        arg = str(folder)
        if folder == afp and name in QUEST:
            arg = str(folder / "QuestItem.lua")
        elif folder == afp and name in MAIN:
            arg = str(folder / "Main.lua")
        try:
            done = subprocess.run([PY, str(test), arg], cwd=str(test.parent), stdin=subprocess.DEVNULL,
                                  capture_output=True, text=True, timeout=300)
            code, out = done.returncode, (done.stdout + done.stderr).strip()
        except subprocess.TimeoutExpired:
            code, out = "timeout", ""
        ran += 1
        last = out.splitlines()[-1] if out else ""
        print("%-4s %s/%s  %s" % ("ok" if code == 0 else "FAIL", folder.name, name, last[:150]))
        if code != 0:
            failed.append((folder.name + "/" + name, out[-1500:]))
print("\n%d files, %d failed" % (ran, len(failed)))
for name, out in failed:
    print("\n--- " + name + "\n" + out)
sys.exit(1 if failed else 0)

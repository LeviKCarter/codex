"""python -m unittest test_wow_client.py (from this folder)"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import wow_client


class WowClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.choice = self.root / "wow-client.txt"
        (self.root / "_classic_beta_").mkdir()
        (self.root / "_classic_beta_" / "WowB.exe").write_bytes(b"")

    def tearDown(self):
        self.tmp.cleanup()

    def install_forever(self):
        (self.root / "_forever_").mkdir()
        (self.root / "_forever_" / "Wow.exe").write_bytes(b"")

    def test_beta_until_the_new_client_is_installed(self):
        self.assertEqual(wow_client.client(self.root, self.choice), "beta")
        (self.root / "_forever_").mkdir()  # Battle.net makes the folder before the program is in it
        self.assertEqual(wow_client.client(self.root, self.choice), "beta")

    def test_the_new_client_once_installed(self):
        self.install_forever()
        self.assertEqual(wow_client.game_dir(self.root, self.choice), self.root / "_forever_")
        self.assertEqual(wow_client.addons_dir(self.root, self.choice), self.root / "_forever_" / "Interface" / "AddOns")
        self.assertEqual(wow_client.product(self.root, self.choice), "wowf")

    def test_the_file_decides(self):
        self.install_forever()
        self.choice.write_text("beta\r\n", encoding="utf-8-sig")
        self.assertEqual(wow_client.game_dir(self.root, self.choice), self.root / "_classic_beta_")
        self.assertEqual(wow_client.product(self.root, self.choice), "wow_classic_beta")
        self.choice.write_text("Forever", encoding="utf-8")
        self.assertEqual(wow_client.client(self.root, self.choice), "forever")

    def test_a_word_it_does_not_know_is_ignored(self):
        self.install_forever()
        self.choice.write_text("classic", encoding="utf-8")
        self.assertEqual(wow_client.client(self.root, self.choice), "forever")


if __name__ == "__main__":
    unittest.main()

"""scripts/wisp_package.py's gate on the source it reads (RV-1188, RV-1189): a symlinked or outside file refused, a file
not of the pinned commit refused, an archive member over the size cap refused before it's read; the action table's
shape. Made-up trees and archives; nothing of the bot's.

Usage: python -I scripts/wisp_package_test.py   (needs numpy and onnx, as wisp_package.py)
"""
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wisp_package  # noqa: E402


class Gate(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.src = self.root / "src-tree"
        (self.src / "src/models").mkdir(parents=True)
        for rel in wisp_package.MODELS:
            (self.src / rel).write_bytes(b"made up")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_a_symlinked_licence_is_refused(self) -> None:
        secret = self.root / "elsewhere.txt"
        secret.write_text("a local file")
        os.symlink(secret, self.src / "LICENSE")
        with self.assertRaises(SystemExit) as raised:
            wisp_package.regular(self.src, "LICENSE")
        self.assertIn("not a regular file", str(raised.exception))
        with self.assertRaises(SystemExit):
            wisp_package.verified(self.src)

    def test_a_file_reached_through_a_symlinked_folder_is_refused(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "LICENSE").write_text("a local file")
        os.symlink(outside, self.src / "linked")
        with self.assertRaises(SystemExit):
            wisp_package.regular(self.src, "linked/LICENSE")

    def test_files_not_of_the_pinned_commit_are_refused(self) -> None:
        (self.src / "LICENSE").write_text("MIT, but another file")
        with self.assertRaises(SystemExit) as raised:
            wisp_package.verified(self.src)
        self.assertIn("not the file of", str(raised.exception))

    def test_an_oversized_archive_member_is_refused_before_it_is_read(self) -> None:
        path = self.root / "big.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("archive/data/0", b"\0" * (wisp_package.MAX_MEMBER + 1))
            z.writestr("archive/byteorder", b"little")
        with zipfile.ZipFile(path) as z:
            self.assertEqual(wisp_package.member(z, "archive/byteorder"), b"little")
            with self.assertRaises(SystemExit) as raised:
                wisp_package.member(z, "archive/data/0")
        self.assertIn("over", str(raised.exception))


class Table(unittest.TestCase):
    def test_the_action_table(self) -> None:
        rows = wisp_package.action_table()
        self.assertEqual(len(rows), 90)
        self.assertTrue(all(len(r) == 8 for r in rows))


if __name__ == "__main__":
    unittest.main()

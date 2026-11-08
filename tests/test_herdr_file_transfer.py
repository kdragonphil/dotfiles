import io
import json
from pathlib import Path
import runpy
import tarfile
import tempfile
import unittest


MODULE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "herdr-app/mods/files-plus/transfer.py"))


class FileTransferTests(unittest.TestCase):
    def test_local_copy_steps_finish_large_file_without_a_detached_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.bin"
            source.write_bytes(bytes(range(256)) * 70000)
            target = root / "destination"
            target.mkdir()
            job = root / "herdr-files-transfer-test"
            job.mkdir()
            (job / "local.json").write_text(json.dumps({"pending": [{"op": "entry", "source": str(source), "directory": str(target), "top": True}], "created": [], "paths": []}))
            request = {"status": str(job / "status.json"), "local": True}
            steps = 0
            while True:
                result = MODULE["local_step"](request)
                steps += 1
                self.assertNotEqual(result["state"], "error", result)
                if result["state"] == "done":
                    break
            self.assertGreater(steps, 1)
            self.assertEqual((target / source.name).read_bytes(), source.read_bytes())

    def test_binary_collision_keeps_original_and_all_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "한글 'quote' [1] $() `name`.bin"
            source.write_bytes(bytes(range(256)) * 5000)
            destination = root / "destination"
            destination.mkdir()
            first = Path(MODULE["copy_unique"](source, destination))
            second = Path(MODULE["copy_unique"](source, destination))
            self.assertNotEqual(first, second)
            self.assertEqual(first.read_bytes(), source.read_bytes())
            self.assertEqual(second.read_bytes(), source.read_bytes())

    def test_folder_copy_preserves_hidden_files_and_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "folder"
            source.mkdir()
            (source / ".env").write_text("TEST_ONLY=1\n")
            (source / "link").symlink_to(".env")
            destination = root / "destination"
            destination.mkdir()
            archive = root / "files.tar"
            MODULE["pack"](str(source), archive)
            MODULE["unpack"](archive, destination)
            self.assertEqual((destination / "payload/.env").read_text(), "TEST_ONLY=1\n")
            self.assertTrue((destination / "payload/link").is_symlink())
            with self.assertRaises(ValueError):
                MODULE["copy_unique"](source, source)

    def test_archive_cannot_write_outside_staging_or_through_a_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, symlink in [("../escaped", False), ("payload/link/escaped", True)]:
                archive = root / "unsafe.tar"
                destination = root / ("link-test" if symlink else "path-test")
                destination.mkdir()
                with tarfile.open(archive, "w") as output:
                    if symlink:
                        link = tarfile.TarInfo("payload/link")
                        link.type = tarfile.SYMTYPE
                        link.linkname = str(root)
                        output.addfile(link)
                    member = tarfile.TarInfo(name)
                    member.size = 1
                    output.addfile(member, io.BytesIO(b"x"))
                with self.assertRaises(ValueError):
                    MODULE["unpack"](archive, destination)
                self.assertFalse((root / "escaped").exists())


if __name__ == "__main__":
    unittest.main()

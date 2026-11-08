#!/usr/bin/env python3
"""File copies and Finder clipboard access over existing Herdr connections."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

CORE = shutil.which("hc") or str(Path.home() / ".local/bin/hc")


def copy_unique(source, directory, name=None):
    source, directory = Path(source), Path(directory)
    if not source.is_absolute() or not directory.is_absolute():
        raise ValueError("File paths must be absolute")
    if not os.path.lexists(source):
        raise ValueError("The source file is no longer available")
    if not directory.is_dir():
        raise ValueError("The destination folder is no longer available")
    if source.is_dir() and not source.is_symlink() and directory.resolve().is_relative_to(source.resolve()):
        raise ValueError("A folder cannot be copied into itself or a descendant")
    name = name or source.name
    if not name or name in (".", "..") or "/" in name or "\0" in name:
        raise ValueError("Invalid file name")
    stem, suffix = os.path.splitext(name) if not source.is_dir() else (name, "")
    for index in range(10000):
        candidate = name if not index else f"{stem} copy{f' {index}' if index > 1 else ''}{suffix}"
        target = directory / candidate
        try:
            if source.is_symlink():
                os.symlink(os.readlink(source), target)
                return str(target)
            if source.is_dir():
                target.mkdir()
                try:
                    shutil.copytree(source, target, symlinks=True, dirs_exist_ok=True)
                except Exception:
                    shutil.rmtree(target)
                    raise
                return str(target)
            with target.open("xb") as output:
                try:
                    with source.open("rb") as incoming:
                        shutil.copyfileobj(incoming, output)
                    shutil.copystat(source, target)
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
            return str(target)
        except FileExistsError:
            continue
    raise ValueError("No available copy name in this folder")


def checked(args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=1800)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "File transfer failed")
    return result.stdout


def core(machine, request):
    # stdin carries binary chunks as base64 JSON, never interpolated into a shell.
    source = Path(__file__).read_text()
    result = subprocess.run([CORE, "exec", "--on", machine, "--timeout", "600", "-i", "python3", "-c", source, "remote"],
                            input=json.dumps(request), text=True, capture_output=True, timeout=650)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Remote file transfer failed")
    return json.loads(result.stdout)


CHUNK = 1024 * 1024


def digest(path):
    value = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            value.update(chunk)
    return value.hexdigest()


def pack(source, archive):
    if not os.path.isabs(source) or not os.path.lexists(source):
        raise ValueError("The source file is no longer available")
    with tarfile.open(archive, "w", dereference=False) as output:
        output.add(source, arcname="payload", recursive=True)


def unpack(archive, directory):
    # Preserve links, but never extract an entry through one or outside staging.
    directory = Path(directory).resolve()
    directories = []
    with tarfile.open(archive, "r") as incoming:
        for member in incoming:
            parts = Path(member.name).parts
            if not parts or parts[0] != "payload" or ".." in parts or Path(member.name).is_absolute():
                raise ValueError("Unsafe path in file transfer")
            target = directory / member.name
            if not target.parent.resolve().is_relative_to(directory):
                raise ValueError("Unsafe link in file transfer")
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
                directories.append((target, member))
            elif member.issym():
                os.symlink(member.linkname, target)
            elif member.islnk():
                link = directory / member.linkname
                if not link.resolve().is_relative_to(directory):
                    raise ValueError("Unsafe hard link in file transfer")
                os.link(link, target)
            elif member.isfile():
                with incoming.extractfile(member) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
            else:
                raise ValueError("Only regular files, folders and links can be copied")
            if not member.issym() and not member.isdir():
                os.chmod(target, member.mode & 0o777)
                os.utime(target, (member.mtime, member.mtime))
    # Apply read-only directory modes after their children have been extracted.
    for target, member in reversed(directories):
        os.chmod(target, member.mode & 0o777)
        os.utime(target, (member.mtime, member.mtime))


def transfer(source, destination):
    src, host = source["path"], source.get("on")
    directory, machine = destination["dir"], destination.get("on")
    if not os.path.isabs(src) or not os.path.isabs(directory):
        raise ValueError("File paths must be absolute")
    if host and machine:
        raise ValueError("Paste via this Mac to transfer between remote machines")
    if not host and not machine:
        return copy_unique(src, directory)
    if machine:
        stage = core(machine, {"action": "prepare", "dir": directory})["stage"]
        try:
            with tempfile.TemporaryDirectory(prefix="herdr-upload-") as local:
                archive = Path(local) / "files.tar"
                pack(src, archive)
                offset = 0
                with archive.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(CHUNK), b""):
                        core(machine, {"action": "append", "stage": stage, "dir": directory,
                                       "offset": offset, "data": base64.b64encode(chunk).decode("ascii")})
                        offset += len(chunk)
                return core(machine, {"action": "commit", "stage": stage, "dir": directory,
                                      "name": Path(src).name, "sha256": digest(archive)})["path"]
        finally:
            core(machine, {"action": "cleanup", "stage": stage, "dir": directory})
    exported = core(host, {"action": "export", "path": src})
    try:
        with tempfile.TemporaryDirectory(prefix="herdr-download-") as local:
            archive = Path(local) / "files.tar"
            with archive.open("wb") as output:
                for offset in range(0, exported["size"], CHUNK):
                    chunk = core(host, {"action": "read", "stage": exported["stage"], "dir": exported["dir"], "offset": offset})
                    output.write(base64.b64decode(chunk["data"], validate=True))
            if digest(archive) != exported["sha256"]:
                raise ValueError("The downloaded file did not pass its integrity check")
            unpack(archive, local)
            return copy_unique(Path(local) / "payload", directory, Path(src).name)
    finally:
        core(host, {"action": "cleanup", "stage": exported["stage"], "dir": exported["dir"]})


def remote(request):
    action = request["action"]
    if action == "export":
        stage = Path(tempfile.mkdtemp(prefix=".herdr-transfer-"))
        try:
            archive = stage / "files.tar"
            pack(request["path"], archive)
            return {"stage": str(stage), "dir": str(stage.parent), "size": archive.stat().st_size, "sha256": digest(archive)}
        except Exception:
            shutil.rmtree(stage)
            raise
    directory = Path(request["dir"])
    if not directory.is_absolute() or not directory.is_dir():
        raise ValueError("The destination folder is no longer available")
    if action == "prepare":
        return {"stage": tempfile.mkdtemp(prefix=".herdr-transfer-", dir=directory)}
    stage = Path(request["stage"])
    if stage.parent != directory or not stage.name.startswith(".herdr-transfer-"):
        raise ValueError("Invalid transfer folder")
    if action == "cleanup":
        shutil.rmtree(stage, ignore_errors=True)
        return {"ok": True}
    if action == "commit":
        if digest(stage / "files.tar") != request["sha256"]:
            raise ValueError("The uploaded file did not pass its integrity check")
        unpack(stage / "files.tar", stage)
        return {"path": copy_unique(stage / "payload", directory, request["name"])}
    if action == "append":
        with (stage / "files.tar").open("ab") as output:
            if output.tell() != request["offset"]:
                raise ValueError("The upload position changed; try again")
            output.write(base64.b64decode(request["data"], validate=True))
        return {"ok": True}
    if action == "read":
        with (stage / "files.tar").open("rb") as stream:
            stream.seek(request["offset"])
            return {"data": base64.b64encode(stream.read(CHUNK)).decode("ascii")}
    raise ValueError("Unknown transfer operation")


def status(job, value):
    path = Path(job) / "status.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.replace(path)


def worker(job):
    paths = []
    try:
        request = json.loads((Path(job) / "request.json").read_text())
        for source in request["sources"]:
            paths.append(transfer(source, request["destination"]))
            status(job, {"state": "working", "paths": paths})
        status(job, {"state": "done", "paths": paths})
    except Exception as error:
        status(job, {"state": "error", "error": str(error), "paths": paths})


def reserve_copy(source, directory, kind):
    name = source.name
    stem, suffix = os.path.splitext(name) if kind == "file" else (name, "")
    for index in range(10000):
        target = directory / (name if not index else f"{stem} copy{f' {index}' if index > 1 else ''}{suffix}")
        try:
            if kind == "dir":
                target.mkdir()
            elif kind == "link":
                os.symlink(os.readlink(source), target)
            else:
                target.open("xb").close()
            return target
        except FileExistsError:
            continue
    raise ValueError("No available copy name in this folder")


def local_step(job):
    """Bounded local I/O stays a child of Herdr, retaining its macOS consent."""
    directory = Path(job["status"]).parent
    state_path = directory / "local.json"
    state = json.loads(state_path.read_text())
    deadline = time.monotonic() + 0.5
    copied = 0
    try:
        while state["pending"] and time.monotonic() < deadline and copied < 16 * CHUNK:
            task = state["pending"].pop()
            source = Path(task["source"])
            if task["op"] == "entry":
                parent = Path(task["directory"])
                if not source.is_absolute() or not parent.is_absolute() or not parent.is_dir():
                    raise ValueError("The destination folder is no longer available")
                mode = source.lstat()
                if source.is_symlink():
                    kind = "link"
                elif source.is_dir():
                    kind = "dir"
                    if parent.resolve().is_relative_to(source.resolve()):
                        raise ValueError("A folder cannot be copied into itself or a descendant")
                elif source.is_file():
                    kind = "file"
                else:
                    raise ValueError("Only regular files, folders and links can be copied")
                target = reserve_copy(source, parent, kind)
                if task.get("top"):
                    state["created"].append(str(target))
                    state["pending"].append({"op": "complete", "source": str(source), "path": str(target)})
                if kind == "dir":
                    state["pending"].append({"op": "metadata", "source": str(source), "path": str(target)})
                    for child in reversed(sorted(source.iterdir())):
                        state["pending"].append({"op": "entry", "source": str(child), "directory": str(target)})
                elif kind == "file":
                    state["pending"].append({"op": "file", "source": str(source), "path": str(target),
                                             "offset": 0, "size": mode.st_size, "mtime": mode.st_mtime_ns})
            elif task["op"] == "file":
                target = Path(task["path"])
                current = source.stat()
                if current.st_size != task["size"] or current.st_mtime_ns != task["mtime"]:
                    raise ValueError("The source file changed during copying; try again")
                with source.open("rb") as incoming, target.open("r+b") as output:
                    incoming.seek(task["offset"])
                    if output.seek(0, 2) != task["offset"]:
                        raise ValueError("The destination changed during copying")
                    chunk = incoming.read(CHUNK)
                    output.write(chunk)
                task["offset"] += len(chunk)
                copied += len(chunk)
                if task["offset"] < task["size"]:
                    state["pending"].append(task)
                else:
                    shutil.copystat(source, target)
            elif task["op"] == "metadata":
                shutil.copystat(source, task["path"])
            elif task["op"] == "complete":
                state["paths"].append(task["path"])
        state_path.write_text(json.dumps(state))
        result = {"state": "working" if state["pending"] else "done", "paths": state["paths"]}
    except Exception as error:
        message = str(error)
        for path in set(state["created"]) - set(state["paths"]):
            try:
                target = Path(path)
                if target.is_dir() and not target.is_symlink():
                    shutil.rmtree(target)
                else:
                    target.unlink(missing_ok=True)
            except OSError:
                pass
        if isinstance(error, PermissionError):
            message = (f"macOS denied file access: {error.filename or source}. "
                       "Allow Herdr access to this folder in System Settings → Privacy & Security → Files & Folders, then retry.")
        result = {"state": "error", "error": message, "paths": state["paths"]}
    status(directory, result)
    return result


CLIPBOARD_READ = r'''
ObjC.import('AppKit');
function run(argv) {
    var pasteboard = argv.length ? $.NSPasteboard.pasteboardWithName($(argv[0])) : $.NSPasteboard.generalPasteboard;
    var options = $.NSDictionary.dictionaryWithObjectForKey($(true), $.NSPasteboardURLReadingFileURLsOnlyKey);
    var urls = pasteboard.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), options);
    var paths = [];
    for (var i = 0; i < Number(urls.count); i++) paths.push(ObjC.unwrap(urls.objectAtIndex(i).path));
    return JSON.stringify(paths);
}
'''
CLIPBOARD_WRITE = r'''
ObjC.import('AppKit');
function run(argv) {
    var name = argv.shift();
    // Materialize file URLs eagerly; NSURL's lazy pasteboard provider would
    // disappear as soon as the osascript helper exits.
    var items = $.NSMutableArray.alloc.init;
    argv.forEach(function(path) {
        var item = $.NSPasteboardItem.alloc.init;
        item.setStringForType($.NSURL.fileURLWithPath($(path)).absoluteString, $('public.file-url'));
        items.addObject(item);
    });
    var pasteboard = name ? $.NSPasteboard.pasteboardWithName($(name)) : $.NSPasteboard.generalPasteboard;
    pasteboard.clearContents;
    pasteboard.writeObjects(items);
    if (Number(pasteboard.pasteboardItems.count) !== argv.length) throw new Error('Cannot copy files to Finder clipboard');
    return 'ok';
}
'''


def main():
    global CORE
    operation = sys.argv[1]
    if operation == "remote":
        print(json.dumps(remote(json.loads(sys.stdin.read()))))
    elif operation == "worker":
        if len(sys.argv) > 3:
            CORE = sys.argv[3]
        worker(sys.argv[2])
    elif operation == "start":
        request = json.loads(sys.argv[2])
        if not request.get("sources"):
            raise ValueError("No files selected")
        job = tempfile.mkdtemp(prefix="herdr-files-transfer-")
        (Path(job) / "request.json").write_text(json.dumps(request), encoding="utf-8")
        status(job, {"state": "working", "paths": []})
        if not request["destination"].get("on") and all(not source.get("on") for source in request["sources"]):
            state = {"pending": [{"op": "entry", "source": source["path"], "directory": request["destination"]["dir"], "top": True}
                                 for source in reversed(request["sources"])], "created": [], "paths": []}
            (Path(job) / "local.json").write_text(json.dumps(state))
            print(json.dumps({"status": str(Path(job) / "status.json"), "local": True}))
            return
        # Herdr ends descendants when exec returns. launchd owns the copy job so
        # large files can finish without being cut off by the 30-second limit.
        label = "com.herdr.filesplus." + Path(job).name.removeprefix("herdr-files-transfer-")
        checked(["/bin/launchctl", "submit", "-l", label, "--", sys.executable,
                 str(Path(__file__).resolve()), "worker", job, CORE])
        print(json.dumps({"status": str(Path(job) / "status.json"), "label": label}))
    elif operation == "step":
        print(json.dumps(local_step(json.loads(sys.argv[2]))))
    elif operation == "finish":
        job = json.loads(sys.argv[2])
        if not job.get("local") and not re.fullmatch(r"com\.herdr\.filesplus\.[\w-]+", job["label"]):
            raise ValueError("Invalid transfer job")
        directory = Path(job["status"]).parent
        if not directory.name.startswith("herdr-files-transfer-"):
            raise ValueError("Invalid transfer status")
        if not job.get("local"):
            subprocess.run(["/bin/launchctl", "remove", job["label"]], capture_output=True)
        shutil.rmtree(directory)
        print(json.dumps({"ok": True}))
    elif operation == "cache":
        parent = Path(sys.argv[2])
        parent.mkdir(parents=True, exist_ok=True)
        print(json.dumps({"dir": tempfile.mkdtemp(prefix="clipboard-", dir=parent)}))
    elif operation == "cache-remove":
        directory = Path(sys.argv[2])
        if directory.parent.resolve() != (Path(__file__).parent / ".cache").resolve() or not directory.name.startswith("clipboard-"):
            raise ValueError("Invalid transfer cache")
        shutil.rmtree(directory)
        print(json.dumps({"ok": True}))
    elif operation == "clipboard-read":
        print(checked(["/usr/bin/osascript", "-l", "JavaScript", "-e", CLIPBOARD_READ, *sys.argv[2:3]]).strip())
    elif operation == "clipboard-write":
        paths = json.loads(sys.argv[2])
        if not paths or any(not os.path.isabs(path) or not os.path.lexists(path) for path in paths):
            raise ValueError("The copied file is no longer available")
        checked(["/usr/bin/osascript", "-l", "JavaScript", "-e", CLIPBOARD_WRITE, sys.argv[3] if len(sys.argv) > 3 else "", *paths])
        print(json.dumps({"ok": True}))
    else:
        raise ValueError("Unknown file operation")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

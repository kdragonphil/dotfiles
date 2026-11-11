import { exec, appHome, readTextFile, window, pickFolder, shared, setShared, notify } from "herdr";
import { copySelection } from "./selection.js";

const CLIPBOARD = "files-plus.clipboard", REVISION = "files-plus.revision";
export const nativeFiles = () => window()?.platform === "macos";
const helper = () => `${appHome()}/mods/files-plus/transfer.py`;

async function operation(name, argument) {
  const result = await exec("python3", [helper(), name, ...(argument === undefined ? [] : [typeof argument === "string" ? argument : JSON.stringify(argument)])]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "File operation failed");
  return JSON.parse(result.stdout);
}

export async function transferFiles(sources, destination, cx) {
  if (destination.on && !destination.staged && sources.some(source => !source.on)) {
    const cache = await operation("cache", `${appHome()}/mods/files-plus/.cache`);
    try {
      const staged = await transferFiles(sources, { dir: cache.dir, on: null }, cx);
      return await transferFiles(staged.map(path => ({ path, on: null })), { ...destination, staged: true }, cx);
    } finally { await operation("cache-remove", cache.dir).catch(() => null); }
  }
  if (!destination.on && sources.some(source => source.on) && !destination.staged) {
    const cache = await operation("cache", `${appHome()}/mods/files-plus/.cache`);
    try {
      const downloaded = await transferFiles(sources, { dir: cache.dir, on: null, staged: true }, cx);
      return await transferFiles(downloaded.map(path => ({ path, on: null })), destination, cx);
    } finally { await operation("cache-remove", cache.dir).catch(() => null); }
  }
  const request = {
    sources: sources.map(source => ({ path: source.path, on: source.on || null })),
    destination: { dir: destination.dir, on: destination.on || null },
  };
  const job = await operation("start", request);
  // The worker streams files independently of Herdr's 30-second exec limit.
  for (;;) {
    const text = job.local ? null : await readTextFile(job.status);
    if (!job.local && !text) throw new Error("The file transfer status is unavailable");
    const result = job.local ? await operation("step", job) : JSON.parse(text);
    if (result.state === "done" || result.state === "error") {
      await operation("finish", job).catch(() => null);
      if (result.state === "done") return result.paths;
      throw new Error(`${result.error}${result.paths.length ? ` (${result.paths.length} already copied)` : ""}`);
    }
    await cx.sleep(500);
  }
}

export async function importFiles(paths, target, cx) {
  if (!paths?.length) throw new Error("먼저 Finder에서 파일을 복사하세요");
  const directory = target.kind === "file" ? target.path.slice(0, target.path.lastIndexOf("/")) || "/" : target.path;
  notify({ title: "파일 복사 중…", body: `${paths.length}개 → ${target.on || "이 Mac"}`, timeout: 2500 });
  const copied = await transferFiles(paths.map(path => ({ path, on: null })), { dir: directory, on: target.on }, cx);
  setShared(REVISION, (Number(shared(REVISION)) || 0) + 1);
  notify({ title: `파일 ${copied.length}개 복사됨`, body: directory, level: "success", timeout: 3000 });
  return copied;
}

export async function pasteFiles(target, cx) {
  const paths = await operation("clipboard-read");
  return importFiles(paths, target, cx);
}

export async function copyFile(target, cx) {
  const sources = copySelection(target.entries || [target]);
  let paths = sources.map(source => source.path);
  if (target.on) {
    notify({ title: "Mac 클립보드로 복사 중…", body: target.on, timeout: 2500 });
    const cache = await operation("cache", `${appHome()}/mods/files-plus/.cache`);
    paths = await transferFiles(sources, { dir: cache.dir, on: null, staged: true }, cx);
  }
  await operation("clipboard-write", paths);
  setShared(CLIPBOARD, { path: target.path, kind: target.kind, on: target.on, entries: sources });
  notify({ title: `${paths.length}개 항목 복사됨`, body: "Finder나 Files에서 ⌘V로 붙여넣기", level: "success", timeout: 3000 });
}

export async function saveToMac(target, cx) {
  const directory = await pickFolder({ prompt: "여기에 저장" });
  if (!directory) return;
  notify({ title: "Mac에 저장 중…", body: target.on || "이 Mac", timeout: 2500 });
  const copied = await transferFiles(copySelection(target.entries || [target]), { dir: directory, on: null }, cx);
  notify({ title: `${copied.length}개 항목 Mac에 저장됨`, body: directory, level: "success", timeout: 4000 });
  return copied;
}

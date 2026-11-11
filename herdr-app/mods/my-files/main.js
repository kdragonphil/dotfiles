// A lazy file browser for the focused pane's folder; local text files up to 400 KB open editable (cmd-s / 저장), others read-only.
// my-files: right-click a row (or empty space) for copy path / reveal / rename / trash (mod my-files-actions);
// drop files from Finder onto a folder row (or empty space) to copy them in.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, nextCommand, watchFolder, theme, settings, window, openOverlay, notify, shared, appHome } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000, EDIT_LIMIT = 400000;
const IMAGES = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "tif", "tiff"]);

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Reparse points keep directory attributes even when dangling; check their target.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Same items as my-files-actions' menu: copy path, (copy relative), copy name, then this Mac's reveal/open,
// then new file/new folder, then rename/trash (one separator before the new/rename group).
function menuHeight(path, dir, on) {
  const copies = path ? 3 : 2, local = on ? 0 : dir ? 1 : 2, create = 2, edit = path ? 2 : 0;
  return (copies + local + create + edit) * 31 + ((local ? 1 : 0) + 1) * 9 + 12;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.changed = shared("my-files.changed");
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    cx.spawn(async cx => { for (;;) { const c = await nextCommand(); if (c === "save") this.save(cx); cx.notify(); } });
  }

  // Saves the open text file. writeTextFile refuses if the file changed on disk since it was read.
  save(cx) {
    if (!this.code || !this.editable || this.saving) return;
    const text = this.code.value(), full = `${this.root}/${this.file}`, code = this.code;
    if (text === this.original) return;
    this.saving = true;
    cx.spawn(async cx => {
      try {
        await writeTextFile(full, text, this.original);
        if (this.code === code) { this.original = text; this.dirty = this.code.value() !== text; this.discard = false; }
        notify({ title: "저장됨", body: this.file, level: "success", timeout: 2000 });
      } catch (e) {
        notify({ title: "저장 실패", body: /stale|match|changed/i.test(String(e)) ? "다른 곳에서 파일이 바뀌었습니다. 내용을 복사해 두고 파일을 다시 여세요." : String(e), level: "error" });
      } finally { this.saving = false; cx.notify(); }
    });
  }

  // Back to the tree; with unsaved edits the first press only warns.
  back(cx) {
    if (this.dirty && !this.discard) { this.discard = true; cx.notify(); return; }
    this.show(null); cx.notify();
  }

  menu(path, dir, cx) {
    if (!this.root) return;
    openOverlay({ mod: "my-files-actions", kind: "popup", width: 230, height: menuHeight(path, dir, this.on),
      props: { view: "menu", root: this.root, path, dir, on: this.on } });
    cx.stop_propagation();
  }

  // Copies dropped Finder files into folder `into` (relative; "" is the root). Never overwrites.
  drop(paths, into, cx) {
    cx.stop_propagation();
    const now = Date.now();
    if (this.dropped && now - this.dropped < 300) return; // the row and the tree both heard this drop
    this.dropped = now;
    if (!this.root || !paths?.length) return;
    if (this.on) { notify({ title: "드롭 복사는 이 Mac 폴더에서만 됩니다", body: `${this.on}의 폴더에는 복사하지 않았습니다`, level: "warning" }); return; }
    const dir = into ? `${this.root}/${into}` : this.root;
    const script = 'dir=$1; shift; for s in "$@"; do b=${s##*/}; d="$dir/$b"; case "$dir/" in "$s"/*) printf "%s\\n" "$b"; continue;; esac; if [ -e "$d" ] || [ -L "$d" ]; then printf "%s\\n" "$b"; continue; fi; cp -R -- "$s" "$d" || exit 1; done';
    cx.spawn(async cx => {
      const r = await exec("sh", ["-c", script, "my-files", dir, ...paths]).catch(e => ({ code: 1, stderr: String(e), stdout: "" }));
      const skipped = r.stdout.split("\n").filter(Boolean);
      if (r.code !== 0) notify({ title: "복사 실패", body: r.stderr.trim(), level: "error" });
      else notify({ title: `${paths.length - skipped.length}개 복사됨 → ${into || this.root.split("/").pop()}`,
        body: skipped.length ? `같은 이름이 있어 건너뜀: ${skipped.join(", ")}` : undefined, level: skipped.length ? "warning" : "success", timeout: 3000 });
      if (into && !this.folders.has(into)) this.toggle(into, cx);
      this.refresh(cx);
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      const draft = this.dirty && this.code ? { file: this.file, code: this.code, original: this.original } : null;
      if (draft) this.code = null; // keep the unsaved editor alive instead of releasing it
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file, draft });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.draft) { this.file = saved.draft.file; this.code = saved.draft.code; this.original = saved.draft.original; this.editable = true; this.dirty = true; }
      else if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null; this.original = null; this.editable = false; this.dirty = false; this.discard = false; this.picture = null; this.pictureInfo = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    const kind = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
    if (IMAGES.has(kind)) {
      // image() only loads paths inside the app folder, so preview a copy in cache/my-files/ (one at a time).
      if (on) { this.fileError = "다른 머신의 이미지는 미리보기할 수 없습니다"; return; }
      const rel = `cache/my-files/${Date.now()}.${kind}`, src = `${root}/${path}`;
      cx.spawn(async cx => {
        const script = 'd=$(dirname "$2"); mkdir -p "$d" && rm -f "$d"/* && cp "$1" "$2" || exit 1; sips -g pixelWidth -g pixelHeight "$1" 2>/dev/null | awk \'/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w+0, h+0}\'; du -h "$1" | cut -f1';
        const r = await exec("sh", ["-c", script, "my-files", src, `${appHome()}/${rel}`]).catch(e => ({ code: 1, stderr: String(e) }));
        if (this.file !== path || !this.current(context)) return;
        if (r.code !== 0) { this.fileError = "이미지를 읽을 수 없습니다"; cx.notify(); return; }
        const [dims, size] = r.stdout.trim().split("\n"), [w, h] = dims.split(" ").map(Number);
        this.picture = { rel, w, h };
        this.pictureInfo = [w && h ? `${w}×${h}` : "", size].filter(Boolean).join(" · ");
        cx.notify();
      });
      return;
    }
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        // Editable when it's on this Mac and shown whole; otherwise a read-only preview.
        this.editable = !on && text.length <= EDIT_LIMIT; this.original = text;
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: !this.editable, soft_wrap: ext === "md" || ext === "txt",
          value: text.length > EDIT_LIMIT ? text.slice(0, EDIT_LIMIT) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
        const code = this.code;
        code.on("change", (_e, cx) => { if (this.code !== code) return; const d = code.value() !== this.original; if (d !== this.dirty) { this.dirty = d; this.discard = false; cx.notify(); } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_mouse_down("right", (_e, cx) => this.menu(path, entry.dir, cx))
        .on_drop((e, cx) => this.drop(e.paths, entry.dir ? path : prefix, cx))
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  // image() stretches to its box, so size the box to the picture's aspect within the panel.
  fitted() {
    const { rel, w, h } = this.picture, size = this.size ?? { width: 360, height: 600 };
    const room = { w: Math.max(40, size.width - 22), h: Math.max(40, size.height - 42 - 20 - 30) };
    if (!w || !h) return image(rel).w(room.w).h(room.h);
    const k = Math.min(room.w / w, room.h / h, 1);
    return image(rel).w(Math.floor(w * k)).h(Math.floor(h * k)).rounded(4);
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const changed = shared("my-files.changed");
    if (changed !== this.changed) { this.changed = changed; this.refresh(cx); }
    const t = theme();
    return v_flex().id("files").on_size_change((size, cx) => { if (size.width !== this.size?.width || size.height !== this.size?.height) { this.size = size; cx.notify(); } }).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.back(cx)).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(this.discard ? t.blocked : t.dim)
          .child(this.discard ? "저장 안 됨 · ← 다시 누르면 버림" : (this.dirty ? "● " : "") + (this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
        .when(Boolean(this.file) && this.editable && Boolean(this.code), el => el.child(div().id("files-save").flex_none().px(8).py(2).rounded(6).text_size(12)
          .cursor_pointer().when(this.dirty, s => s.bg(t.solid).text_color(t.solid_foreground)).when(!this.dirty, s => s.text_color(t.dim).border_1().border_color(t.border))
          .on_click((_e, cx) => this.save(cx)).child(this.saving ? "저장 중…" : "저장"))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .on_mouse_down("right", (_e, cx) => this.menu("", true, cx))
        .on_drop((e, cx) => this.drop(e.paths, "", cx))
        .children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file) && Boolean(this.picture), el => el.child(v_flex().flex_1().min_h(0).p(10).gap(8)
        .on_mouse_down("right", (_e, cx) => this.menu(this.file, false, cx))
        .child(h_flex().flex_1().min_h(0).w_full().items_center().justify_center().child(this.fitted()))
        .when(Boolean(this.pictureInfo), el => el.child(div().flex_none().text_size(11).text_color(t.dim).text_center().child(this.pictureInfo)))))
      .when(Boolean(this.file) && !this.picture, el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}

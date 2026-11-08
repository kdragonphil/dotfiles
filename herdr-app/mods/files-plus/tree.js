import { View, div, svg, image } from "gpui-kit";
import { settings } from "herdr";
import { fileIcon } from "./file-icon.js";
import { v_flex, h_flex } from "gpui-base";
import { joinPath, label, shortPath } from "./roots.js";

export const CHUNK_SIZE = 100;
export const FOLDER_MOTION = { duration: 250, easing: "ease-out" };

export function retainClosingRows(previous, rows, closingKeys) {
  if (!closingKeys.size) return rows;
  const keys = new Set(rows.map(row => row.key)), before = new Map();
  let pending = [];
  for (const row of previous) {
    if (keys.has(row.key)) {
      if (pending.length) before.set(row.key, pending);
      pending = [];
    } else if (closingKeys.has(row.key)) pending.push({ ...row, leaving: true });
  }
  return [...rows.flatMap(row => [...(before.get(row.key) || []), row]), ...pending];
}

export function visibleRows(state) {
  const out = [];
  const status = (key, name, depth = 0, error = false) => out.push({ key, id: key, kind: "status", name, depth, error, fresh: state.fresh?.has(key) || false });
  const walk = (prefix, root, depth) => {
    if (depth > 40) return;
    const list = state.entries.get(prefix);
    if (!list?.length) { status(`empty-${prefix}`, list ? "No files" : "Loading files…", depth); return; }
    for (const entry of list) {
      const path = joinPath(prefix, entry.name), open = state.folders.has(path);
      out.push({ key: path, id: `file-${path}`, path, root, depth, kind: entry.dir ? "dir" : "file", name: entry.name,
        mark: state.marks[path], open, selected: state.selectedPaths?.has(path) || false, fresh: state.fresh?.has(path) || false });
      if (entry.dir && open) walk(path, root, depth + 1);
    }
  };
  if (state.workspace) for (const folder of state.rootInfo || state.workspace.folders) {
    const path = folder.path, open = state.folders.has(path), missing = folder.exists === false;
    out.push({ key: `root-${path}`, id: `root-${path}`, path, root: path, depth: 0, kind: "root", name: label(folder),
      detail: missing ? "Not found" : shortPath(path), open, missing, selected: state.selectedPaths?.has(path) || false });
    if (open && !missing) walk(path, path, 1);
  }
  else if (state.root) walk(state.root, state.root, 0);
  else status("no-folder", "No folder");
  if (state.error) status("tree-error", state.error, 0, true);
  if (state.limited) status("tree-limit", "File list limited to 500 entries per folder and 5,000 total");
  return out;
}

export class RowChunk extends View {
  init(p) { this.update(p); }
  update(p) {
    const previous = new Set((this.data?.rows || []).map(row => row.key));
    this.entering = new Set(p.rows.filter(row => !row.leaving && (this.entering?.has(row.key) || row.fresh && !previous.has(row.key))).map(row => row.key));
    this.mounted ||= new Set();
    this.data = p;
  }
  reveal(key, cx) {
    this.mounted.add(key);
    if (this.revealTimer) return;
    this.revealTimer = true;
    // A target change can animate only after native layout has seen height 0.
    cx.timer.after(0, cx => {
      this.revealTimer = false;
      for (const key of this.mounted) this.entering.delete(key);
      this.mounted.clear(); cx.notify();
    });
  }
  render() {
    const { rows, panel, look } = this.data;
    const { colors: t, font } = look, height = 28;
    return v_flex().w_full().min_w(0).font_family(font).text_size(13).text_color(t.foreground).children(rows.map(row => {
      const entering = this.entering.has(row.key), hidden = entering || row.leaving;
      if (row.kind === "status") return h_flex().id(row.id).h(hidden ? 0 : height).min_h(0).flex_none().overflow_hidden().items_center().pl(8 + row.depth * 18).text_size(12).text_color(row.error ? t.ansi1 : t.muted)
        .when(entering, el => el.on_size_change((_size, cx) => this.reveal(row.key, cx)))
        .opacity(hidden ? 0 : 1).transition("height", FOLDER_MOTION).transition("opacity", FOLDER_MOTION)
        .child(div().truncate().tooltip(row.name).when(row.name === "Loading files…", el => el.loop("opacity", { from: 0.5, to: 1, period: 1200, easing: "ease-out" })).child(row.name));
      const folder = row.kind !== "file";
      return h_flex().id(row.id).w_full().min_w(0).h(hidden ? 0 : height).min_h(0).flex_none().overflow_hidden().pl(8 + row.depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_default().disabled(Boolean(row.leaving))
        .when(entering, el => el.on_size_change((_size, cx) => this.reveal(row.key, cx)))
        .opacity(hidden ? 0 : 1).transition("height", FOLDER_MOTION).transition("opacity", FOLDER_MOTION)
        .when(row.selected, el => el.bg(t.selected)).when(!row.leaving, el => el.hover(s => s.bg(t.hover)))
        .on_mouse_down("left", (event, cx) => panel.beginRowSelection(row, event, cx))
        .on_mouse_up("left", (_event, cx) => panel.endSelection(cx))
        .on_mouse_move((event, cx) => panel.dragSelectionTo(row, event, cx))
        .on_drop((event, cx) => panel.dropFiles(event.paths, panel.target(row.path, row.kind, row.root), cx))
        .on_click((event, cx) => { cx.stop_propagation(); panel.rowClick(row, event, cx); })
        .on_mouse_down("right", (event, cx) => { if (row.leaving) cx.stop_propagation(); else panel.menu(row.path, row.kind, row.root, event, cx); })
        .child(folder ? div().size(12).flex_none().on_mouse_down("left", (_event, cx) => cx.stop_propagation())
          .on_click((_event, cx) => { cx.stop_propagation(); if (!row.missing) panel.toggle(row.path, cx); })
          .child(svg(`mods/files-plus/chevron-${row.open ? "down" : "right"}.svg`).size(12).text_color(t.muted)) : div().w(12).flex_none())
        .child(image(fileIcon(row.path, folder, row.open, settings().dark)).size(16).flex_none())
        .child(div().min_w(0).truncate().when(!row.detail, el => el.flex_1()).child(row.name))
        .when(Boolean(row.detail), el => el.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(row.detail)))
        .when(Boolean(row.mark), el => el.child(div().text_size(12).text_color(row.mark === "A" ? t.ansi2 : row.mark === "D" || row.mark === "U" ? t.ansi1 : t.ansi3).child(row.mark)));
    }));
  }
}

export class TreeView extends View {
  init(p) { this.update(p); }
  update(p) { this.data = p; }
  render() {
    const { chunks, panel, look } = this.data;
    const gesture = panel.selectionGesture, bounds = panel.treeBounds, scale = settings().zoom || 1;
    return v_flex().id("files-tree").relative().w_full().min_w(0).flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .on_mouse_down("left", (event, cx) => panel.beginBlankSelection(event, cx))
      .on_mouse_up("left", (_event, cx) => panel.endSelection(cx))
      .on_click((_event, cx) => panel.endSelection(cx))
      .on_mouse_down("right", (event, cx) => { const target = panel.transferTarget(); if (target) panel.menu(target.path, target.kind, target.root, event, cx); })
      .children(chunks)
      .when(Boolean(gesture?.active && bounds), el => el.child(div().absolute()
        .left(Math.max(0, (Math.min(gesture.start.x, gesture.current.x) - bounds.x) / scale))
        .top(Math.max(0, (Math.min(gesture.start.y, gesture.current.y) - bounds.y) / scale))
        .w(Math.abs(gesture.current.x - gesture.start.x) / scale).h(Math.abs(gesture.current.y - gesture.start.y) / scale)
        .bg(look.colors.selected).border_1().border_color(look.colors.accent).opacity(0.5)));
  }
}

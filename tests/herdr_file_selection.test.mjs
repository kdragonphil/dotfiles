import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const code = await readFile(new URL("../herdr-app/mods/files-plus/selection.js", import.meta.url), "utf8");
const { clickSelection, rangeSelection, copySelection, selectable } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const rows = ["a", "b", "c", "d"].map(name => ({ path: `/work/${name}`, kind: "file" }));

test("command toggles individual rows and shift adds the visible range", () => {
  let selected = clickSelection(rows, new Set(), "/work/a", null);
  selected = clickSelection(rows, selected, "/work/c", "/work/a", { platform: true });
  assert.deepEqual([...selected], ["/work/a", "/work/c"]);
  selected = clickSelection(rows, selected, "/work/a", "/work/c", { platform: true });
  assert.deepEqual([...selected], ["/work/c"]);
  selected = clickSelection(rows, selected, "/work/a", "/work/c", { shift: true });
  assert.deepEqual([...selected], ["/work/a", "/work/b", "/work/c"]);
});

test("drag ranges include both ends in either direction and preserve additive selection", () => {
  assert.deepEqual([...rangeSelection(rows, "/work/c", "/work/a")], ["/work/a", "/work/b", "/work/c"]);
  assert.deepEqual([...rangeSelection(rows, "/work/b", "/work/c", ["/work/d"])], ["/work/d", "/work/b", "/work/c"]);
  assert.deepEqual([...rangeSelection([...rows, { path: "/work/hidden", leaving: true }], "/work/a", "/work/hidden")], []);
});

test("group copies omit descendants of selected folders but keep siblings and distinct machines", () => {
  const entries = [{ path: "/work/a", kind: "dir", on: null }, { path: "/work/a/child", kind: "file", on: null },
    { path: "/work/ab", kind: "file", on: null }, { path: "/work/a/child", kind: "file", on: "dev02" }];
  assert.deepEqual(copySelection([...entries, entries[0]]), [entries[0], entries[2], entries[3]]);
});

const workspaceCode = await readFile(new URL("../herdr-app/mods/files-plus/workspace.js", import.meta.url), "utf8");
function selectionPanel() {
  const context = vm.createContext({ View: class {}, clickSelection, rangeSelection, copySelection, selectable, zoom: () => 1 });
  vm.runInContext(workspaceCode.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + "\nglobalThis.Panel = FilesPanel;", context);
  const panel = new context.Panel();
  panel.rowModel = rows;
  panel.selectedPaths = new Set();
  panel.handle = { focus() {} };
  panel.setSelection = paths => { panel.selectedPaths = new Set(paths); };
  panel.updateSelectionView = () => {};
  panel.target = path => ({ path });
  return panel;
}
const selectionContext = { notify() {} };
const mouse = y => ({ position: { x: 20, y }, bounds: { x: 0, y, width: 200, height: 28 }, modifiers: {} });

test("a completed click cancels selection drag even if the parent missed mouse-up", () => {
  const panel = selectionPanel();
  panel.beginRowSelection(rows[0], mouse(10), selectionContext);
  panel.rowClick(rows[0], { click_count: 1, modifiers: {} }, selectionContext);
  panel.dragSelectionTo(rows[2], mouse(66), selectionContext);
  panel.moveSelection(mouse(94), selectionContext);
  assert.deepEqual([...panel.selectedPaths], ["/work/a"]);
  assert.equal(panel.selectionGesture, null);
});

test("selection expands during a held drag and stops expanding after release", () => {
  const panel = selectionPanel();
  panel.beginRowSelection(rows[0], mouse(10), selectionContext);
  panel.dragSelectionTo(rows[2], mouse(66), selectionContext);
  assert.deepEqual([...panel.selectedPaths], ["/work/a", "/work/b", "/work/c"]);
  panel.endSelection(selectionContext);
  panel.dragSelectionTo(rows[3], mouse(94), selectionContext);
  assert.deepEqual([...panel.selectedPaths], ["/work/a", "/work/b", "/work/c"]);
});

test("hover ignores a stale gesture when the left button is released", () => {
  const panel = selectionPanel();
  panel.beginRowSelection(rows[0], mouse(10), selectionContext);
  panel.leftButtonDown = false;
  panel.dragSelectionTo(rows[2], mouse(66), selectionContext);
  panel.moveSelection(mouse(94), selectionContext);
  assert.deepEqual([...panel.selectedPaths], ["/work/a"]);
  assert.equal(panel.selectionGesture, null);
});

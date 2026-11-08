import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const code = await readFile(new URL("../herdr-app/mods/files-plus/selection.js", import.meta.url), "utf8");
const { clickSelection, rangeSelection, copySelection } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
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

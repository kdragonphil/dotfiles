export const selectable = rows => rows.filter(row => row.path && !row.leaving && !row.missing);

export function rangeSelection(rows, anchor, end, base = []) {
  const paths = selectable(rows).map(row => row.path), selected = new Set(base);
  const first = paths.indexOf(anchor), last = paths.indexOf(end);
  if (first < 0 || last < 0) return selected;
  for (const path of paths.slice(Math.min(first, last), Math.max(first, last) + 1)) selected.add(path);
  return selected;
}

export function clickSelection(rows, selected, path, anchor, modifiers = {}) {
  if (modifiers.shift && anchor) return rangeSelection(rows, anchor, path, modifiers.platform || modifiers.control ? selected : []);
  if (modifiers.platform || modifiers.control) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  }
  return new Set([path]);
}

export function copySelection(entries) {
  const unique = [...new Map(entries.map(entry => [`${entry.on || ""}\0${entry.path}`, entry])).values()];
  return unique.filter(entry => !unique.some(parent => parent !== entry && parent.on === entry.on && parent.kind !== "file"
    && entry.path.startsWith(parent.path.replace(/\/+$/, "") + "/")));
}

// How long agents in each tab have worked, kept in shared state so every mod
// (and every layout) reads the same totals: { [tabId]: { acc, since } }.
// acc: finished working time (ms); since: when the current working run began.
import { spaces, shared, setShared } from "herdr";

const KEY = "worktime";

export function syncWorktime(now = Date.now()) {
  const prev = shared(KEY) ?? {};
  const next = { ...prev };
  let changed = false;
  for (const space of spaces()) {
    for (const tab of space.tabs) {
      const old = prev[tab.id] ?? { acc: 0, since: null };
      let { acc, since } = old;
      const ws = tab.working_since ?? null;
      if (since !== null && ws !== since) {
        // The run ended (or a new one began): count it up to when the tab last changed.
        const end = ws ?? (tab.changed_at && tab.changed_at > since ? tab.changed_at : now);
        acc += Math.max(0, Math.min(end, now) - since);
        since = null;
      }
      if (ws !== null && since === null) since = ws;
      if (acc !== old.acc || since !== old.since || !(tab.id in prev)) {
        if (acc > 0 || since !== null) { next[tab.id] = { acc, since }; changed = true; }
      }
    }
  }
  if (changed) setShared(KEY, next);
  return next;
}

export function worked(tabId, now = Date.now()) {
  const w = (shared(KEY) ?? {})[tabId];
  if (!w) return 0;
  return w.acc + (w.since !== null ? Math.max(0, now - w.since) : 0);
}

export function clock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export const anyWorking = () => spaces().some(p => p.tabs.some(t => t.working_since));

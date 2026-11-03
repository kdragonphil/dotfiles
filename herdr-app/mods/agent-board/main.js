// Agents as cards in three columns: Needs you (blocked), Working, Done (done, then idle).
// Clicking a card shows that agent's tab. Each card shows its tab's work timer.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, run, theme, setAgentOrder } from "herdr";
import { syncWorktime, worked, clock, anyWorking } from "./worktime.js";

const COLUMNS = [
  { id: "blocked", label: "Needs you", match: (s) => s === "blocked" },
  { id: "working", label: "Working", match: (s) => s === "working" },
  { id: "done", label: "Done", match: (s) => s === "done" || s === "idle" },
];

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class AgentBoard extends View {
  init(_props, cx) {
    syncWorktime();
    cx.timer.every(1000, (cx) => { syncWorktime(); if (anyWorking()) cx.notify(); });
  }

  card(a, t) {
    const color = t[a.status] ?? t.idle;
    const tabName = a.tab_name && !/^tb\d+$/.test(a.tab_name) ? a.tab_name : `Tab ${a.tab_index}`;
    const title = clean(a.title);
    const ms = worked(a.tab);
    return v_flex().id(`card-${a.address}`).gap(6).p(10).rounded(8).bg(t.background)
      .border(1).border_color(a.focused ? t.accent : t.border)
      .hover(s => s.bg(t.hover))
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(h_flex().gap(7).items_center()
        .when(Boolean(a.program?.icon), el => el.child(icon(a.program, 16, t.muted)))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(a.program?.name ?? a.app ?? "Agent"))
        .when(a.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(color).spin(900)))
        .when(a.status !== "working", el => el.child(div().size(7).flex_none().rounded(4).bg(color))))
      .child(div().truncate().text_size(12).text_color(t.muted).child(`${a.space_name} · ${tabName}`))
      .when(Boolean(title), el => el.child(div().truncate().text_size(12).text_color(t.dim).child(title)))
      .when(ms >= 1000, el => el.child(h_flex().gap(5).items_center().text_size(11.5)
        .text_color(a.status === "working" ? t.working : t.dim)
        .child(svg("mods/workspace-chrome/clock.svg").size(12))
        .child(clock(ms))));
  }

  render() {
    const t = theme();
    const all = agents();
    const cols = COLUMNS.map(c => ({ ...c, items: all.filter(a => c.match(a.status))
      // Done before idle; then most recently changed first.
      .sort((x, y) => (x.status === y.status ? 0 : x.status === "done" ? -1 : y.status === "done" ? 1 : 0) || y.seq - x.seq) }));
    setAgentOrder(cols.flatMap(c => c.items.map(a => a.address)));
    const column = (c) => v_flex().flex_1().min_w(0).h_full().rounded(10).bg(t.chrome)
      .border(1).border_color(t.border)
      .child(h_flex().h(38).px(12).gap(8).items_center().flex_none()
        .child(div().size(8).rounded(4).bg(t[c.id]))
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(c.label))
        .child(div().text_size(12).text_color(t.dim).child(String(c.items.length))))
      .child(v_flex().id(`col-${c.id}`).flex_1().min_h(0).px(8).pb(8).gap(8).overflow_y_scrollbar()
        .when(c.items.length === 0, el => el.child(div().p(10).text_size(12).text_color(t.dim).child("No agents")))
        .children(c.items.map(a => this.card(a, t))));
    return h_flex().id("board").size_full().gap(8).bg(t.canvas).children(cols.map(column));
  }
}

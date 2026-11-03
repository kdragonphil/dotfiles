// Actions for the my-files panel, opened as an overlay with
// props { view: "menu" | "rename" | "delete", root, path, dir, on }.
// `path` is relative to `root` ("" is the root folder itself); `on` is the machine (null: this Mac).
// Every action runs here with exec, then bumps shared "my-files.changed" so the panel reloads.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, exec, notify, setShared } from "herdr";

const ICON = "mods/my-files-actions";
const abs = (p) => (p.path ? `${p.root}/${p.path}` : p.root);
const baseName = (p) => (p.path ? p.path.split("/").pop() : p.root.split("/").pop());
const changed = () => setShared("my-files.changed", Date.now());

async function sh(script, args, on) {
  const r = await exec("sh", ["-c", script, "my-files", ...args], { on });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim());
  return r.stdout;
}

async function copyText(text, label) {
  try {
    await sh('printf %s "$1" | pbcopy', [text], null);
    notify({ title: `${label} 복사됨`, body: text, level: "success", timeout: 2500 });
  } catch (e) { notify({ title: "복사 실패", body: String(e.message ?? e), level: "error" }); }
}

function items(p) {
  const local = !p.on;
  const list = [
    ["경로 복사", "copy", () => copyText(abs(p), "경로")],
    ...(p.path ? [["상대 경로 복사", "copy", () => copyText(p.path, "상대 경로")]] : []),
    ["이름 복사", "copy", () => copyText(baseName(p), "이름")],
  ];
  if (local) {
    list.push(["Finder에서 보기", "reveal", () => sh('open -R -- "$1"', [abs(p)], null).catch((e) => notify({ title: "Finder 열기 실패", body: e.message, level: "error" }))]);
    if (!p.dir) list.push(["기본 앱으로 열기", "open", () => sh('open -- "$1"', [abs(p)], null).catch((e) => notify({ title: "열기 실패", body: e.message, level: "error" }))]);
  }
  if (p.path) {
    list.push(["이름 변경…", "rename", () => openOverlay({ mod: "my-files-actions", kind: "dialog", width: 440, height: 230, props: { ...p, view: "rename", overlay: undefined } })]);
    list.push(["휴지통으로 이동…", "trash", () => openOverlay({ mod: "my-files-actions", kind: "dialog", width: 440, height: 210, props: { ...p, view: "delete", overlay: undefined } })]);
  }
  return list;
}

// Moves to the Trash. This Mac: ~/.Trash (a numbered name if taken). Other machines: gio trash or trash-put only.
async function trash(p) {
  if (!p.on) {
    await sh('src=$1; b=${src##*/}; d="$HOME/.Trash/$b"; n=1; while [ -e "$d" ] || [ -L "$d" ]; do d="$HOME/.Trash/$b $n"; n=$((n+1)); done; mv -- "$src" "$d"', [abs(p)], null);
  } else {
    await sh('if command -v gio >/dev/null 2>&1; then gio trash -- "$1"; elif command -v trash-put >/dev/null 2>&1; then trash-put -- "$1"; else echo "이 머신에는 휴지통 명령(gio, trash-put)이 없어 삭제하지 않았습니다" >&2; exit 2; fi', [abs(p)], p.on);
  }
}

export default class FileActions extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.at = 0;
    this.error = null;
    this.busy = false;
    this.handle = cx.focus_handle();
    if (p.view === "rename" && p.root) {
      const name = baseName(p);
      this.input = InputState.new({ value: name });
      const dot = p.dir ? -1 : name.lastIndexOf(".");
      this.input.set_selected_range({ start: 0, end: dot > 0 ? dot : name.length });
      this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.rename(cx));
      this.input.focus();
      cx.timer.after(300, () => this.input.focus());
    } else {
      this.handle.focus();
    }
  }

  close() { closeOverlay(props()?.overlay); }

  choose(i) {
    const it = items(props())[i];
    if (!it) return;
    this.close();
    it[2]();
  }

  rename(cx) {
    const p = props();
    const name = this.input.value().trim();
    if (this.busy) return;
    if (!name || name === "." || name === ".." || name.includes("/")) { this.error = "사용할 수 없는 이름입니다"; cx.notify(); return; }
    if (name === baseName(p)) { this.close(); return; }
    const parent = p.path.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/")) : "";
    const dest = `${p.root}/${parent ? parent + "/" : ""}${name}`;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await sh('if [ -e "$2" ] || [ -L "$2" ]; then echo "같은 이름이 이미 있습니다" >&2; exit 3; fi; mv -- "$1" "$2"', [abs(p), dest], p.on);
        changed();
        this.close();
      } catch (e) { this.error = e.message; }
      finally { this.busy = false; cx.notify(); }
    });
  }

  remove(cx) {
    const p = props();
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await trash(p);
        changed();
        this.close();
        notify({ title: "휴지통으로 이동됨", body: baseName(p), level: "success", timeout: 2500 });
      } catch (e) { this.error = e.message; }
      finally { this.busy = false; cx.notify(); }
    });
  }

  button(id, text, primary, danger, action) {
    const t = theme();
    const bg = danger ? t.ansi1 : primary ? t.solid : t.raised;
    return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(primary || danger ? bg : t.input).bg(bg)
      .text_color(primary || danger ? t.solid_foreground : t.foreground).text_size(12.5).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
  }

  dialog(title, body, buttons, cx) {
    const t = theme();
    return v_flex().id("mfa-dialog").track_focus(this.handle).size_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.close();
        else if (e.key === "enter" && props().view === "delete") this.remove(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(body)
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end().children(buttons));
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    if (p.view === "rename") {
      return this.dialog(p.dir ? "폴더 이름 변경" : "파일 이름 변경",
        Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground),
        [this.button("mfa-cancel", "취소", false, false, () => this.close()), this.button("mfa-ok", this.busy ? "변경 중…" : "변경", true, false, (_e, cx) => this.rename(cx))], cx);
    }
    if (p.view === "delete") {
      return this.dialog(`"${baseName(p)}"을(를) 휴지통으로 옮길까요?`,
        v_flex().gap(4).text_color(t.muted).text_size(12.5).child(div().truncate().child(abs(p))).child(div().child(p.on ? `${p.on}의 휴지통으로 옮깁니다 (gio trash / trash-put).` : "~/.Trash로 옮깁니다. Finder의 '되돌려 놓기'는 안 되니 필요하면 휴지통에서 직접 꺼내세요.")),
        [this.button("mfa-cancel", "취소", false, false, () => this.close()), this.button("mfa-ok", this.busy ? "옮기는 중…" : "휴지통으로 이동", false, true, (_e, cx) => this.remove(cx))], cx);
    }
    if (!p.root) return div().p(12).bg(t.popover).text_color(t.dim).child("대상 파일이 없습니다");
    const list = items(p);
    return v_flex().id("mfa-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") this.close();
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => v_flex()
        .when(i > 0 && (it[1] === "rename" || (it[1] === "reveal" && list[i - 1][1] === "copy")), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`mfa-${i}`).h(31).px(8).gap(9).rounded(7).items_center().cursor_pointer()
          .text_color(it[1] === "trash" ? t.ansi1 : t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(i))
          .child(svg(`${ICON}/${it[1]}.svg`).size(14).flex_none().text_color(it[1] === "trash" ? t.ansi1 : t.muted))
          .child(div().flex_1().child(it[0])))));
  }
}


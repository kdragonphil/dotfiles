# dotfiles

Herdr 앱과 코딩 에이전트(Claude Code, Codex) 설정을 여러 Mac에서 똑같이 쓰기 위한 저장소입니다.
비공개 저장소: <https://github.com/kdragonphil/dotfiles>

| 폴더 | 내용 | 스크립트 |
|---|---|---|
| `herdr-app/` | Herdr 앱 개인 설정 (레이아웃, 모드, 단축키, 글꼴) | `bin/herdr-app-sync` |
| `agents/` | 에이전트 전역 지침 (`CLAUDE.md` + SuperClaude, Codex `AGENTS.md`) | `bin/agents-sync` |
| `mcp/` | MCP 서버 설정 (Claude Code, Codex). 비밀값은 빼고 저장 | `bin/mcp-sync` |

세 스크립트 모두 명령이 같습니다.

| 명령 | 하는 일 |
|---|---|
| `save ["커밋 메시지"]` | 지금 컴퓨터의 설정 → 저장소로 복사, 커밋, push |
| `apply` | `git pull` → 저장소 설정을 이 컴퓨터에 적용. 덮어쓰는 파일은 먼저 백업 |
| `status` | 지금 컴퓨터와 저장소의 차이만 보여 줌 (아무것도 바꾸지 않음) |

---

## 1. 새 컴퓨터 처음 설정하기

### 1-1. 기본 도구
```sh
# Homebrew (없으면)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install git gh node python        # node: npx 로 도는 MCP 서버, python3: 동기화 스크립트(3.11 이상)
curl -LsSf https://astral.sh/uv/install.sh | sh   # uvx: serena MCP 서버
gh auth login                          # 이 비공개 저장소 clone, github/issues 모드에 필요
```

### 1-2. 코딩 에이전트
```sh
brew install --cask claude-code   # 또는 npm i -g @anthropic-ai/claude-code
brew install codex                # 또는 npm i -g @openai/codex
claude                            # 한 번 실행해서 로그인
codex                             # 한 번 실행해서 로그인
```

### 1-3. Herdr 앱 설치
```sh
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
herdr-app                          # 한 번 실행 → ~/.config/herdr-app 이 만들어짐
hc --version                       # 함께 설치되는 herdr-core CLI 확인
```
- 앱을 꺼도 터미널과 에이전트는 herdr-core(`hc`)에서 계속 돌아갑니다.
- 업데이트는 앱이 알아서 내려받고 재시작을 권합니다.

### 1-4. 이 저장소 받아서 한 번에 적용
```sh
git clone https://github.com/kdragonphil/dotfiles ~/dotfiles
~/dotfiles/bin/agents-sync apply      # ~/.claude/*.md, ~/.codex/AGENTS.md
~/dotfiles/bin/mcp-sync apply         # MCP 서버 (비밀값은 1-5 참고)
~/dotfiles/bin/herdr-app-sync apply   # Herdr 레이아웃·모드·단축키·글꼴, my-layout 으로 전환
```
적용 뒤 실행 중인 Claude Code / Codex 는 다시 시작하세요. Herdr 앱은 바로 반영됩니다.

### 1-5. 비밀값 옮기기 (MCP)
API 키나 개인 URL은 git 에 올리지 않고 `mcp/secrets.local.json` 에만 둡니다(`.gitignore`).
새 컴퓨터에서는 둘 중 하나:
- 원래 컴퓨터의 `~/dotfiles/mcp/secrets.local.json` 을 AirDrop 등으로 같은 위치에 복사한 뒤 `mcp-sync apply` 다시 실행
- 또는 직접 만들기: `mcp-sync status` 가 필요한 이름을 알려 줍니다.
  ```json
  { "n8n_1": "<n8n MCP URL 의 UUID>" }
  ```
비밀값이 없는 서버는 `apply` 에서 건너뛰고 이름을 알려 줍니다.

`magic`·`magic-ui`·`tavily` 서버는 쓰지 않아 뺐습니다. 다른 컴퓨터에 남아 있으면 Claude Code 는 `claude mcp remove --scope user magic` / `tavily`, Codex 는 `~/.codex/config.toml` 의 해당 `[mcp_servers.*]` 블록을 지우세요(`apply` 는 지우지 않습니다).

---

## 2. 평소에 쓰는 법

설정을 바꾼 컴퓨터에서 `save`, 다른 컴퓨터에서 `apply`.
```sh
~/dotfiles/bin/herdr-app-sync save "Files 메뉴 수정"
~/dotfiles/bin/agents-sync save
~/dotfiles/bin/mcp-sync save

# 다른 컴퓨터에서
~/dotfiles/bin/herdr-app-sync apply
```
- 자동 동기화가 아닙니다. 양쪽에서 각각 고친 뒤 `save` 하면 push 가 거절되니, 먼저 `apply`(=pull) 하고 `save` 하세요.
- 무엇이 다른지만 보려면 `status`.
- 백업 위치: `~/.config/herdr-app/backup-before-apply-<시각>/`, `~/.claude/backup-before-apply-<시각>/`,
  `~/.codex/backup-before-apply-<시각>/`, `~/.codex/config.toml.backup-<시각>`

---

## 3. 무엇이 들어 있나

### herdr-app/
`~/.config/herdr-app` 에서 **Herdr 가 기본 제공하지 않는 것만** 담습니다(`installed.json` 기준). 새로 만든 모드·레이아웃은 `save` 때 저절로 들어갑니다.

| 항목 | 내용 |
|---|---|
| `layouts/my-layout.json` | 기본 `main` 레이아웃 복제본. Files 패널이 `my-files` |
| `layouts/board.json`, `main-timer.json` | 에이전트 보드, 탭별 작업 타이머 레이아웃 |
| `mods/my-files`, `my-files-actions` | Files 패널: 오른쪽 클릭(경로 복사, Finder에서 보기, 새 파일·새 폴더, 이름 변경, 휴지통), Finder 에서 끌어다 놓기, 이미지 미리보기 |
| `mods/agent-board`, `timer-tabs`, `git-graph`, `github`, `issues`, `issue-agent` | 개인 모드 (`github`/`issues`/`issue-agent` 는 `gh` 필요) |
| `mods/files-plus`, `preview-plus`, `file-icons` | 파일 탐색·편집·미리보기, Finder 파일 복사와 Mac ↔ 원격 파일 전송 |
| `keys.json`, `settings.json`, `fonts/` | 단축키, 글꼴(D2Coding) 등 |

넣지 않는 것: `layouts/.state/`(패널 크기 등 클릭 상태), `view.json`, `shared.json`, `data/`, `cache/`, 스페이스·탭·ssh 머신 목록.

> 기본 제공 레이아웃·모드(`main`, `files` 등)는 앱이 켤 때마다 원래대로 덮어씁니다.
> 고치려면 복제해서 고치세요: `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`,
> `herdr-app do mod.clone '{"name":"files","as":"my-files"}'`

### Files Plus에서 파일 주고받기 (macOS)

- 한 번 클릭하면 선택, 두 번 클릭하면 파일을 엽니다. 폴더는 왼쪽 화살표나 더블클릭으로 펼칩니다.
- `⌘클릭`으로 개별 추가·해제, `Shift클릭`으로 범위 선택, 마우스를 누른 채로 드래그하면 여러 행을 선택합니다. `⌘A`는 보이는 목록 전체, `Esc`는 선택 해제입니다.
- 여러 개를 선택한 상태에서 오른쪽 클릭 → **Copy N items** / **Save N items to Mac…**을 사용할 수 있습니다. 부모 폴더와 그 안의 파일을 함께 선택해도 중복 복사하지 않습니다.
- 에이전트로 `@파일` 참조를 끌어 넣는 기존 동작은 `Option(⌥)`을 누른 채 드래그하거나 **Add to agent (@)** 메뉴로 사용합니다.
- Finder의 파일·폴더를 Files 목록이나 폴더 행에 드롭하면 그 위치로 복사합니다. 파일 행에 드롭하면 해당 파일의 부모 폴더로 복사합니다.
- Finder에서 복사한 파일은 Files의 **Paste** 버튼이나 오른쪽 클릭 → **Paste**로 붙여넣습니다. Files 목록에 키보드 포커스가 있으면 `⌘C` / `⌘V`도 쓸 수 있습니다.
- Files에서 오른쪽 클릭 → **Copy**를 누르면 Finder에 붙여넣을 수 있는 실제 파일이 복사됩니다. 원격 파일은 먼저 이 Mac의 로컬 캐시에 내려받습니다.
- 오른쪽 클릭 → **Save to Mac…**은 저장할 Mac 폴더를 선택해 파일·폴더를 복사합니다.
- 같은 이름이 있으면 `copy`, `copy 2` 등의 이름으로 보존합니다. 기존 파일을 덮어쓰지 않습니다.
- 원격 전송은 추가 SSH 로그인 없이 연결된 herdr-core를 사용합니다. Mac과 원격에 `python3`, Mac에 `hc`가 필요합니다. 전송 중에는 **Copying…**이 표시됩니다.
- Downloads·바탕화면의 접근 허용은 macOS가 관리합니다. Mac 파일 복사는 Herdr의 실행 경로 안에서 나누어 처리하며, 접근이 거절되면 **시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더**에서 macOS가 요청한 Herdr 항목의 해당 폴더를 허용한 뒤 다시 시도하세요.
- Finder로 직접 끌어내는 드래그는 모드 API가 지원하지 않으므로 **Copy → Finder에 붙여넣기** 또는 **Save to Mac…**을 사용합니다.
- 폴더 확인이 한 번 실패해도(앱 재시작·업데이트 직후, SSH 순간 끊김) 10초 안에 다시 확인해 목록을 되살립니다. 20초 넘게 응답이 없는 읽기는 버리고 새로 읽습니다.

로컬 텍스트 파일은 Preview Plus에서 편집하고 `⌘S`로 저장합니다. Markdown은 **Edit** 버튼으로 원문 편집을 엽니다. 원격 파일·40만 자 초과 텍스트는 읽기 전용입니다.

### agents/
| 저장소 | 홈 |
|---|---|
| `agents/claude/*.md` | `~/.claude/CLAUDE.md` 와 그것이 `@` 로 불러오는 SuperClaude 파일들 |
| `agents/codex/AGENTS.md` | `~/.codex/AGENTS.md` |

핵심 규칙: 답변은 한국어 / 다른 에이전트에게 맡길 때는 먼저 `hc --skill` 을 읽고 따른다.
메모리(`~/.claude/projects/`), `settings.json`, 로그인 정보는 넣지 않습니다.

### mcp/
| 파일 | 내용 |
|---|---|
| `mcp/claude-code.json` | `~/.claude.json` 의 `mcpServers` (사용자 범위) |
| `mcp/codex.toml` | `~/.codex/config.toml` 의 `[mcp_servers.*]` (ChatGPT 앱이 관리하는 `node_repl`, `computer-use` 제외) |
| `mcp/secrets.local.json` | 비밀값. **git 에 올라가지 않음** |

- `apply` 는 저장소에 있는 서버만 추가·갱신하고, 그 컴퓨터에만 있는 서버는 지우지 않습니다.
- Claude Code 는 `claude mcp add-json --scope user` 로 넣고(실행 중인 Claude 가 쓰는 `~/.claude.json` 을 직접 고치지 않으려고), Codex 는 `config.toml` 에서 같은 이름 블록만 바꿉니다.
- `save` 는 비밀값이 저장소 파일에 남아 있거나 `secrets.local.json` 이 `.gitignore` 에서 빠져 있으면 커밋하지 않고 멈춥니다.
- `filesystem` 서버의 `/Volumes/VEGA/Data` 처럼 이 컴퓨터 경로가 들어간 서버는 다른 컴퓨터에서 경로를 맞춰야 합니다.

---

## 4. Herdr 사용 메모

### 단축키
| 키 | 동작 |
|---|---|
| `⌘ /` | 단축키 목록 (글자를 쳐서 찾기) |
| `⌘ B` | 사이드바 열고 닫기 |
| `ctrl ⇧ L` / `⌘ ⇧ L` | 레이아웃 전환 (my-layout ↔ board ↔ main-timer …) |
| `⌘ ⇧ P` | 명령 팔레트 |
| `⌘ T` / `⌘ D` / `⌘ ⇧ D` | 새 탭 / 오른쪽 분할 / 아래 분할 |

### 터미널에서 herdr-core 다루기 (`hc`)
```sh
hc ls            # core 에서 도는 터미널 목록
hc attach t5     # 그 터미널에 붙기 (빠져나오기: ctrl+\)
hc wait t5       # 일이 끝날 때까지 기다리기
hc --skill       # 에이전트용 hc 매뉴얼
```

### 앱을 말로 바꾸기
에이전트에게 이렇게 시키면 됩니다.
```
~/.config/herdr-app/AGENTS.md를 읽고, 이 앱에서 무엇을 바꿀 수 있는지 다섯 줄로 알려 줘.
한글 글자 사이가 벌어져 보여. 터미널 글꼴을 D2Coding으로 바꿔 줘.
탭마다 에이전트가 일한 시간을 타이머로 보여 줘.
needs you, working, done 세 칸에 에이전트를 카드로 보여 주는 보드 레이아웃을 새로 만들고 그 레이아웃으로 바꿔 줘.
```
바꾼 뒤에는 `~/dotfiles/bin/herdr-app-sync save`.

### 남이 만든 레이아웃·모드 가져오기 (herdr.dev/layouts, herdr.dev/mods)
```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/herdrdev/pasture
Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/herdrdev/tmux-prefix
```
모드는 명령 실행·네트워크 접근을 할 수 있는 JavaScript 입니다. 에이전트가 먼저 읽고 확인하게 하세요.

### 에이전트가 에이전트를 부리기
```
hc --skill을 읽고, Codex 리뷰어를 하나 띄워서 server 폴더를 읽기만 하며 검토하게 해 줘. 리뷰어가 끝나면 결과를 세 줄로 알려 줘.
```
- 띄우는 형식: `hc run --bg --name <이름> --cwd <저장소> <에이전트> "<첫 작업>"`, 끝나면 `hc send $HC_TERMINAL_ID` 로 보고.
- Codex 안에서 `hc send` 로 결과를 돌려보내려면 Codex 샌드박스가 herdr-core 소켓 폴더에 쓸 수 있어야 합니다.
  `~/.codex/config.toml`:
  ```toml
  [sandbox_workspace_write]
  writable_roots = ["/Users/<사용자>/.config/herdr"]   # herdr.sock 이 있는 폴더
  ```

### 다른 컴퓨터도 한 화면에
앱: 사이드바 아래 **Add machine** → `user@host`(SSH 로 닿는 주소). 터미널에서는:
```sh
hc machine add <ssh 호스트> --name macbook-air --install
hc ls     # macbook-air/t1 처럼 다른 컴퓨터의 터미널도 한 목록에
```
(ssh 머신 목록은 컴퓨터마다 다르므로 이 저장소에 넣지 않습니다.)

### 휴대폰에서 답하기: Ovis (선택)
```sh
curl -fsSL https://bun.sh/install | bash        # Bun 1.4 이상
git clone https://github.com/devswha/ovis.git
cd ovis && bun install
OVIS_RUNTIME=herdr-core OVIS_TELEMETRY=0 bun run start   # → http://127.0.0.1:7317
```
- `OVIS_RUNTIME=herdr-core`: Herdr 앱(herdr-core)에 붙기. 빼면 Herdr TUI 서버를 찾습니다.
- `OVIS_TELEMETRY=0`: 익명 사용 통계 끄기.
- 포트 7317 은 내 컴퓨터(127.0.0.1)에서만 열고 인터넷에 직접 열지 마세요.
- 휴대폰: 두 기기 모두 Tailscale → `tailscale serve --bg --https=443 http://127.0.0.1:7317` → Ovis 설정 Phone & devices 의 QR. 알림은 HTTPS 에서만.

### 참고
- 가이드: <https://herdr.dev/guide/> · 앱이 에이전트에게 주는 전체 설명: `~/.config/herdr-app/AGENTS.md`
- 레이아웃/모드 모음: <https://herdr.dev/layouts>, <https://herdr.dev/mods> · 질문: Discord <https://discord.gg/PsgRfzmUDg>

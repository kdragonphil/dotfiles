# dotfiles

## herdr-app

Herdr 데스크톱 앱(`~/.config/herdr-app`)의 **개인 설정만** 보관합니다.
Herdr 기본 제공 레이아웃·모드(`installed.json`에 있는 것)와 앱이 쓰는 상태 파일은 넣지 않습니다.

| 명령 | 하는 일 |
|---|---|
| `bin/herdr-app-sync save ["메시지"]` | 앱 → 저장소 복사, 커밋, (원격이 있으면) push |
| `bin/herdr-app-sync apply` | (원격이 있으면) pull, 저장소 → 앱 복사. 덮어쓰는 파일은 `~/.config/herdr-app/backup-before-apply-<시각>/`에 백업 |
| `bin/herdr-app-sync status` | 개인 설정으로 잡히는 목록과 저장소와 다른 점 |

### 새 컴퓨터에서
1. Herdr 앱 설치 후 한 번 실행 (`~/.config/herdr-app` 생성)
2. `git clone <이 저장소> ~/dotfiles && ~/dotfiles/bin/herdr-app-sync apply`
3. `github` / `issues` / `issue-agent` 모드용: `brew install gh && gh auth login`

### 들어가는 것
- `layouts/` : 기본 제공이 아닌 레이아웃(+ 미리보기 svg/png)
- `mods/` : 기본 제공이 아닌 모드 (`gpui-kit.d.ts`, `jsconfig.json`은 앱이 다시 만들므로 제외)
- `keys.json`, `settings.json`, `programs.json`(있으면), `fonts/`, 기본 제공이 아닌 `themes/*.json`

### 안 들어가는 것
- `layouts/.state/` (패널 크기 등 클릭 상태, 자주 바뀜), `view.json`, `shared.json`, `data/`, 창 위치
- 스페이스·탭·ssh 머신 목록 (컴퓨터마다 다름)

복사 방식인 이유: 앱이 설정 화면에서 `settings.json` 등을 새로 쓸 때 심볼릭 링크가 일반 파일로 바뀔 수 있어서입니다.

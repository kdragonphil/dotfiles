# User Rules

- 답변은 항상 한국어로 한다. (Always reply to the user in Korean.)
- 다른 에이전트(Codex, Claude, pi 등)에게 작업을 맡길 때는 먼저 `hc --skill`을 실행해 그 매뉴얼(herdr-core `hc`)을 따른다. 예전 `herdr` CLI는 쓰지 않는다. `hc run --bg --name <이름> --cwd <저장소> <에이전트> "<첫 작업>"`으로 첫 작업을 함께 보내고, 끝나면 `hc send $HC_TERMINAL_ID`로 보고하게 한다. 사용자가 지정한 모델·추론 강도를 쓴다.

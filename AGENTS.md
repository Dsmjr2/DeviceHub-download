# DeviceHub: notes for agents

## Working beside other agents (Shawn, 11 Nov 2026)

Several agents work in this repo, sometimes at the same time: Claude chats, Antigravity, Codex, Muse and T3 threads.
This repo's own rules are in CLAUDE.md; read it too.

- Never commit straight to the main branch. Start every task on your own branch, `<agent>/<task>`
  (e.g. `antigravity/ipad-fonts`).
- If the folder has uncommitted changes you didn't make, another agent is mid-task: leave them alone and work in your
  own worktree: `git worktree add ../<repo>-<agent> -b <agent>/<task> origin/<main branch>`.
- Commit as you go: small commits, plain messages, only your own files (never `git add -A`).
- When the task is done and works, merge it yourself, with no one to ask:
  `node "$HOME/source/repos/setup/tools/agent-merge.mjs"`. It takes the latest main branch and puts your work on it
  only if there is no conflict and the checks pass. If another agent merged first, it waits its turn and retries.
  - Exit 2 = conflict: resolve it on your branch, keeping both agents' changes, then run it again.
  - Exit 3 = the checks failed: fix them on your branch, then run it again.
- Never force-push, and never merge around it by hand.
- Real data only: never invent a data source, a number or a default.

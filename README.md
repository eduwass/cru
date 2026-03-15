<p align="center"><img src="assets/logo.svg" width="128"/></p>

# ◫ cru

Layout for [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams), fixed.

Agent teams let multiple Claude Code instances work together in parallel — cru handles the terminal layout so you don't have to.

```
╭──────────────────┬────────────────┬────────────────╮
│                  │                │                │
│                  │  ⚡ worker-1    │  ⚡ worker-2    │
│                  │                │                │
│       lead       ├────────────────┼────────────────┤
│                  │                │                │
│                  │  ⚡ worker-3    │  ⚡ worker-4    │
│                  │                │                │
╰──────────────────┴────────────────┴────────────────╯
```

![demo](assets/demo.gif)

## Terminal setup

- **Already using tmux?** You're good.
- **iTerm2?** Use [`tmux -CC`](https://iterm2.com/documentation-tmux-integration.html) for native pane integration.
- **Ghostty?** Workers still run in tmux (that's how Claude Code spawns agents), but cru mirrors them into native Ghostty splits via [AppleScript](https://ghostty.org/docs/features/applescript) — so you get Ghostty's UI instead of working inside tmux yourself. Requires Ghostty v1.3.0+.

## Install

```bash
npm install -g cru-cli
```
```bash
pnpm add -g cru-cli
```
```bash
bun add -g cru-cli
```

## Quick start

1. Set up cru in your project:

```bash
cru init
```

2. In Claude Code, spawn a team:

```
/cru split the auth module into subtasks and parallelize across workers
```

That's it — cru creates the panes, applies the grid layout, and your workers are ready to go.

## Use cases

**[Parallel feature work](https://code.claude.com/docs/en/agent-teams#when-to-use-agent-teams)** — split subtasks across workers, merge when done

  ```
  /cru break down the checkout flow into vertical slices, one worker per slice
  ```
**[Review crew](https://code.claude.com/docs/en/agent-teams#run-a-parallel-code-review)** — workers build, one reviews

  ```
  /cru 3 review PR #142 — one on security, one on performance, one on test coverage
  ```
**[Competing hypotheses](https://code.claude.com/docs/en/agent-teams#investigate-with-competing-hypotheses)** — debug faster with multiple theories at once

  ```
  /cru users report the app crashes on login — each worker investigates a different theory
  ```

**[Research spike](https://code.claude.com/docs/en/agent-teams#start-with-research-and-review)** — explore different approaches simultaneously
  ```
  /cru 3 evaluate auth libraries — one on passport, one on lucia, one on arctic
  ```

## Documentation

- [CLI reference](CLI.md) — all commands, flags, and examples
- [Configuration](CONFIG.md) — layout options, config files, resolution order
- [Testing](TESTING.md) — test structure and how to run tests

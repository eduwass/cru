# Testing

## Unit tests

Pure functions, no terminal needed. Run with `bun test tests/unit/`.

```
tests/unit/
├── config.test.ts    # deepMerge, config resolution
├── layout.test.ts    # computeGrid, buildLayout (tmux layout strings)
├── logs.test.ts      # message parsing, truncation, color hashing
└── panes.test.ts     # pane record shape, serialization
```

## E2E tests

Real terminal sessions with Claude Code. Each backend has its own test suite.

```
tests/e2e/
├── iterm/            # iTerm2 + tmux -CC
│   ├── setup.ts      # creates iTerm window → tmux -CC → Claude
│   ├── smoke.test.ts
│   ├── explicit-count.test.ts
│   └── full-workflow.test.ts
└── ghostty/          # Native Ghostty (AppleScript)
    ├── setup.ts      # creates Ghostty window → Claude (no tmux wrapper)
    ├── smoke.test.ts
    └── workflow.test.ts
```

### Running

```bash
# Unit tests
bun test tests/unit/

# Ghostty e2e (requires Ghostty v1.3.0+)
bun test tests/e2e/ghostty/smoke.test.ts --timeout 60000
bun test tests/e2e/ghostty/workflow.test.ts --timeout 600000

# iTerm2 e2e (requires iTerm2 + it2 CLI + tmux)
bun test tests/e2e/iterm/smoke.test.ts --timeout 120000
bun test tests/e2e/iterm/full-workflow.test.ts --timeout 600000
```

### Shared helpers

```
tests/helpers/
├── common.ts     # poll, tmux utils, snapshots, createRunDir
├── iterm.ts      # it2 CLI helpers (getScreen, sendText, etc.)
└── ghostty.ts    # AppleScript helpers, swarm socket discovery
```

### How the Ghostty tests work

Ghostty tests don't use tmux in the test terminal — they test the real native flow:

1. Open a Ghostty window via AppleScript
2. Start Claude Code directly (no tmux wrapper)
3. Send `/cru` via `input text` AppleScript
4. Assert by checking: Ghostty terminal count (via AppleScript), swarm tmux sessions, `~/.claude/teams/`, cru CLI output
5. Terminal tracking uses snapshot diffing (all terminal IDs before/after) so the user can switch focus freely during tests

### How the iTerm tests work

iTerm tests use tmux -CC (control mode) for native pane integration:

1. Open an iTerm2 window, start `tmux -CC`
2. Launch Claude Code in the tmux pane
3. Send commands via `it2 session send-text`
4. Assert using `it2 get-screen`, tmux pane queries, cru CLI output
5. Claude readiness detected via iTerm2 plugin data (`has-no-queued-claude-messages`)

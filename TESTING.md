# Testing Plan

Two layers: unit tests for deterministic CLI internals, e2e evals for the full skill flow.

## Layer 1: Unit Tests

Pure functions, no tmux/LLM needed. Run with `bun test`.

### `src/lib/layout.ts` — ✅ done

- [x] `computeGrid` — correct cols/rows for various worker counts (1–12)
- [x] `computeGrid` — respects `maxCols` constraint
- [x] `computeGrid` — respects `maxRows` constraint
- [x] `computeGrid` — respects both `maxCols` + `maxRows` together
- [x] `buildLayout` — produces valid tmux layout string for 1 worker
- [x] `buildLayout` — produces valid tmux layout string for 2 workers
- [x] `buildLayout` — produces valid tmux layout string for 4 workers (2x2)
- [x] `buildLayout` — lead position left/right/top/bottom all produce different layouts
- [x] `buildLayout` — lead size percentage is respected
- [x] `buildLayout` — column fill reorders pane IDs
- [x] `buildLayout` — all pane IDs present in output

Note: `distribute` and `reorderColumnFirst` are internal — tested indirectly through `buildLayout`.

### `src/lib/config.ts` — ✅ done

- [x] `deepMerge` — merges flat objects
- [x] `deepMerge` — later values override earlier
- [x] `deepMerge` — merges nested objects recursively
- [x] `deepMerge` — replaces arrays (no array merging)
- [x] `deepMerge` — adds new nested keys
- [x] `deepMerge` — null values override
- [x] `deepMerge` — returns mutated target
- [x] `deepMerge` — works with DEFAULTS shape

### `src/lib/spawn.ts` — ✅ done

- [x] `buildClaudeCmd` — agent ID as `name@team`
- [x] `buildClaudeCmd` — includes all flags (name, team, color, parent session, agent type)
- [x] `buildClaudeCmd` — prepends `cd` when cwd is set, quotes paths with spaces
- [x] `buildClaudeCmd` — starts with `claude` when no cwd
- [x] Color cycling — wraps after 6 colors

### Infra setup — ✅ done

- [x] Add `"test": "bun test"` to `package.json`
- [x] Create `src/lib/layout.test.ts`
- [x] Create `src/lib/config.test.ts`

## Layer 2: E2E Evals

Run the actual skill in iTerm2 + tmux, verify results with `tmux` commands and [it2](https://it2.tmc.dev/).

### Test harness — ✅ done

Uses `bun:test` + Bun Shell (`$`) for structured tests with real shell execution.
Run with `bun run test:e2e` (requires tmux + iTerm2 + it2 + Claude Code).

- [x] `tests/e2e/helpers.ts` — shared utilities (poll, waitForPanes, getScreen, sendText, etc.)
- [x] `tests/e2e/explicit-count.test.ts` — tests with explicit worker count
- [x] `tests/e2e/auto-count.test.ts` — tests where the LLM decides worker count
- [x] Polling with timeout via `poll()` helper — no arbitrary sleeps
- [x] Cleanup in `afterAll` via `killTeam()`
- [x] `bun run test:e2e` script in package.json (120s timeout)

### it2 integration

Key commands used in the harness:

- [x] `it2 session send-text --require is-claude-session,is-at-prompt` — wait for Claude ready
- [x] `it2 get-screen --wait-stable` — capture settled screen contents
- [x] `it2 get-buffer --last N` — read buffer with scrollback
- [x] `it2-session-has-no-queued-claude-messages` — check if Claude is idle
- [x] `it2-session-claude-auto-approve` — auto-approve safe modals

### Eval cases

**Explicit count** (`tests/e2e/explicit-count.test.ts`):

| Task | Expected | Assertion |
|------|----------|-----------|
| `/cru 3 say hi` | 3 workers | pane count = 4, lead wider than workers, worker screens non-empty |
| `/cru 2 compare bun vs deno` | 2 workers | pane count = 3 |

**Auto count** (`tests/e2e/auto-count.test.ts`):

| Task | Expected | Assertion |
|------|----------|-----------|
| `/cru review security, perf, and tests` | ~3 workers | pane count in 4–5 |
| `/cru compare bun vs deno` | ~2 workers | pane count in 3–4 |
| `/cru break this into subtasks` | 2–5 workers | pane count in 3–6, worker screens non-empty |

### Not yet implemented

- [ ] Verify workers are running `claude` processes (check child of pane PID)
- [ ] Verify workers are working on *different* slices (buffer content analysis)
- [ ] Verify lead received a status summary
- [ ] Auto-approve worker modals during test run (babysit loop)
- [ ] CI-friendly mode (headless tmux, no iTerm2 dependency)

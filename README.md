<p align="center"><img src="assets/logo.svg" width="128"/></p>

# ◫ cru

Layout for [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams), fixed.

Agent teams let multiple Claude Code instances work together in parallel — cru handles the tmux layout so you don't have to.

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

That's it — cru creates the tmux panes, applies the grid layout, and your workers are ready to go.

## Use cases

- **[Parallel feature work](https://code.claude.com/docs/en/agent-teams#when-to-use-agent-teams)** — split subtasks across workers, merge when done

  ```
  /cru break down the checkout flow into vertical slices, one worker per slice
  ```
- **[Review crew](https://code.claude.com/docs/en/agent-teams#run-a-parallel-code-review)** — workers build, one reviews

  ```
  /cru 3 review PR #142 — one on security, one on performance, one on test coverage
  ```
- **[Competing hypotheses](https://code.claude.com/docs/en/agent-teams#investigate-with-competing-hypotheses)** — debug faster with multiple theories at once

  ```
  /cru users report the app crashes on login — each worker investigates a different theory
  ```
  
- **[Research spike](https://code.claude.com/docs/en/agent-teams#start-with-research-and-review)** — explore different approaches simultaneously
  ```
  /cru 3 evaluate auth libraries — one on passport, one on lucia, one on arctic
  ```

## Skill

The `/cru` skill is installed to `.claude/skills/` via `cru init`. It handles team creation, spawning, and layout in one shot — the main way most people use cru.

## CLI

For granular control or custom scripting, cru exposes the full CLI. Run these directly from Claude Code by prefixing with `!`.

### `teams [team]`

List all teams or show detail for a specific team.

```bash
cru teams                  # list active teams
cru teams --all            # include dead teams
cru teams my-team          # show members and pane assignments
```

### `panes <action> [team]`

Manage terminal panes — list, apply grid layout, or close workers.

```bash
cru panes list                              # list panes in current window
cru panes list my-team                      # list panes for a team
cru panes grid my-team                      # apply grid layout
cru panes grid my-team --lead-position right
cru panes grid my-team --lead-size 50
cru panes grid my-team --fill column
cru panes grid my-team --max-cols 3
cru panes close my-team                     # close all worker panes
```

| Flag | Description |
|------|-------------|
| `--lead-size <n>` | Lead pane size as % of window (default: `40`) |
| `--lead-position <pos>` | `left` \| `right` \| `top` \| `bottom` (default: `left`) |
| `--fill <dir>` | Grid fill direction: `row` \| `column` (default: `row`) |
| `--max-cols <n>` | Cap the number of grid columns |
| `--max-rows <n>` | Cap the number of grid rows |
| `--expect <n>` | Wait for N worker panes before applying layout |

### `tasks [team]`

List tasks for a team or all teams.

```bash
cru tasks                          # tasks from all teams
cru tasks my-team                  # tasks for a specific team
cru tasks --status in_progress     # filter by status
```

### `logs [team]`

Show team activity log — creation, member joins, and messages between agents. Omit the team name to see all teams merged into one timeline.

```bash
cru logs my-team
cru logs                   # all teams
cru logs -f                # follow live events
cru logs --last 10         # last 10 events
cru logs my-team --full    # show full message text
```

### `config`

Show the resolved config (defaults merged with your overrides).

### `doctor`

Check environment requirements (tmux, claude, bun). Shows terminal-specific fix hints.

```bash
cru doctor
cru doctor --json
```

### `clean`

Remove old team data from `~/.claude/teams`.

```bash
cru clean                  # remove teams older than 7 days
cru clean --days 3         # older than 3 days
cru clean --all            # remove all teams
cru clean --dry-run        # show what would be removed
```

### `init`

Set up cru in the current project.

```bash
cru init            # creates .cru.json + installs /cru skill
```

## Configuration

Create `.cru.json` in your project (or `~/.config/cru/config.json` globally).

> **Note:** Layout options apply to tmux pane grids. In Ghostty, splits are managed via AppleScript and these settings are not used.

```json
{
  "layout": {
    "lead": {
      "position": "left",
      "size": 40
    },
    "grid": {
      "fill": "row",
      "maxCols": null,
      "maxRows": null
    }
  }
}
```

### `layout.lead`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `position` | `"left"` \| `"right"` \| `"top"` \| `"bottom"` | `"left"` | Which side the lead pane sits on |
| `size` | `number` | `40` | Lead pane size as percentage of the window |

### `layout.grid`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fill` | `"row"` \| `"column"` | `"row"` | How workers fill the grid. `row` fills left-to-right then top-to-bottom. `column` fills top-to-bottom then left-to-right |
| `maxCols` | `number \| null` | `null` | Maximum columns in the grid. `null` = auto (`ceil(sqrt(N))`) |
| `maxRows` | `number \| null` | `null` | Maximum rows in the grid. `null` = auto |

### Resolution order

1. CLI flags (`--lead-size`, `--fill`, etc.)
2. Project config (`.cru.json` in cwd)
3. Global config (`~/.config/cru/config.json`)
4. Built-in defaults

### Examples

**Lead on the right, 30% width:**
```json
{
  "layout": {
    "lead": { "position": "right", "size": 30 }
  }
}
```

**Lead on top, workers in a single row:**
```json
{
  "layout": {
    "lead": { "position": "top", "size": 25 },
    "grid": { "maxRows": 1 }
  }
}
```

**Force 3-column grid:**
```json
{
  "layout": {
    "grid": { "maxCols": 3 }
  }
}
```

## Output formats

All commands support incur's output formats:

```bash
cru panes grid my-team --json
cru teams --format yaml
cru teams my-team --format md
```

## Project structure

```
src/
├── cli.ts                        # Entrypoint
├── commands/
│   ├── teams.ts                  # List teams / show team detail
│   ├── panes.ts                  # List, grid layout, close panes
│   ├── tasks.ts                  # List tasks
│   ├── config.ts                 # Show resolved config
│   ├── doctor.ts                 # Environment diagnostics
│   ├── init.ts                   # Set up cru in a project
│   ├── clean.ts                  # Remove old team data
│   └── logs.ts                   # Team activity log
└── lib/
    ├── config.ts                 # Config loading & merging
    ├── env.ts                    # Environment detection utilities
    ├── layout.ts                 # Grid math & tmux layout strings
    ├── preflight.ts              # Prerequisite checks
    ├── panes.ts                  # Pane tracking (cru-panes.json)
    ├── teams.ts                  # Read Claude Code team configs
    └── tmux.ts                   # Tmux command helpers

skills/
└── cru/SKILL.md                  # Claude Code skill
```

Built with [incur](https://github.com/wevm/incur).

## License

ISC

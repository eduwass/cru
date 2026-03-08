<p align="center"><img src="assets/logo.svg" width="128"/></p>

# ◫ cru

Layout for [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams), fixed.

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

## tmux setup

- **Already using tmux?** You're good.
- **iTerm2?** Use [`tmux -CC`](https://iterm2.com/documentation-tmux-integration.html) for native pane integration.
- **Ghostty?** tmux works fine inside it. Native pane integration (like iTerm2's `tmux -CC`) isn't supported yet, but [AppleScript support is coming](https://github.com/ghostty-org/ghostty/pull/11208).

## Install

Install with your package manager of choice:

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

2. Ask Claude Code to spawn a team:

```
/spawn-team 4 build a REST API
```

That's it — cru creates the tmux panes, applies the grid layout, and your workers are ready to go.

## Commands

### `spawn <team>`

Spawn worker agents in tmux panes and apply grid layout.

```bash
cru spawn my-team -n 4
cru spawn my-team -n 6 --lead-size 30
```

### `kill <team>`

Kill all worker panes for a team.

### `grid <team>`

Apply the grid layout to a team's tmux window.

```bash
cru grid my-team
cru grid my-team --lead-position right
cru grid my-team --lead-size 50
cru grid my-team --fill column
cru grid my-team --max-cols 3
```

| Flag | Description |
|------|-------------|
| `--lead-size <n>` | Lead pane size as % of window (default: `40`) |
| `--lead-position <pos>` | `left` \| `right` \| `top` \| `bottom` (default: `left`) |
| `--fill <dir>` | Grid fill direction: `row` \| `column` (default: `row`) |
| `--max-cols <n>` | Cap the number of grid columns |
| `--max-rows <n>` | Cap the number of grid rows |

### `list`

List all teams.

### `status <team>`

Show team members and pane assignments.

### `config`

Show the resolved config (defaults merged with your overrides).

### `init`

Set up cru in the current project.

```bash
cru init            # creates .cru.json + installs skills
```

## Configuration

Create `.cru.json` in your project (or `~/.config/cru/config.json` globally):

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

## Skills

The `/spawn-team` skill lives in `skills/spawn-team/` and is copied to `.claude/skills/` via `cru init`.

```
/spawn-team 4 build a REST API
```

It creates a team, spawns N worker agents, and applies the grid layout automatically.

## Output formats

All commands support incur's output formats:

```bash
cru grid my-team --json
cru list --format yaml
cru status my-team --format md
```

## Project structure

```
src/
├── cli.ts                        # Entrypoint
├── commands/
│   ├── init.ts                   # Set up cru in a project
│   ├── orchestration/
│   │   ├── spawn.ts              # Spawn worker agents
│   │   ├── kill.ts               # Kill worker panes
│   │   ├── status.ts             # Show team status
│   │   └── list.ts               # List teams
│   └── layout/
│       ├── grid.ts               # Apply tmux grid layout
│       └── config.ts             # Show resolved config
└── lib/
    ├── config.ts                 # Config loading & merging
    ├── layout.ts                 # Grid math & tmux layout strings
    ├── preflight.ts              # Prerequisite checks
    ├── spawn.ts                  # Worker spawning logic
    ├── teams.ts                  # Read Claude Code team configs
    └── tmux.ts                   # Tmux command helpers

skills/
└── spawn-team/SKILL.md           # Claude Code skill
```

Built with [incur](https://github.com/wevm/incur).

## License

ISC

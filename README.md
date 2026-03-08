# agent-teams

CLI for managing tmux layouts when running [Claude Code](https://claude.ai/code) agent teams. Lead pane on one side, workers in an auto-sized grid on the other.

```
|            | worker-1 | worker-2 |
|   lead     |----------|----------|
|            | worker-3 | worker-4 |
```

Built with [incur](https://github.com/wevm/incur).

## Install

```bash
bun install
```

## Quick start

```bash
# Apply grid layout to an active team
bun src/cli.js grid my-team

# With overrides
bun src/cli.js grid my-team --lead-size 30 --lead-position right
```

## Commands

### `grid <team>`

Apply the grid layout to a team's tmux window.

```bash
agent-teams grid my-team
agent-teams grid my-team --lead-position right
agent-teams grid my-team --lead-size 50
agent-teams grid my-team --fill column
agent-teams grid my-team --max-cols 3
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

```bash
agent-teams list
```

### `status <team>`

Show team members and pane assignments.

```bash
agent-teams status my-team
```

### `config`

Show the resolved config (defaults merged with your overrides).

```bash
agent-teams config
```

### `init`

Generate a config file with defaults.

```bash
agent-teams init            # creates .agent-teams.json in current directory
agent-teams init --global   # creates ~/.config/agent-teams/config.json
```

## Configuration

Create `.agent-teams.json` in your project (or `~/.config/agent-teams/config.json` globally):

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
2. Project config (`.agent-teams.json` in cwd)
3. Global config (`~/.config/agent-teams/config.json`)
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

## Claude Code integration

### As a skill

The repo includes a `/spawn-team` skill at `.claude/skills/spawn-team/SKILL.md` that spawns agents and applies the grid layout automatically:

```
/spawn-team 4 build a REST API
```

### Output formats

All commands support incur's output formats:

```bash
agent-teams grid my-team --json
agent-teams list --format yaml
agent-teams status my-team --format md
```

## Project structure

```
src/
├── cli.js              # Entrypoint — wires commands to incur
├── commands/
│   ├── config.js       # Show resolved config
│   ├── grid.js         # Apply tmux grid layout
│   ├── init.js         # Generate config file
│   ├── list.js         # List teams
│   └── status.js       # Show team status
└── lib/
    ├── config.js       # Config loading & merging
    ├── layout.js       # Grid math & tmux layout strings
    ├── teams.js        # Read Claude Code team configs
    └── tmux.js         # Tmux command helpers
```

## License

ISC

# CLI Reference

The `/cru` skill is the main way most people use cru — it handles team creation, spawning, and layout in one shot. For granular control or custom scripting, cru exposes the full CLI below. Run these directly from Claude Code by prefixing with `!`.

## `panes <action> [team]`

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

## `teams [team]`

List all teams or show detail for a specific team.

```bash
cru teams                  # list active teams
cru teams --all            # include dead teams
cru teams my-team          # show members and pane assignments
```

## `tasks [team]`

List tasks for a team or all teams.

```bash
cru tasks                          # tasks from all teams
cru tasks my-team                  # tasks for a specific team
cru tasks --status in_progress     # filter by status
```

## `logs [team]`

Show team activity log — creation, member joins, and messages between agents. Omit the team name to see all teams merged into one timeline.

```bash
cru logs my-team
cru logs                   # all teams
cru logs -f                # follow live events
cru logs --last 10         # last 10 events
cru logs my-team --full    # show full message text
```

## `config`

Show the resolved config (defaults merged with your overrides).

## `doctor`

Check environment requirements (tmux, claude, bun). Shows terminal-specific fix hints.

```bash
cru doctor
cru doctor --json
```

## `clean`

Remove old team data from `~/.claude/teams`.

```bash
cru clean                  # remove teams older than 7 days
cru clean --days 3         # older than 3 days
cru clean --all            # remove all teams
cru clean --dry-run        # show what would be removed
```

## `init`

Set up cru in the current project.

```bash
cru init            # creates .cru.json + installs /cru skill
```

## Output formats

All commands support incur's output formats:

```bash
cru panes grid my-team --json
cru teams --format yaml
cru teams my-team --format md
```

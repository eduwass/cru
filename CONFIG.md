# Configuration

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

## `layout.lead`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `position` | `"left"` \| `"right"` \| `"top"` \| `"bottom"` | `"left"` | Which side the lead pane sits on |
| `size` | `number` | `40` | Lead pane size as percentage of the window |

## `layout.grid`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fill` | `"row"` \| `"column"` | `"row"` | How workers fill the grid. `row` fills left-to-right then top-to-bottom. `column` fills top-to-bottom then left-to-right |
| `maxCols` | `number \| null` | `null` | Maximum columns in the grid. `null` = auto (`ceil(sqrt(N))`) |
| `maxRows` | `number \| null` | `null` | Maximum rows in the grid. `null` = auto |

## Resolution order

1. CLI flags (`--lead-size`, `--fill`, etc.)
2. Project config (`.cru.json` in cwd)
3. Global config (`~/.config/cru/config.json`)
4. Built-in defaults

## Examples

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

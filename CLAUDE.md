# Agent Teams

## Spawning Teams

Use `/spawn-team <N> [task]` to spawn a team of N worker agents with the preferred grid layout.

## Tmux Layout Preference

When spawning agent teams, ALWAYS arrange the tmux layout as:
- **Lead agent** on the LEFT (~40% width, full height)
- **Worker agents** in a GRID on the RIGHT

Example with 4 workers:
```
|            | worker-1 | worker-2 |
|   lead     |----------|----------|
|            | worker-3 | worker-4 |
```

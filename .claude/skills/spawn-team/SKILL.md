---
name: spawn-team
description: Spawn an agent team with workers arranged in a grid layout. Use when the user wants to create a team of agents.
argument-hint: <num-agents> [task description]
disable-model-invocation: true
---

# Spawn Agent Team

Spawn a team of worker agents arranged in a 2D grid to the right of the lead agent.

## Arguments

- `$ARGUMENTS[0]` — number of worker agents to spawn (required)
- Remaining arguments — task/prompt for the workers (optional, defaults to "Say hi to the team lead")

## Steps

1. **Create the team** using TeamCreate with a descriptive name based on the task.

2. **Spawn agents** — spawn `$ARGUMENTS[0]` agents in parallel using the Agent tool:
   - Name them `worker-1`, `worker-2`, ..., `worker-N`
   - Set `team_name` to the created team name
   - Set `run_in_background: true`
   - Give each agent the task from the remaining arguments, or a default greeting task

3. **Wait for all agents to spawn successfully.**

4. **Apply the grid layout** by running:
   ```bash
   node src/cli.js grid <team-name>
   ```
   This arranges: lead on the left, workers in a grid on the right.

5. **Report** to the user that the team is ready, listing agent names and the grid arrangement.

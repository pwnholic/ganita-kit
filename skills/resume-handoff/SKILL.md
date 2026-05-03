---
name: resume-handoff
description: Resume work from a previous handoff document. Restores goals, progress, decisions, and context so you can continue where the last session left off.
allowed-tools: read bash grep find
---

# Resume Handoff

Resume work from a serialized handoff document. Restore context, verify state, and continue from where the last session stopped.

## Execution Model

Pi executes tool calls sequentially. Batch independent reads in one turn.

## Step 1: Find the Handoff

Batch these in one turn to discover available handoffs:

- **find**: `.continuum/handoffs/ -name "*.md" -type f` -- all handoff files
- **bash**: `ls -t .continuum/handoffs/*.md 2>/dev/null | head -5` -- most recent first

If multiple handoffs exist, read the most recent one first with **read**.

If the user specified a particular handoff, read that one instead.

If no `.continuum/handoffs/` directory exists, tell the user: "No handoff documents found. Run /skill:create-handoff first."

## Step 2: Parse and Verify

Read the handoff document. Extract:

1. **Goal** -- what was being attempted
2. **In Progress** -- what was actively being worked on
3. **Next Steps** -- what was planned next
4. **Critical Context** -- runtime data not in files
5. **Errors** -- unresolved issues

Then verify current state matches the handoff. Batch these:

- **bash**: `git log --oneline -5` -- are there new commits since handoff?
- **bash**: `git status --short` -- current working tree state
- **bash**: `git diff --stat` -- uncommitted changes

Read any files mentioned in "In Progress" or "Next Steps" to confirm their current state matches the handoff description. If something changed since the handoff, note the discrepancy.

## Step 3: Restore Context

Present the restored state to the user:

```
Resuming from handoff: {date}

Goal: {one-line goal}

Progress:
  Done: {N} tasks
  In Progress: {description}
  Blocked: {blockers or "none"}

Files modified since handoff: {yes/no, what changed}

Next step: {from handoff, or adjusted if state diverged}
```

Ask the user to confirm or redirect. Then proceed with the next step.

## Step 4: Execute Next Step

Continue from the first item in "Next Steps" from the handoff document.

If the handoff's next steps don't match current reality (files changed, errors resolved, new context), adjust your approach:

- If a file mentioned in the handoff was modified by someone else, re-read it before acting
- If an error marked as "open" in the handoff is now resolved, skip it
- If new files appeared that the handoff didn't anticipate, investigate before proceeding

## Failure Recovery

| Situation                                 | Recovery                                                       |
| ----------------------------------------- | -------------------------------------------------------------- |
| Handoff file not found                    | List available handoffs, ask user to specify                   |
| Handoff references deleted files          | Note as discrepancy, ask user how to proceed                   |
| State diverged significantly from handoff | Report what changed, suggest re-planning with /skill:premortem |
| Handoff is old (days/weeks)               | Verify all referenced files still exist, re-check git history  |
| Multiple handoffs for same task           | Use the most recent one, mention older ones exist              |

## Guidelines

- Always verify state before acting. A handoff is a snapshot, not a guarantee.
- If reality contradicts the handoff, trust reality. Report the discrepancy.
- Don't re-explain what the previous session already explained. Just continue.
- After completing the task, run /skill:create-handoff again to update the handoff.

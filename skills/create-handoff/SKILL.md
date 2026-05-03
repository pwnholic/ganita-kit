---
name: create-handoff
description: Serialize current session context into a handoff document. Captures goals, progress, decisions, files modified, and errors. Use before context compaction, session end, or switching tasks.
allowed-tools: read bash grep find
---

# Create Handoff

Serialize session state into a portable handoff document. A fresh session reading only this document must be able to continue without asking questions.

## Execution Model

Pi executes tool calls sequentially. Batch independent reads and searches in one turn to save round-trips.

## Step 1: Scan Recent Activity

Batch these in one turn to gather state:

- **bash**: `git diff --stat HEAD~10` -- recent changes
- **bash**: `git log --oneline -10` -- recent commits
- **bash**: `git status --short` -- current working tree state
- **find**: `. -name "*.ts" -newer .git/index -type f` -- recently touched files

If the project has a `.continuum/` directory, read the latest handoff or contract to understand prior state.

## Step 2: Extract Session Knowledge

Review the conversation in your context. Extract:

1. **Goal**: What is the user trying to accomplish? Single clearest statement.
2. **Progress**: What is done vs in-progress vs blocked. Reference specific files.
3. **Decisions**: Key decisions and their rationale, especially non-obvious ones.
4. **Files**: What was read, modified, or created -- with one-line description of each.
5. **Errors**: Actual error messages encountered, whether resolved or still open.
6. **Context**: Runtime state, API responses, config values, IDs -- anything not in files.

Use **grep** to search for TODO comments or markers in recently modified files if progress is unclear.

## Step 3: Write the Document

Create the handoff directory if needed, then write:

**bash**: `mkdir -p .continuum/handoffs`

Then **bash** with a heredoc to write the file at `.continuum/handoffs/YYYY-MM-DD_HH-MM.md`:

```markdown
---
date: { ISO timestamp }
type: handoff
trigger: manual
goal: "{one-line goal}"
---

# Handoff: {goal}

## Goal

{2-3 sentences. What the user is trying to accomplish.}

## Constraints

- {Requirements from user}
- {Technical constraints discovered during work}

## Progress

### Done

- [x] {task} (`path/to/file`)

### In Progress

- [ ] {task} -- {current state, what remains}

### Blocked

- {blocker} -- {reason}

## Key Decisions

- **{decision}**: {rationale}

## Next Steps

1. {concrete action with file reference}
2. {next action}

## Files

### Modified

- `path/to/file` -- {what changed}

### Created

- `path/to/file` -- {purpose}

## Errors

- `{error message}`: {resolved how, or still open}

## Critical Context

- {data that cannot be rediscovered from files}
```

## Step 4: Confirm

Tell the user:

- Written to: `.continuum/handoffs/{filename}`
- One-line summary: goal, progress counts (done/in-progress/blocked), next step

## Failure Recovery

| Situation                           | Recovery                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| No git history                      | Skip git-based discovery, rely on conversation context only         |
| `.continuum/` doesn't exist         | Create it: `mkdir -p .continuum/handoffs`                           |
| Multiple unrelated tasks            | Focus on the latest unfinished task, briefly mention completed ones |
| Large session with lots of history  | Focus on last 10-20 interactions. Older context is less relevant.   |
| User asks to handoff specific scope | Narrow to that scope, mention other work in "Done" only             |

## Guidelines

- Be precise with file paths. Always relative to project root.
- Never paste code into the handoff. Reference file:line instead.
- The handoff must be self-contained -- a fresh session reads only this and can continue.
- Errors section is critical. Include actual error messages, not paraphrases.
- "Critical Context" is for data not in files: runtime state, user preferences, temporary values, API responses.
- If the conversation is long, prioritize recent work. Old completed tasks get one-liners in "Done".

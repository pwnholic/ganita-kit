---
name: autonomous
description: Full SDLC pipeline -- assess research plan premortem prepare execute validate evolve. Orchestrates workers via delegate_task for bounded implementation tasks with validation gates.
allowed-tools: read bash write edit grep find web_search code_search webclaw_scrape webclaw_summarize google_surf_search tldr_structure tldr_health tldr_bugbot tldr_impact tldr_whatbreaks tldr_change_impact tldr_search tldr_extract tldr_dead tldr_smells tldr_complexity tldr_cognitive tldr_loc tldr_deps tldr_secure tldr_vuln bloks_context bloks_search bloks_card bloks_recipe bloks_learn bloks_ack bloks_nack fast_edit fast_read fast_search fast_delete ask_user delegate_task
---

# Autonomous

SDLC pipeline for bounded implementation tasks. You orchestrate -- never implement directly. Workers build via delegate_task. You plan, decompose, delegate, validate, steer.

Pipeline: ASSESS -> RESEARCH -> PLAN -> PREMORTEM -> PREPARE -> EXECUTE -> VALIDATE -> EVOLVE

All phases run. Depth scales with complexity. RESEARCH is optional for patch tasks, mandatory for feature and above.

## Execution Model

Pi executes tool calls sequentially. Batch independent tool calls in one turn to save round-trips. Use **delegate_task** for worker execution -- each worker gets a bounded prompt and isolated turn budget.

## ASSESS

Read the task. Batch context gathering in one turn:

- **tldr_structure** with `path="."` -- project layout
- **tldr_health** with `path="."` -- current health
- **tldr_loc** with `path="."` -- project size
- **read**: AGENTS.md or project config if present

Classify complexity:

| Type          | Criteria            | Research needed? | Workers | Milestones |
| ------------- | ------------------- | ---------------- | ------- | ---------- |
| patch         | Bug fix, one change | No               | 1       | 1          |
| feature       | One bounded feature | Yes              | 2-4     | 1          |
| multi-feature | Multiple features   | Yes              | 4-8     | 2+         |
| greenfield    | New project/module  | Yes              | 3-6     | 2+         |

Identify unknowns: things you don't know about the codebase, the library, the API, or the domain that must be resolved before you can plan. List them explicitly.

## RESEARCH

Resolve unknowns identified in ASSESS. Skip this phase only for patch tasks with zero unknowns.

Choose research strategy based on unknown type:

### Codebase Unknowns

Batch these in one turn:

- **tldr_search** with `query="{concept}"` and `path="<path>"` -- find relevant code
- **tldr_context** with `entry="{function}"` -- trace call graph
- **tldr_deps** with `path="<path>"` -- dependency relationships
- **tldr_impact** with `function_name="<name>"` and `path="<path>"` -- callers

### Library/API Unknowns

Batch these in one turn:

- **bloks_search** with `query="{topic}"` -- indexed library docs
- **bloks_recipe** with `library="{lib}"` and `keywords=["{kw1}", "{kw2}"]` -- composed API context
- **bloks_card** with `library="{lib}"` and `symbol="{name}"` -- specific signatures
- **code_search** with `query="{lib} {function} usage"` -- code examples

### Domain/External Unknowns

Batch these in one turn:

- **web_search** with `queries=["{topic} {aspect}", "{topic} best practice"]` -- web research
- **webclaw_scrape** with `url="{doc-url}"` -- full documentation
- **google_surf_search** with `query="{topic}"` -- Google search fallback

### Deep Investigation

For complex unknowns requiring multi-turn reasoning:

- **delegate_task** with a research worker:
  - `prompt="Investigate {question}. Search codebase with tldr_search, read relevant files, trace dependencies. Write findings to .continuum/autonomous/{task-id}/research/{topic}.md"`
  - `tools=["read", "bash", "grep", "find", "tldr_search", "tldr_structure", "tldr_extract", "bloks_search", "bloks_card"]`

### Research Output

Write findings to `.continuum/autonomous/{task-id}/research/{topic}.md` via **bash**.

Each finding must be actionable: "X does Y, which means we must Z in the implementation."

After all unknowns are resolved, you should be able to answer every question posed in ASSESS. If not, identify what remains unknown and decide: block and ask user via **ask_user**, or proceed with documented assumptions.

## PLAN

Create a contract at `.continuum/autonomous/{task-id}/contract.json` via **bash**.

Research findings feed directly into assertions. Every assertion should reference evidence from RESEARCH.

Contract tracks the full lifecycle:

```json
{
  "task": "description",
  "complexity": "patch|feature|multi-feature|greenfield",
  "milestones": [
    { "name": "milestone-1", "status": "pending", "assertions": ["VAL-001"] }
  ],
  "assertions": [
    {
      "id": "VAL-001",
      "type": "invariant|behavioral|contract|approval",
      "text": "what must be true",
      "milestone": "milestone-1",
      "status": "pending",
      "depends": [],
      "worker": null,
      "evidence": null
    }
  ]
}
```

Rules:

- One assertion = one testable claim. If you need "and" to describe it, split into two.
- Assertions with `depends: []` run first. Dependent assertions wait.
- Decomposition is YOUR job. Workers execute one assertion each.
- Every assertion should be grounded in RESEARCH findings, not guesswork.

Write contract.json, then write plan.md for multi-feature tasks.

## PREMORTEM

Run failure analysis on the plan. Use the same process as /skill:premortem:

Batch structural analysis in one turn:

- **tldr_impact** for key functions
- **tldr_deps** for affected modules
- **tldr_smells** for existing issues

Present findings via **ask_user**. BLOCK on tigers, WARN on elephants and paper tigers, PASS if clean.

## PREPARE

Front-load context into worker prompts. Workers should never discover what you already know.

Combine RESEARCH findings + library context. Batch all gathering in one turn:

- **bloks_context** with `path="."` -- project rules, tastes, corrections
- **bloks_recipe** with `library="{lib}"` and `keywords=["{kw1}", "{kw2}"]` -- task-specific API docs
- **bloks_card** with `library="{lib}"` and `symbol="{name}"` -- specific signatures
- **tldr_structure** with `path="<affected>"` -- affected module layout
- **read**: `.continuum/autonomous/{task-id}/research/*.md` -- research findings

Capture all output. This goes verbatim into worker prompts. Do not summarize bloks output -- paste it. The cards are already compressed.

## EXECUTE

Dispatch workers via **delegate_task**. One worker per assertion.

Respect dependency order:

1. Assertions with `depends: []` first
2. Independent assertions MAY run in parallel (batch delegate_task calls) IF they touch disjoint files
3. Before parallelizing: check file sets overlap. Same files = serialize.

Worker prompt structure (every field present):

```
Role: {implement|research|review|evolve}

Assertion: {id} - {text}

Context:
  research_findings: {key findings from RESEARCH phase}
  bloks_context: {verbatim output from PREPARE}
  bloks_cards: {array of {id, content} objects}
  conventions: {from AGENTS.md or project rules}
  structure: {tldr_structure output for affected modules}
  prior_report: {null if first, or previous worker's report}

Bounds:
  files: ["path/to/file1", "path/to/file2"]
  test_command: "{test command}"
  tdd: {true|false}

Output: Write report to .continuum/autonomous/{task-id}/reports/{worker-id}.json
```

Worker archetypes:

**implement**: Drive minimal correct code through failing tests. TDD when `tdd: true`.

**research**: Decompose unknowns discovered during execution. Write findings to bloks via bloks_learn. One finding per call.

**review**: Audit diff against contract coldly. Evidence only, no vibes.

**evolve**: Harden infrastructure. Eliminate error classes through constraints.

### Worker Tools

Assign tools based on archetype:

- implement: `["read", "bash", "edit", "write", "grep", "find", "fast_edit", "fast_read", "fast_search"]`
- research: `["read", "bash", "grep", "find", "tldr_search", "tldr_structure", "bloks_search", "bloks_card", "bloks_learn"]`
- review: `["read", "bash", "grep", "tldr_bugbot", "tldr_impact", "tldr_smells", "tldr_diff"]`
- evolve: `["read", "bash", "edit", "write", "grep", "find", "fast_edit", "bloks_learn", "bloks_ack", "bloks_nack"]`

### Worker Report Format

Every worker writes a JSON report:

```json
{
  "task": "assigned task",
  "assertion": "VAL-001",
  "result": "success|partial|blocked",
  "implemented": "what was done",
  "remaining": "what's left",
  "tests": { "added": [], "command": "", "exit_code": 0 },
  "bloks_used": [{ "card": "id", "helpful": true }],
  "corrections": [],
  "discoveries": [],
  "issues": [],
  "conventions": []
}
```

## VALIDATE

After each milestone, validate sequentially:

1. **Automated checks**: Batch in one turn:
   - **bash**: `{test_command}` -- run tests
   - **bash**: `{typecheck_command}` -- type errors
   - **bash**: `{lint_command}` -- lint issues

2. **Assertion check**: Read worker reports. Verify evidence matches assertion type. Update contract.json status.

3. **Scrutiny**: delegate_task with review archetype on milestone diff. Match contract? Regressions?

4. **Fix loop**: If failures, dispatch targeted fix workers. Max 2 rounds. Then escalate via **ask_user**.

5. **Rollback**: If fix rounds exhausted and user declines, **bash**: `git reset --hard` to pre-milestone commit.

Write validation result to `.continuum/autonomous/{task-id}/validation/{milestone}.json`.

## EVOLVE

After task completes, aggregate all worker reports.

Batch context gathering:

- **bash**: `cat .continuum/autonomous/{task-id}/reports/*.json` -- all reports
- **tldr_health** with `path="."` -- compare against ASSESS baseline

For each confirmed pattern, recommend enforcement tier:

lint rule > type system > formatter > pre-commit hook > CI check > AGENTS.md (last resort)

Present via **ask_user**: "Based on N worker reports, M patterns confirmed. Apply all / select / skip?"

Then execute approved changes and close the knowledge loop:

1. **corrections**: **bloks_learn** or **bloks_card** updates
2. **discoveries**: verify bloks writes landed
3. **bloks_ack** / **bloks_nack**: for every card injected during PREPARE
   - Correct and used -> ack
   - Wrong or outdated -> nack
4. Re-run **tldr_health** for delta vs ASSESS baseline

## STATE

All state lives in the file system:

```
.continuum/autonomous/{task-id}/
  contract.json     -- assertions + lifecycle state
  plan.md           -- milestones (multi-feature+)
  research/         -- findings from RESEARCH phase
  reports/          -- worker reports
  validation/       -- milestone results
```

## RESUME

If resuming after compaction or new session:

1. **read**: `.continuum/autonomous/{task-id}/contract.json`
2. **read**: `.continuum/autonomous/{task-id}/research/*.md` -- prior research findings
3. Find pending assertions and milestones
4. Respect depends graph -- don't dispatch if dependency is pending/failed
5. Continue from gap. Show user: assertions N/total, milestones M/total, next pending.

## Failure Recovery

| Situation                              | Recovery                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| RESEARCH cannot resolve an unknown     | Block and ask user via ask_user. Proceed only with answer or documented assumption. |
| delegate_task times out                | Increase max_turns, or split the assertion into smaller pieces                      |
| Worker returns blocked                 | Read report, understand blocker, either fix prerequisite or re-plan                 |
| Tests fail after implementation        | Dispatch fix worker with `tdd: true`, max 2 rounds                                  |
| bloks returns empty for a library      | Skip that context variable, don't fabricate                                         |
| File conflict between parallel workers | Serialize instead, pass first worker's report to second                             |
| Contract gets out of sync              | Re-read contract.json before each dispatch, update after each result                |

## Guidelines

- Never implement directly. Workers via delegate_task.
- RESEARCH before PLAN. Never plan on assumptions -- plan on evidence.
- TDD: assertion -> failing test -> implement -> pass.
- Every milestone has a validation gate. No exceptions.
- Workers are atomic: one task, one assertion, one report.
- Commit after each worker: `bash` with `git add -A && git commit -m "..."`
- Respect assertion dependency graph. Always.
- Front-load context into worker prompts. Paste bloks output verbatim.
- Include research findings in worker prompts. Workers should not re-discover what RESEARCH already found.

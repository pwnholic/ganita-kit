---
name: review
description: Structural and semantic code review using tldr bugbot, impact analysis, and complexity metrics. Use for code review, pre-merge checks, checking uncommitted changes, or reviewing a specific path.
allowed-tools: read bash grep find tldr_bugbot tldr_impact tldr_whatbreaks tldr_smells tldr_complexity tldr_cognitive tldr_hotspots tldr_secure tldr_vuln tldr_change_impact tldr_dead tldr_diff tldr_health delegate_task ask_user
---

# Review

Hybrid code review: deterministic structural analysis from tldr tools + semantic reasoning over actual diffs. No guessing -- every finding backed by computed facts.

## Execution Model

Pi executes tool calls sequentially. Batch independent analyses in one turn. Use **delegate_task** for parallel deep investigation.

## Step 1: Determine Scope

Parse arguments:

| Argument          | Scope               | Action                                                |
| ----------------- | ------------------- | ----------------------------------------------------- |
| No args           | Uncommitted changes | `git diff --stat HEAD` and `git diff --staged --stat` |
| `--staged`        | Staged only         | `git diff --staged --stat`                            |
| `--base-ref main` | Since branch point  | `git diff main...HEAD --stat`                         |
| `--quick`         | Fast mode           | Skip delegate_task, run analysis in main context      |
| `--security`      | Security focus      | Add tldr_secure, tldr_vuln, tldr_taint                |
| `<path>`          | Specific directory  | Scope all tools to that path                          |

Batch these in one turn to understand what changed:

- **bash**: `git diff --stat {BASE_REF}` or `git diff --staged --stat`
- **bash**: `git diff {BASE_REF} --unified=5` (or `--staged --unified=5`)

If no changes detected, stop and tell the user.

## Step 2: Structural Analysis

### Quick Mode (--quick)

Batch these in one turn:

- **tldr_bugbot** with `path="."` and appropriate `base_ref` or `staged=true`
- **tldr_smells** with `path="."`

Reason over findings directly in main context.

### Full Mode (default)

Launch parallel investigations via **delegate_task**. Batch all three in one turn:

**Agent 1 -- Bug Detection:**

- **delegate_task** with:
  - `prompt="Run bug detection on changes and return ALL output. Use tldr_bugbot with path='.', {staged/base_ref flags}. Then for each changed function found in the diff, run tldr_dead on the containing file. Return complete findings."`
  - `tools=["bash", "read", "tldr_bugbot", "tldr_dead"]`

**Agent 2 -- Impact Analysis:**

- **delegate_task** with:
  - `prompt="For each changed function in the diff, run impact and whatbreaks analysis. Use tldr_impact and tldr_whatbreaks for each function name against the project path. Return all results."`
  - `tools=["bash", "read", "tldr_impact", "tldr_whatbreaks"]`

**Agent 3 -- Quality Analysis:**

- **delegate_task** with:
  - `prompt="Run quality analysis on changed files. Use tldr_smells, tldr_hotspots. For each changed file run tldr_complexity and tldr_cognitive. Return all results."`
  - `tools=["bash", "read", "tldr_smells", "tldr_hotspots", "tldr_complexity", "tldr_cognitive"]`

### Security Mode (--security)

Add a fourth agent:

- **delegate_task** with:
  - `prompt="Run security analysis. Use tldr_secure, tldr_vuln on the changed paths. For endpoint/handler functions, trace taint flows. Return all findings."`
  - `tools=["bash", "read", "tldr_secure", "tldr_vuln"]`

## Step 3: Semantic Reasoning

After all agents complete, read their outputs. Also read the actual diff if not already in context.

Apply reasoning over computed facts:

- **Bugbot findings**: Read actual code around each finding. Is it a real issue or acceptable in context?
- **Impact analysis**: Are high-centrality hub functions affected? How many downstream callers?
- **Quality metrics**: Complexity hotspots? New dead code? Cognitive complexity spikes?
- **Security** (if applicable): Taint flows reaching sensitive sinks? Resource leaks?

## Step 4: Produce Review

Format:

```markdown
## Review: {scope description}

**Verdict: APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION**

### Structural Facts

| Category          | Count                | Severity              |
| ----------------- | -------------------- | --------------------- |
| Bug findings      | N                    | N critical, N warning |
| Impact radius     | N functions affected |
| Security findings | N                    | (if applicable)       |

### Blocking Issues

1. **[severity] [category]**: description
   - File: `path:line`
   - Structural fact: what the tool found
   - Why it matters
   - Suggested fix

### Warnings

1. **[warning] [category]**: description

### Observations

Non-actionable notes: complexity trends, architecture observations, positive changes.

### Test Coverage

- Changed functions with tests: N/M
- Suggested test additions

### Summary

{2-3 sentence human-readable summary}
```

## Failure Recovery

| Situation                        | Recovery                                                    |
| -------------------------------- | ----------------------------------------------------------- |
| tldr_bugbot finds nothing        | Good -- report clean bill of health, move to quality review |
| delegate_task fails or times out | Fall back to quick mode, run analysis directly              |
| Diff is very large (>500 lines)  | Focus on files with most findings, skip clean files         |
| No tests exist for changed code  | Flag as a finding: "No test coverage for changed code"      |

## Guidelines

- Always present structural evidence alongside semantic judgment
- Never flag an issue without citing the tool and finding that detected it
- Keep verdict binary: APPROVE or REQUEST_CHANGES. NEEDS_DISCUSSION only for architectural disagreements.
- Blocking issues must have a concrete suggested fix, not just "this is wrong"
- If all clear, say so directly. Don't manufacture findings.
- After review, suggest next steps: /skill:autonomous to fix issues, or commit if approved

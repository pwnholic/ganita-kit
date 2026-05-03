---
name: bootup
description: Assess project readiness and route to the right workflow. Scores health using tldr analysis, identifies gaps, and recommends autonomous/research/review mode.
allowed-tools: read bash grep find tldr_health tldr_structure tldr_loc tldr_smells tldr_deps tldr_todo ask_user
---

# Bootup

Assess project health, identify gaps, and route to the right workflow. You are a dispatcher -- you gather facts and route, you do not implement.

## Execution Model

Pi executes tool calls sequentially. Batch independent analyses in one turn.

## Step 1: Assess Health

Batch all health checks in one turn:

- **tldr_health** with `path="."` -- comprehensive health dashboard
- **tldr_structure** with `path="."` -- project layout
- **tldr_loc** with `path="."` -- code size breakdown
- **tldr_smells** with `path="."` -- code smells
- **tldr_deps** with `path="."` -- dependency graph and cycles
- **tldr_todo** with `path="."` -- improvement suggestions

If the project has existing config files, batch these reads in one turn:

- **bash**: `cat package.json 2>/dev/null || cat Cargo.toml 2>/dev/null || cat pyproject.toml 2>/dev/null`
- **bash**: `cat tsconfig.json 2>/dev/null`
- **bash**: `ls biome.json .eslintrc* .prettierrc* ruff.toml Makefile 2>/dev/null`
- **bash**: `ls AGENTS.md CLAUDE.md .cursorrules 2>/dev/null`

## Step 2: Score Readiness

Extract scores from tldr_health output. Map to readiness levels:

| Level | Pass Rate | Meaning |
|-------|-----------|---------|
| 5 | 90%+ | Production ready. All tooling configured. |
| 4 | 75-89% | Strong. Minor gaps. |
| 3 | 50-74% | Workable. Agents can function with care. |
| 2 | 25-49% | Fragile. Missing foundational tooling. |
| 1 | <25% | Greenfield or bare. Needs setup before agent work. |

Note failing criteria from tldr_todo and tldr_smells output.

## Step 3: Detect Stack

From the files present, determine:

- **Language**: TypeScript, Python, Rust, Go, etc.
- **Framework**: Next.js, FastAPI, Axum, etc.
- **Build tool**: npm/pnpm, cargo, pip/poetry
- **Test runner**: vitest, pytest, cargo test
- **Linter/formatter**: biome, eslint, ruff, clippy

This determines which tools the agent should use.

## Step 4: Present and Route

Use **ask_user** with `type="select"` to ask:

```
Readiness: Level {N}/5 ({pass_rate}%)
Stack: {language}/{framework}
Size: {loc} lines across {files} files
Health issues: {top 3 from tldr_todo}

What do you want to do?
1. Research -- explore, brainstorm, reduce uncertainty
2. Autonomous -- plan and build with pipeline
3. Review -- code review on current state
```

### Routing

Based on the answer:

- **Research**: Tell user to run `/skill:research`
- **Autonomous**: Tell user to run `/skill:autonomous`
- **Review**: Tell user to run `/skill:review`

### Level-Based Recommendations

**Level 3+**: Project workable. Route directly.

**Level 2**: Present choice:
"Level 2 is workable but agents may struggle with gaps in {failing_categories}. Recommend fixing readiness first (~30 min) or proceed anyway."

**Level 1**: Strong recommendation:
"Level 1 needs foundational work. Missing: {top 5 criteria}. Recommend /skill:autonomous with a readiness-focused mission first."

## Failure Recovery

| Situation | Recovery |
|-----------|----------|
| tldr_health times out | Run with `quick=true`, skip coupling analysis |
| No package manifest found | Report as finding: "No package manager detected" |
| Empty project (no source files) | Route directly to autonomous for scaffolding |
| Multiple languages detected | Note polyglot setup, ask which to focus on |

## Guidelines

- Never implement anything yourself. You dispatch.
- Present facts, not opinions. The tldr output is the evidence.
- If the user just wants to start working, let them. Readiness is advisory, not blocking.
- Keep the interaction short. Assess, present, route. Under 3 minutes.

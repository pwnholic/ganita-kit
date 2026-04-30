---
name: tldr
description:
  Code analysis via the tldr CLI — AST structure, call graphs, dead code, security scanning,
  quality metrics, program slicing, and 60+ analysis commands across 18 languages.
  Use when you need to understand, audit, refactor, or explain code.
---

# Tldr — Code Analysis

Analyze code with 60+ commands across 18 languages using a 5-layer stack (AST → CallGraph → CFG → DFG → PDG). Every question backed by structural evidence, not grep.

## Execution Model

Pi executes tool calls sequentially, even when you emit multiple calls in one turn. But batching independent calls in one turn still saves LLM round-trips (~5-10s each). Use these patterns:

| Pattern                      | When                                    | Actually parallel?         |
| ---------------------------- | --------------------------------------- | -------------------------- |
| Batch tool calls in one turn | Independent analyses on different files | No, but saves round-trips  |
| Warm + analyze               | Before heavy analysis session           | No, warm must finish first |

## Step 1: Classify the Request

Before doing anything, classify the request to pick the right analysis workflow.

| Type              | Trigger                                              | Primary Approach                                                    |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| **Orientation**   | "What's in this codebase?", "Explain this project"   | `tldr_tree` + `tldr_structure` + `tldr_deps`                        |
| **Navigation**    | "Where is X defined?", "Who calls Y?"                | `tldr_definition` + `tldr_references` + `tldr_impact`               |
| **Health**        | "Is this code good?", "What needs fixing?"           | `tldr_health` + `tldr_dead` + `tldr_smells` + `tldr_todo`           |
| **Security**      | "Is this safe?", "Any vulnerabilities?"              | `tldr_secure` + `tldr_vuln` + `tldr_taint` + `tldr_api_check`       |
| **Refactoring**   | "Can I rename/move X?", "What breaks if I change Y?" | `tldr_impact` + `tldr_whatbreaks` + `tldr_change_impact`            |
| **Understanding** | "Explain this function", "How does data flow here?"  | `tldr_explain` + `tldr_slice` + `tldr_contracts`                    |
| **Metrics**       | "How complex is this?", "Coverage?"                  | `tldr_complexity` + `tldr_cognitive` + `tldr_coverage` + `tldr_loc` |

## Step 2: Analyze by Type

### Orientation — "What's in this codebase?"

Batch these in one turn:

```
tldr_tree({ path: "src/" })
tldr_structure({ path: "src/" })
tldr_deps({ path: "src/" })
```

Then drill into specific modules with `tldr_structure` on individual files, or `tldr_explain` on key functions.

### Navigation — "Where is X? Who calls it?"

Batch these in one turn:

```
tldr_definition({ file: "src/app.ts", symbol: "handleRequest" })
tldr_references({ symbol: "handleRequest", path: "src/" })
tldr_impact({ function_name: "handleRequest", path: "src/" })
```

`impact` gives the reverse call graph (all callers). `references` finds all textual references. `definition` gives the exact location. Together they answer: where is it, who uses it, what breaks if it changes.

### Health — "What needs fixing?"

Batch these in one turn:

```
tldr_health({ path: "src/" })
tldr_dead({ path: "src/" })
tldr_smells({ path: "src/", threshold: "strict" })
tldr_todo({ path: "src/", quick: true })
```

`health` gives the dashboard overview. `dead` finds unreachable code. `smells` detects anti-patterns. `todo` aggregates everything into an actionable list.

For a single function's health:

```
tldr_explain({ file: "src/app.ts", function_name: "processRequest", depth: 2 })
tldr_complexity({ file: "src/app.ts", function_name: "processRequest" })
tldr_cognitive({ path: "src/app.ts", function_name: "processRequest" })
```

### Security — "Is this safe?"

Start with the dashboard, then drill into findings:

```
tldr_secure({ path: "src/" })
```

For specific concerns:

```
tldr_vuln({ path: "src/", severity: "high" })
tldr_vuln({ path: "src/", vuln_type: "sql_injection" })
tldr_taint({ file: "src/api/auth.ts", function_name: "login" })
tldr_api_check({ path: "src/" })
tldr_resources({ file: "src/api/db.ts", function_name: "connect" })
```

`taint` traces user input to dangerous sinks. `vuln` scans for known vulnerability patterns. `api_check` catches misuse like missing timeouts or bare excepts. `resources` finds leaks.

### Refactoring — "What breaks if I change X?"

```
tldr_impact({ function_name: "parseConfig", path: "src/" })
tldr_whatbreaks({ target: "parseConfig", path: "src/" })
tldr_change_impact({ path: "src/", files: "src/config.ts" })
```

Before deleting a symbol:

```
tldr_impact({ function_name: "oldHandler", path: "src/" })
tldr_references({ symbol: "oldHandler", path: "src/" })
```

If `impact` and `references` both return empty — safe to delete. If not, you know exactly what to update.

After refactoring, verify:

```
tldr_diff({ file_a: "src/app.ts", file_b: "src/app.ts" })
tldr_change_impact({ path: "src/" })
```

### Understanding — "How does this work?"

For a single function, one call gives everything:

```
tldr_explain({ file: "src/app.ts", function_name: "handleRequest", depth: 3 })
```

That returns signature, purity, complexity, all callers, all callees. For data flow:

```
tldr_slice({ file: "src/app.ts", function_name: "handleRequest", line: 42 })
```

That returns every statement that affects line 42. For pre/postconditions:

```
tldr_contracts({ file: "src/app.ts", function_name: "handleRequest" })
```

### Metrics — "How complex/covered is this?"

Batch these in one turn:

```
tldr_loc({ path: "src/", by_file: true })
tldr_churn({ path: "src/", days: 90 })
tldr_hotspots({ path: "src/", days: 90 })
```

`hotspots` = churn × complexity. Files that change often AND are complex = highest risk.

For per-function metrics:

```
tldr_complexity({ file: "src/app.ts", function_name: "process" })
tldr_cognitive({ path: "src/app.ts", function_name: "process" })
tldr_halstead({ path: "src/app.ts", function_name: "process" })
```

For coverage:

```
tldr_coverage({ report: "coverage/lcov.info" })
```

## Step 3: Performance Tips

Before heavy analysis on a large project, warm the cache:

```
tldr_warm({ path: "src/" })
```

This pre-builds the call graph. All subsequent `impact`, `calls`, `dead`, `explain` queries will be near-instant.

For repeated analysis during a session, start the daemon:

```bash
tldr daemon start    # once
# all subsequent tldr calls use the daemon (instant)
tldr daemon status   # check if running
```

## Step 4: Tool Selection Guide

### Quick Reference — "Which tool do I use?"

| I want to...                       | Use this                              |
| ---------------------------------- | ------------------------------------- |
| See project layout                 | `tldr_tree`                           |
| List functions/classes in a file   | `tldr_structure`                      |
| Find where a symbol is defined     | `tldr_definition`                     |
| Find all usages of a symbol        | `tldr_references`                     |
| See who calls a function           | `tldr_impact`                         |
| See full call graph                | `tldr_calls`                          |
| Find dead code                     | `tldr_dead`                           |
| Find code clones                   | `tldr_clones`                         |
| Compare two files structurally     | `tldr_diff`                           |
| Compare code similarity            | `tldr_dice`                           |
| Detect code smells                 | `tldr_smells`                         |
| Get function complexity            | `tldr_complexity` or `tldr_cognitive` |
| Get full function analysis         | `tldr_explain`                        |
| Find vulnerabilities               | `tldr_vuln` or `tldr_secure`          |
| Trace taint flow                   | `tldr_taint`                          |
| Find API misuse                    | `tldr_api_check`                      |
| Find resource leaks                | `tldr_resources`                      |
| Get module dependencies            | `tldr_deps`                           |
| Get inheritance hierarchy          | `tldr_inheritance`                    |
| Extract API surface                | `tldr_surface` or `tldr_interface`    |
| Get quality dashboard              | `tldr_health`                         |
| Get aggregated fix suggestions     | `tldr_todo`                           |
| Build LLM context from entry point | `tldr_context`                        |
| Trace what affects a line          | `tldr_slice`                          |
| Find dead variable stores          | `tldr_dead_stores`                    |
| Infer pre/postconditions           | `tldr_contracts`                      |
| Extract specs from tests           | `tldr_specs`                          |
| Detect design patterns             | `tldr_patterns`                       |
| Find hub functions                 | `tldr_hubs`                           |
| Analyze class cohesion             | `tldr_cohesion`                       |
| Analyze module coupling            | `tldr_coupling`                       |
| Analyze technical debt             | `tldr_debt`                           |
| Find affected tests                | `tldr_change_impact`                  |
| Parse import statements            | `tldr_imports`                        |
| Find who imports a module          | `tldr_importers`                      |
| Count lines of code                | `tldr_loc`                            |
| Analyze git churn                  | `tldr_churn`                          |
| Find risk hotspots                 | `tldr_hotspots`                       |
| Parse coverage reports             | `tldr_coverage`                       |
| Run type check + lint              | `tldr_diagnostics`                    |
| Auto-fix errors                    | `tldr_fix`                            |
| Detect bugs in changes             | `tldr_bugbot`                         |
| Pre-warm cache                     | `tldr_warm`                           |
| Check daemon status                | `tldr_daemon_status`                  |
| Show cache stats                   | `tldr_cache_stats`                    |
| Clear cache                        | `tldr_cache_clear`                    |

## Failure Recovery

| Failure                                          | Recovery                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tldr_structure` returns empty                   | File may be empty or language not detected; try with explicit `tldr_extract`                                                          |
| `tldr_impact` returns no callers                 | Function may be an entry point (main, handler) or only called dynamically                                                             |
| `tldr_dead` flags a function                     | Verify with `tldr_references` first — dynamic dispatch (callbacks, plugins) won't show in static analysis                             |
| `tldr_vuln` finds too many low-severity findings | Filter by `severity: "high"` or `severity: "critical"` to focus on what matters                                                       |
| `tldr_taint` on wrong function                   | Taint requires the exact function that receives user input; trace backwards from the sink first                                       |
| `tldr_explain` returns partial data              | Call graph may not be built yet; run `tldr_warm` first, then retry                                                                    |
| Cache seems stale                                | Run `tldr_cache_clear` then `tldr_warm` to rebuild                                                                                    |
| Language not detected                            | All commands auto-detect language from file extension. If ambiguous, the tool defaults to the most common language for that extension |
| Large repo is slow                               | Use `tldr_warm` once, then all subsequent queries use the cache. Or use `tldr_daemon_status` to check if daemon is running            |

## Guidelines

- Always warm the cache before a heavy analysis session — `tldr_warm({ path: "src/" })`
- Start with `tldr_health` or `tldr_todo` for a quick overview before diving deep
- Use `tldr_explain` instead of reading the whole file — it gives signature, complexity, callers, and callees in one call
- Batch independent analyses in one turn to save round-trips
- For refactoring, always run `tldr_impact` BEFORE changing code and `tldr_change_impact` AFTER
- For security audits, start with `tldr_secure` (full dashboard) then drill into specific findings with `tldr_vuln` and `tldr_taint`
- Answer directly with evidence. Show the function signature, the caller list, the complexity score — not just "it looks fine"

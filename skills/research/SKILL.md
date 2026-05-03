---
name: research
description: Open-ended research and exploration. Gathers data from web search, documentation, code analysis, and library knowledge. Produces a findings document at .continuum/research/{topic}/findings.md. Use when you need to explore, investigate, or reduce uncertainty before implementation.
allowed-tools: read bash grep find web_search code_search webclaw_scrape webclaw_summarize google_surf_search tldr_structure tldr_search tldr_extract tldr_context bloks_search bloks_card bloks_recipe bloks_context delegate_task ask_user
---

# Research

Open-ended exploration where the destination isn't clear yet. Unlike /skill:autonomous (which drives toward known goals), research is for reducing uncertainty.

## Execution Model

Pi executes tool calls sequentially. Batch independent calls in one turn to save round-trips (~5-10s each). Use these patterns:

| Pattern                      | When                                              | Saves round-trips?    |
| ---------------------------- | ------------------------------------------------- | --------------------- |
| Batch tool calls in one turn | Independent searches, reads, analyses             | Yes                   |
| delegate_task                | Deep investigation requiring multi-turn reasoning | Yes (entire sub-task) |

## Step 1: Frame the Question

Before searching, define what you need to know:

1. What specific questions need answering?
2. What is already known from the codebase or conversation?
3. What would change the decision if found?

Write these down. They guide which tools to use.

## Step 2: Gather Data

Choose data sources based on question type. Batch independent calls in one turn.

### Web and Documentation

- **web_search** with `queries=["{topic} {aspect 1}", "{topic} {aspect 2}"]` -- multiple angles, not the same pattern repeated
- **code_search** with `query="{library} {function} usage"` -- code examples and API docs
- **webclaw_scrape** with `url="{doc-url}"` -- extract full documentation pages
- **webclaw_summarize** with `url="{url}"` -- quick summary when full content isn't needed
- **google_surf_search** with `query="{topic}"` -- Google search without API key

### Codebase Analysis

Batch these in one turn:

- **tldr_structure** with `path="<path>"` -- module layout
- **tldr_search** with `query="{concept}"` and `path="<path>"` -- find relevant functions
- **tldr_context** with `entry="{function}"` -- build call graph context
- **tldr_extract** with `file="<path>"` -- full symbol inventory

### Library Knowledge

Batch these in one turn:

- **bloks_context** with `path="."` -- project dependency context
- **bloks_search** with `query="{topic}"` -- search indexed library docs
- **bloks_recipe** with `library="{lib}"` and `keywords=["{kw1}", "{kw2}"]` -- composed API context
- **bloks_card** with `library="{lib}"` and `symbol="{name}"` -- specific API signature

### Deep Investigation

For complex questions requiring multi-turn reasoning:

- **delegate_task** with `prompt="Research {question}. Use tldr_search, read, and grep to investigate {path}. Write findings to .continuum/research/{topic}/notes.md"` and `tools=["read", "bash", "grep", "find", "tldr_search", "tldr_structure"]`

## Step 3: Synthesize

Combine all gathered data into a coherent answer. Cross-reference sources:

- Do web results match codebase reality?
- Do library docs match actual usage in the project?
- Are there contradictions between sources?

Write findings to `.continuum/research/{topic}/findings.md` using **bash**:

```bash
mkdir -p .continuum/research/{topic}
```

Then write the document with **bash** heredoc:

```markdown
# {Topic} Research

## Summary

{2-3 sentences -- the answer, not the journey}

## Questions Answered

### Q1: {Question}

**Answer:** {Direct answer}
**Evidence:** {Key data points}
**Source:** {Tool name + query or file path}
**Confidence:** High | Medium | Low

## Sources

- {source 1}
- {source 2}
```

## Step 4: Write to Bloks

After each significant finding, write it to bloks so future sessions benefit:

- **bloks_search** to check if finding already exists
- If new: **bloks_learn** with `library="{lib}"` and `note="{finding}"` -- one finding per call
- If existing card is wrong: use the correction in your findings and note it

## Failure Recovery

| Situation                       | Recovery                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------- |
| web_search returns nothing      | Rephrase query with different terminology, try google_surf_search                |
| Library not indexed in bloks    | Use code_search and webclaw_scrape on official docs instead                      |
| delegate_task runs out of turns | Increase max_turns or break the question into smaller pieces                     |
| Contradicting sources           | State both positions with confidence levels, note which seems more authoritative |
| Too many results to process     | Filter by recency, focus on official docs first, skip blog posts                 |

## Guidelines

- Every claim needs a source: tool name + query, or file path + line number
- State confidence level honestly. Medium/low confidence is fine -- uncertainty is valuable information.
- Vary search queries. Different angles, not the same phrase repeated.
- Write to bloks as you discover things. Don't batch findings into one call.
- The findings document is what others consume. Keep it telegraphic, not narrative.
- Research finds the path. /skill:autonomous walks it.

---
name: premortem
description: Pre-implementation failure analysis gate. Identifies tiger risks, paper tigers, and elephants before code is written. Use after planning, before implementation starts.
allowed-tools: read bash grep find tldr_structure tldr_impact tldr_whatbreaks tldr_deps tldr_smells ask_user
---

# Premortem

Failure-state projection before implementation. You imagine the project has already failed, then reason backward from that failure to identify risks.

Run this after a plan exists. Do NOT start without a plan to analyze.

## Execution Model

Pi executes tool calls sequentially, even when you emit multiple calls in one turn. Batch independent calls in a single turn to save LLM round-trips (~5-10s each).

## Step 1: Gather Structural Facts

Read the plan first. Identify which files and modules will be affected.

Then batch all structural analysis in one turn:

- **tldr_structure** with `path="<affected-path>"` -- module layout, function signatures
- **tldr_deps** with `path="<affected-path>"` -- dependency graph, circular deps
- **tldr_smells** with `path="<affected-path>"` -- existing code smells

For each key function that will change, batch in one turn:

- **tldr_impact** with `function_name="<name>"` and `path="<path>"` -- who calls it
- **tldr_whatbreaks** with `target="<name>"` and `path="<path>"` -- what breaks if it changes

Capture all output. These are deterministic facts, not guesses.

## Step 2: Project Forward to Failure

Imagine the implementation is complete and it failed. Reason backward through these lenses:

**Base assumptions that led astray.** What foundational beliefs proved wrong? Cross-reference with structural facts from Step 1. A `tldr_deps` result showing tight coupling contradicts "we can change this independently".

**Shortcuts taken.** Where did expediency override quality? Which "temporary" solutions became permanent? `tldr_smells` output reveals existing shortcuts -- new work will inherit them.

**Weak implementations.** What components got minimal attention? `tldr_impact` shows high-centrality functions -- changes there ripple everywhere. Untested edge cases in these functions are lethal.

**Missing evaluations.** What tests or validations were skipped? How would deviation be caught?

**Necessity conditions.** What must remain true? External API stability, config format compatibility, data schema assumptions. If any of these break, everything downstream fails.

**Nth-order effects.** Secondary consequences of primary decisions. `tldr_whatbreaks` shows the blast radius -- are you prepared for all of it?

## Step 3: Classify Risks

For each identified failure mode:

1. State the risk precisely
2. Provide falsifiable check: how to verify this risk is real vs imagined
3. Trace root cause: proximate trigger vs underlying system issue
4. Scan for cognitive bias: overconfidence, planning fallacy, confirmation bias
5. Classify into one of three categories:

**Tiger** -- clear threat with concrete evidence from structural analysis. Must mitigate before proceeding.

**Paper Tiger** -- appears threatening but bounded. Explain specifically why damage is limited.

**Elephant** -- avoided systemic issue with wide impact. Nobody talks about it but it matters.

## Step 4: Report and Gate

Use **ask_user** with `type="select"` to present the verdict and ask how to proceed.

Format the findings first, then ask:

```
Premortem: BLOCK | WARN | PASS

## Tigers (must mitigate)
1. [risk]: structural evidence, root cause, falsifiable check, mitigation required

## Paper Tigers (manageable)
1. [risk]: why it looks scary but isn't, with evidence

## Elephants (avoided but real)
1. [risk]: why avoided, true impact if unaddressed
```

Decision gate:

- **Tigers with no mitigation**: BLOCK. Ask user: "BLOCKED by {risk}. Options: add mitigation, accept with justification, research further."
- **Only paper tigers and elephants**: WARN. Proceed with documented awareness.
- **No significant risks**: PASS. Continue to implementation.

## Failure Recovery

| Situation                          | Recovery                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------- |
| tldr_impact returns nothing        | Function name may differ -- use tldr_structure to find actual names, retry |
| No plan exists                     | Ask user to describe what they intend to build, treat that as the plan     |
| Plan references non-existent files | Note as a risk itself: "plan assumes files that don't exist"               |
| Cannot classify a risk             | Default to paper tiger with explicit uncertainty note                      |

## Guidelines

- Every risk must cite structural evidence or state explicitly that it is an assumption without evidence
- If you cannot state what would disprove a risk, demote to paper tiger or discard
- Bias scan is mandatory for tigers -- state which cognitive bias drives the assumption
- Keep analysis cold and adversarial. The goal is to find what will break, not validate the plan
- Batch all tldr calls in one turn -- they are independent and save round-trips

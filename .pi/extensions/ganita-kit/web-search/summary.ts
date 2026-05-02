/**
 * Summary generation for the curator.
 *
 * Two paths:
 *   1. AI-powered summary via CrofAI (OpenAI-compatible).
 *   2. Deterministic fallback when CrofAI is unavailable or fails.
 *
 * Callers always receive the same shape regardless of which path ran.
 * Check `meta.fallbackUsed` to know which path executed.
 */

import type { SummaryGenerationContext } from "../types/search.js";
import { crofComplete, isCrofaIReady } from "./provider/crof.js";

// ── Constants ──────────────────────────────────────────────

const DEFAULT_MODEL = "kimi-k2.6-precision";
const MAX_SOURCE_URLS = 15;
const ANSWER_PREVIEW_LENGTH = 240;

// ── Types ──────────────────────────────────────────────────

export interface SummaryMeta {
    /** Model identifier used, or null when the deterministic fallback ran. */
    model: string | null;
    durationMs: number;
    tokenEstimate: number;
    fallbackUsed: boolean;
    /** Populated only when fallbackUsed is true. Human-readable reason. */
    fallbackReason?: string;
    /** True when the user has manually edited the summary after generation. */
    edited?: boolean;
}

export interface QueryResultData {
    query: string;
    answer: string;
    results: Array<{ title: string; url: string }>;
    error: string | null;
    provider?: string;
}

export interface SummaryResult {
    summary: string;
    meta: SummaryMeta;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Rough token estimate based on character count.
 * Uses the common 4-chars-per-token heuristic for Latin text.
 * Not suitable for billing — use only for telemetry and budget checks.
 */
function estimateTokens(text: string): number {
    const trimmed = text.trim();
    return trimmed.length === 0 ? 0 : Math.max(1, Math.ceil(trimmed.length / 4));
}

/**
 * Serialises a single QueryResultData into a compact plain-text block
 * suitable for injection into the summary prompt.
 *
 * Error results are represented explicitly so the model knows which
 * queries failed rather than silently receiving an incomplete picture.
 */
function serializeQueryResult(result: QueryResultData): string {
    if (result.error) {
        return [`Query: ${result.query}`, "Status: Error", `Error: ${result.error}`].join("\n");
    }

    const lines = [
        `Query: ${result.query}`,
        `Provider: ${result.provider ?? "unknown"}`,
        `Answer: ${result.answer.trim() || "(no answer text returned)"}`,
    ];

    if (result.results.length === 0) {
        lines.push("Sources: none");
        return lines.join("\n");
    }

    lines.push("Sources:");
    for (let i = 0; i < result.results.length; i++) {
        const source = result.results[i];
        if (source) lines.push(`  ${i + 1}. ${source.title} — ${source.url}`);
    }

    return lines.join("\n");
}

// ── Prompt building ────────────────────────────────────────

/**
 * Builds the user-turn prompt sent to the AI model.
 *
 * When `feedback` is provided, the prompt instructs the model to treat
 * the previous summary as a draft and apply the user's corrections.
 * The feedback is injected after the search results so it can reference
 * specific content from them.
 */
export function buildSummaryPrompt(results: QueryResultData[], feedback?: string): string {
    const sections: string[] = [
        "You are a senior technical researcher synthesizing web search results for an AI coding agent.",
        "The agent will use your summary to make decisions, write code, or solve a technical problem.",
        "Your summary must be precise, dense with actionable information, and completely grounded in the sources provided.",
        "",
        "## Your Job",
        "Produce a structured technical summary that tells the agent exactly what it needs to know.",
        "Prioritize accuracy and specificity over completeness. A shorter, precise summary beats a long, vague one.",
        "",
        "## Required Structure",
        "1. **TL;DR** — One to two sentences. The single most important finding the agent must act on.",
        "2. **Key Findings** — Grouped by theme or sub-topic under clear headings. Each point must be concrete:",
        "   - Prefer specific versions, numbers, API names, function signatures, and dates over general statements.",
        "   - If multiple sources agree, state it as established fact.",
        "   - If sources conflict, name the conflict explicitly: what each side claims and why it matters to the agent.",
        "   - If a claim comes from a single source, flag it inline: (one source only — verify before use).",
        "3. **Caveats and Gaps** — What the search results do NOT answer. What the agent must verify independently.",
        "4. **Sources** — Relevant URLs only, ordered by relevance. No descriptions.",
        "",
        "## Hard Rules",
        "- Every claim must trace back to a result in <search_results>. Do not infer, extrapolate, or fill gaps.",
        "- Do not invent URLs, version numbers, dates, package names, or quotes.",
        "- Do not write meta-commentary: no 'according to the search results', no 'the sources indicate'.",
        "- Do not pad. Omit any section that has nothing meaningful to say.",
        "- Write in plain, direct prose. No marketing language. No hedging filler. No em-dash abuse.",
        "- Wrap all code snippets, CLI commands, and API signatures in backticks.",
        "- If all results are errors or empty, say so in one sentence and stop.",
    ];

    if (feedback) {
        sections.push(
            "",
            "## Revision Instructions",
            "A previous summary was shown to the user. They have provided a correction or refinement below.",
            "Your output must fully address their feedback. Do not partially apply it. Do not ignore any part of it.",
            "Where the feedback contradicts the search results, flag the contradiction — do not silently pick a side.",
        );
    }

    sections.push("", "<search_results>");

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result) {
            sections.push(`\n[Result ${i + 1}]`);
            sections.push(serializeQueryResult(result));
        }
    }

    sections.push("\n</search_results>");

    if (feedback) {
        sections.push("", "<user_feedback>", feedback.trim(), "</user_feedback>");
    }

    return sections.join("\n");
}

// ── Deterministic fallback ─────────────────────────────────

/**
 * Produces a structured plain-text summary without any AI call.
 * Used when CrofAI is not configured or when the AI call fails.
 *
 * Output is intentionally minimal: it surfaces the raw answer text
 * and sources so the agent has something to work with, but makes no
 * attempt to synthesise or interpret the content.
 */
export function buildDeterministicSummary(results: QueryResultData[]): SummaryResult {
    const baseMeta: Omit<SummaryMeta, "tokenEstimate"> = {
        model: null,
        durationMs: 0,
        fallbackUsed: true,
        edited: false,
    };

    if (results.length === 0) {
        const summary =
            "No completed search results were available when the curator session finished.\n\nSources\n- None";
        return {
            summary,
            meta: { ...baseMeta, tokenEstimate: estimateTokens(summary) },
        };
    }

    const lines: string[] = ["Summary based on the currently selected search results.", ""];

    const seenUrls = new Set<string>();
    const sourceUrls: string[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const result of results) {
        if (result.error) {
            failCount += 1;
            lines.push(`- ${result.query}: failed — ${result.error}`);
            continue;
        }

        successCount += 1;

        const answer = result.answer.replace(/\s+/g, " ").trim();
        const preview =
            answer.length > ANSWER_PREVIEW_LENGTH
                ? `${answer.slice(0, ANSWER_PREVIEW_LENGTH - 3)}...`
                : answer;

        lines.push(
            preview
                ? `- ${result.query}: ${preview}`
                : `- ${result.query}: returned ${result.results.length} source(s) without answer text.`,
        );

        for (const source of result.results) {
            if (!seenUrls.has(source.url)) {
                seenUrls.add(source.url);
                sourceUrls.push(source.url);
            }
        }
    }

    lines.push(
        "",
        `Completed: ${results.length} queries — ${successCount} succeeded, ${failCount} failed.`,
        "",
        "Sources",
    );

    if (sourceUrls.length === 0) {
        lines.push("- None");
    } else {
        for (const url of sourceUrls.slice(0, MAX_SOURCE_URLS)) {
            lines.push(`- ${url}`);
        }
        if (sourceUrls.length > MAX_SOURCE_URLS) {
            lines.push(`- … and ${sourceUrls.length - MAX_SOURCE_URLS} more`);
        }
    }

    const summary = lines.join("\n").trim();
    return {
        summary,
        meta: { ...baseMeta, tokenEstimate: estimateTokens(summary) },
    };
}

// ── AI summary generation via CrofAI ──────────────────────

/**
 * Generates a summary draft using CrofAI.
 *
 * Falls back to `buildDeterministicSummary` in two cases:
 *   - CrofAI is not configured (`isCrofaIReady()` returns false).
 *   - The CrofAI call throws or rejects.
 *
 * In both fallback cases, `meta.fallbackUsed` is true and
 * `meta.fallbackReason` describes why the fallback was triggered.
 *
 * @param results  - Completed query results from the curator.
 * @param ctx      - Generation context (reserved for future routing logic).
 * @param signal   - Optional AbortSignal to cancel the in-flight request.
 * @param model    - Optional model override; defaults to DEFAULT_MODEL.
 * @param feedback - Optional user feedback to refine a previous draft.
 */
export async function generateSummaryDraft(
    results: QueryResultData[],
    _ctx: SummaryGenerationContext,
    signal?: AbortSignal,
    model?: string,
    feedback?: string,
): Promise<SummaryResult> {
    const startedAt = Date.now();

    if (!isCrofaIReady()) {
        const fallback = buildDeterministicSummary(results);
        return {
            ...fallback,
            meta: { ...fallback.meta, fallbackReason: "crof-not-configured" },
        };
    }

    const prompt = buildSummaryPrompt(results, feedback);
    const resolvedModel = model ?? DEFAULT_MODEL;

    try {
        const summary = await crofComplete(
            [{ role: "user", content: prompt }],
            signal,
            resolvedModel,
        );

        return {
            summary,
            meta: {
                model: `crofai/${resolvedModel}`,
                durationMs: Math.max(0, Date.now() - startedAt),
                tokenEstimate: estimateTokens(summary),
                fallbackUsed: false,
                edited: false,
            },
        };
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const fallback = buildDeterministicSummary(results);
        return {
            ...fallback,
            meta: {
                ...fallback.meta,
                fallbackReason: `crof-error: ${reason.slice(0, 200)}`,
            },
        };
    }
}

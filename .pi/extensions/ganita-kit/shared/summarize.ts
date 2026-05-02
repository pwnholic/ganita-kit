/**
 * Agent-based summarization using an in-memory Pi sub-session.
 *
 * Creates a temporary, ephemeral agent session that reuses the same model
 * provider as the running Pi instance. The sub-session has no tools, no
 * persistence, and is disposed immediately after the summary is produced.
 *
 * No tokens are added to the main session — the summary is returned as a
 * plain string.
 *
 * Also provides deterministic fallback and prompt-building utilities
 * that were previously in web-search/summary.ts.
 */

import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import type { QueryResultData, SummaryMeta } from "../types/search.js";

/** Result of a summarization operation. */
export interface SummaryResult {
    summary: string;
    meta: SummaryMeta;
}

// ── Agent-based summarization ───────────────────────────────

/** Options for agent summarization. */
export interface AgentSummarizeOptions {
    /** Text content to summarize. */
    content: string;
    /** The Pi model to use (typically `ctx.model` from the tool's execute). */
    model: unknown;
    /** Optional abort signal to cancel summarization. */
    signal?: AbortSignal;
    /** Max tokens for the summary response. */
    maxTokens?: number;
    /** Optional custom instruction override. */
    instruction?: string;
}

/**
 * Summarize content using the Pi agent's model in an isolated sub-session.
 *
 * The sub-session is created fresh, prompts the model, collects the response,
 * and disposes — all without touching the main session's context or history.
 *
 * @returns The summary text, or an empty string if summarization was aborted.
 */
export async function summarizeWithAgent(options: AgentSummarizeOptions): Promise<string> {
    const { content, model, signal, maxTokens = 500, instruction } = options;

    const sub = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        tools: [],
        model: model as never,
    });

    // Propagate abort signal
    const abortHandler = () => sub.session.abort();
    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
        let summary = "";
        sub.session.subscribe((event) => {
            if (
                event.type === "message_update" &&
                event.assistantMessageEvent.type === "text_delta"
            ) {
                summary += event.assistantMessageEvent.delta;
            }
        });

        const prompt =
            instruction ??
            `Summarize the following content concisely in at most ${maxTokens} tokens. \
Focus on key facts, data, and actionable information. \
Use plain direct prose:\n\n${content}`;

        await sub.session.prompt(prompt);
        return summary;
    } catch (err) {
        // Aborted — return empty
        if (err instanceof Error && err.message.toLowerCase().includes("abort")) {
            return "";
        }
        throw err;
    } finally {
        signal?.removeEventListener("abort", abortHandler);
        sub.session.dispose();
    }
}

// ── Prompt building ─────────────────────────────────────────

const MAX_SOURCE_URLS = 15;
const ANSWER_PREVIEW_LENGTH = 240;

/**
 * Serialises a single QueryResultData into a compact plain-text block.
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

/**
 * Builds the user-turn prompt sent to the AI model for summarization.
 * Produces a structured technical summary prompt grounded in search results.
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
 * Rough token estimate based on character count.
 * Uses the common 4-chars-per-token heuristic for Latin text.
 */
function estimateTokens(text: string): number {
    const trimmed = text.trim();
    return trimmed.length === 0 ? 0 : Math.max(1, Math.ceil(trimmed.length / 4));
}

/**
 * Produces a structured plain-text summary without any AI call.
 * Used when the agent-based summarization is unavailable or fails.
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

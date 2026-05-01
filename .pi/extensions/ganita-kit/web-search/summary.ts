/**
 * Summary generation for the curator.
 * Uses CrofAI (OpenAI-compatible) for AI-powered summary generation,
 * with a deterministic fallback when CrofAI is unavailable.
 */

import type { SummaryGenerationContext } from "../types/search.js";
import { crofComplete, isCrofaIReady } from "./provider/crof.js";

// ── Types ─────────────────────────────────────────────────

export interface SummaryMeta {
	model: string | null;
	durationMs: number;
	tokenEstimate: number;
	fallbackUsed: boolean;
	fallbackReason?: string;
	edited?: boolean;
}

export interface QueryResultData {
	query: string;
	answer: string;
	results: Array<{ title: string; url: string }>;
	error: string | null;
	provider?: string;
}

// ── Helpers ────────────────────────────────────────────────

function estimateTokens(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return Math.max(1, Math.ceil(trimmed.length / 4));
}

function summarizeQueryResult(result: QueryResultData): string {
	if (result.error) {
		return `Query: ${result.query}\nStatus: Error\nError: ${result.error}`;
	}
	const lines = [
		`Query: ${result.query}`,
		`Provider: ${result.provider ?? "unknown"}`,
		`Answer: ${result.answer || "(no answer text returned)"}`,
	];
	if (result.results.length === 0) {
		lines.push("Sources: none");
		return lines.join("\n");
	}
	lines.push("Sources:");
	for (let i = 0; i < result.results.length; i++) {
		const s = result.results[i];
		if (s) lines.push(`${i + 1}. ${s.title} — ${s.url}`);
	}
	return lines.join("\n");
}

// ── Prompt building ────────────────────────────────────────

export function buildSummaryPrompt(
	results: QueryResultData[],
	feedback?: string,
): string {
	const sections = [
		"You are writing the final web search summary for a coding assistant.",
		"",
		"## Instructions",
		"Write a thorough, well-organized summary of the search results below.",
		"The reader is an AI coding agent preparing to act on this information.",
		"",
		"## Quality Requirements",
		"- Begin with a concise overview paragraph (2-3 sentences).",
		"- Group related findings under clear section headings.",
		"- Include specific numbers, versions, dates, and technical details where available.",
		"- If sources disagree or evidence is weak, say so explicitly.",
		"- Do NOT invent sources, quotes, or claims not present in the results.",
		"- Do NOT include meta-commentary like 'according to the search results'.",
		"- End with a '## Sources' section listing the most relevant URLs.",
	];
	if (feedback)
		sections.push(
			"- Incorporate the user feedback provided below into the summary.",
		);
	sections.push("", "<search_results>");
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (r) {
			sections.push(`\n[Result ${i + 1}]`);
			sections.push(summarizeQueryResult(r));
		}
	}
	sections.push("\n</search_results>");
	if (feedback) {
		sections.push("", "<user_feedback>", feedback, "</user_feedback>");
	}
	return sections.join("\n");
}

// ── Deterministic fallback ─────────────────────────────────

export function buildDeterministicSummary(results: QueryResultData[]): {
	summary: string;
	meta: SummaryMeta;
} {
	if (results.length === 0) {
		return {
			summary:
				"No completed search results were available when the curator session finished.\n\nSources\n- None",
			meta: {
				model: null,
				durationMs: 0,
				tokenEstimate: 0,
				fallbackUsed: true,
				edited: false,
			},
		};
	}
	const lines: string[] = [
		"Summary based on the currently selected search results.",
		"",
	];
	const sourceUrls: string[] = [];
	let successful = 0;
	let failed = 0;
	for (const result of results) {
		if (result.error) {
			failed += 1;
			lines.push(`- ${result.query}: failed (${result.error})`);
			continue;
		}
		successful += 1;
		const answer = result.answer.replace(/\s+/g, " ").trim();
		const preview = answer.length > 240 ? `${answer.slice(0, 237)}...` : answer;
		if (preview) {
			lines.push(`- ${result.query}: ${preview}`);
		} else {
			lines.push(
				`- ${result.query}: returned ${result.results.length} sources without answer text.`,
			);
		}
		for (const source of result.results) {
			if (!sourceUrls.includes(source.url)) sourceUrls.push(source.url);
		}
	}
	lines.push(
		"",
		`Completed queries: ${results.length}`,
		`Successful: ${successful}`,
		`Failed: ${failed}`,
		"",
		"Sources",
	);
	if (sourceUrls.length === 0) lines.push("- None");
	else {
		for (const url of sourceUrls.slice(0, 12)) lines.push(`- ${url}`);
		if (sourceUrls.length > 12)
			lines.push(`- ... and ${sourceUrls.length - 12} more`);
	}
	const summary = lines.join("\n").trim();
	return {
		summary,
		meta: {
			model: null,
			durationMs: 0,
			tokenEstimate: estimateTokens(summary),
			fallbackUsed: true,
			edited: false,
		},
	};
}

// ── AI summary generation via CrofAI ───────────────────────

export async function generateSummaryDraft(
	results: QueryResultData[],
	_ctx: SummaryGenerationContext,
	signal?: AbortSignal,
	_modelOverride?: string,
	feedback?: string,
): Promise<{ summary: string; meta: SummaryMeta }> {
	const startedAt = Date.now();

	// If CrofAI is not configured, fall back to deterministic summary
	if (!isCrofaIReady()) {
		const fallback = buildDeterministicSummary(results);
		return {
			...fallback,
			meta: {
				...fallback.meta,
				fallbackReason: "crof-not-configured",
			},
		};
	}

	const prompt = buildSummaryPrompt(results, feedback);

	try {
		const summary = await crofComplete(
			[{ role: "user", content: prompt }],
			signal,
			_modelOverride || undefined,
		);

		return {
			summary,
			meta: {
				model: `crofai/${_modelOverride || "kimi-k2.6-precision"}`,
				durationMs: Math.max(0, Date.now() - startedAt),
				tokenEstimate: estimateTokens(summary),
				fallbackUsed: false,
				edited: false,
			},
		};
	} catch (err) {
		// If CrofAI fails, use deterministic fallback
		const fallback = buildDeterministicSummary(results);
		const message = err instanceof Error ? err.message : String(err);
		return {
			...fallback,
			meta: {
				...fallback.meta,
				fallbackReason: `crof-error: ${message.slice(0, 200)}`,
			},
		};
	}
}

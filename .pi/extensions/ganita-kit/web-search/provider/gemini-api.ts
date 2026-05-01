/**
 * Gemini API provider — uses API key for search with Google grounding.
 * Falls back to Gemini Web (cookie-based) when API key is not configured.
 */
import { getGeminiApiKey } from "../../config/config.js";
import type { SearchResponse } from "../../types/search.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Check if Gemini API key is available.
 */
export function isGeminiApiAvailable(): boolean {
	return getGeminiApiKey() !== null;
}

/**
 * Search using Gemini API with Google Search grounding.
 * Requires GEMINI_API_KEY to be configured.
 */
export async function searchWithGeminiApi(
	query: string,
	options: {
		model?: string;
		signal?: AbortSignal;
		timeoutMs?: number;
	} = {},
): Promise<SearchResponse | null> {
	const apiKey = getGeminiApiKey();
	if (!apiKey) return null;

	const model = options.model ?? "gemini-3-flash-preview";
	const timeout = options.timeoutMs ?? 60_000;
	const effectiveSignal = options.signal
		? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
		: AbortSignal.timeout(timeout);

	const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;
	const body = {
		contents: [{ parts: [{ text: query }] }],
		tools: [{ google_search: {} }],
	};

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: effectiveSignal,
	});

	if (!res.ok) {
		const errorText = await res.text();
		throw new Error(
			`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`,
		);
	}

	const data = (await res.json()) as GeminiSearchResponse;
	const answer =
		data.candidates?.[0]?.content?.parts
			?.map((p) => p.text)
			.filter(Boolean)
			.join("\n") ?? "";

	const metadata = data.candidates?.[0]?.groundingMetadata;
	const results = await resolveGroundingChunks(metadata?.groundingChunks);

	if (!answer && results.length === 0) return null;
	return { answer, results };
}

// ── Grounding helpers ──────────────────────────────────────

interface GeminiSearchResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		groundingMetadata?: {
			webSearchQueries?: string[];
			groundingChunks?: GroundingChunk[];
		};
	}>;
}

interface GroundingChunk {
	web?: { uri?: string; title?: string };
}

async function resolveGroundingChunks(
	chunks: GroundingChunk[] | undefined,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
	if (!chunks?.length) return [];

	const results: Array<{ title: string; url: string; snippet: string }> = [];
	for (const chunk of chunks) {
		if (!chunk.web) continue;
		const title = chunk.web.title || "";
		let url = chunk.web.uri || "";

		if (
			url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")
		) {
			const resolved = await resolveRedirect(url);
			if (resolved) url = resolved;
		}

		if (url) {
			results.push({ title, url, snippet: "" });
		}
	}
	return results;
}

async function resolveRedirect(proxyUrl: string): Promise<string | null> {
	try {
		const res = await fetch(proxyUrl, {
			method: "HEAD",
			redirect: "manual",
			signal: AbortSignal.timeout(5000),
		});
		return res.headers.get("location") || null;
	} catch {
		return null;
	}
}

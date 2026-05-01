import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getExaApiKey } from "../../config/config.js";
import type { ExaSearchOptions, SearchResponse } from "../../types/search.js";

// ── Constants ──────────────────────────────────────────────

const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const USAGE_PATH = join(homedir(), ".pi", "exa-usage.json");
const MONTHLY_LIMIT = 1000;
const WARNING_THRESHOLD = 800;
const REQUEST_TIMEOUT_MS = 60_000;

// ── Internal types ─────────────────────────────────────────

interface ExaUsage {
	month: string;
	count: number;
}

interface ExaAnswerResponse {
	answer?: string;
	citations?: Array<{
		url?: string;
		title?: string;
		text?: string;
		publishedDate?: string;
	}>;
}

interface ExaApiSearchResult {
	title?: string;
	url?: string;
	publishedDate?: string;
	author?: string;
	text?: string;
	highlights?: unknown;
	highlightScores?: number[];
}

interface ExaSearchResponse {
	results?: ExaApiSearchResult[];
}

interface ExaMcpRpcResponse {
	result?: {
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	};
	error?: {
		code?: number;
		message?: string;
	};
}

type McpParsedResult = { title: string; url: string; content: string };

/** Union return type for searchWithExa: response, budget exhausted, or no result. */
export type ExaSearchResultType = SearchResponse | { exhausted: true } | null;

// ── Usage tracking (free tier) ─────────────────────────────

let warnedMonth: string | null = null;

function getCurrentMonth(): string {
	return new Date().toISOString().slice(0, 7);
}

function isExaUsageLike(
	value: unknown,
): value is { month: string; count: number } {
	if (!value || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
	const month = obj["month"];
	// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
	const count = obj["count"];
	return typeof month === "string" && typeof count === "number";
}

function normalizeUsage(raw: unknown): ExaUsage {
	const month = getCurrentMonth();
	if (!isExaUsageLike(raw)) return { month, count: 0 };
	if (!Number.isFinite(raw.count)) return { month, count: 0 };
	if (raw.month !== month) return { month, count: 0 };
	return { month: raw.month, count: Math.max(0, Math.floor(raw.count)) };
}

function readUsage(): ExaUsage {
	if (!existsSync(USAGE_PATH)) return { month: getCurrentMonth(), count: 0 };
	const raw = readFileSync(USAGE_PATH, "utf-8");
	try {
		return normalizeUsage(JSON.parse(raw));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${USAGE_PATH}: ${message}`);
	}
}

function writeUsage(usage: ExaUsage): void {
	const dir = join(homedir(), ".pi");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(USAGE_PATH, `${JSON.stringify(usage, null, 2)}\n`);
}

/**
 * Reserve one request from the monthly budget.
 * Returns { exhausted: true } if the limit is reached, null otherwise.
 */
function reserveRequestBudget(): { exhausted: true } | null {
	const usage = readUsage();
	if (usage.count >= MONTHLY_LIMIT) {
		return { exhausted: true };
	}
	const nextCount = usage.count + 1;
	if (nextCount >= WARNING_THRESHOLD && warnedMonth !== usage.month) {
		warnedMonth = usage.month;
		console.error(
			`Exa usage warning: ${nextCount}/${MONTHLY_LIMIT} monthly requests used.`,
		);
	}
	writeUsage({ month: usage.month, count: nextCount });
	return null;
}

// ── Signal helpers ─────────────────────────────────────────

function requestSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ── Domain / recency mapping ───────────────────────────────

function recencyToStartDate(filter: string): string {
	const now = new Date();
	const offsets: Record<string, number> = {
		day: 1,
		week: 7,
		month: 30,
		year: 365,
	};
	const days = offsets[filter] ?? 0;
	return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function mapDomainFilter(domainFilter: string[] | undefined): {
	includeDomains?: string[];
	excludeDomains?: string[];
} {
	if (!domainFilter?.length) return {};
	const includeDomains = domainFilter
		.filter((d) => !d.startsWith("-") && d.trim().length > 0)
		.map((d) => d.trim());
	const excludeDomains = domainFilter
		.filter((d) => d.startsWith("-"))
		.map((d) => d.slice(1).trim())
		.filter(Boolean);
	return {
		...(includeDomains.length ? { includeDomains } : {}),
		...(excludeDomains.length ? { excludeDomains } : {}),
	};
}

// ── API result mapping ─────────────────────────────────────

function normalizeHighlights(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is string =>
			typeof item === "string" && item.trim().length > 0,
	);
}

function mapResults(
	results: ExaSearchResponse["results"] | ExaAnswerResponse["citations"],
): SearchResponse["results"] {
	if (!Array.isArray(results)) return [];
	const mapped: SearchResponse["results"] = [];
	for (let i = 0; i < results.length; i++) {
		const item = results[i];
		if (!item?.url) continue;
		mapped.push({
			title: item.title || `Source ${i + 1}`,
			url: item.url,
			snippet: "",
		});
	}
	return mapped;
}

function buildAnswerFromSearchResults(
	results: ExaSearchResponse["results"],
): string {
	if (!results?.length) return "";
	const parts: string[] = [];
	for (let i = 0; i < results.length; i++) {
		const item = results[i];
		if (!item?.url) continue;
		const highlights = normalizeHighlights(item.highlights);
		const content =
			highlights.length > 0
				? highlights.join(" ")
				: typeof item.text === "string"
					? item.text.trim().slice(0, 1000)
					: "";
		if (!content) continue;
		const sourceTitle = item.title || `Source ${i + 1}`;
		parts.push(`${content}\nSource: ${sourceTitle} (${item.url})`);
	}
	return parts.join("\n\n");
}

// ── MCP helpers ────────────────────────────────────────────

/**
 * Parse an MCP JSON-RPC response from either SSE or raw JSON body.
 * Returns the parsed response object or null if unparseable.
 */
function parseMcpResponse(body: string): ExaMcpRpcResponse | null {
	const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));

	// Try SSE lines first
	for (const line of dataLines) {
		const payload = line.slice(5).trim();
		if (!payload) continue;
		try {
			const candidate = JSON.parse(payload) as ExaMcpRpcResponse;
			if (candidate?.result || candidate?.error) return candidate;
		} catch {
			// Not a valid JSON line — skip
		}
	}

	// Fall back to raw JSON body
	try {
		const candidate = JSON.parse(body) as ExaMcpRpcResponse;
		if (candidate?.result || candidate?.error) return candidate;
	} catch {
		// Body is not JSON either
	}

	return null;
}

/**
 * Validate an MCP response and extract the text content.
 * Throws on error responses or empty content.
 */
function validateMcpResponse(parsed: ExaMcpRpcResponse): string {
	if (parsed.error) {
		const code =
			typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
		const message = parsed.error.message || "Unknown error";
		throw new Error(`Exa MCP error${code}: ${message}`);
	}

	if (parsed.result?.isError) {
		const message = parsed.result.content
			?.find((item) => item.type === "text" && typeof item.text === "string")
			?.text?.trim();
		throw new Error(message || "Exa MCP returned an error");
	}

	const text = parsed.result?.content
		?.find(
			(item) =>
				item.type === "text" &&
				typeof item.text === "string" &&
				item.text.trim().length > 0,
		)
		?.text?.trim();

	if (!text) {
		throw new Error("Exa MCP returned empty content");
	}

	return text;
}

/**
 * Call an Exa MCP tool via JSON-RPC over HTTP.
 * Handles SSE and plain JSON response formats.
 */
export async function callExaMcp(
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	const response = await fetch(EXA_MCP_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: toolName, arguments: args },
		}),
		signal: requestSignal(signal),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Exa MCP error ${response.status}: ${errorText.slice(0, 300)}`,
		);
	}

	const body = await response.text();
	const parsed = parseMcpResponse(body);

	if (!parsed) {
		throw new Error("Exa MCP returned an empty response");
	}

	return validateMcpResponse(parsed);
}

/** Parse Exa MCP search results into structured data. */
function parseMcpResults(text: string): McpParsedResult[] | null {
	const blocks = text
		.split(/(?=^Title: )/m)
		.filter((block) => block.trim().length > 0);
	const parsed = blocks
		.map((block) => {
			const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
			const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
			let content = "";
			const textStart = block.indexOf("\nText: ");
			if (textStart >= 0) {
				content = block.slice(textStart + 7).trim();
			} else {
				const hlMatch = block.match(/\nHighlights:\s*\n/);
				if (hlMatch?.index != null) {
					content = block.slice(hlMatch.index + hlMatch[0].length).trim();
				}
			}
			content = content.replace(/\n---\s*$/, "").trim();
			return { title, url, content };
		})
		.filter((result) => result.url.length > 0);
	return parsed.length > 0 ? parsed : null;
}

function buildAnswerFromMcpResults(results: McpParsedResult[]): string {
	if (results.length === 0) return "";
	const parts: string[] = [];
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (!result) continue;
		const snippet = result.content.replace(/\s+/g, " ").trim().slice(0, 500);
		if (!snippet) continue;
		const sourceTitle = result.title || `Source ${i + 1}`;
		parts.push(`${snippet}\nSource: ${sourceTitle} (${result.url})`);
	}
	return parts.join("\n\n");
}

/** Build enriched query string for MCP that encodes domain/recency filters. */
function buildMcpQuery(query: string, options: ExaSearchOptions): string {
	const parts = [query];
	if (options.domainFilter?.length) {
		for (const d of options.domainFilter) {
			parts.push(d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`);
		}
	}
	if (options.recencyFilter) {
		const now = new Date();
		switch (options.recencyFilter) {
			case "day": {
				parts.push("past 24 hours");
				break;
			}
			case "week": {
				parts.push("past week");
				break;
			}
			case "month": {
				parts.push(
					`${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`,
				);
				break;
			}
			case "year": {
				parts.push(String(now.getFullYear()));
				break;
			}
		}
	}
	return parts.join(" ");
}

/** Search with Exa MCP (no API key needed). */
async function searchWithExaMcp(
	query: string,
	options: ExaSearchOptions = {},
): Promise<SearchResponse | null> {
	const enrichedQuery = buildMcpQuery(query, options);

	const text = await callExaMcp(
		"web_search_exa",
		{
			query: enrichedQuery,
			numResults: options.numResults ?? 5,
			livecrawl: "fallback",
			type: "auto",
			contextMaxCharacters: options.includeContent ? 50_000 : 3000,
		},
		options.signal,
	);

	const parsedResults = parseMcpResults(text);
	if (!parsedResults) return null;

	return {
		answer: buildAnswerFromMcpResults(parsedResults),
		results: parsedResults.map((result, index) => ({
			title: result.title || `Source ${index + 1}`,
			url: result.url,
			snippet: "",
		})),
	};
}

// ── Direct API search ──────────────────────────────────────

/** Search with Exa API (requires API key, consumes monthly budget). */
async function searchWithExaApi(
	query: string,
	options: ExaSearchOptions = {},
): Promise<SearchResponse | { exhausted: true }> {
	const apiKey = getExaApiKey();

	const budget = reserveRequestBudget();
	if (budget) return budget;

	// Decide whether to use /search (richer) or /answer (cheaper)
	const useSearch =
		options.includeContent ||
		!!options.recencyFilter ||
		!!options.domainFilter?.length ||
		!!(options.numResults && options.numResults !== 5);

	if (!useSearch) {
		const response = await fetch(EXA_ANSWER_URL, {
			method: "POST",
			headers: {
				"x-api-key": apiKey ?? "",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query, text: true }),
			signal: requestSignal(options.signal),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Exa API error ${response.status}: ${errorText.slice(0, 300)}`,
			);
		}

		const data = (await response.json()) as ExaAnswerResponse;
		return {
			answer: data.answer || "",
			results: mapResults(data.citations),
		};
	}

	const startDate = options.recencyFilter
		? recencyToStartDate(options.recencyFilter)
		: null;
	const domainFilters = mapDomainFilter(options.domainFilter);

	const response = await fetch(EXA_SEARCH_URL, {
		method: "POST",
		headers: {
			"x-api-key": apiKey ?? "",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query,
			type: "auto",
			numResults: options.numResults ?? 5,
			...domainFilters,
			...(startDate ? { startPublishedDate: startDate } : {}),
			contents: {
				text: options.includeContent ? true : { maxCharacters: 3000 },
				highlights: true,
			},
		}),
		signal: requestSignal(options.signal),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Exa API error ${response.status}: ${errorText.slice(0, 300)}`,
		);
	}

	const data = (await response.json()) as ExaSearchResponse;
	return {
		answer: buildAnswerFromSearchResults(data.results),
		results: mapResults(data.results),
	};
}

// ── Public API ─────────────────────────────────────────────

/** Check whether Exa is available (API key present or MCP usable). */
export function isExaAvailable(): boolean {
	if (getExaApiKey()) {
		const usage = readUsage();
		return usage.count < MONTHLY_LIMIT;
	}
	// MCP is always available without a key
	return true;
}

/** Check whether an Exa API key is configured. */
export function hasExaApiKey(): boolean {
	return !!getExaApiKey();
}

/**
 * Search the web using Exa.
 * Uses the direct API if an API key is configured, otherwise falls back to MCP.
 */
export async function searchWithExa(
	query: string,
	options: ExaSearchOptions = {},
): Promise<ExaSearchResultType> {
	const apiKey = getExaApiKey();
	if (!apiKey) {
		return searchWithExaMcp(query, options);
	}
	return searchWithExaApi(query, options);
}

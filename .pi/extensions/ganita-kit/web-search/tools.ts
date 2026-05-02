import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "../config/loader.js";
import { hasBinary } from "../config/runtime.js";
import type { CuratorServerHandle } from "../types/curator.js";
import type { SearchResult, SummaryGenerationContext } from "../types/search.js";
import { startCuratorServer } from "../ui/curator/server.js";
import { callExaMcp, searchWithExa } from "./provider/exa.js";
import {
    buildDeterministicSummary,
    generateSummaryDraft,
    type QueryResultData,
} from "./summary.js";

// ── Runtime config ─────────────────────────────────────────

const cfg = loadConfig();
const searchCfg = cfg.search!;
const curatorCfg = cfg.curator!;
const EXTRACT_TIMEOUT = searchCfg.extractTimeoutMs!;
const MAX_WEB_SEARCH_OUTPUT = searchCfg.maxOutputChars!;

/** Maximum MCP response before truncation (code_search). */
const MAX_CODE_SEARCH_OUTPUT = 50_000;

/**
 * Truncates large output to stay within token budgets.
 * @param text - Raw response text.
 * @param max - Maximum character count.
 * @returns Truncated text with suffix notice when truncated.
 */
function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const excess = text.length - max;
    return `${text.slice(0, max)}\n\n... [${excess} characters truncated]`;
}

/** Format search results into a readable summary for the agent. */
function formatSearchSummary(results: SearchResult[], answer: string): string {
    let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
    output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
    return output;
}

/** Normalize query list from tool parameters. */
function normalizeQueryList(rawList: unknown[]): string[] {
    const normalized: string[] = [];
    for (const q of rawList) {
        if (typeof q !== "string") continue;
        const trimmed = q.trim();
        if (trimmed.length > 0) normalized.push(trimmed);
    }
    return normalized;
}

// ── Result types ────────────────────────────────────────────

/** Details shape for code_search tool results. */
interface CodeSearchDetails {
    query: string;
    maxTokens: number;
    error?: string;
}

/** Details shape for web_search tool results. */
interface WebSearchDetails {
    queries: string[];
    queryCount: number;
    successfulQueries: number;
    totalResults: number;
    includeContent: boolean;
    sourceUrls: Array<{ url: string; domain: string }>;
    error?: string;
}

/** Per-query accumulated result. */
interface QueryAccumulator {
    query: string;
    answer: string;
    results: SearchResult[];
    error: string | null;
}

/** Tool result shape for web_search. */
type WebSearchToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details: WebSearchDetails;
};

/** Tool result shape for code_search. */
type CodeSearchToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details: CodeSearchDetails;
};

// ── Shared helpers ──────────────────────────────────────────

/**
 * Run webclaw to extract full content from URLs.
 * Returns the raw CLI stdout on success, or an error message on failure.
 */
async function extractContentWithWebclaw(
    pi: ExtensionAPI,
    urls: string[],
    signal: AbortSignal | undefined,
): Promise<string> {
    if (!hasBinary("webclaw")) {
        return "webclaw is not installed. Content extraction skipped.";
    }

    const args = [...urls, "-f", "llm"];
    const result = await pi.exec("webclaw", args, {
        ...(signal ? { signal } : {}),
        timeout: EXTRACT_TIMEOUT,
    });

    if (result.killed) {
        return "Content extraction cancelled (timeout).";
    }

    if (result.code !== 0) {
        const error = result.stderr || result.stdout;
        return `Content extraction failed: ${truncate(error, 500)}`;
    }

    return truncate(result.stdout, MAX_WEB_SEARCH_OUTPUT);
}

/** Execute a single Exa search query and return the accumulated result. */
async function executeSingleQuery(
    query: string,
    params: {
        numResults?: number;
        recencyFilter?: string;
        domainFilter?: string[];
        includeContent: boolean;
        signal: AbortSignal | undefined;
    },
): Promise<QueryAccumulator> {
    try {
        const result = await searchWithExa(query, {
            ...(params.numResults ? { numResults: params.numResults } : {}),
            ...(params.recencyFilter
                ? {
                      recencyFilter: params.recencyFilter as "day" | "week" | "month" | "year",
                  }
                : {}),
            ...(params.domainFilter ? { domainFilter: params.domainFilter } : {}),
            includeContent: params.includeContent,
            ...(params.signal ? { signal: params.signal } : {}),
        });

        if (result && "exhausted" in result) {
            return {
                query,
                answer: "",
                results: [],
                error: "Exa monthly free tier exhausted (1,000 requests). Resets next month. Upgrade at exa.ai/pricing",
            };
        }

        if (!result) {
            return { query, answer: "", results: [], error: "No results returned" };
        }

        return {
            query,
            answer: result.answer,
            results: result.results,
            error: null,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { query, answer: "", results: [], error: message };
    }
}

/** Build the formatted output text from accumulated query results. */
function buildOutputText(perQuery: QueryAccumulator[], queryList: string[]): string {
    let output = "";
    for (const { query, answer, results, error } of perQuery) {
        if (queryList.length > 1) {
            output += `## Query: "${query}"\n\n`;
        }
        if (error) {
            output += `Error: ${error}\n\n`;
        } else if (results.length === 0) {
            output += "No results found.\n\n";
        } else {
            output += `${formatSearchSummary(results, answer)}\n\n`;
        }
    }
    return output;
}

/** Build an error result for missing/empty queries. */
function buildNoQueryResult(): WebSearchToolResult {
    return {
        content: [
            {
                type: "text",
                text: "Error: No query provided. Use 'query' or 'queries' parameter.",
            },
        ],
        details: {
            queries: [],
            queryCount: 0,
            successfulQueries: 0,
            totalResults: 0,
            includeContent: false,
            sourceUrls: [],
            error: "No query provided",
        },
    };
}

/** Collect unique URLs from accumulated query results. */
function collectUrls(perQuery: QueryAccumulator[]): string[] {
    const urls: string[] = [];
    for (const acc of perQuery) {
        if (acc.error) continue;
        for (const r of acc.results) {
            if (!urls.includes(r.url)) urls.push(r.url);
        }
    }
    return urls;
}

/** Extract domain from a URL string for display purposes. */
function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

/** Extract the webclaw extraction output appended to the result text. */
async function appendExtractedContent(
    pi: ExtensionAPI,
    output: string,
    allUrls: string[],
    signal: AbortSignal | undefined,
): Promise<string> {
    const contentText = await extractContentWithWebclaw(pi, allUrls, signal);
    if (!contentText) return output;
    return `${output}---\n\n## Extracted Content\n\n${contentText}`;
}

/** Parse raw tool parameters into a normalized query list. */
function extractQueryList(params: { query?: string; queries?: string[] }): string[] {
    const rawQueryList: unknown[] = Array.isArray(params.queries)
        ? params.queries
        : params.query !== undefined
          ? [params.query]
          : [];
    return normalizeQueryList(rawQueryList);
}

// ── Curator workflow ────────────────────────────────────────

/** Execute searches with the interactive curator workflow. */
async function executeWithCurator(
    pi: ExtensionAPI,
    queryList: string[],
    _params: Record<string, unknown>,
    _signal: AbortSignal | undefined,
    ctx: ExtensionContext,
): Promise<WebSearchToolResult> {
    const summaryContext: SummaryGenerationContext = {
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
    };
    const searchResults = new Map<number, QueryResultData>();
    const searchAbort = new AbortController();
    const sessionToken = randomUUID();
    let cancelled = false;
    let curatorHandle: CuratorServerHandle | null = null;

    const finish = (value: WebSearchToolResult): void => {
        cancelled = true;
        searchAbort.abort();
        resultResolve(value);
    };

    const cancelCurator = (_reason: "user" | "stale"): void => {
        if (cancelled) return;
        finish(buildSearchReturnFromResults(searchResults, queryList, true));
    };

    let resultResolve: (value: WebSearchToolResult) => void = () => {};
    const resultPromise = new Promise<WebSearchToolResult>((resolve) => {
        resultResolve = resolve;
    });

    try {
        const handle = await startCuratorServer(
            {
                queries: queryList,
                sessionToken,
                timeout: 30,
                defaultProvider: "exa",
            },
            {
                async onAddSearch(query, queryIndex) {
                    if (cancelled) throw new Error("Cancelled");
                    const result = await searchWithExa(query, {
                        signal: searchAbort.signal,
                    });
                    if (result && !("exhausted" in result) && result) {
                        const qd: QueryResultData = {
                            query,
                            answer: result.answer,
                            results: result.results,
                            error: null,
                            provider: "exa",
                        };
                        searchResults.set(queryIndex, qd);
                        return {
                            answer: result.answer,
                            results: result.results.map((r) => ({
                                title: r.title,
                                url: r.url,
                                domain: extractDomain(r.url),
                            })),
                            provider: "exa",
                        };
                    }
                    throw new Error("Search returned no results");
                },
                onProviderChange(_provider: string): void {
                    // Exa-only provider — no-op
                },
                async onSummarize(selectedQueryIndices: number[], summarizeSignal: AbortSignal) {
                    const selected: QueryResultData[] = [];
                    for (const qi of selectedQueryIndices) {
                        const r = searchResults.get(qi);
                        if (r) selected.push(r);
                    }
                    if (selected.length === 0) {
                        return {
                            summary: "No results selected.",
                            meta: {
                                model: null,
                                durationMs: 0,
                                tokenEstimate: 0,
                                fallbackUsed: true,
                                fallbackReason: "no-results",
                                edited: false,
                            },
                        };
                    }
                    try {
                        return await generateSummaryDraft(
                            selected,
                            summaryContext,
                            summarizeSignal,
                        );
                    } catch {
                        return buildDeterministicSummary(selected);
                    }
                },
                async onRewriteQuery(query: string, _rewriteSignal: AbortSignal) {
                    return query;
                },
                onSubmit(payload): void {
                    if (cancelled) return;
                    const usedIndices =
                        payload.selectedQueryIndices.length > 0
                            ? payload.selectedQueryIndices
                            : [...searchResults.keys()];
                    for (const qi of usedIndices) {
                        const r = searchResults.get(qi);
                        if (r) {
                            // Result was selected for inclusion
                        }
                    }
                    finish(buildSearchReturnFromResults(searchResults, queryList, false));
                },
                onCancel(reason): void {
                    cancelCurator(reason === "timeout" ? "stale" : reason);
                },
            },
        );

        curatorHandle = handle;

        // Run initial searches
        for (let qi = 0; qi < queryList.length; qi++) {
            if (cancelled || searchAbort.signal.aborted) break;
            const query = queryList[qi];
            if (!query) continue;
            try {
                const result = await searchWithExa(query, {
                    signal: searchAbort.signal,
                });
                if (cancelled || searchAbort.signal.aborted) break;
                if (result && !("exhausted" in result) && result) {
                    searchResults.set(qi, {
                        query,
                        answer: result.answer,
                        results: result.results,
                        error: null,
                        provider: "exa",
                    });
                    handle.pushResult(qi, {
                        answer: result.answer,
                        results: result.results.map((r) => ({
                            title: r.title,
                            url: r.url,
                            domain: extractDomain(r.url),
                        })),
                        provider: "exa",
                    });
                } else {
                    searchResults.set(qi, {
                        query,
                        answer: "",
                        results: [],
                        error: "No results returned",
                        provider: "exa",
                    });
                    handle.pushError(qi, "No results returned", "exa");
                }
            } catch (err) {
                if (cancelled || searchAbort.signal.aborted) break;
                const message = err instanceof Error ? err.message : String(err);
                searchResults.set(qi, {
                    query,
                    answer: "",
                    results: [],
                    error: message,
                    provider: "exa",
                });
                handle.pushError(qi, message, "exa");
            }
        }

        if (!cancelled && curatorHandle) {
            curatorHandle.searchesDone();
        }

        // Open browser — if it fails, auto-submit results instead of error
        let browserOpened = false;
        try {
            await openInBrowser(pi, handle.url);
            browserOpened = true;
        } catch (_browserErr) {
            // Browser open failed — submit results directly
        }

        if (!browserOpened) {
            finish(buildSearchReturnFromResults(searchResults, queryList, true));
            return resultPromise;
        }

        // Fallback timeout: auto-submit after configured timeout if browser is closed without submit
        const curatorTimeout = new Promise<WebSearchToolResult>((resolve) => {
            const timeoutId = setTimeout(() => {
                if (!cancelled) {
                    finish(buildSearchReturnFromResults(searchResults, queryList, true));
                }
                resolve(buildSearchReturnFromResults(searchResults, queryList, true));
            }, curatorCfg.curatorTimeoutMs!);
            // Clean up timeout if resultPromise resolves first
            resultPromise.finally(() => clearTimeout(timeoutId)).catch(() => {});
        });

        return Promise.race([resultPromise, curatorTimeout]);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (curatorHandle) curatorHandle.close();
        return {
            content: [{ type: "text", text: `Curator failed: ${message}` }],
            details: {
                queries: queryList,
                queryCount: queryList.length,
                successfulQueries: 0,
                totalResults: 0,
                includeContent: false,
                sourceUrls: [],
                error: message,
            },
        };
    }
}

/** Build a search return from a Map of results. */
function buildSearchReturnFromResults(
    searchResults: Map<number, QueryResultData>,
    queryList: string[],
    includeContent: boolean,
): WebSearchToolResult {
    const perQuery: QueryResultData[] = [];
    const allUrls: string[] = [];
    for (let i = 0; i < queryList.length; i++) {
        const r = searchResults.get(i);
        if (r) {
            perQuery.push(r);
            if (!r.error) {
                for (const s of r.results) {
                    if (!allUrls.includes(s.url)) allUrls.push(s.url);
                }
            }
        }
    }
    const successfulQueries = perQuery.filter((r) => !r.error).length;
    const output = buildOutputText(perQuery as QueryAccumulator[], queryList);
    return {
        content: [{ type: "text", text: output.trim() }],
        details: {
            queries: queryList,
            queryCount: queryList.length,
            successfulQueries,
            totalResults: allUrls.length,
            includeContent,
            sourceUrls: allUrls.map((u) => ({ url: u, domain: extractDomain(u) })),
        },
    };
}

/** Open a URL in the default browser. */
async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {
    const plat = platform();
    const result =
        plat === "darwin"
            ? await pi.exec("open", [url])
            : plat === "win32"
              ? await pi.exec("cmd", ["/c", "start", "", url])
              : await pi.exec("xdg-open", [url]);
    if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
    }
}

// ── Tool registration ───────────────────────────────────────

/**
 * Registers web search and code search tools with the Pi extension system.
 * @param pi - The Pi extension API.
 */
export function register(pi: ExtensionAPI): void {
    // ── web_search ──────────────────────────────────────────

    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description:
            "Search the web using Exa. Returns a synthesized answer with source citations. " +
            "When includeContent is true, full page content is extracted from sources using webclaw. " +
            "By default, opens an interactive curator browser for reviewing and selecting results. " +
            "Set workflow to 'none' to skip curation and return raw results. " +
            "Provider auto-selects: Exa direct API (with key) or Exa MCP (zero config, no key needed).",
        promptSnippet:
            "Use for web research questions. Prefer {queries:[...]} with 2-4 varied angles over a single query for broader coverage.",
        promptGuidelines: [
            "Use web_search when you need to find information on the web.",
            "For research tasks, prefer 'queries' with 2-4 varied angles over a single 'query' for broader coverage.",
            "Set includeContent to true when you need the full text of source pages, not just snippets.",
            "Set workflow to 'none' to skip the interactive curator browser.",
            "Works without any API key via Exa MCP. Add exaApiKey to ~/.pi/ganita-kit.json for direct API access.",
        ],
        parameters: Type.Object({
            query: Type.Optional(
                Type.String({
                    description:
                        "Single search query. For research tasks, prefer 'queries' with multiple varied angles instead.",
                }),
            ),
            queries: Type.Optional(
                Type.Array(
                    Type.String({
                        description:
                            "Multiple queries searched in sequence. Vary phrasing, scope, and angle across 2-4 queries to maximize coverage.",
                    }),
                ),
            ),
            numResults: Type.Optional(
                Type.Number({ description: "Results per query (default: 5, max: 20)" }),
            ),
            includeContent: Type.Optional(
                Type.Boolean({
                    description:
                        "Extract full page content from sources using webclaw. Requires webclaw CLI installed.",
                }),
            ),
            recencyFilter: Type.Optional(
                StringEnum(["day", "week", "month", "year"], {
                    description: "Filter by recency",
                }),
            ),
            domainFilter: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Limit to domains (prefix with - to exclude)",
                }),
            ),
            workflow: Type.Optional(
                StringEnum(["none", "summary-review"], {
                    description:
                        "Search workflow: none = return raw results, summary-review = open curator with summary draft (default)",
                }),
            ),
        }),

        async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<WebSearchToolResult> {
            const queryList = extractQueryList(params);
            if (queryList.length === 0) return buildNoQueryResult();

            // Use curator workflow when context is available
            const workflow = params.workflow ?? "summary-review";
            if (workflow === "summary-review" && ctx) {
                return executeWithCurator(pi, queryList, params, signal, ctx);
            }

            const includeContent = params.includeContent ?? false;
            const searchParams = {
                ...(params.numResults ? { numResults: params.numResults } : {}),
                ...(params.recencyFilter ? { recencyFilter: params.recencyFilter } : {}),
                ...(params.domainFilter ? { domainFilter: params.domainFilter } : {}),
                includeContent,
                signal,
            };

            const perQuery = await Promise.all(
                queryList.map((q) => executeSingleQuery(q, searchParams)),
            );
            const allUrls = collectUrls(perQuery);
            const successfulQueries = perQuery.filter((r) => !r.error).length;
            let output = buildOutputText(perQuery, queryList);

            if (includeContent && allUrls.length > 0) {
                output = await appendExtractedContent(pi, output, allUrls, signal);
            }

            return {
                content: [{ type: "text", text: output.trim() }],
                details: {
                    queries: queryList,
                    queryCount: queryList.length,
                    successfulQueries,
                    totalResults: allUrls.length,
                    includeContent,
                    sourceUrls: allUrls.map((url) => ({
                        url,
                        domain: extractDomain(url),
                    })),
                },
            };
        },
    });

    // ── code_search ─────────────────────────────────────────

    pi.registerTool({
        name: "code_search",
        label: "Code Search",
        description:
            "Search for code examples, documentation, and API references. " +
            "Returns relevant code snippets and docs from GitHub, Stack Overflow, " +
            "and official documentation. No API key required — uses Exa MCP.",
        promptSnippet:
            "Use for programming/API/library questions to retrieve concrete examples and docs before implementing or debugging code.",
        promptGuidelines: [
            "Use code_search when you need code examples, API references, or documentation.",
            "Works without any API key via Exa MCP.",
            "Increase maxTokens for broader context when researching complex topics.",
        ],
        parameters: Type.Object({
            query: Type.String({
                description: "Programming question, API, library, or debugging topic to search for",
            }),
            maxTokens: Type.Optional(
                Type.Integer({
                    minimum: 1000,
                    maximum: 50000,
                    description:
                        "Maximum tokens of code/documentation context to return (default: 5000)",
                }),
            ),
        }),

        async execute(_toolCallId, params, signal): Promise<CodeSearchToolResult> {
            const query = params.query.trim();

            if (!query) {
                return {
                    content: [{ type: "text", text: "Error: No query provided." }],
                    details: {
                        query: "",
                        maxTokens: params.maxTokens ?? 5000,
                        error: "No query provided",
                    } satisfies CodeSearchDetails,
                };
            }

            const maxTokens = params.maxTokens ?? 5000;

            try {
                const text = await callExaMcp(
                    "get_code_context_exa",
                    {
                        query,
                        tokensNum: maxTokens,
                    },
                    signal,
                );

                return {
                    content: [{ type: "text", text: truncate(text, MAX_CODE_SEARCH_OUTPUT) }],
                    details: { query, maxTokens } satisfies CodeSearchDetails,
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: "text", text: `Error: ${message}` }],
                    details: {
                        query,
                        maxTokens,
                        error: message,
                    } satisfies CodeSearchDetails,
                };
            }
        },
    });
}

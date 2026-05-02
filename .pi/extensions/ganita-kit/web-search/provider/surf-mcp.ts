/**
 * MCP client for google-surf-mcp — Google search via Playwright, no API key.
 *
 * Spawns google-surf-mcp as a subprocess and communicates via
 * JSON-RPC 2.0 over stdio. The subprocess manages its own Chrome profile,
 * Playwright browser pool, and CAPTCHA recovery.
 *
 * Lazily started on first call. The MCP process manages its own idle close
 * via SURF_IDLE_CLOSE_MS (default 30s). Restarts automatically on next call.
 *
 * Known issue: pool-based tools (extract, search_parallel, search_extract)
 * can fail if the sequential context is still holding the profile lock.
 * Workaround: sequential and pool calls are serialized — sequential context
 * is closed before pool ops, and pool is reset before sequential ops.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { loadConfig } from "../../config/loader.js";

// ── Types ──────────────────────────────────────────────────

export interface SurfSearchItem {
    title: string;
    url: string;
    description: string;
}

export interface SurfSearchResult {
    results: SurfSearchItem[];
    elapsed_ms?: number;
    error?: string;
}

export interface SurfExtractResult {
    url?: string;
    title?: string;
    content?: string;
    excerpt?: string;
    length?: number;
    error?: string;
}

// ── JSON-RPC types ─────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number;
    result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
    error?: { code: number; message: string };
}

// ── Client state ───────────────────────────────────────────

let proc: ChildProcess | null = null;
let lineReader: ReturnType<typeof createInterface> | null = null;
let requestId = 0;
const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();
let initialized = false;
let initPromise: Promise<void> | null = null;

/** Resolve the path to the locally installed google-surf-mcp entry point. */
function resolveSurfBinary(): string {
    return require.resolve("google-surf-mcp/build/index.js");
}

/** Start and initialize the surf MCP subprocess (idempotent). */
async function ensureStarted(): Promise<void> {
    if (initialized && proc && !proc.killed) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const cfg = loadConfig();
        const surfCfg = cfg.surf;
        const env: Record<string, string | undefined> = { ...process.env };

        if (surfCfg?.headless !== undefined) env["SURF_HEADLESS"] = String(surfCfg.headless);
        if (surfCfg?.idleCloseMs !== undefined)
            env["SURF_IDLE_CLOSE_MS"] = String(surfCfg.idleCloseMs);
        if (surfCfg?.chromePath) env["CHROME_PATH"] = surfCfg.chromePath;
        if (surfCfg?.profileRoot) env["SURF_PROFILE_ROOT"] = surfCfg.profileRoot;
        if (surfCfg?.locale) env["SURF_LOCALE"] = surfCfg.locale;
        if (surfCfg?.tz) env["SURF_TZ"] = surfCfg.tz;

        const entryPath = resolveSurfBinary();
        proc = spawn("node", [entryPath], {
            stdio: ["pipe", "pipe", "pipe"],
            env,
        });

        proc.on("exit", () => {
            initialized = false;
            proc = null;
            lineReader = null;
            for (const [, entry] of pending) {
                entry.reject(new Error("Surf process exited"));
            }
            pending.clear();
        });

        proc.on("error", (err) => {
            initialized = false;
            proc = null;
            for (const [, entry] of pending) {
                entry.reject(new Error(`Surf process error: ${err.message}`));
            }
            pending.clear();
        });

        // Read JSON-RPC responses from stdout
        lineReader = createInterface({ input: proc.stdout!, crlfDelay: Number.POSITIVE_INFINITY });
        lineReader.on("line", (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
                const response = JSON.parse(trimmed) as JsonRpcResponse;
                const entry = pending.get(response.id);
                if (!entry) return;
                pending.delete(response.id);

                if (response.error) {
                    entry.reject(
                        new Error(`Surf error (${response.error.code}): ${response.error.message}`),
                    );
                } else {
                    entry.resolve(response.result);
                }
            } catch {
                // Non-JSON line — ignore
            }
        });

        // Surf logs to stderr — ignore
        proc.stderr?.setEncoding("utf-8");
        proc.stderr?.on("data", () => {});

        // MCP initialize handshake
        await sendRequest("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "ganita-kit-surf", version: "1.0.0" },
        });

        // Send initialized notification (no response expected)
        proc.stdin?.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        );

        initialized = true;
    })();

    try {
        await initPromise;
    } finally {
        initPromise = null;
    }
}

/** Send a JSON-RPC request and wait for the response. */
function sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const id = ++requestId;
        const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

        const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Surf request "${method}" timed out after 60s`));
        }, 60_000);

        pending.set(id, {
            resolve: (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            reject: (err) => {
                clearTimeout(timeout);
                reject(err);
            },
        });

        try {
            proc?.stdin?.write(`${JSON.stringify(request)}\n`);
        } catch (err) {
            clearTimeout(timeout);
            pending.delete(id);
            reject(new Error(`Failed to write to surf: ${String(err)}`));
        }
    });
}

/** Call a surf MCP tool and extract text content from the response. */
async function callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<string> {
    await ensureStarted();

    // Propagate abort
    const abortHandler = () => {
        const entry = pending.get(requestId);
        if (entry) {
            pending.delete(requestId);
            entry.reject(new Error("Aborted"));
        }
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
        const result = (await sendRequest("tools/call", { name, arguments: args })) as {
            content?: Array<{ type: string; text: string }>;
            isError?: boolean;
        };

        const text = result?.content?.[0]?.text ?? "";

        if (result?.isError) {
            // Extract error from JSON text or use raw text
            try {
                const parsed = JSON.parse(text) as { error?: string };
                throw new Error(parsed.error ?? text.slice(0, 200));
            } catch (err) {
                if (err instanceof Error && err.message !== text.slice(0, 200)) throw err;
                throw new Error(text.slice(0, 200));
            }
        }

        return text;
    } finally {
        signal?.removeEventListener("abort", abortHandler);
    }
}

/** Parse JSON text from a surf tool response, falling back to raw text. */
function parseResponseText<T>(text: string, fallback: T): T {
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Search Google via surf (sequential context).
 * ~1.5s/query after first call.
 */
export async function surfSearch(
    query: string,
    limit = 10,
    signal?: AbortSignal,
): Promise<SurfSearchResult> {
    const text = await callTool("search", { query, limit: Math.min(limit, 20) }, signal);
    return parseResponseText<SurfSearchResult>(text, { results: [] });
}

/**
 * Fetch URL content via surf extract (pool context).
 * Returns article markdown via Mozilla Readability + Turndown.
 */
export async function surfExtract(
    url: string,
    maxChars?: number,
    signal?: AbortSignal,
): Promise<SurfExtractResult> {
    const text = await callTool(
        "extract",
        {
            url,
            ...(maxChars !== undefined ? { max_chars: Math.min(maxChars, 50_000) } : {}),
        },
        signal,
    );
    return parseResponseText<SurfExtractResult>(text, { error: text.slice(0, 300) });
}

/**
 * Google search + extract content from each result.
 * Uses sequential search then sequential extract (avoids pool warm issues).
 */
export async function surfSearchExtract(
    query: string,
    limit = 5,
    maxChars?: number,
    signal?: AbortSignal,
): Promise<{
    query: string;
    results: Array<SurfSearchItem & { content?: string; error?: string }>;
    error?: string;
}> {
    // Step 1: Search via sequential context
    const searchResult = await surfSearch(query, limit, signal);
    if (searchResult.error || searchResult.results.length === 0) {
        return {
            query,
            results: [],
            error: searchResult.error ?? "No results found",
        };
    }

    // Step 2: Extract each URL via pool context (sequential fallback if pool fails)
    const enriched = await Promise.all(
        searchResult.results.map(async (r) => {
            try {
                const extracted = await surfExtract(r.url, maxChars, signal);
                const item: SurfSearchItem & { content?: string; error?: string } = {
                    title: r.title,
                    url: r.url,
                    description: r.description,
                };
                if (extracted.content) item.content = extracted.content;
                if (extracted.error) item.error = extracted.error;
                return item;
            } catch (err) {
                return {
                    title: r.title,
                    url: r.url,
                    description: r.description,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        }),
    );

    return { query, results: enriched };
}

/** Stop the surf subprocess. Call on extension shutdown. */
export function stopSurf(): void {
    if (proc) {
        proc.kill();
        proc = null;
    }
    initialized = false;
    for (const [, entry] of pending) {
        entry.reject(new Error("Surf client stopped"));
    }
    pending.clear();
}

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "../../config/config.js";
import type {
    CuratorServerCallbacks,
    CuratorServerHandle,
    CuratorServerOptions,
    CuratorServerState,
} from "../../types/curator.js";
import type { SummaryMeta } from "../../types/search.js";
import { generateCuratorPage } from "./pages.js";

// ── Runtime config ─────────────────────────────────────────

const cfg = loadConfig();
// Non-null assertion: cfg.curator has defaults from loadConfig
const curatorCfg = cfg.curator!;
const STALE_THRESHOLD_MS = curatorCfg.staleThresholdMs!;
const DISCONNECT_GRACE_MS = curatorCfg.disconnectGraceMs!;
const WATCHDOG_INTERVAL_MS = curatorCfg.watchdogIntervalMs!;
const MAX_BODY_SIZE = curatorCfg.maxBodySize!;

// ── Types ──────────────────────────────────────────────────

type ServerState = CuratorServerState;

// ── HTTP helpers ───────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
}

function parseJSONBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                req.destroy();
                reject(new Error("Request body too large"));
                return;
            }
            body += chunk.toString();
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                reject(new Error(`Invalid JSON: ${message}`));
            }
        });
        req.on("error", reject);
    });
}

async function parseBodyOrSend(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
    try {
        return await parseJSONBody(req);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid body";
        const status = message === "Request body too large" ? 413 : 400;
        sendJson(res, status, { ok: false, error: message });
        return null;
    }
}

function normalizeSelectedIndices(
    value: unknown,
    options: { allowEmpty: boolean; maxExclusive: number },
): { ok: true; indices: number[] } | { ok: false; error: string } {
    if (!Array.isArray(value)) {
        return { ok: false, error: "Invalid selection" };
    }

    if (!options.allowEmpty && value.length === 0) {
        return { ok: false, error: "Invalid selection" };
    }

    const normalized: number[] = [];
    const seen = new Set<number>();
    for (const item of value) {
        if (typeof item !== "number" || !Number.isInteger(item) || item < 0) {
            return { ok: false, error: "Invalid selection" };
        }
        if (item >= options.maxExclusive) {
            return { ok: false, error: "Invalid selection" };
        }
        if (seen.has(item)) continue;
        seen.add(item);
        normalized.push(item);
    }

    if (!options.allowEmpty && normalized.length === 0) {
        return { ok: false, error: "Invalid selection" };
    }

    return { ok: true, indices: normalized };
}

function normalizeSummaryMeta(value: unknown): SummaryMeta | null {
    if (!value || typeof value !== "object") return null;
    const meta = value as { [key: string]: unknown };

    const modelValue = meta["model"];
    if (modelValue !== null && typeof modelValue !== "string") return null;

    const durationMsValue = meta["durationMs"];
    if (
        typeof durationMsValue !== "number" ||
        !Number.isFinite(durationMsValue) ||
        durationMsValue < 0
    )
        return null;

    const tokenEstimateValue = meta["tokenEstimate"];
    if (
        typeof tokenEstimateValue !== "number" ||
        !Number.isFinite(tokenEstimateValue) ||
        tokenEstimateValue < 0
    )
        return null;

    const fallbackUsedValue = meta["fallbackUsed"];
    if (typeof fallbackUsedValue !== "boolean") return null;

    const fallbackReasonValue = meta["fallbackReason"];
    if (fallbackReasonValue !== undefined && typeof fallbackReasonValue !== "string") return null;

    const editedValue = meta["edited"];
    if (editedValue !== undefined && typeof editedValue !== "boolean") return null;

    return {
        model: modelValue as string | null,
        durationMs: durationMsValue as number,
        tokenEstimate: tokenEstimateValue as number,
        fallbackUsed: fallbackUsedValue as boolean,
        ...(fallbackReasonValue !== undefined
            ? { fallbackReason: fallbackReasonValue as string }
            : {}),
        ...(editedValue !== undefined ? { edited: editedValue as boolean } : {}),
    };
}

// ── Server factory ─────────────────────────────────────────

export function startCuratorServer(
    options: CuratorServerOptions,
    callbacks: CuratorServerCallbacks,
): Promise<CuratorServerHandle> {
    const { queries, sessionToken, timeout, defaultProvider } = options;

    let browserConnected = false;
    let lastHeartbeatAt = Date.now();
    let completed = false;
    let watchdog: NodeJS.Timeout | null = null;
    let state: ServerState = "SEARCHING";
    let sseResponse: ServerResponse | null = null;
    const sseBuffer: string[] = [];
    let nextQueryIndex = queries.length;
    let summarizeAbortController: AbortController | null = null;
    let summarizeRequestSeq = 0;
    let sseKeepalive: NodeJS.Timeout | null = null;

    const abortInFlightSummarize = (): void => {
        if (!summarizeAbortController) return;
        summarizeAbortController.abort();
        summarizeAbortController = null;
    };

    const markCompleted = (): boolean => {
        if (completed) return false;
        completed = true;
        state = "COMPLETED";
        if (watchdog) {
            clearInterval(watchdog);
            watchdog = null;
        }
        if (sseKeepalive) {
            clearInterval(sseKeepalive);
            sseKeepalive = null;
        }
        abortInFlightSummarize();
        if (sseResponse) {
            try {
                sseResponse.end();
            } catch {
                // Ignore end errors on already-closed connections
            }
            sseResponse = null;
        }
        return true;
    };

    const touchHeartbeat = (): void => {
        lastHeartbeatAt = Date.now();
        browserConnected = true;
    };

    function validateToken(body: unknown, res: ServerResponse): boolean {
        if (!body || typeof body !== "object") {
            sendJson(res, 400, { ok: false, error: "Invalid body" });
            return false;
        }
        if ((body as { token?: string }).token !== sessionToken) {
            sendJson(res, 403, { ok: false, error: "Invalid session" });
            return false;
        }
        return true;
    }

    function sendSSE(event: string, data: unknown): void {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const res = sseResponse;
        if (res && !res.writableEnded && res.socket && !res.socket.destroyed) {
            try {
                res.write(payload);
                return;
            } catch {
                // Fall through to buffer
            }
        }
        sseBuffer.push(payload);
    }

    const pageHtml = generateCuratorPage(queries, sessionToken, timeout, defaultProvider);

    const server = http.createServer(async (req, res) => {
        try {
            const method = req.method || "GET";
            const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

            // ── GET / — HTML page ─────────────────────────────────
            if (method === "GET" && url.pathname === "/") {
                const token = url.searchParams.get("session");
                if (token !== sessionToken) {
                    res.writeHead(403, { "Content-Type": "text/plain" });
                    res.end("Invalid session");
                    return;
                }
                touchHeartbeat();
                res.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store",
                });
                res.end(pageHtml);
                return;
            }

            // ── GET /events — SSE stream ──────────────────────────
            if (method === "GET" && url.pathname === "/events") {
                const token = url.searchParams.get("session");
                if (token !== sessionToken) {
                    res.writeHead(403, { "Content-Type": "text/plain" });
                    res.end("Invalid session");
                    return;
                }
                if (state === "COMPLETED") {
                    sendJson(res, 409, { ok: false, error: "No events available" });
                    return;
                }
                if (sseResponse) {
                    try {
                        sseResponse.end();
                    } catch {
                        // Ignore
                    }
                }
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                    "X-Accel-Buffering": "no",
                });
                res.flushHeaders();
                if (res.socket) res.socket.setNoDelay(true);
                sseResponse = res;
                if (sseBuffer.length > 0) {
                    const pending = sseBuffer.splice(0, sseBuffer.length);
                    for (let i = 0; i < pending.length; i++) {
                        const msg = pending[i];
                        if (msg) {
                            try {
                                res.write(msg);
                            } catch {
                                sseBuffer.unshift(...pending.slice(i));
                                break;
                            }
                        }
                    }
                }
                if (sseKeepalive) clearInterval(sseKeepalive);
                sseKeepalive = setInterval(() => {
                    if (sseResponse) {
                        try {
                            sseResponse.write(":keepalive\n\n");
                        } catch {
                            // Ignore
                        }
                    }
                }, 15_000);
                req.on("close", () => {
                    if (sseResponse === res) {
                        sseResponse = null;
                        // Fast-track stale detection: if browser doesn't reconnect
                        // within DISCONNECT_GRACE_MS, watchdog will fire
                        lastHeartbeatAt = Date.now() - STALE_THRESHOLD_MS + DISCONNECT_GRACE_MS;
                    }
                });
                return;
            }

            // ── POST /heartbeat ──────────────────────────────────
            if (method === "POST" && url.pathname === "/heartbeat") {
                const body = await parseBodyOrSend(req, res);
                if (!body) return;
                if (!validateToken(body, res)) return;
                touchHeartbeat();
                sendJson(res, 200, { ok: true });
                return;
            }

            // ── POST /provider ───────────────────────────────────
            if (method === "POST" && url.pathname === "/provider") {
                const body = await parseBodyOrSend(req, res);
                if (!body) return;
                if (!validateToken(body, res)) return;
                const { provider } = body as { provider?: string };
                if (typeof provider !== "string" || provider.length === 0) {
                    sendJson(res, 400, { ok: false, error: "Invalid provider" });
                    return;
                }
                setImmediate(() => callbacks.onProviderChange(provider));
                sendJson(res, 200, { ok: true });
                return;
            }

            // ── POST /search ─────────────────────────────────────
            if (method === "POST" && url.pathname === "/search") {
                const body = await parseBodyOrSend(req, res);
                if (!body) return;
                if (!validateToken(body, res)) return;
                if (state === "COMPLETED") {
                    sendJson(res, 409, { ok: false, error: "Session closed" });
                    return;
                }
                const { query } = body as { query?: unknown; provider?: unknown };
                if (typeof query !== "string" || query.trim().length === 0) {
                    sendJson(res, 400, { ok: false, error: "Invalid query" });
                    return;
                }
                const qi = nextQueryIndex++;
                touchHeartbeat();
                try {
                    const result = await callbacks.onAddSearch(query.trim(), qi, undefined);
                    sendJson(res, 200, {
                        ok: true,
                        queryIndex: qi,
                        answer: result.answer,
                        results: result.results,
                        provider: result.provider,
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : "Search failed";
                    sendJson(res, 200, {
                        ok: true,
                        queryIndex: qi,
                        error: message,
                    });
                }
                return;
            }

            // ── POST /summarize ─────────────────────────────────
            if (method === "POST" && url.pathname === "/summarize") {
                const body = await parseBodyOrSend(req, res);
                if (!body) return;
                if (!validateToken(body, res)) return;
                if (state === "COMPLETED") {
                    sendJson(res, 409, { ok: false, error: "Session closed" });
                    return;
                }

                const parsed = normalizeSelectedIndices((body as { selected?: unknown }).selected, {
                    allowEmpty: false,
                    maxExclusive: nextQueryIndex,
                });
                if (!parsed.ok) {
                    sendJson(res, 400, { ok: false, error: parsed.error });
                    return;
                }

                let model: string | undefined;
                const bodyModel = (body as { model?: unknown }).model;
                if (bodyModel !== undefined) {
                    if (typeof bodyModel !== "string") {
                        sendJson(res, 400, { ok: false, error: "Invalid model" });
                        return;
                    }
                    model = bodyModel.trim() || undefined;
                }

                const bodyFeedback = (body as { feedback?: unknown }).feedback;
                const feedback =
                    typeof bodyFeedback === "string" && bodyFeedback.trim().length > 0
                        ? bodyFeedback.trim()
                        : undefined;

                abortInFlightSummarize();
                const controller = new AbortController();
                summarizeAbortController = controller;
                const requestId = ++summarizeRequestSeq;

                try {
                    const result = await callbacks.onSummarize(
                        parsed.indices,
                        controller.signal,
                        model,
                        feedback,
                    );
                    if (requestId !== summarizeRequestSeq) {
                        sendJson(res, 409, {
                            ok: false,
                            error: "Summarize request superseded",
                        });
                        return;
                    }
                    sendJson(res, 200, {
                        ok: true,
                        summary: result.summary,
                        meta: result.meta,
                    });
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : "Summary generation failed";
                    const status = controller.signal.aborted ? 409 : 500;
                    sendJson(res, status, { ok: false, error: message });
                } finally {
                    if (summarizeAbortController === controller) {
                        summarizeAbortController = null;
                    }
                }
                return;
            }

            // ── POST /rewrite ────────────────────────────────────
            if (method === "POST" && url.pathname === "/rewrite") {
                const body = await parseBodyOrSend(req, res);
                if (!body) return;
                if (!validateToken(body, res)) return;
                if (state === "COMPLETED") {
                    sendJson(res, 409, { ok: false, error: "Session closed" });
                    return;
                }
                const { query } = body as { query?: unknown };
                if (typeof query !== "string" || query.trim().length === 0) {
                    sendJson(res, 400, { ok: false, error: "Invalid query" });
                    return;
                }
                const controller = new AbortController();
                req.on("close", () => controller.abort());
                touchHeartbeat();
                try {
                    const rewritten = await callbacks.onRewriteQuery(
                        query.trim(),
                        controller.signal,
                    );
                    sendJson(res, 200, { ok: true, query: rewritten });
                } catch (err) {
                    const message = err instanceof Error ? err.message : "Rewrite failed";
                    const status = controller.signal.aborted ? 409 : 500;
                    sendJson(res, status, { ok: false, error: message });
                }
                return;
            }

            // ── POST /submit ─────────────────────────────────────
            if (method === "POST" && url.pathname === "/submit") {
                const body = await parseBodyOrSend(req, res);
                if (!body) return;
                if (!validateToken(body, res)) return;

                const parsed = normalizeSelectedIndices((body as { selected?: unknown }).selected, {
                    allowEmpty: true,
                    maxExclusive: nextQueryIndex,
                });
                if (!parsed.ok) {
                    sendJson(res, 400, { ok: false, error: parsed.error });
                    return;
                }

                let summary: string | undefined;
                const bodySummary = (body as { summary?: unknown }).summary;
                if (bodySummary !== undefined) {
                    if (typeof bodySummary !== "string") {
                        sendJson(res, 400, { ok: false, error: "Invalid summary" });
                        return;
                    }
                    summary = bodySummary.trim() || undefined;
                }

                let summaryMeta: SummaryMeta | undefined;
                const bodySummaryMeta = (body as { summaryMeta?: unknown }).summaryMeta;
                if (bodySummaryMeta !== undefined) {
                    const parsedMeta = normalizeSummaryMeta(bodySummaryMeta);
                    if (!parsedMeta) {
                        sendJson(res, 400, { ok: false, error: "Invalid summaryMeta" });
                        return;
                    }
                    summaryMeta = parsedMeta;
                }

                if (state !== "SEARCHING" && state !== "RESULT_SELECTION") {
                    sendJson(res, 409, {
                        ok: false,
                        error: "Cannot submit in current state",
                    });
                    return;
                }
                if (!markCompleted()) {
                    sendJson(res, 409, { ok: false, error: "Session closed" });
                    return;
                }
                const rawResults = (body as { rawResults?: unknown }).rawResults === true;
                sendJson(res, 200, { ok: true });
                setImmediate(() =>
                    callbacks.onSubmit({
                        selectedQueryIndices: parsed.indices,
                        ...(summary !== undefined ? { summary } : {}),
                        ...(summaryMeta !== undefined ? { summaryMeta } : {}),
                        rawResults,
                    }),
                );
                return;
            }

            // ── POST /cancel ─────────────────────────────────────
            if (method === "POST" && url.pathname === "/cancel") {
                const body = await parseBodyOrSend(req, res);
                if (!body) return;
                if (!validateToken(body, res)) return;
                if (!markCompleted()) {
                    sendJson(res, 200, { ok: true });
                    return;
                }
                const { reason } = body as { reason?: string };
                sendJson(res, 200, { ok: true });
                const cancelReason = reason === "timeout" ? "timeout" : "user";
                setImmediate(() => callbacks.onCancel(cancelReason));
                return;
            }

            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
        } catch (err) {
            const message = err instanceof Error ? err.message : "Server error";
            sendJson(res, 500, { ok: false, error: message });
        }
    });

    return new Promise<CuratorServerHandle>((resolve, reject) => {
        const onError = (err: Error) => {
            reject(new Error(`Curator server failed to start: ${err.message}`));
        };

        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", onError);
            const addr = server.address();
            if (!addr || typeof addr === "string") {
                reject(new Error("Curator server: invalid address"));
                return;
            }
            const url = `http://localhost:${addr.port}/?session=${sessionToken}`;

            watchdog = setInterval(() => {
                if (completed || !browserConnected) return;
                if (Date.now() - lastHeartbeatAt <= STALE_THRESHOLD_MS) return;
                if (!markCompleted()) return;
                setImmediate(() => callbacks.onCancel("stale"));
            }, WATCHDOG_INTERVAL_MS);

            resolve({
                server,
                url,
                close: () => {
                    const wasOpen = markCompleted();
                    try {
                        server.close();
                    } catch {
                        // Ignore close errors
                    }
                    if (wasOpen) {
                        setImmediate(() => callbacks.onCancel("stale"));
                    }
                },
                pushResult: (queryIndex, data) => {
                    if (completed) return;
                    sendSSE("result", {
                        queryIndex,
                        query: queries[queryIndex] ?? "",
                        ...data,
                    });
                },
                pushError: (queryIndex, error, provider) => {
                    if (completed) return;
                    sendSSE("search-error", {
                        queryIndex,
                        query: queries[queryIndex] ?? "",
                        error,
                        provider,
                    });
                },
                searchesDone: () => {
                    if (completed) return;
                    sendSSE("done", {});
                    state = "RESULT_SELECTION";
                },
            });
        });
    });
}

import { getGeminiApiKey } from "../../config/runtime.js";
import type { SearchResponse, SearchResult } from "../../types/search.js";
import { type CookieMap, getGoogleCookies } from "./chrome-cookies.js";

// ── Constants ──────────────────────────────────────────────

const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL =
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const _GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const _GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MODEL_HEADERS: Record<string, string> = {
    "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
    "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
    "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];

// ── Public API ─────────────────────────────────────────────

/**
 * Check if Gemini Web is available (has valid Google cookies).
 */
export async function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null> {
    const result = await getGoogleCookies({
        ...(chromeProfile ? { profile: chromeProfile } : {}),
        requiredCookies: REQUIRED_COOKIES,
    });
    if (!result) return null;
    return result.cookies;
}

/**
 * Search using Gemini Web (cookie-based, no API key needed).
 * Falls back to Gemini API if cookies aren't available but API key is.
 */
export async function searchWithGeminiWeb(
    query: string,
    options: {
        model?: string;
        signal?: AbortSignal;
        timeoutMs?: number;
        chromeProfile?: string;
    } = {},
): Promise<SearchResponse | null> {
    // Try cookies first
    const cookies = await isGeminiWebAvailable(options.chromeProfile);
    if (cookies) {
        try {
            return await searchWithCookies(query, cookies, options);
        } catch (err) {
            // If cookie-based fails, fall through to API
            const apiKey = getGeminiApiKey();
            if (!apiKey) throw err;
        }
    }

    // Fall back to API key
    const apiKey = getGeminiApiKey();
    if (apiKey) {
        const { searchWithGeminiApi } = await import("./gemini-api.js");
        return searchWithGeminiApi(query, {
            ...(options.model ? { model: options.model } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        });
    }

    return null;
}

// ── Cookie-based search ────────────────────────────────────

async function searchWithCookies(
    query: string,
    cookieMap: CookieMap,
    options: { model?: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<SearchResponse> {
    const model =
        options.model && MODEL_HEADERS[options.model] ? options.model : "gemini-2.5-flash";
    const timeoutMs = options.timeoutMs ?? 120_000;
    const prompt = buildSearchPrompt(query);

    const result = await runGeminiWebOnce(prompt, cookieMap, model, timeoutMs, options.signal);

    // Auto-fallback if model unavailable
    if (isModelUnavailable(result.errorCode) && model !== "gemini-2.5-flash") {
        const fallback = await runGeminiWebOnce(
            prompt,
            cookieMap,
            "gemini-2.5-flash",
            timeoutMs,
            options.signal,
        );
        if (fallback.errorMessage) throw new Error(fallback.errorMessage);
        if (!fallback.text) throw new Error("Gemini Web returned empty response (fallback)");
        return parseGeminiResponse(fallback.text);
    }

    if (result.errorMessage) throw new Error(result.errorMessage);
    if (!result.text) throw new Error("Gemini Web returned empty response");

    return parseGeminiResponse(result.text);
}

function buildSearchPrompt(query: string): string {
    return `Search the web and answer the following question. Include source URLs for your claims.

Format your response as:
1. A direct answer to the question
2. Cited sources as markdown links

Question: ${query}`;
}

function parseGeminiResponse(markdown: string): SearchResponse {
    const results = extractSourceUrls(markdown);
    return { answer: markdown, results };
}

function extractSourceUrls(markdown: string): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    for (const match of markdown.matchAll(linkRegex)) {
        const url = match[2];
        if (!url || seen.has(url)) continue;
        seen.add(url);
        results.push({ title: match[1] ?? "", url, snippet: "" });
    }
    return results;
}

// ── Gemini Web internal API ────────────────────────────────

interface GeminiWebResult {
    text: string;
    errorCode?: number;
    errorMessage?: string;
}

async function runGeminiWebOnce(
    prompt: string,
    cookieMap: CookieMap,
    model: string,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<GeminiWebResult> {
    const effectiveSignal = withTimeout(signal, timeoutMs);
    const cookieHeader = buildCookieHeader(cookieMap);

    try {
        const accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);
        const fReq = buildFReqPayload(prompt);
        const params = new URLSearchParams();
        params.set("at", accessToken);
        params.set("f.req", fReq);

        const res = await fetch(GEMINI_STREAM_GENERATE_URL, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded;charset=utf-8",
                host: "gemini.google.com",
                origin: "https://gemini.google.com",
                referer: "https://gemini.google.com/",
                "x-same-domain": "1",
                "user-agent": USER_AGENT,
                cookie: cookieHeader,
                ...(MODEL_HEADERS[model] ? { [MODEL_HEADER_NAME]: MODEL_HEADERS[model] } : {}),
            },
            body: params.toString(),
            signal: effectiveSignal,
        });

        const rawText = await res.text();

        if (!res.ok) {
            return {
                text: "",
                errorMessage: `Gemini request failed: ${res.status}`,
            };
        }

        try {
            return parseStreamGenerateResponse(rawText);
        } catch (err) {
            let errorCode: number | undefined;
            try {
                const json = JSON.parse(trimJsonEnvelope(rawText));
                errorCode = extractErrorCode(json);
            } catch {
                // Ignore parse errors
            }
            return {
                text: "",
                ...(errorCode !== undefined ? { errorCode } : {}),
                errorMessage: err instanceof Error ? err.message : String(err),
            };
        }
    } catch (err) {
        return {
            text: "",
            errorMessage: err instanceof Error ? err.message : String(err),
        };
    }
}

const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";

async function fetchAccessToken(cookieHeader: string, signal: AbortSignal): Promise<string> {
    const html = await fetchWithCookieRedirects(GEMINI_APP_URL, cookieHeader, 10, signal);

    for (const key of ["SNlM0e", "thykhd"]) {
        const match = html.match(new RegExp(`"${key}":"(.*?)"`));
        if (match?.[1]) return match[1];
    }

    throw new Error(
        "Unable to authenticate with Gemini. Make sure you're signed into gemini.google.com in a supported Chromium-based browser.",
    );
}

async function fetchWithCookieRedirects(
    url: string,
    cookieHeader: string,
    maxRedirects: number,
    signal: AbortSignal,
): Promise<string> {
    let current = url;
    for (let i = 0; i <= maxRedirects; i++) {
        const res = await fetch(current, {
            headers: { "user-agent": USER_AGENT, cookie: cookieHeader },
            redirect: "manual",
            signal,
        });
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            if (location) {
                current = new URL(location, current).toString();
                continue;
            }
        }
        return await res.text();
    }
    throw new Error(`Too many redirects (>${maxRedirects})`);
}

function buildCookieHeader(cookieMap: CookieMap): string {
    return Object.entries(cookieMap)
        .filter(([, value]) => typeof value === "string" && value.length > 0)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}

function buildFReqPayload(prompt: string): string {
    const innerList = [[prompt], null, null, null];
    return JSON.stringify([null, JSON.stringify(innerList)]);
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ── Response parsing ───────────────────────────────────────

function trimJsonEnvelope(text: string): string {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("Gemini response did not contain a JSON payload.");
    }
    return text.slice(start, end + 1);
}

function extractErrorCode(responseJson: unknown): number | undefined {
    const code = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0]);
    return typeof code === "number" && code >= 0 ? code : undefined;
}

function isModelUnavailable(errorCode: number | undefined): boolean {
    return errorCode === 1052;
}

function getNestedValue(value: unknown, pathParts: number[]): unknown {
    let current: unknown = value;
    for (const part of pathParts) {
        if (current == null) return undefined;
        if (!Array.isArray(current)) return undefined;
        current = (current as unknown[])[part];
    }
    return current;
}

function parseStreamGenerateResponse(rawText: string): GeminiWebResult {
    const responseJson = JSON.parse(trimJsonEnvelope(rawText));
    const errorCode = extractErrorCode(responseJson);

    const parts = Array.isArray(responseJson) ? responseJson : [];
    let body: unknown = null;

    for (let i = 0; i < parts.length; i++) {
        const partBody = getNestedValue(parts[i], [2]);
        if (!partBody || typeof partBody !== "string") continue;
        try {
            const parsed = JSON.parse(partBody);
            const candidateList = getNestedValue(parsed, [4]);
            if (Array.isArray(candidateList) && (candidateList as unknown[]).length > 0) {
                body = parsed;
                break;
            }
        } catch {
            // Ignore parse errors
        }
    }

    const candidateList = getNestedValue(body, [4]);
    const firstCandidate = Array.isArray(candidateList)
        ? (candidateList as unknown[])[0]
        : undefined;
    const textRaw = getNestedValue(firstCandidate, [1, 0]) as string | undefined;

    let text = textRaw ?? "";
    if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
        const alt = getNestedValue(firstCandidate, [22, 0]) as string | undefined;
        if (alt) text = alt;
    }

    return {
        text,
        ...(errorCode !== undefined ? { errorCode } : {}),
    };
}

// ── Re-export for convenience ──────────────────────────────

/**
 * Get active Google email from cookies (for verification).
 */
export async function getActiveGoogleEmail(cookies: CookieMap): Promise<string | null> {
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader) return null;

    try {
        const html = await fetchWithCookieRedirects(
            GEMINI_APP_URL,
            cookieHeader,
            10,
            AbortSignal.timeout(10000),
        );
        const email = extractEmailFromGeminiHtml(html);
        if (email) return email;
    } catch {
        // Ignore
    }

    return null;
}

function extractEmailFromGeminiHtml(html: string): string | null {
    const patterns = [
        /"email"\s*:\s*"([^"]+)"/,
        /"displayEmail"\s*:\s*"([^"]+)"/,
        /"identifier"\s*:\s*"([^"]+)"/,
        /"defaultEmail"\s*:\s*"([^"]+)"/,
        /"gaiaIdentifier"\s*:\s*"([^"]+)"/,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        const email = normalizeEmail(match?.[1]);
        if (email) return email;
    }

    return findFirstEmail(html);
}

function findFirstEmail(text: string): string | null {
    const decoded = text
        .replace(/\\u0040/gi, "@")
        .replace(/\\x40/gi, "@")
        .replace(/&#64;/gi, "@")
        .replace(/&commat;/gi, "@");
    const match = decoded.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    return match?.[0] ?? null;
}

function normalizeEmail(value: string | undefined): string | null {
    if (!value) return null;
    const decoded = value
        .replace(/\\u0040/gi, "@")
        .replace(/\\x40/gi, "@")
        .replace(/&#64;/gi, "@")
        .replace(/&commat;/gi, "@");
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(decoded.trim()) ? decoded.trim() : null;
}

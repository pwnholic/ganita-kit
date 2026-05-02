/**
 * Full configuration interface for ganita-kit.
 * All fields have sensible defaults — only override what you need.
 */
export interface GanitaKitConfig {
    /** Exa API key for search. Falls back to EXA_API_KEY env var. */
    exaApiKey?: string;
    /** CrofAI API key for summarization. Falls back to CROFAI_API_KEY env var. */
    crofAiKey?: string;
    /** Gemini API key. Falls back to GEMINI_API_KEY env var. */
    geminiApiKey?: string;
    /** Chrome profile name for cookie extraction (default: "Default"). */
    chromeProfile?: string;

    /** Search-related configuration. */
    search?: {
        /** Default number of results per query (default: 5). */
        defaultNumResults?: number;
        /** Maximum results per query (default: 20). */
        maxResultsPerQuery?: number;
        /** Maximum output characters before truncation (default: 100000). */
        maxOutputChars?: number;
        /** Timeout for webclaw content extraction in ms (default: 60000). */
        extractTimeoutMs?: number;
    };

    /** Curator UI configuration. */
    curator?: {
        /** Default curator session timeout in seconds (default: 30). */
        defaultTimeoutSec?: number;
        /** Stale threshold for watchdog in ms (default: 30000). */
        staleThresholdMs?: number;
        /** Grace period after SSE disconnect in ms (default: 5000). */
        disconnectGraceMs?: number;
        /** Watchdog check interval in ms (default: 2000). */
        watchdogIntervalMs?: number;
        /** Maximum POST body size in bytes (default: 65536). */
        maxBodySize?: number;
        /** Fallback timeout for curator auto-submit in ms (default: 120000). */
        curatorTimeoutMs?: number;
    };

    /** CrofAI summarization configuration. */
    crof?: {
        /** API base URL (default: https://crof.ai/v1). */
        baseUrl?: string;
        /** Default model for summarization (default: kimi-k2.6-precision). */
        defaultModel?: string;
        /** Fallback models in order (default: kimi-k2.5, glm-5.1-precision, deepseek-v3.2). */
        fallbackModels?: string[];
        /** Maximum output tokens (default: 8192). */
        maxTokens?: number;
        /** Temperature for generation (default: 0.15). */
        temperature?: number;
        /** Top-p sampling (default: 0.9). */
        topP?: number;
        /** Repetition penalty (default: 1.05). */
        repetitionPenalty?: number;
    };

    /** Exa search provider configuration. */
    exa?: {
        /** Monthly budget for Exa API calls (default: 1000). */
        monthlyBudget?: number;
        /** Warning threshold before budget exhausted (default: 800). */
        warningThreshold?: number;
        /** API base URL (default: https://api.exa.ai). */
        apiUrl?: string;
        /** MCP endpoint URL (default: https://mcp.exa.ai/mcp). */
        mcpUrl?: string;
        /** Request timeout in ms (default: 60000). */
        requestTimeoutMs?: number;
        /** Current month's usage count (managed internally, do not edit). */
        usageCount?: number;
        /** Usage month in YYYY-MM format (managed internally, do not edit). */
        usageMonth?: string;
    };

    /** Gemini search provider configuration. */
    gemini?: {
        /** Default model for Gemini API search (default: gemini-3-flash-preview). */
        defaultModel?: string;
        /** Gemini Web model for cookie-based search (default: gemini-2.5-flash). */
        webModel?: string;
        /** Request timeout in ms (default: 60000). */
        timeoutMs?: number;
    };
}

/** Default values for all config fields. */
export const DEFAULTS: Required<GanitaKitConfig> = {
    exaApiKey: "",
    crofAiKey: "",
    geminiApiKey: "",
    chromeProfile: "Default",
    search: {
        defaultNumResults: 5,
        maxResultsPerQuery: 20,
        maxOutputChars: 100_000,
        extractTimeoutMs: 60_000,
    },
    curator: {
        defaultTimeoutSec: 30,
        staleThresholdMs: 30_000,
        disconnectGraceMs: 5_000,
        watchdogIntervalMs: 2_000,
        maxBodySize: 64 * 1024,
        curatorTimeoutMs: 120_000,
    },
    crof: {
        baseUrl: "https://crof.ai/v1",
        defaultModel: "kimi-k2.6-precision",
        fallbackModels: ["kimi-k2.5", "glm-5.1-precision", "deepseek-v3.2"],
        maxTokens: 8192,
        temperature: 0.15,
        topP: 0.9,
        repetitionPenalty: 1.05,
    },
    exa: {
        monthlyBudget: 1000,
        warningThreshold: 800,
        apiUrl: "https://api.exa.ai",
        mcpUrl: "https://mcp.exa.ai/mcp",
        requestTimeoutMs: 60_000,
        usageCount: 0,
        usageMonth: "",
    },
    gemini: {
        defaultModel: "gemini-3-flash-preview",
        webModel: "gemini-2.5-flash",
        timeoutMs: 60_000,
    },
};

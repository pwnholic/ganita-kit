/**
 * Full configuration interface for ganita-kit.
 * All fields have sensible defaults — only override what you need.
 */
export interface GanitaKitConfig {
    /** Exa API key for search. Falls back to EXA_API_KEY env var. */
    exaApiKey?: string;
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

    /** CLI tool timeouts and output limits. */
    cli?: {
        /** Maximum CLI output before truncation in chars (default: 50000). */
        maxOutputChars?: number;
        /** tldr default timeout in ms (default: 60000). */
        tldrTimeoutMs?: number;
        /** tldr full-project scan timeout in ms (default: 120000). */
        tldrProjectTimeoutMs?: number;
        /** webclaw scrape/fetch timeout in ms (default: 30000). */
        webclawScrapeTimeoutMs?: number;
        /** webclaw crawl timeout in ms (default: 120000). */
        webclawCrawlTimeoutMs?: number;
        /** webclaw research timeout in ms (default: 300000). */
        webclawResearchTimeoutMs?: number;
        /** bloks default timeout in ms (default: 60000). */
        bloksTimeoutMs?: number;
        /** bloks add/index timeout in ms (default: 120000). */
        bloksAddTimeoutMs?: number;
        /** fastedit default timeout in ms (default: 30000). */
        fasteditTimeoutMs?: number;
        /** fastedit model inference timeout in ms (default: 120000). */
        fasteditModelTimeoutMs?: number;
        /** fastedit model pull timeout in ms (default: 600000). */
        fasteditPullTimeoutMs?: number;
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
    exa: {
        monthlyBudget: 1000,
        warningThreshold: 800,
        apiUrl: "https://api.exa.ai",
        mcpUrl: "https://mcp.exa.ai/mcp",
        requestTimeoutMs: 60_000,
        usageCount: 0,
        usageMonth: "",
    },
    cli: {
        maxOutputChars: 50_000,
        tldrTimeoutMs: 60_000,
        tldrProjectTimeoutMs: 120_000,
        webclawScrapeTimeoutMs: 30_000,
        webclawCrawlTimeoutMs: 120_000,
        webclawResearchTimeoutMs: 300_000,
        bloksTimeoutMs: 60_000,
        bloksAddTimeoutMs: 120_000,
        fasteditTimeoutMs: 30_000,
        fasteditModelTimeoutMs: 120_000,
        fasteditPullTimeoutMs: 600_000,
    },
    gemini: {
        defaultModel: "gemini-3-flash-preview",
        webModel: "gemini-2.5-flash",
        timeoutMs: 60_000,
    },
};

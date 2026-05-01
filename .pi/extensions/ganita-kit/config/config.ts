import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../types/result.js";

// ── Config file paths ──────────────────────────────────────

/** User-level config: ~/.pi/ganita-kit.json */
const USER_CONFIG_PATH = join(homedir(), ".pi", "ganita-kit.json");

/** Project-level config: {extension root}/.pi/ganita-kit.json */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const PROJECT_CONFIG_PATH = join(PROJECT_ROOT, ".pi", "ganita-kit.json");

/**
 * Full configuration interface for ganita-kit.
 * All fields have sensible defaults — only override what you need.
 */
export interface GanitaKitConfig {
    /** Exa API key for search. Falls back to EXA_API_KEY env var. */
    exaApiKey?: string;
    /** CrofAI API key for summarization. Falls back to CROFAI_API_KEY env var. */
    crofAiKey?: string;

    /** Search-related configuration. */
    search?: {
        /** Default number of results per query (default: 5). */
        defaultNumResults?: number;
        /** Maximum results per query (default: 20). */
        maxResultsPerQuery?: number;
        /** Maximum output characters before truncation (default: 50000). */
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
    };
}

// ── Defaults ───────────────────────────────────────────────

const DEFAULTS: Required<GanitaKitConfig> = {
    exaApiKey: "",
    crofAiKey: "",
    search: {
        defaultNumResults: 5,
        maxResultsPerQuery: 20,
        maxOutputChars: 50_000,
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
    },
};

// ── Loading ────────────────────────────────────────────────

let cachedConfig: Required<GanitaKitConfig> | null = null;

function deepMerge(
    defaults: Required<GanitaKitConfig>,
    overrides: Partial<GanitaKitConfig>,
): Required<GanitaKitConfig> {
    const result: Required<GanitaKitConfig> = {
        exaApiKey: defaults.exaApiKey,
        crofAiKey: defaults.crofAiKey,
        search: { ...defaults.search },
        curator: { ...defaults.curator },
        crof: { ...defaults.crof },
        exa: { ...defaults.exa },
    };

    if (overrides.exaApiKey !== undefined) result.exaApiKey = overrides.exaApiKey;
    if (overrides.crofAiKey !== undefined) result.crofAiKey = overrides.crofAiKey;

    if (overrides.search) {
        for (const key of Object.keys(overrides.search) as Array<keyof typeof result.search>) {
            const val = overrides.search[key];
            if (val !== undefined) {
                (result.search as Record<string, unknown>)[key] = val;
            }
        }
    }
    if (overrides.curator) {
        for (const key of Object.keys(overrides.curator) as Array<keyof typeof result.curator>) {
            const val = overrides.curator[key];
            if (val !== undefined) {
                (result.curator as Record<string, unknown>)[key] = val;
            }
        }
    }
    if (overrides.crof) {
        for (const key of Object.keys(overrides.crof) as Array<keyof typeof result.crof>) {
            const val = overrides.crof[key];
            if (val !== undefined) {
                (result.crof as Record<string, unknown>)[key] = val;
            }
        }
    }
    if (overrides.exa) {
        for (const key of Object.keys(overrides.exa) as Array<keyof typeof result.exa>) {
            const val = overrides.exa[key];
            if (val !== undefined) {
                (result.exa as Record<string, unknown>)[key] = val;
            }
        }
    }

    return result;
}

function normalizeApiKey(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Load full config from ~/.pi/ganita-kit.json.
 * Merges user overrides on top of defaults.
 * Cached after first read for process lifetime.
 */
export function loadConfig(): Required<GanitaKitConfig> {
    if (cachedConfig) return cachedConfig;

    const rawConfig: Partial<GanitaKitConfig> = {};

    // Try user config first (highest priority)
    if (existsSync(USER_CONFIG_PATH)) {
        const raw = readFileSync(USER_CONFIG_PATH, "utf-8");
        try {
            const parsed = JSON.parse(raw) as Partial<GanitaKitConfig>;
            Object.assign(rawConfig, parsed);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to parse ${USER_CONFIG_PATH}: ${message}`);
        }
    }

    // Fallback to project config if user config doesn't exist
    if (!existsSync(USER_CONFIG_PATH) && existsSync(PROJECT_CONFIG_PATH)) {
        const raw = readFileSync(PROJECT_CONFIG_PATH, "utf-8");
        try {
            const parsed = JSON.parse(raw) as Partial<GanitaKitConfig>;
            Object.assign(rawConfig, parsed);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to parse ${PROJECT_CONFIG_PATH}: ${message}`);
        }
    }

    cachedConfig = deepMerge(DEFAULTS, rawConfig as Partial<GanitaKitConfig>);
    // cachedConfig is definitely assigned above
    return cachedConfig as Required<GanitaKitConfig>;
}

// ── API key accessors ──────────────────────────────────────

/**
 * Get Exa API key. Checks EXA_API_KEY env var first, then config file.
 */
export function getExaApiKey(): string | null {
    return normalizeApiKey(process.env["EXA_API_KEY"]) ?? normalizeApiKey(loadConfig().exaApiKey);
}

/**
 * Get CrofAI API key. Checks CROFAI_API_KEY env var first, then config file.
 */
export function getCrofaAiKey(): string | null {
    return (
        normalizeApiKey(process.env["CROFAI_API_KEY"]) ?? normalizeApiKey(loadConfig().crofAiKey)
    );
}

// ── Binary resolution (existing) ───────────────────────────

/** Binary names used by ganita-kit. */
const BINARIES = ["tldr", "webclaw", "bloks", "fastedit"] as const;

export type BinaryName = (typeof BINARIES)[number];

/**
 * Resolve the absolute path of a CLI binary.
 * Uses `which` on Unix systems.
 */
export function resolveBinary(name: BinaryName): Result<string> {
    try {
        const path = execSync(`which ${name}`, { encoding: "utf-8" }).trim();
        if (path.length === 0) {
            return { ok: false, error: `${name} not found in PATH` };
        }
        return { ok: true, value: path };
    } catch {
        return { ok: false, error: `${name} not found in PATH` };
    }
}

/**
 * Check which ganita-kit binaries are available.
 */
export function detectBinaries(): Map<BinaryName, string> {
    const found = new Map<BinaryName, string>();
    for (const name of BINARIES) {
        const result = resolveBinary(name);
        if (result.ok) found.set(name, result.value);
    }
    return found;
}

/** Cache for binary detection. */
let binaryCache: Map<BinaryName, string> | null = null;

/**
 * Get available binaries, cached after first call.
 */
export function getAvailableBinaries(): Map<BinaryName, string> {
    if (binaryCache === null) {
        binaryCache = detectBinaries();
    }
    return binaryCache;
}

/**
 * Check if a specific binary is available.
 */
export function hasBinary(name: BinaryName): boolean {
    return getAvailableBinaries().has(name);
}

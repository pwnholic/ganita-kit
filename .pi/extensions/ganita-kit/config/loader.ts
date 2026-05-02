import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GanitaKitConfig } from "./schema.js";
import { DEFAULTS } from "./schema.js";

// ── Config file paths ──────────────────────────────────────

/** User-level config: ~/.pi/ganita-kit.json */
export const USER_CONFIG_PATH = join(homedir(), ".pi", "ganita-kit.json");

/** Project-level config: {extension root}/.pi/ganita-kit.json */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");
export const PROJECT_CONFIG_PATH = join(PROJECT_ROOT, ".pi", "ganita-kit.json");

// ── Config cache ───────────────────────────────────────────

let cachedConfig: Required<GanitaKitConfig> | null = null;

/** Invalidate the config cache. Next loadConfig() will re-read from disk. */
export function invalidateCache(): void {
    cachedConfig = null;
}

// ── Deep merge ─────────────────────────────────────────────

function deepMerge(
    defaults: Required<GanitaKitConfig>,
    overrides: Partial<GanitaKitConfig>,
): Required<GanitaKitConfig> {
    const result: Required<GanitaKitConfig> = {
        exaApiKey: defaults.exaApiKey,
        geminiApiKey: defaults.geminiApiKey,
        chromeProfile: defaults.chromeProfile,
        search: { ...defaults.search },
        curator: { ...defaults.curator },
        exa: { ...defaults.exa },
        cli: { ...defaults.cli },
        gemini: { ...defaults.gemini },
    };

    if (overrides.exaApiKey !== undefined) result.exaApiKey = overrides.exaApiKey;
    if (overrides.geminiApiKey !== undefined) result.geminiApiKey = overrides.geminiApiKey;
    if (overrides.chromeProfile !== undefined) result.chromeProfile = overrides.chromeProfile;

    const sections = ["search", "curator", "exa", "cli", "gemini"] as const;
    for (const section of sections) {
        const overrideSection = overrides[section];
        if (overrideSection) {
            for (const key of Object.keys(overrideSection) as Array<
                keyof (typeof result)[typeof section]
            >) {
                const val = overrideSection[key];
                if (val !== undefined) {
                    (result[section] as Record<string, unknown>)[key] = val;
                }
            }
        }
    }

    return result;
}

// ── Loading ────────────────────────────────────────────────

/**
 * Load full config from ~/.pi/ganita-kit.json.
 * Merges user overrides on top of defaults.
 * Cached after first read for process lifetime.
 */
export function loadConfig(): Required<GanitaKitConfig> {
    if (cachedConfig) return cachedConfig;

    const rawConfig: Partial<GanitaKitConfig> = {};

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

    cachedConfig = deepMerge(DEFAULTS, rawConfig);
    return cachedConfig;
}

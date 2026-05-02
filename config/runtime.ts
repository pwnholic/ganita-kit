import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Result } from "../types/result.js";
import { invalidateCache, loadConfig, PROJECT_CONFIG_PATH, USER_CONFIG_PATH } from "./loader.js";

// ── API key accessors ──────────────────────────────────────

function normalizeApiKey(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Get Exa API key. Checks EXA_API_KEY env var first, then config file. */
export function getExaApiKey(): string | null {
    return normalizeApiKey(process.env["EXA_API_KEY"]) ?? normalizeApiKey(loadConfig().exaApiKey);
}

/** Get Chrome profile name for cookie extraction. */
export function getChromeProfile(): string {
    return loadConfig().chromeProfile;
}

// ── Exa usage tracking ─────────────────────────────────────

/** Shape of Exa usage data persisted in ganita-kit.json. */
export interface ExaUsage {
    month: string;
    count: number;
}

function getCurrentMonth(): string {
    return new Date().toISOString().slice(0, 7);
}

/** Read Exa usage from the config file. Resets if month has changed. */
export function readExaUsage(): ExaUsage {
    const cfg = loadConfig();
    const month = getCurrentMonth();
    const count =
        cfg.exa.usageMonth === month && cfg.exa.usageCount != null ? cfg.exa.usageCount : 0;
    return { month, count };
}

/** Write Exa usage back to the config file and invalidate cache. */
export function writeExaUsage(usage: ExaUsage): void {
    const targetPath = existsSync(USER_CONFIG_PATH) ? USER_CONFIG_PATH : PROJECT_CONFIG_PATH;
    let raw: Record<string, unknown> = {};
    if (existsSync(targetPath)) {
        try {
            raw = JSON.parse(readFileSync(targetPath, "utf-8")) as Record<string, unknown>;
        } catch {
            // Corrupted file — start fresh
        }
    }

    const exa = (raw["exa"] as Record<string, unknown> | undefined) ?? {};
    exa["usageCount"] = usage.count;
    exa["usageMonth"] = usage.month;
    raw["exa"] = exa;

    const dir = targetPath === USER_CONFIG_PATH ? join(homedir(), ".pi") : dirname(targetPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(targetPath, `${JSON.stringify(raw, null, 2)}\n`);

    invalidateCache();
}

/** Get the configured monthly budget for Exa. */
export function getExaMonthlyBudget(): number {
    return loadConfig().exa.monthlyBudget ?? 1000;
}

/** Get the configured warning threshold for Exa. */
export function getExaWarningThreshold(): number {
    return loadConfig().exa.warningThreshold ?? 800;
}

// ── Binary resolution ──────────────────────────────────────

const BINARIES = ["tldr", "webclaw", "bloks", "fastedit"] as const;

export type BinaryName = (typeof BINARIES)[number];

/** Resolve the absolute path of a CLI binary. Uses `which` on Unix. */
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

/** Check which ganita-kit binaries are available. */
export function detectBinaries(): Map<BinaryName, string> {
    const found = new Map<BinaryName, string>();
    for (const name of BINARIES) {
        const result = resolveBinary(name);
        if (result.ok) found.set(name, result.value);
    }
    return found;
}

let binaryCache: Map<BinaryName, string> | null = null;

/** Get available binaries, cached after first call. */
export function getAvailableBinaries(): Map<BinaryName, string> {
    if (binaryCache === null) {
        binaryCache = detectBinaries();
    }
    return binaryCache;
}

/** Check if a specific binary is available. */
export function hasBinary(name: BinaryName): boolean {
    return getAvailableBinaries().has(name);
}

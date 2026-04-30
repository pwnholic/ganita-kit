import { execSync } from "node:child_process";
import type { Result } from "../types/result.js";

/** Binary names used by ganita-kit. */
const BINARIES = ["tldr", "webclaw", "bloks", "fastedit"] as const;

export type BinaryName = (typeof BINARIES)[number];

/**
 * Resolve the absolute path of a CLI binary.
 *
 * Uses `which` on Unix systems. Returns a typed Result so callers
 * can decide how to handle missing binaries.
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
 * Check which ganita-kit binaries are available on this system.
 * Returns a map of binary name → absolute path for those found.
 */
export function detectBinaries(): Map<BinaryName, string> {
    const found = new Map<BinaryName, string>();
    for (const name of BINARIES) {
        const result = resolveBinary(name);
        if (result.ok) {
            found.set(name, result.value);
        }
    }
    return found;
}

/** Cache the result of detectBinaries() for the process lifetime. */
let cached: Map<BinaryName, string> | null = null;

/**
 * Get available binaries, caching after first call.
 * Safe to call repeatedly — returns the same map instance.
 */
export function getAvailableBinaries(): Map<BinaryName, string> {
    if (cached === null) {
        cached = detectBinaries();
    }
    return cached;
}

/**
 * Check if a specific binary is available.
 */
export function hasBinary(name: BinaryName): boolean {
    return getAvailableBinaries().has(name);
}

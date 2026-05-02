import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "../config/loader.js";

/**
 * Shared helpers for CLI tool wrappers.
 *
 * Every CLI tool file (tldr, webclaw, bloks, fastedit) uses the same
 * output limit and truncation logic. This file is the single source of truth.
 */

/** Get the configured max CLI output before truncation. */
export function getMaxOutput(): number {
    return loadConfig().cli.maxOutputChars ?? 50_000;
}

/**
 * Truncates large CLI output to stay within token budgets.
 * @param text - Raw CLI stdout.
 * @param max - Maximum character count.
 * @returns Original text or truncated text with a suffix notice.
 */
export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const excess = text.length - max;
    return `${text.slice(0, max)}\n\n... [${excess} characters truncated]`;
}

/** Shared tool result shape for all CLI tools. */
export type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
    isError?: boolean;
};

/**
 * Execute a CLI binary via pi.exec() with shared error handling.
 * Handles killed processes, non-zero exit codes, and output truncation.
 * @param pi - The Pi extension API.
 * @param binary - CLI binary name (tldr, webclaw, bloks, fastedit).
 * @param args - Arguments to pass to the binary.
 * @param signal - AbortSignal from the tool execution.
 * @param timeout - Timeout in ms.
 * @returns ToolResult with stdout or error message.
 */
export async function execCli(
    pi: ExtensionAPI,
    binary: string,
    args: string[],
    signal: AbortSignal | undefined,
    timeout: number,
): Promise<ToolResult> {
    const result = await pi.exec(binary, args, {
        ...(signal ? { signal } : {}),
        timeout,
    });

    if (result.killed) {
        return {
            content: [{ type: "text", text: "Operation cancelled." }],
            details: {},
        };
    }

    if (result.code !== 0) {
        return {
            content: [
                {
                    type: "text",
                    text: `${binary} error (exit ${result.code}): ${result.stderr || result.stdout}`,
                },
            ],
            details: {},
            isError: true,
        };
    }

    return {
        content: [{ type: "text", text: truncate(result.stdout, getMaxOutput()) }],
        details: {},
    };
}

/**
 * Post-edit diagnostics hook.
 *
 * Runs `tldr diagnostics` on files after they are edited via edit, write,
 * or fast_edit tools. Injects type errors and lint issues as additional
 * context so the LLM gets immediate feedback without waiting for tests.
 *
 * Falls through silently if tldr is not installed or diagnostics fail.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hasBinary } from "../config/runtime.js";

const EDIT_TOOLS = new Set(["edit", "write", "fast_edit", "fast_batch_edit", "fast_multi_edit"]);

const ENABLED_EXTENSIONS = new Set([
    ".py",
    ".pyx",
    ".pyi",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".rs",
]);

function extractFilePath(params: Record<string, unknown>): string | null {
    const fp = params["file_path"] ?? params["path"];
    if (typeof fp === "string") return fp;
    const f = params["file"];
    if (typeof f === "string") return f;
    return null;
}

// Handler signature must match ExtensionHandler<ToolResultEvent, ToolResultEventResult>.
// ToolResultEvent is a discriminated union with specific toolName literals.
// We cast to access toolName/input generically across all variants.
type AnyToolResultEvent = {
    toolName: string;
    toolCallId: string;
    input: Record<string, unknown>;
    isError: boolean;
};

export function register(pi: ExtensionAPI): void {
    if (!hasBinary("tldr")) return;

    pi.on(
        "tool_result" as never,
        async (
            event: unknown,
            _ctx: unknown,
        ): Promise<{ additionalContext?: string } | undefined> => {
            const e = event as AnyToolResultEvent;
            if (!EDIT_TOOLS.has(e.toolName)) return undefined;
            if (e.isError) return undefined;

            const filePath = extractFilePath(e.input);
            if (!filePath) return undefined;

            const ext = filePath.lastIndexOf(".");
            if (ext === -1) return undefined;
            if (!ENABLED_EXTENSIONS.has(filePath.slice(ext))) return undefined;

            try {
                const result = await pi.exec(
                    "tldr",
                    ["diagnostics", filePath, "--format", "json"],
                    {
                        timeout: 15_000,
                    },
                );

                if (result.code !== 0 || !result.stdout.trim()) return undefined;

                const diag = JSON.parse(result.stdout) as {
                    summary?: { type_errors?: number; lint_errors?: number; lint_issues?: number };
                    type_errors?: number;
                    lint_errors?: number;
                    lint_issues?: number;
                    errors?: Array<{
                        file?: string;
                        line?: number;
                        column?: number;
                        message?: string;
                    }>;
                };

                const summary = diag.summary ?? diag;
                const typeErrors = summary.type_errors ?? 0;
                const lintIssues = summary.lint_errors ?? summary.lint_issues ?? 0;

                if (typeErrors === 0 && lintIssues === 0) return undefined;

                const lines = [`Diagnostics: ${typeErrors} type errors, ${lintIssues} lint issues`];
                const errors = diag.errors ?? [];
                for (const err of errors.slice(0, 5)) {
                    const file = err.file?.split("/").pop() ?? filePath.split("/").pop();
                    const loc = err.column
                        ? `${file}:${err.line}:${err.column}`
                        : `${file}:${err.line}`;
                    lines.push(`  - ${loc}: ${err.message}`);
                }
                if (errors.length > 5) lines.push(`  ... and ${errors.length - 5} more`);

                return {
                    additionalContext: lines.join("\n"),
                };
            } catch {
                return undefined;
            }
        },
    );
}

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "../config/loader.js";
import { execCli, type ToolResult } from "../shared/cli.js";

function getDefaultTimeout(): number {
    return loadConfig().cli.fasteditTimeoutMs ?? 30_000;
}
function getModelTimeout(): number {
    return loadConfig().cli.fasteditModelTimeoutMs ?? 120_000;
}
function getPullTimeout(): number {
    return loadConfig().cli.fasteditPullTimeoutMs ?? 600_000;
}

/** Default inference backend. MLX is the primary backend for Apple Silicon. */
const DEFAULT_BACKEND = "mlx";

/** Default model name used by `fastedit pull`. */
const DEFAULT_MODEL = "fastedit-1.7b-mlx-8bit";

let piRef: ExtensionAPI | null = null;

/** Backend options shared by edit, batch-edit, and multi-edit. */
type BackendParams = {
    backend?: string;
    model_path?: string;
    api_base?: string;
    api_model?: string;
};

/** Resolves backend params with defaults and env var overrides. */
function resolveBackendParams(params: BackendParams): Required<BackendParams> {
    return {
        backend: params.backend ?? DEFAULT_BACKEND,

        model_path: params.model_path ?? process.env["FASTEDIT_MODEL_PATH"] ?? DEFAULT_MODEL,

        api_base: params.api_base ?? process.env["FASTEDIT_API_BASE"] ?? "",

        api_model: params.api_model ?? process.env["FASTEDIT_API_MODEL"] ?? "",
    };
}

/** Pushes backend/model flags to the args array. */
function pushBackendArgs(args: string[], resolved: Required<BackendParams>): void {
    args.push("--backend", resolved.backend);
    args.push("--model-path", resolved.model_path);
    if (resolved.api_base) {
        args.push("--api-base", resolved.api_base);
    }
    if (resolved.api_model) {
        args.push("--api-model", resolved.api_model);
    }
}

/**
 * Registers fastedit CLI tools with the Pi extension system.
 * Fastedit provides AST-aware code editing by symbol name.
 * @param pi - The Pi extension API.
 */
export function register(pi: ExtensionAPI): void {
    piRef = pi;

    function execFastedit(
        args: string[],
        signal: AbortSignal | undefined,
        timeout?: number,
    ): Promise<ToolResult> {
        const pi = piRef;
        if (!pi) throw new Error("register() must be called before executing fastedit tools");
        return execCli(pi, "fastedit", args, signal, timeout ?? getDefaultTimeout());
    }

    // =====================================================
    // Reading & searching
    // =====================================================
    // =====================================================
    // Reading & searching
    // =====================================================

    // --- fast_read ---
    pi.registerTool({
        name: "fast_read",
        label: "Fast Read",
        description:
            "Show file structure — functions, classes, and their line ranges. " +
            "AST-based, accurate across 13 languages. " +
            "Use before editing to identify symbol names and their boundaries.",
        promptSnippet: "Show file structure (functions, classes, line ranges)",
        promptGuidelines: [
            "Use fast_read before fast_edit to learn the symbol names in a file.",
            "fast_read is more precise than grep for finding function and class boundaries.",
        ],
        parameters: Type.Object({
            file: Type.String({ description: "File path to read" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execFastedit(["read", params.file], signal);
        },
    });

    // --- fast_search ---
    pi.registerTool({
        name: "fast_search",
        label: "Fast Search",
        description:
            "Search for symbols and functions across a codebase. " +
            "Supports multiple search modes: semantic, regex, hybrid, and references.",
        promptSnippet: "Search for symbols in a codebase",
        promptGuidelines: [
            "Use fast_search to find where a symbol is defined before editing or renaming.",
        ],
        parameters: Type.Object({
            query: Type.String({
                description: "Search query or symbol name",
            }),
            path: Type.Optional(
                Type.String({
                    description: "Directory to search. Default: current dir",
                }),
            ),
            mode: Type.Optional(
                StringEnum(["search", "regex", "hybrid", "references"], {
                    description: "Search mode. Default: search",
                }),
            ),
            top_k: Type.Optional(Type.Number({ description: "Max results. Default: 10" })),
            regex_filter: Type.Optional(
                Type.String({ description: "Regex filter for hybrid mode" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["search"];

            if (params.mode) {
                args.push("--mode", params.mode);
            }
            if (params.top_k !== undefined) {
                args.push("--top-k", String(params.top_k));
            }
            if (params.regex_filter) {
                args.push("--regex-filter", params.regex_filter);
            }

            args.push(params.query);
            if (params.path) {
                args.push(params.path);
            }

            return execFastedit(args, signal);
        },
    });

    // --- fast_diff ---
    pi.registerTool({
        name: "fast_diff",
        label: "Fast Diff",
        description:
            "Show diff between the last backup and current file. Use to preview changes " +
            "before committing or to verify an edit was applied correctly.",
        promptSnippet: "Show diff between last backup and current file",
        promptGuidelines: ["Use fast_diff to review changes made by fast_edit before committing."],
        parameters: Type.Object({
            file: Type.String({ description: "File path to diff" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execFastedit(["diff", params.file], signal);
        },
    });

    // =====================================================
    // Editing
    // =====================================================

    // --- fast_edit ---
    pi.registerTool({
        name: "fast_edit",
        label: "Fast Edit",
        description:
            "AST-aware code edit targeting a named symbol. Uses tree-sitter to locate the " +
            "function/class, then either splices changes deterministically (74% of edits, 0 tokens) " +
            "or uses a 1.7B merge model. Supports 13 languages.",
        promptSnippet: "Edit a function or class by name",
        promptGuidelines: [
            "Use fast_edit instead of the built-in Edit tool for code files (.py, .ts, .rs, .go, etc.).",
            "Use 'replace' for modifying existing functions, 'after' for inserting new code after a symbol.",
            "Always fast_read first to learn the exact symbol names before editing.",
        ],
        parameters: Type.Object({
            file: Type.String({ description: "File path to edit" }),
            replace: Type.Optional(Type.String({ description: "Symbol name to replace" })),
            after: Type.Optional(
                Type.String({ description: "Symbol name to insert new code after" }),
            ),
            snippet: Type.String({
                description: "Code snippet to apply. Use #... or //... for lines to preserve.",
            }),
            backend: Type.Optional(
                StringEnum(["mlx", "vllm"], { description: "Inference backend" }),
            ),
            model_path: Type.Optional(
                Type.String({
                    description: "MLX model path (overrides FASTEDIT_MODEL_PATH)",
                }),
            ),
            api_base: Type.Optional(Type.String({ description: "vLLM API base URL" })),
            api_model: Type.Optional(Type.String({ description: "vLLM model name" })),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["edit", params.file];

            if (params.replace) {
                args.push("--replace", params.replace);
            } else if (params.after) {
                args.push("--after", params.after);
            }

            args.push("--snippet", params.snippet);

            pushBackendArgs(args, resolveBackendParams(params));

            return execFastedit(args, signal, getModelTimeout());
        },
    });

    // --- fast_batch_edit ---
    pi.registerTool({
        name: "fast_batch_edit",
        label: "Fast Batch Edit",
        description:
            "Apply multiple edits to a single file in one operation. More efficient than " +
            "calling fast_edit multiple times for the same file.",
        promptSnippet: "Apply multiple edits to one file",
        promptGuidelines: [
            "Use fast_batch_edit when you need to make several changes to the same file.",
        ],
        parameters: Type.Object({
            file: Type.String({ description: "File path to edit" }),
            edits: Type.String({
                description:
                    'JSON array of edits. Each: {"snippet": "...", "after": "sym"} or {"snippet": "...", "replace": "sym"}',
            }),
            backend: Type.Optional(StringEnum(["mlx", "vllm"])),
            model_path: Type.Optional(Type.String({ description: "MLX model path" })),
            api_base: Type.Optional(Type.String({ description: "vLLM API base URL" })),
            api_model: Type.Optional(Type.String({ description: "vLLM model name" })),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["batch-edit", params.file, "--edits", params.edits];

            pushBackendArgs(args, resolveBackendParams(params));

            return execFastedit(args, signal, getModelTimeout());
        },
    });

    // --- fast_multi_edit ---
    pi.registerTool({
        name: "fast_multi_edit",
        label: "Fast Multi Edit",
        description:
            "Apply edits across multiple files in one operation. More efficient than " +
            "calling fast_edit multiple times across different files.",
        promptSnippet: "Apply edits across multiple files",
        promptGuidelines: [
            "Use fast_multi_edit when you need to make changes across several files at once.",
        ],
        parameters: Type.Object({
            file_edits: Type.String({
                description:
                    'JSON array. Each: {"file_path": "...", "edits": [{"snippet": "...", "replace": "sym"}]}',
            }),
            backend: Type.Optional(StringEnum(["mlx", "vllm"])),
            model_path: Type.Optional(Type.String({ description: "MLX model path" })),
            api_base: Type.Optional(Type.String({ description: "vLLM API base URL" })),
            api_model: Type.Optional(Type.String({ description: "vLLM model name" })),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["multi-edit", "--file-edits", params.file_edits];

            pushBackendArgs(args, resolveBackendParams(params));

            return execFastedit(args, signal, getModelTimeout());
        },
    });

    // =====================================================
    // Symbol operations
    // =====================================================

    // --- fast_delete ---
    pi.registerTool({
        name: "fast_delete",
        label: "Fast Delete",
        description:
            "Delete a function, class, or method by name. Includes a safety check " +
            "that refuses if the symbol has cross-file callers.",
        promptSnippet: "Delete a function or class by name",
        promptGuidelines: [
            "Use fast_delete to remove unused symbols. The tool checks for callers first.",
        ],
        parameters: Type.Object({
            file: Type.String({ description: "File path" }),
            symbol: Type.String({
                description: "Symbol name to delete (e.g. 'my_func' or 'MyClass.method')",
            }),
        }),
        async execute(_toolCallId, params, signal) {
            return execFastedit(["delete", params.file, params.symbol], signal);
        },
    });

    // --- fast_move ---
    pi.registerTool({
        name: "fast_move",
        label: "Fast Move",
        description:
            "Move a symbol to a new position within the same file, after another symbol. " +
            "Useful for reorganizing code.",
        promptSnippet: "Move a symbol within a file",
        promptGuidelines: [
            "Use fast_move to reorganize code by moving a function or class after another symbol in the same file.",
            "This is a structural move — the symbol is extracted and reinserted, preserving its full body.",
        ],
        parameters: Type.Object({
            file: Type.String({ description: "File path" }),
            symbol: Type.String({ description: "Symbol name to move" }),
            after: Type.String({ description: "Move after this symbol name" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execFastedit(
                ["move", params.file, params.symbol, "--after", params.after],
                signal,
            );
        },
    });

    // --- fast_rename ---
    pi.registerTool({
        name: "fast_rename",
        label: "Fast Rename",
        description:
            "Rename a symbol in a single file with AST verification. " +
            "Skips matches in strings, comments, and docstrings.",
        promptSnippet: "Rename a symbol in a file",
        promptGuidelines: [
            "Use fast_rename to rename a function, class, or variable across a single file with AST verification.",
            "Unlike find-and-replace, this skips matches in strings, comments, and docstrings for safety.",
            "For cross-file renaming, use fast_rename on each file that references the symbol.",
        ],
        parameters: Type.Object({
            file: Type.String({ description: "File path" }),
            old_name: Type.String({ description: "Current symbol name" }),
            new_name: Type.String({ description: "New symbol name" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execFastedit(["rename", params.file, params.old_name, params.new_name], signal);
        },
    });

    // =====================================================
    // Undo & model management
    // =====================================================

    // --- fast_undo ---
    pi.registerTool({
        name: "fast_undo",
        label: "Fast Undo",
        description:
            "Revert the last edit applied to a file by fastedit. " +
            "Restores the file to its state before the most recent edit operation.",
        promptSnippet: "Undo the last fastedit operation on a file",
        promptGuidelines: [
            "Use fast_undo to revert changes made by fast_edit, fast_batch_edit, or fast_multi_edit.",
            "Only reverts the most recent edit per file. Use fast_diff first to review what will be undone.",
        ],
        parameters: Type.Object({
            file: Type.String({ description: "File path to undo last edit" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execFastedit(["undo", params.file], signal);
        },
    });

    // --- fast_pull ---
    pi.registerTool({
        name: "fast_pull",
        label: "Fast Pull Model",
        description:
            "Pull the merge model from HuggingFace (~3GB). Required for complex edits " +
            "that cannot be resolved deterministically. Run once to download, then " +
            "fastedit uses it automatically when needed.",
        promptSnippet: "Download the fastedit merge model",
        promptGuidelines: [
            "Run fast_pull once to download the model. After that, fastedit uses it automatically.",
        ],
        parameters: Type.Object({
            model: Type.Optional(
                Type.String({
                    description: "Model name. Default: fastedit-1.7b-mlx-8bit",
                }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["pull"];

            if (params.model) {
                args.push("--model", params.model);
            }

            return execFastedit(args, signal, getPullTimeout());
        },
    });
}

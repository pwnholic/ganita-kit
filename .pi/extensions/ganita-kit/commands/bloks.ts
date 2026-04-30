import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

/** Maximum CLI output before truncation. */
const MAX_OUTPUT = 50_000;

/** Default timeout for bloks operations in milliseconds. */
const DEFAULT_TIMEOUT = 60_000;

/** Timeout for indexing operations (download + analysis) in milliseconds. */
const ADD_TIMEOUT = 120_000;

/** Shared tool result shape. */
type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
    isError?: boolean;
};

/**
 * Truncates large CLI output to stay within token budgets.
 * @param text - Raw CLI stdout.
 * @param max - Maximum character count.
 * @returns Truncated text with suffix notice when truncated.
 */
function truncate(text: string, max: number = MAX_OUTPUT): string {
    if (text.length <= max) return text;
    const excess = text.length - max;
    return `${text.slice(0, max)}\n\n... [${excess} characters truncated]`;
}

/**
 * Registers bloks CLI tools with the Pi extension system.
 * Bloks provides library knowledge management — indexing, searching,
 * and generating structured context for LLM consumption.
 * @param pi - The Pi extension API.
 */
export function register(pi: ExtensionAPI): void {
    async function execBloks(
        args: string[],
        signal: AbortSignal | undefined,
        timeout: number = DEFAULT_TIMEOUT,
    ): Promise<ToolResult> {
        const result = await pi.exec("bloks", args, {
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
                        text: `bloks error (exit ${result.code}): ${result.stderr || result.stdout}`,
                    },
                ],
                details: {},
                isError: true,
            };
        }

        return {
            content: [{ type: "text", text: truncate(result.stdout) }],
            details: {},
        };
    }

    // =====================================================
    // Indexing
    // =====================================================

    // --- bloks_add ---
    pi.registerTool({
        name: "bloks_add",
        label: "Bloks Add",
        description:
            "Index a library from npm, PyPI, or crates.io. Downloads and analyzes the source code, " +
            "extracts APIs via tldr AST analysis, scrapes documentation, and builds a searchable index.",
        promptSnippet: "Index a library for knowledge retrieval",
        promptGuidelines: [
            "Use bloks_add before using bloks_card or bloks_search for a library that hasn't been indexed yet.",
        ],
        parameters: Type.Object({
            names: Type.String({
                description: "Package name(s), space-separated (e.g. 'react react-dom')",
            }),
            registry: Type.Optional(
                StringEnum(["npm", "pypi", "crates"], {
                    description: "Registry to use. Default: auto-detect",
                }),
            ),
            docs: Type.Optional(
                Type.String({
                    description: "Documentation URL override (e.g. https://supabase.com/docs)",
                }),
            ),
            force: Type.Optional(
                Type.Boolean({ description: "Force re-index even if already exists" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["add", ...params.names.split(" "), "--format", "json"];

            if (params.registry) {
                args.push("--registry", params.registry);
            }
            if (params.docs) {
                args.push("--docs", params.docs);
            }
            if (params.force) {
                args.push("--force");
            }

            return execBloks(args, signal, ADD_TIMEOUT);
        },
    });

    // --- bloks_add_local ---
    pi.registerTool({
        name: "bloks_add_local",
        label: "Bloks Add Local",
        description:
            "Index a local directory as a library. Useful for private packages, monorepo internals, " +
            "or code that isn't published to a package registry.",
        promptSnippet: "Index a local directory as a library",
        parameters: Type.Object({
            path: Type.String({ description: "Local directory path to index" }),
            name: Type.String({ description: "Name to assign to this library" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execBloks(
                ["add-local", params.path, "--name", params.name, "--format", "json"],
                signal,
                ADD_TIMEOUT,
            );
        },
    });

    // --- bloks_remove ---
    pi.registerTool({
        name: "bloks_remove",
        label: "Bloks Remove",
        description: "Remove a library and all its data from the bloks index.",
        promptSnippet: "Remove an indexed library",
        parameters: Type.Object({
            library: Type.String({ description: "Library name to remove" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execBloks(["remove", params.library, "--format", "json"], signal);
        },
    });

    // --- bloks_refresh ---
    pi.registerTool({
        name: "bloks_refresh",
        label: "Bloks Refresh",
        description:
            "Re-index libraries. Checks for new versions and updates the index if needed. " +
            "Use --stale to only refresh libraries with version drift.",
        promptSnippet: "Refresh indexed libraries",
        parameters: Type.Object({
            library: Type.Optional(
                Type.String({ description: "Specific library to refresh (omit for all)" }),
            ),
            stale: Type.Optional(
                Type.Boolean({ description: "Only refresh libraries with version drift" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["refresh", "--format", "json"];

            if (params.library) {
                args.push(params.library);
            }
            if (params.stale) {
                args.push("--stale");
            }

            return execBloks(args, signal, ADD_TIMEOUT);
        },
    });

    // --- bloks_reindex ---
    pi.registerTool({
        name: "bloks_reindex",
        label: "Bloks Reindex",
        description:
            "Rebuild the search index from card files. Use after manually editing card files " +
            "or if search results seem incomplete.",
        promptSnippet: "Rebuild search index",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, signal) {
            return execBloks(["reindex", "--format", "json"], signal);
        },
    });

    // --- bloks_index_url ---
    pi.registerTool({
        name: "bloks_index_url",
        label: "Bloks Index URL",
        description:
            "Index specific URL(s) into a library's docs. For agent-assisted discovery " +
            "of documentation pages that aren't automatically scraped.",
        promptSnippet: "Index documentation URLs for a library",
        parameters: Type.Object({
            library: Type.String({ description: "Library name" }),
            urls: Type.Array(Type.String(), { description: "Documentation URL(s) to index" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execBloks(
                ["index-url", params.library, ...params.urls, "--format", "json"],
                signal,
                ADD_TIMEOUT,
            );
        },
    });

    // =====================================================
    // Querying
    // =====================================================

    // --- bloks_card ---
    pi.registerTool({
        name: "bloks_card",
        label: "Bloks Card",
        description:
            "Show a library's API surface. Without a symbol, shows the deck overview. " +
            "With a symbol, shows the symbol card (signature, docs, related APIs).",
        promptSnippet: "Show library API surface or specific symbol",
        promptGuidelines: [
            "Without a symbol name, shows a compact overview of all modules.",
            "With a symbol name, shows the symbol's signature, docs, and related APIs.",
        ],
        parameters: Type.Object({
            library: Type.String({ description: "Library name (e.g., 'react', 'hono')" }),
            symbol: Type.Optional(
                Type.String({
                    description: "Symbol name (e.g., 'useState'). Omit for deck overview.",
                }),
            ),
            module: Type.Optional(
                Type.String({ description: "Filter to a specific module/package" }),
            ),
            level: Type.Optional(
                StringEnum(["compact", "default", "docs", "full"], {
                    description: "Output verbosity level. Default: default",
                }),
            ),
            all: Type.Optional(
                Type.Boolean({
                    description: "Show all APIs including internal (default: public only)",
                }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["card", params.library];

            if (params.symbol) {
                args.push("--symbol", params.symbol);
            }
            if (params.module) {
                args.push("--module", params.module);
            }
            if (params.level) {
                args.push("--level", params.level);
            }
            if (params.all) {
                args.push("--all");
            }

            args.push("--format", "json");

            return execBloks(args, signal);
        },
    });

    // --- bloks_deck ---
    pi.registerTool({
        name: "bloks_deck",
        label: "Bloks Deck",
        description:
            "Show deck index — compact overview of all modules in a library. " +
            "Use for a quick overview before diving into specific APIs.",
        promptSnippet: "Show deck overview for a library",
        parameters: Type.Object({
            library: Type.String({ description: "Library name" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execBloks(["deck", params.library, "--format", "json"], signal);
        },
    });

    // --- bloks_modules ---
    pi.registerTool({
        name: "bloks_modules",
        label: "Bloks Modules",
        description: "List available modules/packages within an indexed library.",
        promptSnippet: "List modules in an indexed library",
        parameters: Type.Object({
            library: Type.String({ description: "Library name" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execBloks(["modules", params.library, "--format", "json"], signal);
        },
    });

    // --- bloks_search ---
    pi.registerTool({
        name: "bloks_search",
        label: "Bloks Search",
        description:
            "Search across all indexed library documentation and APIs. " +
            "Supports multi-word queries and filtering by library, path, or content kind.",
        promptSnippet: "Search indexed library documentation and APIs",
        parameters: Type.Object({
            query: Type.String({ description: "Search query (e.g., 'middleware auth')" }),
            library: Type.Optional(Type.String({ description: "Filter to a specific library" })),
            kind: Type.Optional(StringEnum(["api", "doc", "example"])),
            path: Type.Optional(Type.String({ description: "Filter by file path substring" })),
            limit: Type.Optional(Type.Number({ description: "Max results. Default: 10" })),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["search", params.query, "--format", "json"];

            if (params.library) {
                args.push("--lib", params.library);
            }
            if (params.kind) {
                args.push("--kind", params.kind);
            }
            if (params.path) {
                args.push("--path", params.path);
            }
            if (params.limit !== undefined) {
                args.push("--limit", String(params.limit));
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_recipe ---
    pi.registerTool({
        name: "bloks_recipe",
        label: "Bloks Recipe",
        description:
            "Compose docs, APIs, and user recipes around a set of keywords. " +
            "Generates a multi-API context block combining knowledge from indexed libraries.",
        promptSnippet: "Compose multi-library context around keywords",
        parameters: Type.Object({
            library: Type.String({ description: "Primary library name" }),
            keywords: Type.Array(Type.String(), {
                description: "Keywords to compose around (e.g., ['auth', 'jwt'])",
            }),
            limit: Type.Optional(
                Type.Number({ description: "Max results per section. Default: 5" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["recipe", params.library, ...params.keywords, "--format", "json"];

            if (params.limit !== undefined) {
                args.push("--limit", String(params.limit));
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_context ---
    pi.registerTool({
        name: "bloks_context",
        label: "Bloks Context",
        description:
            "Generate a compact context block for a project. Reads package manifests, " +
            "cross-references with the bloks index, and emits a dependency overview with matching rules.",
        promptSnippet: "Generate dependency context for a project",
        parameters: Type.Object({
            path: Type.Optional(
                Type.String({ description: "Project directory. Default: current dir" }),
            ),
            budget: Type.Optional(Type.Number({ description: "Max output lines. Default: 200" })),
            project: Type.Optional(
                Type.String({ description: "Project name for card filtering (default: inferred)" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["context", params.path ?? ".", "--format", "json"];

            if (params.budget !== undefined) {
                args.push("--budget", String(params.budget));
            }
            if (params.project) {
                args.push("--project", params.project);
            }

            return execBloks(args, signal);
        },
    });

    // =====================================================
    // User knowledge
    // =====================================================

    // --- bloks_learn ---
    pi.registerTool({
        name: "bloks_learn",
        label: "Bloks Learn",
        description:
            "Store a note or correction as a user card for a library. " +
            "Cards surface automatically alongside API context.",
        promptSnippet: "Store a note or correction about a library",
        parameters: Type.Object({
            library: Type.String({ description: "Library name" }),
            note: Type.String({ description: "The note, correction, or rule to store" }),
            kind: Type.Optional(
                StringEnum(["fact", "rule", "pattern", "correction", "note"], {
                    description: "Card kind. Default: correction",
                }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["learn", params.library, params.note, "--format", "json"];

            if (params.kind) {
                args.push("--kind", params.kind);
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_new ---
    pi.registerTool({
        name: "bloks_new",
        label: "Bloks New Card",
        description:
            "Create a new user card with explicit kind, title, and optional tags or file import. " +
            "More control than bloks_learn for structured knowledge capture.",
        promptSnippet: "Create a structured user card",
        parameters: Type.Object({
            kind: StringEnum(
                [
                    "fact",
                    "rule",
                    "pattern",
                    "taste",
                    "decision",
                    "snippet",
                    "note",
                    "correction",
                    "recipe",
                ],
                { description: "Card kind" },
            ),
            title: Type.String({ description: "Card title / content" }),
            tags: Type.Optional(Type.String({ description: "Tags (comma-separated)" })),
            from: Type.Optional(Type.String({ description: "Import body from a file" })),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["new", params.kind, params.title, "--format", "json"];

            if (params.tags) {
                args.push("--tags", params.tags);
            }
            if (params.from) {
                args.push("--from", params.from);
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_cards ---
    pi.registerTool({
        name: "bloks_cards",
        label: "Bloks Cards",
        description:
            "List user cards optionally filtered by tag, kind, or library. " +
            "Use --history to show revision lineage for a specific card.",
        promptSnippet: "List user cards",
        parameters: Type.Object({
            tag: Type.Optional(Type.String({ description: "Filter by tag" })),
            kind: Type.Optional(
                Type.String({ description: "Filter by kind (fact, rule, pattern, etc.)" }),
            ),
            history: Type.Optional(
                Type.String({ description: "Show revision lineage for a card ID" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["cards", "--format", "json"];

            if (params.tag) {
                args.push("--tag", params.tag);
            }
            if (params.kind) {
                args.push("--kind", params.kind);
            }
            if (params.history) {
                args.push("--history", params.history);
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_report ---
    pi.registerTool({
        name: "bloks_report",
        label: "Bloks Report",
        description: "Report an error in a context blok. Helps improve future context generation.",
        promptSnippet: "Report an error in a context blok",
        parameters: Type.Object({
            library: Type.String({ description: "Library name" }),
            error_type: StringEnum(
                ["wrong_import", "deprecated_api", "missing_pattern", "wrong_syntax"],
                { description: "Error type" },
            ),
            description: Type.String({ description: "Description of the error" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execBloks(
                [
                    "report",
                    params.library,
                    params.error_type,
                    params.description,
                    "--format",
                    "json",
                ],
                signal,
            );
        },
    });

    // --- bloks_feedback ---
    pi.registerTool({
        name: "bloks_feedback",
        label: "Bloks Feedback",
        description: "Per-card feedback. Acknowledge cards as useful (ack) or not useful (nack).",
        promptSnippet: "Give feedback on user cards",
        parameters: Type.Object({
            ack: Type.Optional(
                Type.String({ description: "Comma-separated card IDs to acknowledge" }),
            ),
            nack: Type.Optional(
                Type.String({ description: "Comma-separated card IDs to mark as not useful" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["feedback", "--format", "json"];

            if (params.ack) {
                args.push("--ack", params.ack);
            }
            if (params.nack) {
                args.push("--nack", params.nack);
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_ack ---
    pi.registerTool({
        name: "bloks_ack",
        label: "Bloks Ack",
        description:
            "Acknowledge cards as useful. Improves future card relevance. " +
            "Supports per-card IDs or bulk session ack.",
        promptSnippet: "Acknowledge cards as useful",
        parameters: Type.Object({
            card_ids: Type.Optional(
                Type.Array(Type.String(), { description: "Card ID(s) to ack" }),
            ),
            session: Type.Optional(
                Type.String({ description: "Ack all cards viewed in this session" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["ack", "--format", "json"];

            if (params.card_ids && params.card_ids.length > 0) {
                args.push(...params.card_ids);
            }
            if (params.session) {
                args.push("--session", params.session);
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_nack ---
    pi.registerTool({
        name: "bloks_nack",
        label: "Bloks Nack",
        description: "Mark cards as not useful. Supports per-card IDs or bulk session nack.",
        promptSnippet: "Mark cards as not useful",
        parameters: Type.Object({
            card_ids: Type.Optional(
                Type.Array(Type.String(), { description: "Card ID(s) to nack" }),
            ),
            session: Type.Optional(
                Type.String({ description: "Nack all cards viewed in this session" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["nack", "--format", "json"];

            if (params.card_ids && params.card_ids.length > 0) {
                args.push(...params.card_ids);
            }
            if (params.session) {
                args.push("--session", params.session);
            }

            return execBloks(args, signal);
        },
    });

    // --- bloks_stats ---
    pi.registerTool({
        name: "bloks_stats",
        label: "Bloks Stats",
        description: "Show card effectiveness stats. See which cards are most useful.",
        promptSnippet: "Show card effectiveness stats",
        parameters: Type.Object({
            library: Type.Optional(Type.String({ description: "Filter to a specific library" })),
            limit: Type.Optional(Type.Number({ description: "Max results. Default: 20" })),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["stats", "--format", "json"];

            if (params.library) {
                args.push("--lib", params.library);
            }
            if (params.limit !== undefined) {
                args.push("--limit", String(params.limit));
            }

            return execBloks(args, signal);
        },
    });

    // =====================================================
    // Listing
    // =====================================================

    // --- bloks_list ---
    pi.registerTool({
        name: "bloks_list",
        label: "Bloks List",
        description: "List all indexed libraries with names, versions, and index status.",
        promptSnippet: "List all indexed libraries",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, signal) {
            return execBloks(["list", "--format", "json"], signal);
        },
    });

    // --- bloks_info ---
    pi.registerTool({
        name: "bloks_info",
        label: "Bloks Info",
        description:
            "Show detailed info for a library: version, modules, symbols, user cards, index freshness.",
        promptSnippet: "Show detailed info for an indexed library",
        parameters: Type.Object({
            library: Type.String({ description: "Library name" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execBloks(["info", params.library, "--format", "json"], signal);
        },
    });
}

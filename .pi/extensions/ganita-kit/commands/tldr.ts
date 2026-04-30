import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

/** Maximum CLI output before truncation. */
const MAX_OUTPUT = 50_000;

/** Default timeout for tldr operations in milliseconds. */
const DEFAULT_TIMEOUT = 60_000;

/** Timeout for full-project scans in milliseconds. */
const PROJECT_TIMEOUT = 120_000;

/** Shared tool result shape. */
type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
    isError?: boolean;
};

function truncate(text: string, max: number = MAX_OUTPUT): string {
    if (text.length <= max) return text;
    const excess = text.length - max;
    return `${text.slice(0, max)}\n\n... [${excess} characters truncated]`;
}

/**
 * Registers tldr CLI tools with the Pi extension system.
 * Tldr provides token-efficient code analysis across 18 languages —
 * AST structure, call graphs, dead code, security, quality metrics,
 * program slicing, and much more.
 * @param pi - The Pi extension API.
 */
/**
 * Pre-warm tldr call graph cache for a project directory.
 * Used by event.ts on session startup.
 * Non-critical — failures are returned but should not block anything.
 */
export async function warmCache(
    pi: ExtensionAPI,
    cwd: string,
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
    const result = await pi.exec("tldr", ["warm", cwd, "-f", "json", "-q"], {
        timeout: 30_000,
    });

    if (result.code !== 0) {
        return { ok: false, error: `tldr warm failed (exit ${result.code})` };
    }

    const output = result.stdout.trim();
    return { ok: true, output: output.length > 500 ? `${output.slice(0, 500)}...` : output };
}

export function register(pi: ExtensionAPI): void {
    async function execTldr(
        args: string[],
        signal: AbortSignal | undefined,
        timeout: number = DEFAULT_TIMEOUT,
    ): Promise<ToolResult> {
        const result = await pi.exec("tldr", args, {
            ...(signal ? { signal } : {}),
            timeout,
        });

        if (result.killed) {
            return { content: [{ type: "text", text: "Operation cancelled." }], details: {} };
        }

        if (result.code !== 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `tldr error (exit ${result.code}): ${result.stderr || result.stdout}`,
                    },
                ],
                details: {},
                isError: true,
            };
        }

        return { content: [{ type: "text", text: truncate(result.stdout) }], details: {} };
    }

    // =====================================================
    // L1 — AST Layer
    // =====================================================

    pi.registerTool({
        name: "tldr_tree",
        label: "Tldr Tree",
        description:
            "Visual file tree with symbol summaries per file. Quick overview of a project's layout.",
        promptSnippet: "Show project file tree with symbol summaries",
        parameters: Type.Object({
            path: Type.String({ description: "Directory to scan" }),
            ext: Type.Optional(
                Type.String({
                    description: "Filter by extensions (comma-separated, e.g. '.py,.ts')",
                }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["tree", params.path, "-f", "json"];
            if (params.ext) {
                for (const e of params.ext.split(",")) {
                    args.push("-e", e.trim());
                }
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_structure",
        label: "Tldr Structure",
        description:
            "Extract code structure — functions, classes, imports with line ranges and signatures. Supports 18 languages.",
        promptSnippet: "Show code structure (functions, classes, imports)",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory path to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["structure", params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_extract",
        label: "Tldr Extract",
        description:
            "Extract complete module info from a file — all symbols, their signatures, line ranges, and relationships.",
        promptSnippet: "Extract complete module info from a file",
        parameters: Type.Object({
            file: Type.String({ description: "File to extract" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["extract", params.file, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_imports",
        label: "Tldr Imports",
        description:
            "Parse import statements from a file. Shows what modules are imported and how.",
        promptSnippet: "Parse import statements from a file",
        parameters: Type.Object({
            file: Type.String({ description: "File to parse" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["imports", params.file, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_importers",
        label: "Tldr Importers",
        description: "Find files that import a given module. Reverse dependency lookup.",
        promptSnippet: "Find files that import a module",
        parameters: Type.Object({
            module: Type.String({ description: "Module name to search for" }),
            path: Type.String({ description: "Directory to search in" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["importers", params.module, params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_definition",
        label: "Tldr Definition",
        description:
            "Go-to-definition — find where a symbol is defined. Supports position-based and name-based lookup.",
        promptSnippet: "Find where a symbol is defined",
        parameters: Type.Object({
            file: Type.String({ description: "Source file" }),
            line: Type.Optional(Type.Number({ description: "Line number (1-indexed)" })),
            column: Type.Optional(Type.Number({ description: "Column number (0-indexed)" })),
            symbol: Type.Optional(
                Type.String({ description: "Symbol name to look up (alternative to position)" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["definition", "-f", "json"];
            if (params.symbol) {
                args.push("--name", params.symbol, params.file);
            } else {
                args.push(params.file, String(params.line ?? 1), String(params.column ?? 0));
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_references",
        label: "Tldr References",
        description: "Find all references to a symbol across the codebase.",
        promptSnippet: "Find all references to a symbol",
        parameters: Type.Object({
            symbol: Type.String({ description: "Symbol to find references for" }),
            path: Type.String({ description: "Directory to search in" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["references", params.symbol, params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_interface",
        label: "Tldr Interface",
        description:
            "Extract interface contracts — public API signatures and contracts for a module or directory.",
        promptSnippet: "Extract public API interface contracts",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["interface", params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_surface",
        label: "Tldr Surface",
        description: "Extract machine-readable API surface for a library/package or directory.",
        promptSnippet: "Extract API surface for a library",
        parameters: Type.Object({
            target: Type.String({ description: "Package name (e.g., 'json') or directory path" }),
            lookup: Type.Optional(
                Type.String({
                    description: "Lookup a specific API by qualified name (e.g., 'json.loads')",
                }),
            ),
            include_private: Type.Optional(
                Type.Boolean({ description: "Include private/internal APIs. Default: false" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["surface", params.target, "-f", "json"];
            if (params.lookup) {
                args.push("--lookup", params.lookup);
            }
            if (params.include_private) {
                args.push("--include-private");
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_inheritance",
        label: "Tldr Inheritance",
        description: "Extract class inheritance hierarchies. Shows parent/child relationships.",
        promptSnippet: "Show class inheritance hierarchies",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
            class_name: Type.Optional(Type.String({ description: "Filter to specific class" })),
        }),
        async execute(_id, params, signal) {
            const args = ["inheritance", params.path, "-f", "json"];
            if (params.class_name) {
                args.push("-c", params.class_name);
            }
            return execTldr(args, signal);
        },
    });

    // =====================================================
    // L2 — Call Graph Layer
    // =====================================================

    pi.registerTool({
        name: "tldr_calls",
        label: "Tldr Calls",
        description: "Build a cross-file call graph showing caller → callee relationships.",
        promptSnippet: "Show cross-file call graph",
        parameters: Type.Object({
            path: Type.String({ description: "Directory path to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["calls", params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_impact",
        label: "Tldr Impact",
        description:
            "Find all callers of a specific function (reverse call graph). Essential before refactoring.",
        promptSnippet: "Find who calls a function (impact analysis)",
        parameters: Type.Object({
            function_name: Type.String({ description: "Function name to analyze" }),
            path: Type.String({ description: "Directory path to search in" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["impact", params.function_name, params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_dead",
        label: "Tldr Dead Code",
        description: "Find dead (unreachable) code — functions defined but never called.",
        promptSnippet: "Find unreachable/dead code",
        parameters: Type.Object({ path: Type.String({ description: "Directory to scan" }) }),
        async execute(_id, params, signal) {
            return execTldr(["dead", params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_whatbreaks",
        label: "Tldr What Breaks",
        description: "Analyze what breaks if a target (function, file, module) is changed.",
        promptSnippet: "Analyze what breaks if a target changes",
        parameters: Type.Object({
            target: Type.String({ description: "Function name, file path, or module name" }),
            path: Type.String({ description: "Project root directory" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["whatbreaks", params.target, params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_change_impact",
        label: "Tldr Change Impact",
        description:
            "Find tests affected by code changes. Helps decide which tests to run after modifications.",
        promptSnippet: "Find tests affected by code changes",
        parameters: Type.Object({
            path: Type.String({ description: "Project root directory" }),
            files: Type.Optional(
                Type.String({ description: "Comma-separated list of changed files" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["change-impact", params.path, "-f", "json"];
            if (params.files) {
                args.push("-F", params.files);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_deps",
        label: "Tldr Dependencies",
        description: "Analyze module dependencies. Shows import relationships between modules.",
        promptSnippet: "Analyze module dependencies",
        parameters: Type.Object({
            path: Type.String({ description: "Directory to analyze" }),
            include_external: Type.Optional(
                Type.Boolean({ description: "Include external dependencies. Default: false" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["deps", params.path, "-f", "json"];
            if (params.include_external) {
                args.push("--include-external");
            }
            return execTldr(args, signal);
        },
    });

    // =====================================================
    // L3/L4/L5 — CFG / DFG / PDG Layer
    // =====================================================

    pi.registerTool({
        name: "tldr_reaching_defs",
        label: "Tldr Reaching Definitions",
        description:
            "Analyze reaching definitions for a function. Shows where variable values originate.",
        promptSnippet: "Analyze reaching definitions",
        parameters: Type.Object({
            file: Type.String({ description: "Source file" }),
            function_name: Type.String({ description: "Function to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(
                ["reaching-defs", params.file, params.function_name, "-f", "json"],
                signal,
            );
        },
    });

    pi.registerTool({
        name: "tldr_available",
        label: "Tldr Available Expressions",
        description:
            "Analyze available expressions for Common Subexpression Elimination (CSE) detection.",
        promptSnippet: "Analyze available expressions",
        parameters: Type.Object({
            file: Type.String({ description: "Source file" }),
            function_name: Type.String({ description: "Function to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["available", params.file, params.function_name, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_dead_stores",
        label: "Tldr Dead Stores",
        description:
            "Find dead stores using SSA-based analysis — variables written but never read.",
        promptSnippet: "Find dead stores in a function",
        parameters: Type.Object({
            file: Type.String({ description: "Source file" }),
            function_name: Type.String({ description: "Function to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(
                ["dead-stores", params.file, params.function_name, "-f", "json"],
                signal,
            );
        },
    });

    pi.registerTool({
        name: "tldr_slice",
        label: "Tldr Slice",
        description:
            "Compute a program slice — all statements that affect the value at a given line.",
        promptSnippet: "Compute program slice",
        parameters: Type.Object({
            file: Type.String({ description: "Source file path" }),
            function_name: Type.String({ description: "Function containing the line" }),
            line: Type.Number({ description: "Line number to slice from" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(
                ["slice", params.file, params.function_name, String(params.line), "-f", "json"],
                signal,
            );
        },
    });

    pi.registerTool({
        name: "tldr_chop",
        label: "Tldr Chop",
        description:
            "Compute chop slice — intersection of forward and backward slices between two lines.",
        promptSnippet: "Compute chop slice between two lines",
        parameters: Type.Object({
            file: Type.String({ description: "Source file" }),
            function_name: Type.String({ description: "Function containing both lines" }),
            source_line: Type.Number({ description: "Line to trace FROM" }),
            target_line: Type.Number({ description: "Line to trace TO" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(
                [
                    "chop",
                    params.file,
                    params.function_name,
                    String(params.source_line),
                    String(params.target_line),
                    "-f",
                    "json",
                ],
                signal,
            );
        },
    });

    // =====================================================
    // Search
    // =====================================================

    pi.registerTool({
        name: "tldr_search",
        label: "Tldr Search",
        description:
            "Search code with BM25 ranking enriched with structural context. Returns functions with signatures, callers, and callees.",
        promptSnippet: "Search code with structural context",
        parameters: Type.Object({
            query: Type.String({ description: "Search query" }),
            path: Type.String({ description: "Directory to search" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["search", params.query, params.path, "-f", "json"], signal);
        },
    });

    // =====================================================
    // Context
    // =====================================================

    pi.registerTool({
        name: "tldr_context",
        label: "Tldr Context",
        description:
            "Build LLM-ready context from an entry point. Traces the call graph and collects relevant code.",
        promptSnippet: "Build LLM-ready context from entry point",
        parameters: Type.Object({
            entry: Type.String({ description: "Entry point function name" }),
            path: Type.Optional(
                Type.String({ description: "Project root directory. Default: current" }),
            ),
            depth: Type.Optional(Type.Number({ description: "Maximum traversal depth" })),
        }),
        async execute(_id, params, signal) {
            const args = ["context", params.entry, "-f", "json"];
            if (params.path) {
                args.push("-p", params.path);
            }
            if (params.depth !== undefined) {
                args.push("-d", String(params.depth));
            }
            return execTldr(args, signal);
        },
    });

    // =====================================================
    // Quality & Metrics
    // =====================================================

    pi.registerTool({
        name: "tldr_smells",
        label: "Tldr Smells",
        description:
            "Detect code smells — long functions, deep nesting, god classes, feature envy, etc.",
        promptSnippet: "Detect code smells",
        parameters: Type.Object({
            path: Type.String({ description: "Path to analyze" }),
            threshold: Type.Optional(StringEnum(["strict", "default", "relaxed"])),
        }),
        async execute(_id, params, signal) {
            const args = ["smells", params.path, "-f", "json"];
            if (params.threshold) {
                args.push("-t", params.threshold);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_complexity",
        label: "Tldr Complexity",
        description: "Calculate cyclomatic complexity metrics for a specific function.",
        promptSnippet: "Calculate function complexity",
        parameters: Type.Object({
            file: Type.String({ description: "File containing the function" }),
            function_name: Type.String({ description: "Function to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(
                ["complexity", params.file, params.function_name, "-f", "json"],
                signal,
            );
        },
    });

    pi.registerTool({
        name: "tldr_cognitive",
        label: "Tldr Cognitive Complexity",
        description:
            "Calculate cognitive complexity for functions (SonarQube algorithm). Measures how hard code is to read.",
        promptSnippet: "Calculate cognitive complexity",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
            function_name: Type.Optional(
                Type.String({ description: "Specific function (all if omitted)" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["cognitive", params.path, "-f", "json"];
            if (params.function_name) {
                args.push("--function", params.function_name);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_halstead",
        label: "Tldr Halstead",
        description:
            "Calculate Halstead complexity metrics per function — volume, difficulty, effort.",
        promptSnippet: "Calculate Halstead metrics",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
            function_name: Type.Optional(
                Type.String({ description: "Specific function (all if omitted)" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["halstead", params.path, "-f", "json"];
            if (params.function_name) {
                args.push("--function", params.function_name);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_loc",
        label: "Tldr LOC",
        description: "Count lines of code with type breakdown — code, comments, blanks.",
        promptSnippet: "Count lines of code",
        parameters: Type.Object({
            path: Type.String({ description: "Directory or file to analyze" }),
            by_file: Type.Optional(
                Type.Boolean({ description: "Show per-file breakdown. Default: false" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["loc", params.path, "-f", "json"];
            if (params.by_file) {
                args.push("--by-file");
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_churn",
        label: "Tldr Churn",
        description:
            "Analyze git-based code churn — which files change most often and by how much.",
        promptSnippet: "Analyze git code churn",
        parameters: Type.Object({
            path: Type.String({ description: "Directory to analyze" }),
            days: Type.Optional(Type.Number({ description: "Days of git history. Default: 365" })),
        }),
        async execute(_id, params, signal) {
            const args = ["churn", params.path, "-f", "json"];
            if (params.days !== undefined) {
                args.push("--days", String(params.days));
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_debt",
        label: "Tldr Technical Debt",
        description: "Analyze technical debt using the SQALE method. Estimates effort to fix.",
        promptSnippet: "Analyze technical debt (SQALE)",
        parameters: Type.Object({
            path: Type.String({ description: "Path to analyze" }),
            category: Type.Optional(
                StringEnum([
                    "reliability",
                    "security",
                    "maintainability",
                    "efficiency",
                    "changeability",
                    "testability",
                ]),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["debt", params.path, "-f", "json"];
            if (params.category) {
                args.push("-c", params.category);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_health",
        label: "Tldr Health",
        description:
            "Comprehensive code health dashboard combining complexity, cohesion, dead code, and coupling.",
        promptSnippet: "Show code health dashboard",
        parameters: Type.Object({ path: Type.String({ description: "Directory to assess" }) }),
        async execute(_id, params, signal) {
            return execTldr(["health", params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_hubs",
        label: "Tldr Hubs",
        description:
            "Detect hub functions using centrality analysis. Shows functions with the most connections.",
        promptSnippet: "Find hub functions by centrality",
        parameters: Type.Object({
            path: Type.String({ description: "Project root directory" }),
            top: Type.Optional(Type.Number({ description: "Number of top hubs. Default: 10" })),
        }),
        async execute(_id, params, signal) {
            const args = ["hubs", params.path, "-f", "json"];
            if (params.top !== undefined) {
                args.push("--top", String(params.top));
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_patterns",
        label: "Tldr Patterns",
        description: "Detect design patterns and coding conventions used in the codebase.",
        promptSnippet: "Detect design patterns",
        parameters: Type.Object({
            path: Type.String({ description: "Path to analyze" }),
            category: Type.Optional(Type.String({ description: "Filter by pattern category" })),
        }),
        async execute(_id, params, signal) {
            const args = ["patterns", params.path, "-f", "json"];
            if (params.category) {
                args.push("-c", params.category);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_clones",
        label: "Tldr Clones",
        description: "Detect code clones (duplicated code) in a codebase.",
        promptSnippet: "Detect code clones",
        parameters: Type.Object({
            path: Type.String({ description: "Path to analyze" }),
            min_tokens: Type.Optional(
                Type.Number({ description: "Minimum tokens for a clone. Default: 25" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["clones", params.path, "-f", "json"];
            if (params.min_tokens !== undefined) {
                args.push("--min-tokens", String(params.min_tokens));
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_dice",
        label: "Tldr Dice (Similarity)",
        description: "Compare similarity between two code fragments using the Dice coefficient.",
        promptSnippet: "Compare similarity between two code fragments",
        parameters: Type.Object({
            target1: Type.String({
                description: "First target: file, file::function, or file:start:end",
            }),
            target2: Type.String({
                description: "Second target: file, file::function, or file:start:end",
            }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["dice", params.target1, params.target2, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_diff",
        label: "Tldr Diff",
        description:
            "AST-aware structural diff between two files. Compares code structure, not text.",
        promptSnippet: "AST-aware structural diff between two files",
        parameters: Type.Object({
            file_a: Type.String({ description: "First file to compare" }),
            file_b: Type.String({ description: "Second file to compare" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["diff", params.file_a, params.file_b, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_cohesion",
        label: "Tldr Cohesion",
        description:
            "Analyze class cohesion using the LCOM4 metric. Low cohesion suggests classes doing too much.",
        promptSnippet: "Analyze class cohesion (LCOM4)",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["cohesion", params.path, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_coupling",
        label: "Tldr Coupling",
        description:
            "Analyze coupling between modules/classes — afferent/efferent coupling and instability.",
        promptSnippet: "Analyze module coupling",
        parameters: Type.Object({
            path_a: Type.String({ description: "First module or directory" }),
            path_b: Type.Optional(
                Type.String({ description: "Second module (omit for project-wide scan)" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["coupling", params.path_a];
            if (params.path_b) {
                args.push(params.path_b);
            }
            args.push("-f", "json");
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_hotspots",
        label: "Tldr Hotspots",
        description:
            "Identify churn × complexity hotspots. Files that change often AND are complex are high risk.",
        promptSnippet: "Find churn × complexity hotspots",
        parameters: Type.Object({
            path: Type.String({ description: "Directory to analyze" }),
            days: Type.Optional(Type.Number({ description: "Days of git history. Default: 365" })),
        }),
        async execute(_id, params, signal) {
            const args = ["hotspots", params.path, "-f", "json"];
            if (params.days !== undefined) {
                args.push("--days", String(params.days));
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_coverage",
        label: "Tldr Coverage",
        description:
            "Parse coverage reports (Cobertura XML, LCOV, coverage.py JSON). Cross-reference with code structure.",
        promptSnippet: "Parse and analyze coverage report",
        parameters: Type.Object({
            report: Type.String({ description: "Path to coverage report file" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["coverage", params.report, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_todo",
        label: "Tldr Todo",
        description:
            "Aggregate improvement suggestions — dead code, complexity, cohesion, and similar code. " +
            "One-command overview of what to fix.",
        promptSnippet: "Show improvement suggestions",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
            quick: Type.Optional(
                Type.Boolean({ description: "Skip similar analysis for speed. Default: false" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["todo", params.path, "-f", "json"];
            if (params.quick) {
                args.push("--quick");
            }
            return execTldr(args, signal, PROJECT_TIMEOUT);
        },
    });

    // =====================================================
    // Security
    // =====================================================

    pi.registerTool({
        name: "tldr_taint",
        label: "Tldr Taint Analysis",
        description:
            "Analyze taint flows — trace data from sources (user input) to sinks (dangerous operations).",
        promptSnippet: "Trace taint flows for security",
        parameters: Type.Object({
            file: Type.String({ description: "Source file to analyze" }),
            function_name: Type.String({ description: "Function to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["taint", params.file, params.function_name, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_vuln",
        label: "Tldr Vulnerability Scan",
        description:
            "Vulnerability scanning via taint analysis — SQL injection, XSS, command injection, SSRF, path traversal, etc.",
        promptSnippet: "Scan for vulnerabilities",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to scan" }),
            severity: Type.Optional(StringEnum(["critical", "high", "medium", "low", "info"])),
            vuln_type: Type.Optional(
                StringEnum([
                    "sql_injection",
                    "xss",
                    "command_injection",
                    "ssrf",
                    "path_traversal",
                    "deserialization",
                    "unsafe_code",
                    "memory_safety",
                    "panic",
                    "xxe",
                    "open_redirect",
                    "ldap_injection",
                    "xpath_injection",
                ]),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["vuln", params.path, "-f", "json"];
            if (params.severity) {
                args.push("--severity", params.severity);
            }
            if (params.vuln_type) {
                args.push("--vuln-type", params.vuln_type);
            }
            return execTldr(args, signal, PROJECT_TIMEOUT);
        },
    });

    pi.registerTool({
        name: "tldr_secure",
        label: "Tldr Secure Dashboard",
        description:
            "Security analysis dashboard — taint, resources, bounds, contracts, behavioral, mutability. " +
            "Comprehensive security overview in one call.",
        promptSnippet: "Run full security analysis dashboard",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
            quick: Type.Optional(
                Type.Boolean({
                    description: "Quick mode: taint, resources, bounds only. Default: false",
                }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["secure", params.path, "-f", "json"];
            if (params.quick) {
                args.push("--quick");
            }
            return execTldr(args, signal, PROJECT_TIMEOUT);
        },
    });

    pi.registerTool({
        name: "tldr_api_check",
        label: "Tldr API Check",
        description:
            "Detect API misuse patterns — missing timeouts, bare except, weak crypto, unclosed files.",
        promptSnippet: "Detect API misuse patterns",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to check" }),
            category: Type.Optional(
                StringEnum([
                    "call-order",
                    "error-handling",
                    "parameters",
                    "resources",
                    "crypto",
                    "concurrency",
                    "security",
                ]),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["api-check", params.path, "-f", "json"];
            if (params.category) {
                args.push("--category", params.category);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_resources",
        label: "Tldr Resource Analysis",
        description: "Analyze resource lifecycle — leaks, double-close, use-after-close.",
        promptSnippet: "Analyze resource lifecycle",
        parameters: Type.Object({
            file: Type.String({ description: "Source file to analyze" }),
            function_name: Type.Optional(
                Type.String({ description: "Specific function (all if omitted)" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["resources", params.file];
            if (params.function_name) {
                args.push(params.function_name);
            }
            args.push("-f", "json");
            return execTldr(args, signal);
        },
    });

    // =====================================================
    // Contracts, Specs, Invariants
    // =====================================================

    pi.registerTool({
        name: "tldr_contracts",
        label: "Tldr Contracts",
        description:
            "Infer pre/postconditions from guard clauses, assertions, and isinstance checks.",
        promptSnippet: "Infer function contracts",
        parameters: Type.Object({
            file: Type.String({ description: "Source file" }),
            function_name: Type.String({ description: "Function to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["contracts", params.file, params.function_name, "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_specs",
        label: "Tldr Specs",
        description: "Extract behavioral specifications from pytest test files.",
        promptSnippet: "Extract specs from tests",
        parameters: Type.Object({
            from_tests: Type.String({ description: "Test file or directory to scan" }),
            function_name: Type.Optional(
                Type.String({ description: "Filter to specific function under test" }),
            ),
            source: Type.Optional(
                Type.String({ description: "Source directory for cross-referencing" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["specs", "--from-tests", params.from_tests, "-f", "json"];
            if (params.function_name) {
                args.push("--function", params.function_name);
            }
            if (params.source) {
                args.push("--source", params.source);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_invariants",
        label: "Tldr Invariants",
        description:
            "Infer invariants from test execution traces (Daikon-lite). Discovers likely program properties.",
        promptSnippet: "Infer invariants from test traces",
        parameters: Type.Object({
            file: Type.String({ description: "Source file containing functions" }),
            from_tests: Type.String({ description: "Test file or directory for tracing" }),
            function_name: Type.Optional(
                Type.String({ description: "Filter to specific function" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = [
                "invariants",
                "--from-tests",
                params.from_tests,
                params.file,
                "-f",
                "json",
            ];
            if (params.function_name) {
                args.push("--function", params.function_name);
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_temporal",
        label: "Tldr Temporal",
        description: "Mine temporal constraints — method call sequences that must happen in order.",
        promptSnippet: "Mine temporal call constraints",
        parameters: Type.Object({
            path: Type.String({ description: "Directory or file to analyze" }),
            min_support: Type.Optional(
                Type.Number({ description: "Minimum occurrences. Default: 2" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["temporal", params.path, "-f", "json"];
            if (params.min_support !== undefined) {
                args.push("--min-support", String(params.min_support));
            }
            return execTldr(args, signal);
        },
    });

    // =====================================================
    // Verification & Explanation
    // =====================================================

    pi.registerTool({
        name: "tldr_verify",
        label: "Tldr Verify",
        description:
            "Aggregated verification dashboard combining multiple analyses into a pass/fail report.",
        promptSnippet: "Run verification dashboard",
        parameters: Type.Object({
            path: Type.String({ description: "Directory to verify" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["verify", params.path, "-f", "json"], signal, PROJECT_TIMEOUT);
        },
    });

    pi.registerTool({
        name: "tldr_explain",
        label: "Tldr Explain",
        description:
            "Comprehensive function analysis — signature, purity, complexity, callers, callees. " +
            "Everything about a function in one call.",
        promptSnippet: "Explain a function in detail",
        parameters: Type.Object({
            file: Type.String({ description: "Source file" }),
            function_name: Type.String({ description: "Function to explain" }),
            depth: Type.Optional(
                Type.Number({ description: "Call graph depth for callers/callees" }),
            ),
        }),
        async execute(_id, params, signal) {
            const args = ["explain", params.file, params.function_name, "-f", "json"];
            if (params.depth !== undefined) {
                args.push("--depth", String(params.depth));
            }
            return execTldr(args, signal);
        },
    });

    pi.registerTool({
        name: "tldr_diagnostics",
        label: "Tldr Diagnostics",
        description: "Run type checking and linting on a project.",
        promptSnippet: "Run diagnostics (type check + lint)",
        parameters: Type.Object({
            path: Type.String({ description: "File or directory to analyze" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["diagnostics", params.path, "-f", "json"], signal, PROJECT_TIMEOUT);
        },
    });

    pi.registerTool({
        name: "tldr_fix",
        label: "Tldr Fix",
        description: "Diagnose and auto-fix errors from compiler/runtime output.",
        promptSnippet: "Diagnose and auto-fix errors",
        parameters: Type.Object({
            error_output: Type.String({
                description: "Compiler or runtime error output to diagnose",
            }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["fix", "diagnose", "-f", "json", "--", params.error_output], signal);
        },
    });

    pi.registerTool({
        name: "tldr_bugbot",
        label: "Tldr Bugbot",
        description:
            "Automated bug detection on uncommitted code changes. Finds regressions before commit.",
        promptSnippet: "Detect bugs in uncommitted changes",
        parameters: Type.Object({
            path: Type.String({ description: "Project root directory" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(
                ["bugbot", "check", params.path, "-f", "json"],
                signal,
                PROJECT_TIMEOUT,
            );
        },
    });

    // =====================================================
    // Infrastructure (daemon, cache)
    // =====================================================

    pi.registerTool({
        name: "tldr_warm",
        label: "Tldr Warm Cache",
        description:
            "Pre-warm call graph cache for faster subsequent queries. Run once before heavy analysis.",
        promptSnippet: "Pre-warm analysis cache",
        parameters: Type.Object({
            path: Type.String({ description: "Project root directory to warm" }),
        }),
        async execute(_id, params, signal) {
            return execTldr(["warm", params.path, "-f", "json"], signal, PROJECT_TIMEOUT);
        },
    });

    pi.registerTool({
        name: "tldr_cache_stats",
        label: "Tldr Cache Stats",
        description: "Show cache statistics — hit rate, size, and entries.",
        promptSnippet: "Show cache statistics",
        parameters: Type.Object({}),
        async execute(_id, _params, signal) {
            return execTldr(["cache", "stats", "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_cache_clear",
        label: "Tldr Cache Clear",
        description: "Clear all tldr cache files.",
        promptSnippet: "Clear analysis cache",
        parameters: Type.Object({}),
        async execute(_id, _params, signal) {
            return execTldr(["cache", "clear", "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_daemon_status",
        label: "Tldr Daemon Status",
        description: "Show tldr daemon status — running, uptime, and memory usage.",
        promptSnippet: "Check daemon status",
        parameters: Type.Object({}),
        async execute(_id, _params, signal) {
            return execTldr(["daemon", "status", "-f", "json"], signal);
        },
    });

    pi.registerTool({
        name: "tldr_stats",
        label: "Tldr Stats",
        description: "Show tldr usage statistics — command counts, analysis time breakdown.",
        promptSnippet: "Show tldr usage statistics",
        parameters: Type.Object({}),
        async execute(_id, _params, signal) {
            return execTldr(["stats", "-f", "json"], signal);
        },
    });
}

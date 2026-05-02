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
						text: `tldr error (exit ${result.code}): ${result.stderr || result.stdout}`,
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
	// L1 — AST Layer
	// =====================================================

	pi.registerTool({
		name: "tldr_tree",
		label: "Tldr Tree",
		description:
			"Visual file tree with symbol summaries per file. Quick overview of a project's layout.",
		promptSnippet: "Show project file tree with symbol summaries",
		promptGuidelines: [
			"Use tldr_tree to get a quick overview of an unfamiliar project before diving into specific files.",
			"Use the ext parameter to filter by language (e.g. '.py,.ts') when working in polyglot projects.",
		],
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
		promptGuidelines: [
			"Use tldr_structure on a file to see all functions, classes, and their line numbers before editing.",
			"Use on a directory for a project-wide structure overview.",
		],
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
		promptGuidelines: [
			"Use tldr_extract on a single file when you need the full symbol inventory — signatures, line ranges, and relationships.",
			"More detailed than tldr_structure which is meant for directories; use extract when you need per-symbol depth on one file.",
		],
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
		promptGuidelines: [
			"Use tldr_imports to see what a file depends on — what modules it imports and how (default, named, side-effect).",
			"Useful for understanding a file's external dependencies before refactoring or moving it.",
		],
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
		description:
			"Find files that import a given module. Reverse dependency lookup.",
		promptSnippet: "Find files that import a module",
		promptGuidelines: [
			"Use tldr_importers as the reverse of tldr_imports — find which files depend on a given module.",
			"Essential before deleting or renaming a module to assess blast radius.",
		],
		parameters: Type.Object({
			module: Type.String({ description: "Module name to search for" }),
			path: Type.String({ description: "Directory to search in" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["importers", params.module, params.path, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_definition",
		label: "Tldr Definition",
		description:
			"Go-to-definition — find where a symbol is defined. Supports position-based and name-based lookup.",
		promptSnippet: "Find where a symbol is defined",
		promptGuidelines: [
			"Use tldr_definition for go-to-definition — find where a symbol is declared.",
			"Supports position-based lookup (file, line, column) or name-based lookup (--symbol).",
		],
		parameters: Type.Object({
			file: Type.String({ description: "Source file" }),
			line: Type.Optional(
				Type.Number({ description: "Line number (1-indexed)" }),
			),
			column: Type.Optional(
				Type.Number({ description: "Column number (0-indexed)" }),
			),
			symbol: Type.Optional(
				Type.String({
					description: "Symbol name to look up (alternative to position)",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = ["definition", "-f", "json"];
			if (params.symbol) {
				args.push("--symbol", params.symbol, "--file", params.file);
			} else {
				args.push(
					params.file,
					String(params.line ?? 1),
					String(params.column ?? 0),
				);
			}
			return execTldr(args, signal);
		},
	});

	pi.registerTool({
		name: "tldr_references",
		label: "Tldr References",
		description: "Find all references to a symbol across the codebase.",
		promptSnippet: "Find all references to a symbol",
		promptGuidelines: [
			"Use tldr_references to find all usages of a symbol across the codebase.",
			"Broader than tldr_impact (call graph only) — includes reads, writes, imports, and type references.",
		],
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol to find references for" }),
			path: Type.String({ description: "Directory to search in" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["references", params.symbol, params.path, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_interface",
		label: "Tldr Interface",
		description:
			"Extract interface contracts — public API signatures and contracts for a module or directory.",
		promptSnippet: "Extract public API interface contracts",
		promptGuidelines: [
			"Use tldr_interface to extract the public API surface of a module or directory.",
			"Shows exported function/class signatures and their contracts — useful for documenting APIs or checking backward compatibility.",
		],
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
		description:
			"Extract machine-readable API surface for a library/package or directory.",
		promptSnippet: "Extract API surface for a library",
		promptGuidelines: [
			"Use tldr_surface for machine-readable API extraction from a package or directory.",
			"Use --lookup to query a specific qualified API (e.g., 'json.loads'). More structured than tldr_interface.",
		],
		parameters: Type.Object({
			target: Type.String({
				description: "Package name (e.g., 'json') or directory path",
			}),
			lookup: Type.Optional(
				Type.String({
					description:
						"Lookup a specific API by qualified name (e.g., 'json.loads')",
				}),
			),
			include_private: Type.Optional(
				Type.Boolean({
					description: "Include private/internal APIs. Default: false",
				}),
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
		description:
			"Extract class inheritance hierarchies. Shows parent/child relationships.",
		promptSnippet: "Show class inheritance hierarchies",
		promptGuidelines: [
			"Use tldr_inheritance to map class hierarchies — parent classes, subclasses, and mixin relationships.",
			"Use --class to focus on a specific class and see its ancestors and descendants.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File or directory to analyze" }),
			class_name: Type.Optional(
				Type.String({ description: "Filter to specific class" }),
			),
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
		description:
			"Build a cross-file call graph showing caller → callee relationships.",
		promptSnippet: "Show cross-file call graph",
		promptGuidelines: [
			"Use tldr_calls to build the cross-file call graph — who calls whom across the entire project.",
			"Use this to understand overall architecture. For a specific function's callers, use tldr_impact instead.",
		],
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
		promptGuidelines: [
			"Use tldr_impact before refactoring a function to find all callers (reverse call graph).",
			"Shows how deep the impact goes with configurable traversal depth. Essential for safe refactoring.",
		],
		parameters: Type.Object({
			function_name: Type.String({ description: "Function name to analyze" }),
			path: Type.String({ description: "Directory path to search in" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["impact", params.function_name, params.path, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_dead",
		label: "Tldr Dead Code",
		description:
			"Find dead (unreachable) code — functions defined but never called.",
		promptSnippet: "Find unreachable/dead code",
		promptGuidelines: [
			"Use tldr_dead to find functions defined but never called — unreachable dead code.",
			"Useful for cleanup. Does NOT check references in strings or dynamic calls — review results before deleting.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Directory to scan" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(["dead", params.path, "-f", "json"], signal);
		},
	});

	pi.registerTool({
		name: "tldr_whatbreaks",
		label: "Tldr What Breaks",
		description:
			"Analyze what breaks if a target (function, file, module) is changed.",
		promptSnippet: "Analyze what breaks if a target changes",
		promptGuidelines: [
			"Use tldr_whatbreaks for combined impact analysis — what breaks if you change a function, file, or module.",
			"Combines callers, importers, and change impact into a single report. More comprehensive than tldr_impact alone.",
		],
		parameters: Type.Object({
			target: Type.String({
				description: "Function name, file path, or module name",
			}),
			path: Type.String({ description: "Project root directory" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["whatbreaks", params.target, params.path, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_change_impact",
		label: "Tldr Change Impact",
		description:
			"Find tests affected by code changes. Uses call graph analysis to trace which tests " +
			"exercise modified code. Supports git diff, staged, and uncommitted workflows.",
		promptSnippet: "Find tests affected by code changes",
		promptGuidelines: [
			"Use tldr_change_impact after modifying code to determine which tests need to run.",
			"Use --staged for pre-commit workflows or --uncommitted for all pending changes.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Project root directory" }),
			files: Type.Optional(
				Type.String({ description: "Comma-separated list of changed files" }),
			),
			staged: Type.Optional(
				Type.Boolean({
					description:
						"Only consider staged files (pre-commit workflow). Default: false",
				}),
			),
			uncommitted: Type.Optional(
				Type.Boolean({
					description:
						"Consider all uncommitted changes (staged + unstaged). Default: false",
				}),
			),
			base: Type.Optional(
				Type.String({
					description:
						"Git base branch for diff (e.g., 'origin/main' for PR workflow)",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = ["change-impact", params.path, "-f", "json"];
			if (params.files) {
				args.push("-F", params.files);
			}
			if (params.staged) {
				args.push("--staged");
			}
			if (params.uncommitted) {
				args.push("--uncommitted");
			}
			if (params.base) {
				args.push("--base", params.base);
			}
			return execTldr(args, signal);
		},
	});

	pi.registerTool({
		name: "tldr_deps",
		label: "Tldr Dependencies",
		description:
			"Analyze module dependencies. Shows import relationships between modules. " +
			"Can detect circular dependencies and collapse files into package-level nodes.",
		promptSnippet: "Analyze module dependencies",
		promptGuidelines: [
			"Use tldr_deps to understand the dependency structure of a project before refactoring.",
			"Use --show-cycles to find circular dependencies which often indicate coupling issues.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Directory to analyze" }),
			include_external: Type.Optional(
				Type.Boolean({
					description: "Include external dependencies. Default: false",
				}),
			),
			collapse_packages: Type.Optional(
				Type.Boolean({
					description:
						"Collapse files into package-level nodes. Default: false",
				}),
			),
			show_cycles: Type.Optional(
				Type.Boolean({
					description: "Only show circular dependencies. Default: false",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = ["deps", params.path, "-f", "json"];
			if (params.include_external) {
				args.push("--include-external");
			}
			if (params.collapse_packages) {
				args.push("--collapse-packages");
			}
			if (params.show_cycles) {
				args.push("--show-cycles");
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
		promptGuidelines: [
			"Use tldr_reaching_defs for data-flow analysis — trace where a variable's value originates within a function.",
			"Useful for debugging unexpected values or understanding data propagation through complex logic.",
		],
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
		promptGuidelines: [
			"Use tldr_available to detect redundant computations — expressions computed but unused later.",
			"Identifies Common Subexpression Elimination (CSE) opportunities for performance optimization.",
		],
		parameters: Type.Object({
			file: Type.String({ description: "Source file" }),
			function_name: Type.String({ description: "Function to analyze" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["available", params.file, params.function_name, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_dead_stores",
		label: "Tldr Dead Stores",
		description:
			"Find dead stores using SSA-based analysis — variables written but never read.",
		promptSnippet: "Find dead stores in a function",
		promptGuidelines: [
			"Use tldr_dead_stores to find variables written but never read — assignments that have no effect.",
			"SSA-based analysis. Catches wasted computations and hints at logic errors where a value is overwritten before use.",
		],
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
		promptGuidelines: [
			"Use tldr_slice to trace data flow when debugging — find all statements that influence a variable at a specific line.",
			"Use direction 'forward' to find all code affected by a variable change.",
		],
		parameters: Type.Object({
			file: Type.String({ description: "Source file path" }),
			function_name: Type.String({
				description: "Function containing the line",
			}),
			line: Type.Number({ description: "Line number to slice from" }),
			direction: Type.Optional(
				StringEnum(["backward", "forward"], {
					description:
						"Slice direction: backward (what affects this line) or forward (what this line affects). Default: backward",
				}),
			),
			variable: Type.Optional(
				Type.String({
					description: "Variable to filter by (traces all if not specified)",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = [
				"slice",
				params.file,
				params.function_name,
				String(params.line),
				"-f",
				"json",
			];

			if (params.direction) {
				args.push("--direction", params.direction);
			}
			if (params.variable) {
				args.push("--variable", params.variable);
			}

			return execTldr(args, signal);
		},
	});

	pi.registerTool({
		name: "tldr_chop",
		label: "Tldr Chop",
		description:
			"Compute chop slice — intersection of forward and backward slices between two lines.",
		promptSnippet: "Compute chop slice between two lines",
		promptGuidelines: [
			"Use tldr_chop to trace the influence path between two specific lines in a function.",
			"Combines forward and backward slicing. Useful for understanding how input at one point affects output at another.",
		],
		parameters: Type.Object({
			file: Type.String({ description: "Source file" }),
			function_name: Type.String({
				description: "Function containing both lines",
			}),
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
		promptGuidelines: [
			"Use tldr_search to find functions or classes by name or description across a codebase.",
			"Returns richer results than grep because it includes function signatures and call graph context.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			path: Type.String({ description: "Directory to search" }),
			top_k: Type.Optional(
				Type.Number({ description: "Max results. Default: 10" }),
			),
			no_callgraph: Type.Optional(
				Type.Boolean({
					description:
						"Skip call graph enrichment (much faster). Default: false",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = ["search", params.query, params.path, "-f", "json"];

			if (params.top_k !== undefined) {
				args.push("--top-k", String(params.top_k));
			}
			if (params.no_callgraph) {
				args.push("--no-callgraph");
			}

			return execTldr(args, signal);
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
		promptGuidelines: [
			"Use tldr_context to build a self-contained context block from an entry point function for LLM consumption.",
			"Traces the call graph and collects all relevant code. Use when you need to feed a function and its dependencies to an LLM.",
		],
		parameters: Type.Object({
			entry: Type.String({ description: "Entry point function name" }),
			path: Type.Optional(
				Type.String({
					description: "Project root directory. Default: current",
				}),
			),
			depth: Type.Optional(
				Type.Number({ description: "Maximum traversal depth" }),
			),
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
		promptGuidelines: [
			"Use tldr_smells to detect code quality issues — long functions, deep nesting, god classes, feature envy.",
			"Higher-level than complexity metrics. Identifies structural problems that make code hard to maintain.",
		],
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
		description:
			"Calculate cyclomatic complexity metrics for a specific function.",
		promptSnippet: "Calculate function complexity",
		promptGuidelines: [
			"Use tldr_complexity to measure cyclomatic complexity — how many independent paths exist through a function.",
			"High complexity (>15) indicates a function is hard to test and understand. Consider breaking it down.",
		],
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
		promptGuidelines: [
			"Use tldr_cognitive to measure how hard code is to read (SonarQube algorithm).",
			"Unlike cyclomatic complexity, cognitive complexity penalizes nested structures and mental tracking. Better indicator of readability.",
		],
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
		promptGuidelines: [
			"Use tldr_halstead for deep complexity metrics — volume, difficulty, and estimated effort.",
			"Best for academic or detailed quality audits. For quick checks, prefer tldr_complexity or tldr_cognitive.",
		],
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
		description:
			"Count lines of code with type breakdown — code, comments, blanks.",
		promptSnippet: "Count lines of code",
		promptGuidelines: [
			"Use tldr_loc to count lines of code with breakdown by type — code, comments, blanks.",
			"Use --by_file for per-file breakdowns. Useful for project sizing and tracking growth over time.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Directory or file to analyze" }),
			by_file: Type.Optional(
				Type.Boolean({
					description: "Show per-file breakdown. Default: false",
				}),
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
		promptGuidelines: [
			"Use tldr_churn to identify which files change most often in git history.",
			"High-churn files are unstable and may need stabilization or closer review during changes.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Directory to analyze" }),
			days: Type.Optional(
				Type.Number({ description: "Days of git history. Default: 365" }),
			),
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
		description:
			"Analyze technical debt using the SQALE method. Estimates effort to fix.",
		promptSnippet: "Analyze technical debt (SQALE)",
		promptGuidelines: [
			"Use tldr_debt for SQALE-based technical debt analysis — estimates effort to fix quality issues.",
			"Filter by category (security, reliability, maintainability) to focus remediation efforts.",
		],
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
		promptGuidelines: [
			"Use tldr_health for a high-level quality overview of a project or directory.",
			"Use --quick for faster results (skips coupling and similarity analysis).",
			"Use --summary for metrics only without detail arrays.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Directory to assess" }),
			quick: Type.Optional(
				Type.Boolean({
					description:
						"Quick mode (skip coupling and similarity — faster). Default: false",
				}),
			),
			summary: Type.Optional(
				Type.Boolean({
					description:
						"Summary mode — omit detail arrays, only include summary metrics. Default: false",
				}),
			),
			preset: Type.Optional(
				StringEnum(["strict", "default", "relaxed"], {
					description: "Threshold preset. Default: default",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = ["health", params.path, "-f", "json"];

			if (params.quick) {
				args.push("--quick");
			}
			if (params.summary) {
				args.push("--summary");
			}
			if (params.preset) {
				args.push("--preset", params.preset);
			}

			return execTldr(args, signal, PROJECT_TIMEOUT);
		},
	});

	pi.registerTool({
		name: "tldr_hubs",
		label: "Tldr Hubs",
		description:
			"Detect hub functions using centrality analysis. Shows functions with the most connections.",
		promptSnippet: "Find hub functions by centrality",
		promptGuidelines: [
			"Use tldr_hubs to find functions with the most connections in the call graph — central points of the codebase.",
			"Hub functions are high-risk for changes. Modifying them ripples across many callers.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Project root directory" }),
			top: Type.Optional(
				Type.Number({ description: "Number of top hubs. Default: 10" }),
			),
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
		description:
			"Detect design patterns and coding conventions used in the codebase.",
		promptSnippet: "Detect design patterns",
		promptGuidelines: [
			"Use tldr_patterns to detect design patterns and coding conventions used in the codebase.",
			"Helps understand architectural decisions and whether the codebase follows consistent patterns.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Path to analyze" }),
			category: Type.Optional(
				Type.String({ description: "Filter by pattern category" }),
			),
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
		promptGuidelines: [
			"Use tldr_clones to detect duplicated code that could be extracted into shared functions.",
			"Set --min-tokens to control clone granularity. Lower values catch more clones but may include false positives.",
		],
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
		description:
			"Compare similarity between two code fragments using the Dice coefficient.",
		promptSnippet: "Compare similarity between two code fragments",
		promptGuidelines: [
			"Use tldr_dice to compare similarity between two code fragments using the Dice coefficient.",
			"Useful for verifying refactoring correctness or finding near-duplicate implementations.",
		],
		parameters: Type.Object({
			target1: Type.String({
				description: "First target: file, file::function, or file:start:end",
			}),
			target2: Type.String({
				description: "Second target: file, file::function, or file:start:end",
			}),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["dice", params.target1, params.target2, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_diff",
		label: "Tldr Diff",
		description:
			"AST-aware structural diff between two files. Compares code structure, not text.",
		promptSnippet: "AST-aware structural diff between two files",
		promptGuidelines: [
			"Use tldr_diff for AST-aware structural comparison — compares code structure, not text.",
			"Unlike text diff, reordering functions or changing whitespace won't show as differences.",
		],
		parameters: Type.Object({
			file_a: Type.String({ description: "First file to compare" }),
			file_b: Type.String({ description: "Second file to compare" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["diff", params.file_a, params.file_b, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_cohesion",
		label: "Tldr Cohesion",
		description:
			"Analyze class cohesion using the LCOM4 metric. Low cohesion suggests classes doing too much.",
		promptSnippet: "Analyze class cohesion (LCOM4)",
		promptGuidelines: [
			"Use tldr_cohesion (LCOM4 metric) to identify classes doing too many unrelated things.",
			"Low cohesion suggests a class should be split. High cohesion means the class has a single clear responsibility.",
		],
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
		promptGuidelines: [
			"Use tldr_coupling to measure how tightly modules depend on each other — afferent/efferent coupling and instability.",
			"High coupling makes changes harder to isolate. Target low coupling between modules.",
		],
		parameters: Type.Object({
			path_a: Type.String({ description: "First module or directory" }),
			path_b: Type.Optional(
				Type.String({
					description: "Second module (omit for project-wide scan)",
				}),
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
		promptGuidelines: [
			"Use tldr_hotspots to find files that change often AND are complex — the highest risk areas in the codebase.",
			"Combines churn and complexity data. These files should be prioritized for refactoring and extra test coverage.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Directory to analyze" }),
			days: Type.Optional(
				Type.Number({ description: "Days of git history. Default: 365" }),
			),
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
		promptGuidelines: [
			"Use tldr_coverage to parse coverage reports (Cobertura XML, LCOV, coverage.py JSON) and cross-reference with code structure.",
			"Helps identify uncovered critical paths, not just line-level percentages.",
		],
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
		promptGuidelines: [
			"Use tldr_todo for a one-command overview of what to fix — dead code, complexity issues, cohesion problems, and similar code.",
			"Good starting point for a codebase cleanup. Use --quick to skip expensive similar-code analysis.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File or directory to analyze" }),
			quick: Type.Optional(
				Type.Boolean({
					description: "Skip similar analysis for speed. Default: false",
				}),
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
		promptGuidelines: [
			"Use tldr_taint to trace how user input (sources) flows to dangerous operations (sinks) within a function.",
			"Foundation for security analysis. Identifies potential injection points and unvalidated data paths.",
		],
		parameters: Type.Object({
			file: Type.String({ description: "Source file to analyze" }),
			function_name: Type.String({ description: "Function to analyze" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["taint", params.file, params.function_name, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_vuln",
		label: "Tldr Vulnerability Scan",
		description:
			"Vulnerability scanning via taint analysis — SQL injection, XSS, command injection, SSRF, path traversal, etc.",
		promptSnippet: "Scan for vulnerabilities",
		promptGuidelines: [
			"Use tldr_vuln to scan for specific vulnerability types — SQL injection, XSS, command injection, SSRF, path traversal, and more.",
			"Filter by --severity to focus on critical issues first, or --vuln-type to target a specific vulnerability class.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File or directory to scan" }),
			severity: Type.Optional(
				StringEnum(["critical", "high", "medium", "low", "info"]),
			),
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
		promptGuidelines: [
			"Use tldr_secure for a comprehensive security overview in one call — taint, resources, bounds, contracts, behavioral, and mutability analysis.",
			"Use --quick for faster results (taint, resources, bounds only). Full mode is thorough but slower.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File or directory to analyze" }),
			quick: Type.Optional(
				Type.Boolean({
					description:
						"Quick mode: taint, resources, bounds only. Default: false",
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
		promptGuidelines: [
			"Use tldr_api_check to detect API misuse — missing timeouts, bare except clauses, weak crypto, unclosed files.",
			"Filter by category (error-handling, crypto, resources, concurrency) to focus on specific misuse patterns.",
		],
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
		description:
			"Analyze resource lifecycle — leaks, double-close, use-after-close.",
		promptSnippet: "Analyze resource lifecycle",
		promptGuidelines: [
			"Use tldr_resources to analyze resource lifecycle — detect leaks, double-close, and use-after-close issues.",
			"Critical for code that handles files, sockets, or database connections.",
		],
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
		promptGuidelines: [
			"Use tldr_contracts to infer pre/postconditions from guard clauses, assertions, and isinstance checks.",
			"Helps understand what a function expects and guarantees without reading documentation.",
		],
		parameters: Type.Object({
			file: Type.String({ description: "Source file" }),
			function_name: Type.String({ description: "Function to analyze" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["contracts", params.file, params.function_name, "-f", "json"],
				signal,
			);
		},
	});

	pi.registerTool({
		name: "tldr_specs",
		label: "Tldr Specs",
		description: "Extract behavioral specifications from pytest test files.",
		promptSnippet: "Extract specs from tests",
		promptGuidelines: [
			"Use tldr_specs to extract behavioral specifications from pytest test files.",
			"Shows what each test verifies, mapped back to the functions under test. Useful for understanding test coverage intent.",
		],
		parameters: Type.Object({
			from_tests: Type.String({
				description: "Test file or directory to scan",
			}),
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
		promptGuidelines: [
			"Use tldr_invariants to discover likely program properties from test execution traces (Daikon-lite).",
			"Reveals constraints like 'output is always positive' or 'list is never empty after processing'.",
		],
		parameters: Type.Object({
			file: Type.String({ description: "Source file containing functions" }),
			from_tests: Type.String({
				description: "Test file or directory for tracing",
			}),
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
		description:
			"Mine temporal constraints — method call sequences that must happen in order.",
		promptSnippet: "Mine temporal call constraints",
		promptGuidelines: [
			"Use tldr_temporal to mine method call sequences that must happen in order — temporal constraints.",
			"Detects patterns like 'init must be called before process' from the codebase automatically.",
		],
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
		promptGuidelines: [
			"Use tldr_verify for an aggregated pass/fail report combining multiple analyses into a single dashboard.",
			"Good for CI/CD integration or quick project health checks. Combines complexity, security, and quality metrics.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Directory to verify" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["verify", params.path, "-f", "json"],
				signal,
				PROJECT_TIMEOUT,
			);
		},
	});

	pi.registerTool({
		name: "tldr_explain",
		label: "Tldr Explain",
		description:
			"Comprehensive function analysis — signature, purity, complexity, callers, callees. " +
			"Everything about a function in one call.",
		promptSnippet: "Explain a function in detail",
		promptGuidelines: [
			"Use tldr_explain for a comprehensive deep-dive on a single function — signature, purity, complexity, callers, and callees.",
			"Everything about a function in one call. Use when you need to understand a function thoroughly before modifying it.",
		],
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
		promptGuidelines: [
			"Use tldr_diagnostics to run type checking and linting on a project or specific files.",
			"Combines compiler diagnostics with lint output. Use to catch errors before running tests.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File or directory to analyze" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["diagnostics", params.path, "-f", "json"],
				signal,
				PROJECT_TIMEOUT,
			);
		},
	});

	pi.registerTool({
		name: "tldr_fix",
		label: "Tldr Fix",
		description:
			"Diagnose and auto-fix errors from compiler/runtime output. " +
			"Parses error messages, identifies root cause, and suggests fixes.",
		promptSnippet: "Diagnose and auto-fix compiler/runtime errors",
		promptGuidelines: [
			"Use tldr_fix when the user shares compiler errors, type errors, or runtime stack traces.",
			"Pass the source file path and the full error output for accurate diagnosis.",
		],
		parameters: Type.Object({
			error_output: Type.String({
				description: "Compiler or runtime error output to diagnose",
			}),
			source: Type.Optional(
				Type.String({
					description:
						"Path to the source file where the error occurred. Improves diagnosis accuracy.",
				}),
			),
			lang: Type.Optional(
				Type.String({
					description: "Programming language (auto-detected if not specified)",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = ["fix", "diagnose", "-f", "json"];

			if (params.source) {
				args.push("--source", params.source);
			}
			if (params.lang) {
				args.push("--lang", params.lang);
			}

			// Pass error text via --error flag (required by tldr fix diagnose)
			// Truncate very long error output to avoid CLI argument length limits
			const truncatedError =
				params.error_output.length > 10_000
					? `${params.error_output.slice(0, 10_000)}\n... [truncated]`
					: params.error_output;
			args.push("--error", truncatedError);

			return execTldr(args, signal);
		},
	});

	pi.registerTool({
		name: "tldr_bugbot",
		label: "Tldr Bugbot",
		description:
			"Automated bug detection on uncommitted code changes. Finds regressions before commit. " +
			"Analyzes diffs using AST-aware analysis to detect logic errors, missing error handling, and other bugs.",
		promptSnippet: "Detect bugs in uncommitted changes",
		promptGuidelines: [
			"Use tldr_bugbot before committing to catch regressions in uncommitted changes.",
			"Works best when run after making code changes but before git commit.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Project root directory" }),
			base_ref: Type.Optional(
				Type.String({
					description: "Git base reference to diff against. Default: HEAD",
				}),
			),
			staged: Type.Optional(
				Type.Boolean({
					description: "Check only staged changes. Default: false",
				}),
			),
			max_findings: Type.Optional(
				Type.Number({
					description: "Maximum number of findings to report. Default: 50",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const args = ["bugbot", "check", params.path, "-f", "json"];

			if (params.base_ref) {
				args.push("--base-ref", params.base_ref);
			}
			if (params.staged) {
				args.push("--staged");
			}
			if (params.max_findings !== undefined) {
				args.push("--max-findings", String(params.max_findings));
			}

			return execTldr(args, signal, PROJECT_TIMEOUT);
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
		promptGuidelines: [
			"Use tldr_warm once before heavy analysis sessions to pre-build the call graph cache.",
			"Makes subsequent tldr queries significantly faster. Run it at session start for large projects.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Project root directory to warm" }),
		}),
		async execute(_id, params, signal) {
			return execTldr(
				["warm", params.path, "-f", "json"],
				signal,
				PROJECT_TIMEOUT,
			);
		},
	});

	pi.registerTool({
		name: "tldr_cache_stats",
		label: "Tldr Cache Stats",
		description: "Show cache statistics — hit rate, size, and entries.",
		promptSnippet: "Show cache statistics",
		promptGuidelines: [
			"Use tldr_cache_stats to check call graph cache hit rate, size, and entry count.",
			"Useful for debugging slow analysis — low hit rates indicate the cache needs warming or clearing.",
		],
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
		promptGuidelines: [
			"Use tldr_cache_clear to reset the analysis cache when results seem stale or after significant code changes.",
			"After clearing, run tldr_warm to rebuild the cache.",
		],
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
		promptGuidelines: [
			"Use tldr_daemon_status to check if the background analysis daemon is running, its uptime, and memory usage.",
			"If the daemon is not running, analysis commands will be slower as they start cold.",
		],
		parameters: Type.Object({}),
		async execute(_id, _params, signal) {
			return execTldr(["daemon", "status", "-f", "json"], signal);
		},
	});

	pi.registerTool({
		name: "tldr_stats",
		label: "Tldr Stats",
		description:
			"Show tldr usage statistics — command counts, analysis time breakdown.",
		promptSnippet: "Show tldr usage statistics",
		promptGuidelines: [
			"Use tldr_stats to see which tldr commands are used most and how analysis time is distributed.",
			"Helpful for understanding analysis patterns and identifying bottlenecks.",
		],
		parameters: Type.Object({}),
		async execute(_id, _params, signal) {
			return execTldr(["stats", "-f", "json"], signal);
		},
	});
}

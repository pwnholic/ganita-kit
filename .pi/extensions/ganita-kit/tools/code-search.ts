import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { callExaMcp } from "../web-search/provider/exa.js";

/** Maximum MCP response before truncation. */
const MAX_OUTPUT = 50_000;

/**
 * Truncates large output to stay within token budgets.
 * @param text - Raw response text.
 * @param max - Maximum character count.
 * @returns Truncated text with suffix notice when truncated.
 */
function truncate(text: string, max: number = MAX_OUTPUT): string {
    if (text.length <= max) return text;
    const excess = text.length - max;
    return `${text.slice(0, max)}\n\n... [${excess} characters truncated]`;
}

/** Details shape for code_search tool results. */
interface CodeSearchDetails {
    query: string;
    maxTokens: number;
    error?: string;
}

/** Shared tool result shape. */
type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details: CodeSearchDetails;
};

/**
 * Registers the code_search tool with the Pi extension system.
 * Searches for code examples, documentation, and API references
 * via Exa MCP. No API key required.
 * @param pi - The Pi extension API.
 */
export function register(_pi: ExtensionAPI): void {
    _pi.registerTool({
        name: "code_search",
        label: "Code Search",
        description:
            "Search for code examples, documentation, and API references. " +
            "Returns relevant code snippets and docs from GitHub, Stack Overflow, " +
            "and official documentation. No API key required — uses Exa MCP.",
        promptSnippet:
            "Use for programming/API/library questions to retrieve concrete examples and docs before implementing or debugging code.",
        promptGuidelines: [
            "Use code_search when you need code examples, API references, or documentation.",
            "Works without any API key via Exa MCP.",
            "Increase maxTokens for broader context when researching complex topics.",
        ],
        parameters: Type.Object({
            query: Type.String({
                description: "Programming question, API, library, or debugging topic to search for",
            }),
            maxTokens: Type.Optional(
                Type.Integer({
                    minimum: 1000,
                    maximum: 50000,
                    description:
                        "Maximum tokens of code/documentation context to return (default: 5000)",
                }),
            ),
        }),

        async execute(_toolCallId, params, signal): Promise<ToolResult> {
            const query = params.query.trim();

            if (!query) {
                return {
                    content: [{ type: "text", text: "Error: No query provided." }],
                    details: {
                        query: "",
                        maxTokens: params.maxTokens ?? 5000,
                        error: "No query provided",
                    },
                };
            }

            const maxTokens = params.maxTokens ?? 5000;

            try {
                const text = await callExaMcp(
                    "get_code_context_exa",
                    {
                        query,
                        tokensNum: maxTokens,
                    },
                    signal,
                );

                return {
                    content: [{ type: "text", text: truncate(text) }],
                    details: { query, maxTokens },
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: "text", text: `Error: ${message}` }],
                    details: { query, maxTokens, error: message },
                };
            }
        },
    });
}

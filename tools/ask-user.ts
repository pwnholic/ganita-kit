/**
 * ask_user tool -- bridge between LLM and Pi's ctx.ui interaction methods.
 *
 * Skills reference this tool when they need user input (confirm, select, input).
 * Without this tool, the LLM has no way to interactively ask questions during
 * skill execution.
 *
 * Three interaction types:
 * - confirm: yes/no question via ctx.ui.confirm()
 * - select: pick from options via ctx.ui.select()
 * - input: free-text via ctx.ui.input()
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export function register(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "ask_user",
        label: "Ask User",
        description:
            "Ask the user a question and wait for their response. " +
            "Use when a skill or workflow needs user confirmation, a choice between options, or free-text input. " +
            "This is the only way to get interactive user feedback during tool execution.",
        promptSnippet: "Ask user a question",
        promptGuidelines: [
            "Use ask_user when a workflow needs user input to proceed.",
            "type=confirm for yes/no decisions. Returns 'yes' or 'no'.",
            "type=select for choosing from a list. Returns the selected option value.",
            "type=input for free-text. Returns the user's typed response.",
            "Always provide a clear, specific question. Vague questions waste user time.",
        ],
        parameters: Type.Object({
            question: Type.String({
                description: "The question to ask the user",
            }),
            type: Type.Union(
                [Type.Literal("confirm"), Type.Literal("select"), Type.Literal("input")],
                {
                    description:
                        "Interaction type: confirm (yes/no), select (pick one), or input (free text)",
                },
            ),
            options: Type.Optional(
                Type.Array(Type.String(), {
                    description:
                        "Options for type=select. Each entry is a choice. Ignored for confirm/input.",
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            try {
                if (params.type === "confirm") {
                    const result = await ctx.ui.confirm(params.question, "Confirm");
                    return {
                        content: [{ type: "text", text: result ? "yes" : "no" }],
                        details: {},
                    };
                }

                if (params.type === "select") {
                    const options = params.options ?? [];
                    if (options.length === 0) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "Error: options array is required for type=select",
                                },
                            ],
                            details: {},
                        };
                    }
                    const result = await ctx.ui.select(params.question, options);
                    return {
                        content: [{ type: "text", text: result ?? "(cancelled)" }],
                        details: {},
                    };
                }

                // type === "input"
                const result = await ctx.ui.input(params.question);
                return {
                    content: [{ type: "text", text: result ?? "(cancelled)" }],
                    details: {},
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: "text", text: `Error: ${message}` }],
                    details: {},
                };
            }
        },
    });
}

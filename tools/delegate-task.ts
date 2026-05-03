/**
 * delegate_task tool -- spawn a sub-agent with bounded tools and turn budget.
 *
 * This is the Pi equivalent of CCv4.7's Task/Agent system. It creates an
 * isolated agent session with a restricted set of tools, sends a prompt,
 * collects the response, and disposes the session.
 *
 * Used by /skill:autonomous for worker execution, /skill:review for parallel
 * structural analysis, and /skill:research for deep investigation.
 *
 * The sub-session runs in-memory (SessionManager.inMemory()), so no tokens
 * are added to the main session's context. Only the final output is returned.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
    type AgentSession,
    createAgentSession,
    SessionManager,
} from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

/** All tools that can be delegated to sub-agents. */
const DELEGATABLE_TOOLS: Record<string, string> = {
    // Core Pi tools
    read: "read",
    bash: "bash",
    edit: "edit",
    write: "write",
    grep: "grep",
    find: "find",
    // tldr analysis
    tldr_structure: "tldr_structure",
    tldr_search: "tldr_search",
    tldr_extract: "tldr_extract",
    tldr_impact: "tldr_impact",
    tldr_whatbreaks: "tldr_whatbreaks",
    tldr_bugbot: "tldr_bugbot",
    tldr_smells: "tldr_smells",
    tldr_complexity: "tldr_complexity",
    tldr_cognitive: "tldr_cognitive",
    tldr_hotspots: "tldr_hotspots",
    tldr_dead: "tldr_dead",
    tldr_deps: "tldr_deps",
    tldr_health: "tldr_health",
    tldr_secure: "tldr_secure",
    tldr_vuln: "tldr_vuln",
    tldr_diff: "tldr_diff",
    tldr_change_impact: "tldr_change_impact",
    tldr_loc: "tldr_loc",
    tldr_todo: "tldr_todo",
    // fastedit
    fast_edit: "fast_edit",
    fast_read: "fast_read",
    fast_search: "fast_search",
    fast_delete: "fast_delete",
    // bloks
    bloks_search: "bloks_search",
    bloks_card: "bloks_card",
    bloks_recipe: "bloks_recipe",
    bloks_context: "bloks_context",
    bloks_learn: "bloks_learn",
    bloks_ack: "bloks_ack",
    bloks_nack: "bloks_nack",
};

/** Default tool set for workers that don't specify tools. */
const DEFAULT_TOOLS = ["read", "bash", "grep", "find"];

/** Collect output text from a sub-session's streaming events. */
function collectOutput(sub: AgentSession): {
    output: string;
    unsubscribe: () => void;
} {
    let output = "";
    const unsubscribe = sub.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            output += event.assistantMessageEvent.delta;
        }
    });
    return { output, unsubscribe };
}

export function register(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "delegate_task",
        label: "Delegate Task",
        description:
            "Spawn an isolated sub-agent with restricted tools to execute a bounded task. " +
            "The sub-agent runs in-memory with its own context -- no tokens are added to the main session. " +
            "Returns the sub-agent's final output as text. " +
            "Use for worker execution in /skill:autonomous, parallel analysis in /skill:review, or deep investigation in /skill:research.",
        promptSnippet: "Delegate a task to a sub-agent",
        promptGuidelines: [
            "Use delegate_task when a skill needs a worker to execute a bounded task independently.",
            "The sub-agent runs with restricted tools -- it cannot access ask_user or delegate_task (no nesting).",
            "prompt should be a complete, self-contained task description with all context the worker needs.",
            "tools specifies which tools the worker may use. Default: read, bash, grep, find.",
            "max_turns limits how many turns the sub-agent gets. Default: 5.",
            "Output from the sub-agent is returned as text -- only the final response, not intermediate tool calls.",
        ],
        parameters: Type.Object({
            prompt: Type.String({
                description:
                    "Complete task description for the sub-agent. Must be self-contained with all context needed.",
            }),
            tools: Type.Optional(
                Type.Array(Type.String(), {
                    description:
                        "Tools the sub-agent may use. Available: " +
                        Object.keys(DELEGATABLE_TOOLS).join(", ") +
                        ". Default: read, bash, grep, find.",
                }),
            ),
            max_turns: Type.Optional(
                Type.Number({
                    description: "Maximum turns for the sub-agent. Default: 5.",
                    minimum: 1,
                    maximum: 20,
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const requestedTools = params.tools ?? DEFAULT_TOOLS;
            const maxTurns = params.max_turns ?? 5;

            // Resolve tool names to active tool definitions from the main session.
            // Sub-agent reuses the same tool instances but filtered to only the requested set.
            const allTools = pi.getAllTools();
            const toolMap = new Map(allTools.map((t) => [t.name, t]));
            const resolvedTools = [];
            const unknownTools: string[] = [];

            for (const name of requestedTools) {
                const tool = toolMap.get(name);
                if (tool) {
                    resolvedTools.push(tool);
                } else {
                    unknownTools.push(name);
                }
            }

            if (unknownTools.length > 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Unknown tools: ${unknownTools.join(", ")}. Available: ${Object.keys(DELEGATABLE_TOOLS).join(", ")}`,
                        },
                    ],
                    details: {},
                };
            }

            let sub: Awaited<ReturnType<typeof createAgentSession>> | null = null;
            try {
                sub = await createAgentSession({
                    sessionManager: SessionManager.inMemory(),
                    tools: resolvedTools as never,
                    model: ctx.model as never,
                });

                const { output, unsubscribe } = collectOutput(sub.session);

                await sub.session.prompt(
                    `${params.prompt}\n\nYou have ${maxTurns} turns maximum. ` +
                        "Be thorough but concise. Write findings and results clearly. " +
                        "If you encounter an error, report it and stop.",
                );

                unsubscribe();

                if (!output.trim()) {
                    return {
                        content: [{ type: "text", text: "(sub-agent produced no output)" }],
                        details: { turns: maxTurns, tools: requestedTools },
                    };
                }

                return {
                    content: [{ type: "text", text: output }],
                    details: { turns: maxTurns, tools: requestedTools },
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: "text", text: `Sub-agent error: ${message}` }],
                    details: {},
                };
            } finally {
                sub?.session.dispose();
            }
        },
    });
}

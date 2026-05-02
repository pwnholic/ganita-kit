/**
 * Agent-based summarization using an in-memory Pi sub-session.
 *
 * Creates a temporary, ephemeral agent session that reuses the same model
 * provider as the running Pi instance. The sub-session has no tools, no
 * persistence, and is disposed immediately after the summary is produced.
 *
 * No tokens are added to the main session — the summary is returned as a
 * plain string.
 */

import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

/** Options for agent summarization. */
export interface AgentSummarizeOptions {
    /** Text content to summarize. */
    content: string;
    /** The Pi model to use (typically `ctx.model` from the tool's execute). */
    model: unknown;
    /** Optional abort signal to cancel summarization. */
    signal?: AbortSignal;
    /** Max tokens for the summary response. */
    maxTokens?: number;
    /** Optional custom instruction override. */
    instruction?: string;
}

/**
 * Summarize content using the Pi agent's model in an isolated sub-session.
 *
 * The sub-session is created fresh, prompts the model, collects the response,
 * and disposes — all without touching the main session's context or history.
 *
 * @returns The summary text, or an empty string if summarization was aborted.
 */
export async function summarizeWithAgent(options: AgentSummarizeOptions): Promise<string> {
    const { content, model, signal, maxTokens = 500, instruction } = options;

    const sub = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        tools: [],
        model: model as never,
    });

    // Propagate abort signal
    const abortHandler = () => sub.session.abort();
    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
        let summary = "";
        sub.session.subscribe((event) => {
            if (
                event.type === "message_update" &&
                event.assistantMessageEvent.type === "text_delta"
            ) {
                summary += event.assistantMessageEvent.delta;
            }
        });

        const prompt =
            instruction ??
            `Summarize the following content concisely in at most ${maxTokens} tokens. \
Focus on key facts, data, and actionable information. \
Use plain direct prose:\n\n${content}`;

        await sub.session.prompt(prompt);
        return summary;
    } catch (err) {
        // Aborted — return empty
        if (err instanceof Error && err.message.toLowerCase().includes("abort")) {
            return "";
        }
        throw err;
    } finally {
        signal?.removeEventListener("abort", abortHandler);
        sub.session.dispose();
    }
}

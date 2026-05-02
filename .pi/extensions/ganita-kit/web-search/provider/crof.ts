/**
 * CrofAI provider for summarization.
 * CrofAI is an OpenAI-compatible API at https://crof.ai/v1.
 * Used by the curator for AI summary generation.
 *
 * All configurable values come from ~/.pi/ganita-kit.json
 * with sensible defaults defined in config/config.ts.
 */
import { getCrofaAiKey, loadConfig } from "../../config/config.js";

const cfg = loadConfig();
const CROF = cfg.crof!;

/**
 * Call CrofAI chat completions (OpenAI-compatible API).
 * Uses the best available model for high-quality output.
 * @param messages - Chat messages
 * @param signal - Optional abort signal
 * @returns The response content text
 */
export async function crofComplete(
    messages: Array<{ role: string; content: string }>,
    signal?: AbortSignal,
    model?: string,
): Promise<string> {
    const apiKey = getCrofaAiKey();
    if (!apiKey) {
        throw new Error(
            "CrofAI API key not found. Set CROFAI_API_KEY env var or crofAiKey in ~/.pi/ganita-kit.json",
        );
    }

    // Try primary model first, then fallbacks
    const modelsToTry = model ? [model] : [CROF.defaultModel!, ...CROF.fallbackModels!];

    for (const selectedModel of modelsToTry) {
        try {
            return await doCrofComplete(apiKey, selectedModel, messages, signal);
        } catch (err) {
            const isLast = selectedModel === modelsToTry[modelsToTry.length - 1];
            if (isLast) throw err;
        }
    }

    throw new Error("All CrofAI models failed");
}

async function doCrofComplete(
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    signal?: AbortSignal,
): Promise<string> {
    const fetchOptions: RequestInit = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: CROF.maxTokens,
            temperature: CROF.temperature,
            top_p: CROF.topP,
            repetition_penalty: CROF.repetitionPenalty,
        }),
    };
    if (signal) fetchOptions.signal = signal;

    const response = await fetch(`${CROF.baseUrl}/chat/completions`, fetchOptions);

    if (!response.ok) {
        let errorBody = "";
        try {
            errorBody = await response.text();
        } catch {
            errorBody = "(could not read body)";
        }
        throw new Error(`CrofAI API error ${response.status}: ${errorBody.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
        choices?: Array<{
            message?: { content?: string };
        }>;
    };

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("CrofAI returned empty response");
    }

    return content.trim();
}

/**
 * Test whether CrofAI is configured (has API key).
 */
export function isCrofaIReady(): boolean {
    return getCrofaAiKey() !== null;
}

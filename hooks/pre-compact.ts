/**
 * Pre-compact handoff hook.
 *
 * Intercepts session compaction and generates an auto-handoff document
 * from the conversation state. The handoff is written to
 * `.continuum/handoffs/auto-handoff-{timestamp}.md`
 * so a future session can restore context.
 *
 * Extracts: files modified, errors, last assistant message from session entries.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

interface ExtractedState {
    lastAssistantMessage: string;
    filesModified: Set<string>;
    errors: string[];
}

/** Extract state from session entries. */
function extractState(entries: SessionEntry[]): ExtractedState {
    const state: ExtractedState = {
        lastAssistantMessage: "",
        filesModified: new Set(),
        errors: [],
    };

    // Walk backwards from recent entries
    for (let i = entries.length - 1; i >= Math.max(0, entries.length - 50); i--) {
        const entry = entries[i];
        if (!entry) continue;

        // SessionMessageEntry has role + content
        if (
            "role" in entry &&
            entry.role === "assistant" &&
            "content" in entry &&
            typeof entry.content === "string" &&
            !state.lastAssistantMessage
        ) {
            state.lastAssistantMessage = entry.content.slice(0, 500);
        }

        // Extract files from tool-related entries (they carry input with file paths)
        if ("input" in entry) {
            const input = entry.input as Record<string, unknown>;
            const toolName = ("toolName" in entry ? entry.toolName : "") as string;

            if (
                ["edit", "write", "fast_edit", "fast_batch_edit", "fast_multi_edit"].includes(
                    toolName,
                )
            ) {
                const fp = (input["file_path"] ?? input["path"] ?? input["file"]) as
                    | string
                    | undefined;
                if (fp) state.filesModified.add(fp);
            }
        }

        // Extract errors from entries with isError or error fields
        if ("isError" in entry && entry.isError) {
            const content = "content" in entry ? String(entry.content).slice(0, 200) : "";
            if (content) state.errors.push(content);
        }
    }

    state.errors = state.errors.slice(-5);
    return state;
}

/** Generate handoff markdown content. */
function generateHandoff(state: ExtractedState, cwd: string): string {
    const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const lines = [
        "---",
        `date: ${ts}`,
        "type: auto-handoff",
        "trigger: pre-compact-auto",
        "---",
        "",
        "# Auto-Handoff (PreCompact)",
        "",
        "Generated automatically before context compaction.",
        "",
        "## Files Modified",
        "",
    ];

    const files = [...state.filesModified];
    if (files.length > 0) {
        for (const f of files) {
            const rel = f.startsWith(cwd) ? f.slice(cwd.length + 1) : f;
            lines.push(`- ${rel}`);
        }
    } else {
        lines.push("No files modified in recent context.");
    }
    lines.push("");

    if (state.errors.length > 0) {
        lines.push("## Errors Encountered", "");
        for (const e of state.errors) {
            lines.push(`- ${e}`);
        }
        lines.push("");
    }

    if (state.lastAssistantMessage) {
        lines.push("## Last Context", "");
        lines.push(state.lastAssistantMessage);
        if (state.lastAssistantMessage.length >= 500) lines.push("[... truncated]");
        lines.push("");
    }

    lines.push("## Suggested Next Steps", "");
    lines.push("1. Review modified files to understand recent changes");
    lines.push("2. Check errors if any were encountered");
    lines.push("3. Continue from where the session left off");
    lines.push("4. Run /skill:create-handoff for a more detailed handoff if needed");
    lines.push("");

    return lines.join("\n");
}

export function register(pi: ExtensionAPI): void {
    pi.on("session_before_compact", async (_event, ctx) => {
        const cwd = ctx.cwd;

        try {
            const entries = ctx.sessionManager.getEntries();
            const state = extractState(entries);
            const content = generateHandoff(state, cwd);

            const handoffDir = join(cwd, ".continuum", "handoffs");
            if (!existsSync(handoffDir)) {
                mkdirSync(handoffDir, { recursive: true });
            }

            const ts = new Date()
                .toISOString()
                .replace(/:/g, "-")
                .replace(/\.\d+Z$/, "");
            const filename = `auto-handoff-${ts}.md`;
            writeFileSync(join(handoffDir, filename), content);

            // Let compaction continue normally
            return undefined;
        } catch {
            // Never block compaction -- if handoff fails, let compaction proceed
            return undefined;
        }
    });
}

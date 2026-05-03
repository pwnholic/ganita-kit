/**
 * Context guard hook.
 *
 * Checks context usage at each turn start. When usage exceeds 85%,
 * notifies the user and suggests running /skill:create-handoff.
 * At 92%, escalates to an error-level notification.
 *
 * Advisory only -- does not block the agent from proceeding.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CONTEXT_WARNING_THRESHOLD = 0.85;
const CONTEXT_CRITICAL_THRESHOLD = 0.92;

let lastWarningTurn = -1;

export function register(pi: ExtensionAPI): void {
    pi.on("turn_start", async (event, ctx) => {
        const usage = ctx.getContextUsage();
        if (!usage) return;

        const tokens = usage.tokens;
        if (tokens === null) return;
        const percent = usage.percent;
        if (percent === null) return;

        const ratio = percent / 100;

        // Only warn once per turn index to avoid spam
        if (event.turnIndex === lastWarningTurn) return;

        if (ratio >= CONTEXT_CRITICAL_THRESHOLD) {
            lastWarningTurn = event.turnIndex;
            ctx.ui.notify(
                `Context critical: ${percent.toFixed(0)}% used. Run /skill:create-handoff now to save your work.`,
                "error",
            );
            ctx.ui.setStatus("ctx-guard", `Context: ${percent.toFixed(0)}% -- SAVE NOW`);
        } else if (ratio >= CONTEXT_WARNING_THRESHOLD) {
            lastWarningTurn = event.turnIndex;
            ctx.ui.notify(
                `Context high: ${percent.toFixed(0)}% used. Consider /skill:create-handoff before continuing.`,
                "warning",
            );
            ctx.ui.setStatus("ctx-guard", `Context: ${percent.toFixed(0)}%`);
        } else {
            ctx.ui.setStatus("ctx-guard", undefined);
        }
    });

    pi.on("session_start", async () => {
        lastWarningTurn = -1;
    });
}

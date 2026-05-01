import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hasBinary } from "../config/config.js";
import { warmCache } from "../tools/tldr.js";

/**
 * Register lifecycle event handlers for ganita-kit.
 *
 * - `session_start` (startup): auto-warms tldr cache in background
 */
export function register(pi: ExtensionAPI): void {
	pi.on("session_start", async (event, ctx) => {
		// Only warm on fresh startup, not on reload/resume/fork
		if (event.reason !== "startup") {
			return;
		}

		// Skip if tldr binary is not installed
		if (!hasBinary("tldr")) {
			return;
		}

		// Run tldr warm in background — don't block session startup
		warmCache(pi, ctx.cwd)
			.then((result) => {
				if (result.ok) {
					ctx.ui.notify("tldr cache warmed", "info");
				}
			})
			.catch(() => {
				// Warm failure is non-critical — just skip silently.
				// The user can call tldr_warm manually if needed.
			});
	});
}

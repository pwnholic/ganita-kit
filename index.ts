import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { register as registerBloks } from "./cli/bloks.js";
import { register as registerFastedit } from "./cli/fastedit.js";
import { register as registerTldr } from "./cli/tldr.js";
import { register as registerWebclaw } from "./cli/webclaw.js";
import { register as registerContextGuard } from "./hooks/context.js";
import { register as registerPostEditDiagnostics } from "./hooks/post-edit.js";
import { register as registerPreCompactHandoff } from "./hooks/pre-compact.js";
import { register as registerAskUser } from "./tools/ask-user.js";
import { register as registerDelegateTask } from "./tools/delegate-task.js";
import { register as registerWebSearchTools } from "./web-search/tools.js";

/**
 * Ganita Kit — Unified AI agent toolkit for Pi.
 *
 * Integrates CLI tools and web search as Pi extension tools:
 * - **webclaw** — Web scraping, crawling, and content extraction
 * - **bloks** — Library knowledge management and context generation
 * - **tldr** — Code analysis (AST, call graph, dead code, health)
 * - **fastedit** — AST-aware code editing by symbol name
 * - **web_search** — Web search via Exa (API or MCP, zero-config) with curator UI
 * - **code_search** — Code/doc search via Exa MCP (zero-config)
 * - **google_surf_search** — Google search via Playwright, no API key
 * - **ask_user** — Interactive user input (confirm, select, input)
 * - **delegate_task** — Isolated sub-agent with restricted tools
 *
 * CLI tools call their local binaries via pi.exec().
 * Web search tools call Exa API/MCP via HTTP fetch,
 * with optional content extraction via webclaw.
 * Google Surf tools run google-surf-mcp as a subprocess via MCP JSON-RPC.
 * ask_user bridges LLM to ctx.ui for interactive workflows.
 * delegate_task spawns in-memory sub-sessions for worker execution.
 *
 * @param pi - The Pi extension API.
 */
export default function (pi: ExtensionAPI): void {
    registerWebclaw(pi);
    registerWebSearchTools(pi);
    registerBloks(pi);
    registerTldr(pi);
    registerFastedit(pi);
    registerAskUser(pi);
    registerDelegateTask(pi);

    // Hooks (event handlers)
    registerPostEditDiagnostics(pi);
    registerPreCompactHandoff(pi);
    registerContextGuard(pi);

    // Cleanup surf subprocess on process exit
    process.on("exit", () => {
        import("./web-search/provider/surf-mcp.js")
            .then(({ stopSurf }) => stopSurf())
            .catch(() => {});
    });
}

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { register as registerBloks } from "./cli/bloks.js";
import { register as registerFastedit } from "./cli/fastedit.js";
import { register as registerTldr } from "./cli/tldr.js";
import { register as registerWebclaw } from "./cli/webclaw.js";
import { register as registerWebSearchTools } from "./web-search/tools.js";

/**
 * Ganita Kit — Unified AI agent toolkit for Pi.
 *
 * Integrates CLI tools and web search as Pi extension tools:
 * - **webclaw** — Web scraping, crawling, and content extraction
 * - **bloks** — Library knowledge management and context generation
 * - **tldr** — Code analysis (AST, call graph, dead code, health)
 * - **fastedit** — AST-aware code editing by symbol name
 * - **web_search** — Web search via Exa (API or MCP, zero-config)
 * - **code_search** — Code/doc search via Exa MCP (zero-config)
 *
 * CLI tools call their local binaries via pi.exec().
 * Web search tools call Exa API/MCP via HTTP fetch,
 * with optional content extraction via webclaw.
 * @param pi - The Pi extension API.
 */
export default function (pi: ExtensionAPI): void {
	registerWebclaw(pi);
	registerWebSearchTools(pi);
	registerBloks(pi);
	registerTldr(pi);
	registerFastedit(pi);
}

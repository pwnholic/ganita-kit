import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { register as registerBloks } from "./commands/bloks.js";
import { register as registerFastedit } from "./commands/fastedit.js";
import { register as registerTldr } from "./commands/tldr.js";
import { register as registerWebclaw } from "./commands/webclaw.js";
import { register as registerEvent } from "./event/event.js";

/**
 * Ganita Kit — Unified AI agent toolkit for Pi.
 *
 * Integrates four CLI tools as Pi extension tools:
 * - **webclaw** — Web scraping, crawling, and content extraction
 * - **bloks** — Library knowledge management and context generation
 * - **tldr** — Code analysis (AST, call graph, dead code, health)
 * - **fastedit** — AST-aware code editing by symbol name
 *
 * Lifecycle:
 * - On `session_start` (startup): auto-warms tldr cache
 *
 * All tools call their local CLI binaries via pi.exec().
 * @param pi - The Pi extension API.
 */
export default function (pi: ExtensionAPI): void {
    registerEvent(pi);
    registerWebclaw(pi);
    registerBloks(pi);
    registerTldr(pi);
    registerFastedit(pi);
}

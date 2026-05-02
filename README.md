# ganita-kit

Unified AI agent toolkit for Pi. 109 tools across 6 modules: web search, web scraping, code analysis, library knowledge, code editing, and Google search.

## Prerequisites

- **Node.js** >= 18
- **Pi** (coding agent) installed globally
- **Google Chrome or Chromium** (required by google-surf-mcp and cookie extraction)

## Install

### 1. Clone and install dependencies

```bash
git clone https://github.com/pwnholic/ganita-kit.git
cd ganita-kit/.pi/extensions/ganita-kit
npm install
```

### 2. Install CLI binaries

The extension wraps 4 CLI tools. Each must be available on your `$PATH`:

| Binary | Purpose | Install |
|--------|---------|---------|
| `tldr` | Code analysis (60 subcommands, 18 languages) | `npm install -g @pwnholic/tldr-cli` |
| `webclaw` | Web scraping, crawling, extraction | `npm install -g webclaw` |
| `bloks` | Library indexing and knowledge retrieval | `npm install -g @pwnholic/bloks` |
| `fastedit` | AST-aware code editing | `npm install -g @pwnholic/fastedit` |

Verify installation:

```bash
tldr --version
webclaw --version
bloks --version
fastedit --version
```

Tools that depend on missing binaries are automatically disabled at startup.

### 3. Bootstrap Google Surf (one-time, required for google_surf_search)

```bash
cd ganita-kit/.pi/extensions/ganita-kit
npx google-surf-mcp bootstrap
```

This opens a Chrome window. Run one Google search inside it, then close the window. The profile is now warm and `google_surf_search` will work without an API key.

Skip this step if you do not need Google search.

### 4. Configure API keys (optional)

Most tools work without any API keys. The following are optional:

| Key | Used by | Required? |
|-----|---------|-----------|
| `EXA_API_KEY` | `web_search` (Exa direct API mode) | No. Without it, Exa MCP mode is used (zero-config). |
| `EXA_API_KEY` | `code_search` (Exa MCP) | No. Uses hosted MCP endpoint. |

Set via environment variable or config file (see Configuration below).

## Architecture

```
ganita-kit/
  index.ts              Entry point. Registers all 109 tools.
  config/
    schema.ts           Config interface + defaults
    loader.ts           Config loading + deep merge
    runtime.ts          API key resolution, binary detection
  shared/
    cli.ts              execCli(), truncate(), shared CLI helpers
    summarize.ts        Agent-based summarization (in-memory Pi sub-session)
  cli/
    webclaw.ts          13 webclaw tools (scrape, crawl, extract, etc.)
    tldr.ts             60 tldr tools (AST, call graph, security, etc.)
    bloks.ts            22 bloks tools (index, search, context, etc.)
    fastedit.ts         11 fastedit tools (edit, rename, move, etc.)
  web-search/
    tools.ts            web_search, code_search, google_surf_search registrations
    provider/
      exa.ts            Exa API + MCP client
      surf-mcp.ts       google-surf-mcp subprocess client (JSON-RPC over stdio)
  ui/
    curator/            Interactive browser-based curator for web_search results
  types/                Shared TypeScript types
  __tests__/            141 tests across 7 test files
```

## Tools

### Web Search (3 tools)

| Tool | Description | Provider |
|------|-------------|----------|
| `web_search` | Search with interactive curator UI for reviewing results | Exa |
| `code_search` | Code example and documentation search | Exa MCP |
| `google_surf_search` | Google search via Playwright, no API key | google-surf-mcp |

### Webclaw (13 tools)

| Tool | Description |
|------|-------------|
| `webclaw_scrape` | Extract content from URL, PDF, or local file. Supports `summarize: true`. |
| `webclaw_batch` | Extract from multiple URLs in one call |
| `webclaw_crawl` | Crawl a website and extract content |
| `webclaw_map` | Discover all URLs on a website |
| `webclaw_extract` | Extract structured data via LLM |
| `webclaw_brand` | Extract brand identity (colors, fonts, logos) |
| `webclaw_vertical` | Site-specific structured extraction |
| `webclaw_extractors` | List available vertical extractors |
| `webclaw_research` | Deep research on a topic |
| `webclaw_summarize` | Summarize a web page |
| `webclaw_diff` | Compare page content against a snapshot |
| `webclaw_watch` | Watch a URL for changes |
| `webclaw_bench` | Benchmark extraction quality |

### Tldr (60 tools)

Code analysis across 18 languages. Key categories:

| Category | Example tools |
|----------|--------------|
| AST structure | `tldr_tree`, `tldr_structure`, `tldr_extract` |
| Call graph | `tldr_calls`, `tldr_impact`, `tldr_context` |
| Dead code | `tldr_dead`, `tldr_dead_stores` |
| Security | `tldr_taint`, `tldr_vuln`, `tldr_secure` |
| Quality | `tldr_complexity`, `tldr_health`, `tldr_smells`, `tldr_debt` |
| Slicing | `tldr_slice`, `tldr_chop`, `tldr_reaching_defs` |
| Refactoring | `tldr_fix`, `tldr_bugbot`, `tldr_change_impact` |
| Metrics | `tldr_loc`, `tldr_halstead`, `tldr_cognitive` |

### Bloks (22 tools)

Library knowledge management:

| Category | Example tools |
|----------|--------------|
| Indexing | `bloks_add`, `bloks_add_local`, `bloks_remove`, `bloks_refresh` |
| Search | `bloks_search`, `bloks_card`, `bloks_deck`, `bloks_recipe` |
| Context | `bloks_context`, `bloks_modules`, `bloks_index_url` |
| Feedback | `bloks_learn`, `bloks_ack`, `bloks_nack`, `bloks_stats` |

### Fastedit (11 tools)

AST-aware code editing:

| Tool | Description |
|------|-------------|
| `fast_read` | Show file structure (functions, classes, line ranges) |
| `fast_search` | Search for symbols in a codebase |
| `fast_edit` | Edit a function or class by name |
| `fast_batch_edit` | Multiple edits to one file |
| `fast_multi_edit` | Edits across multiple files |
| `fast_delete` | Delete a symbol with caller safety check |
| `fast_move` | Move a symbol within a file |
| `fast_rename` | Rename a symbol (AST-aware, skips strings/comments) |
| `fast_undo` | Revert last edit |
| `fast_diff` | Show diff between backup and current file |
| `fast_pull` | Download the merge model for complex edits |

## Configuration

Configuration is loaded from two locations (project-level overrides global):

1. `~/.pi/ganita-kit.json` (global, user-level)
2. `.pi/ganita-kit.json` (project-level, overrides global)

All fields have sensible defaults. Only override what you need.

### Example config

```json
{
  "exaApiKey": "your-exa-api-key",
  "search": {
    "defaultNumResults": 5,
    "maxOutputChars": 100000
  },
  "curator": {
    "curatorTimeoutMs": 120000
  },
  "surf": {
    "headless": true,
    "idleCloseMs": 30000,
    "locale": "en-US"
  },
  "cli": {
    "maxOutputChars": 50000,
    "tldrTimeoutMs": 60000,
    "webclawScrapeTimeoutMs": 30000
  }
}
```

### Config sections

| Section | Fields | Description |
|---------|--------|-------------|
| `search` | `defaultNumResults`, `maxResultsPerQuery`, `maxOutputChars`, `extractTimeoutMs` | Search behavior |
| `curator` | `staleThresholdMs`, `disconnectGraceMs`, `watchdogIntervalMs`, `maxBodySize`, `curatorTimeoutMs` | Curator browser UI |
| `exa` | `monthlyBudget`, `warningThreshold`, `apiUrl`, `mcpUrl`, `requestTimeoutMs` | Exa provider settings |
| `surf` | `headless`, `idleCloseMs`, `chromePath`, `profileRoot`, `locale`, `tz` | Google Surf MCP settings |
| `cli` | `maxOutputChars`, timeouts for each binary | CLI execution limits |

## Summarization

Two features use agent-based summarization without external APIs:

1. **webclaw_scrape** with `summarize: true` -- post-processes scraped content using the Pi agent's model via an in-memory sub-session.
2. **web_search curator** -- when the user clicks "Summarize" in the curator UI, the Pi agent generates a structured summary.

Both use `createAgentSession({ SessionManager.inMemory() })` to create a temporary, isolated session. The sub-session has no tools, no persistence, and is disposed immediately after the summary is produced. No tokens are added to the main session's context.

## Development

### Run tests

```bash
cd ganita-kit/.pi/extensions/ganita-kit
npm test
```

141 tests across 7 test files. Tests cover tool parameter validation, CLI argument building, config loading, and search provider logic.

### Lint and format

```bash
npx biome check --fix .
```

### Type check

```bash
npx tsc --noEmit
```

## How It Works

### CLI tools (tldr, webclaw, bloks, fastedit)

Each CLI tool calls its binary via `pi.exec()`. Shared infrastructure in `shared/cli.ts` handles output truncation, timeouts, and error formatting.

### Web search (Exa)

`web_search` uses Exa search provider with an interactive curator browser UI. The agent can review results, add more searches, and generate a structured summary before submitting. Falls back to a deterministic summary if the agent-based summarization fails.

`code_search` uses Exa MCP (hosted endpoint, zero-config) to search code examples and documentation.

### Google Surf search

`google_surf_search` spawns `google-surf-mcp` as a subprocess and communicates via JSON-RPC over stdio. No API key needed. The subprocess manages its own Playwright browser with anti-bot stealth and CAPTCHA recovery.

### Content extraction

`webclaw_scrape` and related tools handle all content extraction. No separate extract tool needed.

## License

MIT

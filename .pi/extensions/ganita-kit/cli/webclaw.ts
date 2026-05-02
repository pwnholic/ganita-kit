import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

/** Maximum CLI output before truncation. */
const MAX_OUTPUT = 50_000;

/** Timeout for single-page operations in milliseconds. */
const SCRAPE_TIMEOUT = 30_000;

/** Timeout for crawl operations (multi-page) in milliseconds. */
const CRAWL_TIMEOUT = 120_000;

/** Timeout for research operations in milliseconds. */
const RESEARCH_TIMEOUT = 300_000;

/** Shared tool result shape. */
type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
    isError?: boolean;
};

/** Parameters accepted by most webclaw tools (fetch + extraction options). */
type SharedFetchParams = {
    format?: string;
    pdf_mode?: string;
    timeout?: number;
    proxy?: string;
    proxy_file?: string;
    browser?: string;
    header?: string;
    cookie?: string;
    cookie_file?: string;
    raw_html?: boolean;
    verbose?: boolean;
    cloud?: boolean;
    output_dir?: string;
};

/**
 * Truncates large CLI output to stay within token budgets.
 * @param text - Raw CLI stdout.
 * @param max - Maximum character count.
 * @returns Truncated text with suffix notice when truncated.
 */
function truncate(text: string, max: number = MAX_OUTPUT): string {
    if (text.length <= max) return text;
    const excess = text.length - max;
    return `${text.slice(0, max)}\n\n... [${excess} characters truncated]`;
}

/**
 * Appends shared fetch flags (proxy, browser, headers, cookies, etc.)
 * to the args array. Used by scrape, crawl, extract, and batch tools.
 */
function pushSharedArgs(args: string[], params: SharedFetchParams): void {
    if (params.pdf_mode) {
        args.push("--pdf-mode", params.pdf_mode);
    }
    if (params.timeout !== undefined) {
        args.push("-t", String(params.timeout));
    }
    if (params.proxy) {
        args.push("-p", params.proxy);
    }
    if (params.proxy_file) {
        args.push("--proxy-file", params.proxy_file);
    }
    if (params.browser) {
        args.push("-b", params.browser);
    }
    if (params.header) {
        args.push("-H", params.header);
    }
    if (params.cookie) {
        args.push("--cookie", params.cookie);
    }
    if (params.cookie_file) {
        args.push("--cookie-file", params.cookie_file);
    }
    if (params.raw_html) {
        args.push("--raw-html");
    }
    if (params.verbose) {
        args.push("-v");
    }
    if (params.cloud) {
        args.push("--cloud");
    }
    if (params.output_dir) {
        args.push("--output-dir", params.output_dir);
    }
}

/**
 * Registers webclaw CLI tools with the Pi extension system.
 * Webclaw extracts clean, LLM-optimized content from web pages,
 * PDFs, and local HTML files using TLS fingerprinting to bypass bot protection.
 * @param pi - The Pi extension API.
 */
export function register(pi: ExtensionAPI): void {
    async function execWebclaw(
        args: string[],
        signal: AbortSignal | undefined,
        timeout: number = SCRAPE_TIMEOUT,
    ): Promise<ToolResult> {
        const result = await pi.exec("webclaw", args, {
            ...(signal ? { signal } : {}),
            timeout,
        });

        if (result.killed) {
            return {
                content: [{ type: "text", text: "Operation cancelled." }],
                details: {},
            };
        }

        if (result.code !== 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `webclaw error (exit ${result.code}): ${result.stderr || result.stdout}`,
                    },
                ],
                details: {},
                isError: true,
            };
        }

        return {
            content: [{ type: "text", text: truncate(result.stdout) }],
            details: {},
        };
    }

    // =====================================================
    // Core extraction
    // =====================================================

    // --- webclaw_scrape ---
    pi.registerTool({
        name: "webclaw_scrape",
        label: "Webclaw Scrape",
        description:
            "Extract clean, LLM-optimized content from a URL, PDF, or local HTML file. " +
            "Handles Cloudflare, DataDome, and other bot protection via TLS fingerprinting. " +
            "Supports PDF URLs (auto-detected) and local files.",
        promptSnippet: "Scrape web page, PDF, or local file content",
        promptGuidelines: [
            "Use webclaw_scrape when you need to read a web page, article, documentation, or PDF.",
            "Prefer webclaw_scrape over web_fetch for reliable extraction, especially if web_fetch returns 403 or empty content.",
            "For PDFs, set pdf_mode to 'fast' if the PDF might be scanned/image-based.",
            "Use --include/--exclude selectors to target specific content areas on complex pages.",
            "Use --proxy or --cookie-file for pages that require authentication or regional access.",
        ],
        parameters: Type.Object({
            url: Type.Optional(Type.String({ description: "URL to scrape (web page or PDF)" })),
            file: Type.Optional(
                Type.String({
                    description: "Local HTML or PDF file path to extract from",
                }),
            ),
            stdin: Type.Optional(
                Type.Boolean({
                    description: "Read HTML from stdin instead of fetching",
                }),
            ),
            format: Type.Optional(StringEnum(["llm", "markdown", "text", "json", "html"])),
            pdf_mode: Type.Optional(
                StringEnum(["auto", "fast"], {
                    description:
                        "PDF extraction mode. 'auto' errors on empty (catches scanned PDFs), 'fast' returns whatever text is found. Default: auto",
                }),
            ),
            only_main_content: Type.Optional(
                Type.Boolean({
                    description: "Extract only the main content area. Default: true",
                }),
            ),
            include_selectors: Type.Optional(
                Type.String({
                    description:
                        'CSS selectors to include (comma-separated, e.g. "article,.content")',
                }),
            ),
            exclude_selectors: Type.Optional(
                Type.String({
                    description: 'CSS selectors to exclude (comma-separated, e.g. "nav,.sidebar")',
                }),
            ),
            metadata: Type.Optional(Type.Boolean({ description: "Include metadata in output" })),
            timeout: Type.Optional(
                Type.Number({ description: "Request timeout in seconds. Default: 30" }),
            ),
            proxy: Type.Optional(Type.String({ description: "Proxy URL (http:// or socks5://)" })),
            proxy_file: Type.Optional(
                Type.String({
                    description:
                        "File with proxies (host:port:user:pass, one per line). Rotates per request",
                }),
            ),
            browser: Type.Optional(StringEnum(["chrome", "firefox", "safari-ios", "random"])),
            header: Type.Optional(
                Type.String({
                    description: 'Custom header (repeatable, e.g. "Cookie: foo=bar")',
                }),
            ),
            cookie: Type.Optional(
                Type.String({
                    description: 'Cookie string (shorthand for header "Cookie: ...")',
                }),
            ),
            cookie_file: Type.Optional(
                Type.String({
                    description: "JSON cookie file (Chrome extension format)",
                }),
            ),
            raw_html: Type.Optional(
                Type.Boolean({
                    description: "Output raw fetched HTML instead of extracting",
                }),
            ),
            verbose: Type.Optional(Type.Boolean({ description: "Enable verbose logging" })),
            cloud: Type.Optional(
                Type.Boolean({
                    description: "Force all requests through the cloud API (skip local extraction)",
                }),
            ),
            output_dir: Type.Optional(
                Type.String({
                    description: "Save output to directory instead of stdout",
                }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args: string[] = [];

            if (params.file) {
                args.push("--file", params.file);
            } else if (params.url) {
                args.push(params.url);
            }

            args.push("-f", params.format ?? "llm");

            if (params.stdin) {
                args.push("--stdin");
            }
            if (params.only_main_content !== false && !params.file && !params.stdin) {
                args.push("--only-main-content");
            }
            if (params.include_selectors) {
                args.push("--include", params.include_selectors);
            }
            if (params.exclude_selectors) {
                args.push("--exclude", params.exclude_selectors);
            }
            if (params.metadata) {
                args.push("--metadata");
            }

            pushSharedArgs(args, params);

            return execWebclaw(args, signal);
        },
    });

    // --- webclaw_batch ---
    pi.registerTool({
        name: "webclaw_batch",
        label: "Webclaw Batch",
        description:
            "Extract content from multiple URLs in one call. Pass URLs directly or from a file. " +
            "Supports all scrape options (proxy, headers, cookies, etc.).",
        promptSnippet: "Extract content from multiple URLs at once",
        promptGuidelines: [
            "Use webclaw_batch when you need to scrape multiple pages at once.",
            "Prefer webclaw_batch over calling webclaw_scrape multiple times.",
        ],
        parameters: Type.Object({
            urls: Type.Optional(Type.Array(Type.String(), { description: "URLs to scrape" })),
            urls_file: Type.Optional(Type.String({ description: "File with URLs (one per line)" })),
            format: Type.Optional(StringEnum(["llm", "markdown", "text", "json", "html"])),
            pdf_mode: Type.Optional(
                StringEnum(["auto", "fast"], {
                    description: "PDF extraction mode. Default: auto",
                }),
            ),
            only_main_content: Type.Optional(
                Type.Boolean({
                    description: "Extract only the main content area. Default: true",
                }),
            ),
            metadata: Type.Optional(Type.Boolean({ description: "Include metadata in output" })),
            timeout: Type.Optional(
                Type.Number({ description: "Request timeout in seconds. Default: 30" }),
            ),
            proxy: Type.Optional(Type.String({ description: "Proxy URL (http:// or socks5://)" })),
            proxy_file: Type.Optional(
                Type.String({ description: "File with proxies for rotation" }),
            ),
            browser: Type.Optional(StringEnum(["chrome", "firefox", "safari-ios", "random"])),
            header: Type.Optional(Type.String({ description: "Custom header" })),
            cookie: Type.Optional(Type.String({ description: "Cookie string" })),
            cookie_file: Type.Optional(Type.String({ description: "JSON cookie file" })),
            verbose: Type.Optional(Type.Boolean({ description: "Enable verbose logging" })),
            cloud: Type.Optional(Type.Boolean({ description: "Force cloud API" })),
            output_dir: Type.Optional(
                Type.String({ description: "Save each page to a separate file" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args: string[] = [];

            if (params.urls && params.urls.length > 0) {
                args.push(...params.urls);
            }
            if (params.urls_file) {
                args.push("--urls-file", params.urls_file);
            }

            args.push("-f", params.format ?? "json");

            if (params.pdf_mode) {
                args.push("--pdf-mode", params.pdf_mode);
            }
            if (params.only_main_content !== false) {
                args.push("--only-main-content");
            }
            if (params.metadata) {
                args.push("--metadata");
            }

            pushSharedArgs(args, params);

            // Batch with many URLs needs more time
            const urlCount = params.urls?.length ?? 5;
            const batchTimeout = Math.max(SCRAPE_TIMEOUT, urlCount * 15_000);

            return execWebclaw(args, signal, batchTimeout);
        },
    });

    // =====================================================
    // Crawling
    // =====================================================

    // --- webclaw_crawl ---
    pi.registerTool({
        name: "webclaw_crawl",
        label: "Webclaw Crawl",
        description:
            "Recursively crawl a website and extract content from multiple pages. " +
            "Follows same-origin links up to the specified depth. " +
            "Supports crawl state persistence for resume after interruption.",
        promptSnippet: "Crawl a website and extract content from multiple pages",
        promptGuidelines: [
            "Use webclaw_map first to discover URLs, then crawl with targeted depth.",
        ],
        parameters: Type.Object({
            url: Type.String({ description: "Starting URL to crawl" }),
            depth: Type.Optional(Type.Number({ description: "Maximum crawl depth. Default: 1" })),
            max_pages: Type.Optional(
                Type.Number({ description: "Maximum pages to crawl. Default: 20" }),
            ),
            format: Type.Optional(StringEnum(["llm", "markdown", "text", "json", "html"])),
            concurrency: Type.Optional(
                Type.Number({ description: "Max concurrent requests. Default: 5" }),
            ),
            delay: Type.Optional(
                Type.Number({
                    description: "Delay between requests in ms. Default: 100",
                }),
            ),
            path_prefix: Type.Optional(
                Type.String({
                    description: "Only crawl URLs matching this path prefix",
                }),
            ),
            include_paths: Type.Optional(
                Type.String({
                    description:
                        'Glob patterns for paths to include (comma-separated, e.g. "/api/*")',
                }),
            ),
            exclude_paths: Type.Optional(
                Type.String({
                    description: "Glob patterns for paths to exclude (comma-separated)",
                }),
            ),
            sitemap: Type.Optional(
                Type.Boolean({
                    description: "Seed crawl frontier from sitemap discovery",
                }),
            ),
            crawl_state: Type.Optional(
                Type.String({
                    description:
                        "Path to save/resume crawl state. On Ctrl+C: saves progress. On start: resumes if file exists",
                }),
            ),
            timeout: Type.Optional(
                Type.Number({ description: "Request timeout in seconds. Default: 30" }),
            ),
            proxy: Type.Optional(Type.String({ description: "Proxy URL (http:// or socks5://)" })),
            proxy_file: Type.Optional(
                Type.String({ description: "File with proxies for rotation" }),
            ),
            browser: Type.Optional(StringEnum(["chrome", "firefox", "safari-ios", "random"])),
            header: Type.Optional(Type.String({ description: "Custom header" })),
            cookie: Type.Optional(Type.String({ description: "Cookie string" })),
            cookie_file: Type.Optional(Type.String({ description: "JSON cookie file" })),
            verbose: Type.Optional(Type.Boolean({ description: "Enable verbose logging" })),
            cloud: Type.Optional(Type.Boolean({ description: "Force cloud API" })),
            output_dir: Type.Optional(
                Type.String({ description: "Save each page to a separate file" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = [params.url, "-f", params.format ?? "llm", "--crawl"];

            if (params.depth !== undefined) {
                args.push("--depth", String(params.depth));
            }
            if (params.max_pages !== undefined) {
                args.push("--max-pages", String(params.max_pages));
            }
            if (params.concurrency !== undefined) {
                args.push("--concurrency", String(params.concurrency));
            }
            if (params.delay !== undefined) {
                args.push("--delay", String(params.delay));
            }
            if (params.path_prefix) {
                args.push("--path-prefix", params.path_prefix);
            }
            if (params.include_paths) {
                args.push("--include-paths", params.include_paths);
            }
            if (params.exclude_paths) {
                args.push("--exclude-paths", params.exclude_paths);
            }
            if (params.sitemap) {
                args.push("--sitemap");
            }
            if (params.crawl_state) {
                args.push("--crawl-state", params.crawl_state);
            }

            pushSharedArgs(args, params);

            return execWebclaw(args, signal, CRAWL_TIMEOUT);
        },
    });

    // --- webclaw_map ---
    pi.registerTool({
        name: "webclaw_map",
        label: "Webclaw Map",
        description:
            "Discover all URLs on a website via sitemap and link discovery. " +
            "Returns a list of URLs without extracting content.",
        promptSnippet: "Discover all URLs on a website",
        promptGuidelines: [
            "Use webclaw_map before webclaw_crawl to understand a site's structure.",
        ],
        parameters: Type.Object({
            url: Type.String({ description: "URL to map" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execWebclaw([params.url, "--map", "-f", "json"], signal);
        },
    });

    // =====================================================
    // Structured extraction
    // =====================================================

    // --- webclaw_extract ---
    pi.registerTool({
        name: "webclaw_extract",
        label: "Webclaw Extract",
        description:
            "Extract structured data from a web page using a natural language prompt or JSON schema. " +
            "Uses LLM to pull specific information into structured output.",
        promptSnippet: "Extract structured data from a web page",
        promptGuidelines: [
            "Use webclaw_extract when you need specific structured data (prices, names, specs) rather than full content.",
        ],
        parameters: Type.Object({
            url: Type.String({ description: "URL to extract data from" }),
            prompt: Type.Optional(
                Type.String({
                    description: "Natural language description of what to extract",
                }),
            ),
            json_schema: Type.Optional(
                Type.String({
                    description: "JSON schema string or @file for structured extraction",
                }),
            ),
            timeout: Type.Optional(
                Type.Number({ description: "Request timeout in seconds. Default: 30" }),
            ),
            proxy: Type.Optional(Type.String({ description: "Proxy URL" })),
            browser: Type.Optional(StringEnum(["chrome", "firefox", "safari-ios", "random"])),
            verbose: Type.Optional(Type.Boolean({ description: "Enable verbose logging" })),
        }),
        async execute(_toolCallId, params, signal) {
            const args = [params.url, "-f", "json"];

            if (params.prompt) {
                args.push("--extract-prompt", params.prompt);
            }
            if (params.json_schema) {
                args.push("--extract-json", params.json_schema);
            }

            pushSharedArgs(args, params);

            return execWebclaw(args, signal);
        },
    });

    // --- webclaw_brand ---
    pi.registerTool({
        name: "webclaw_brand",
        label: "Webclaw Brand",
        description:
            "Extract brand identity from a website: colors, fonts, logos, and favicon. " +
            "Useful for design analysis and competitive research.",
        promptSnippet: "Extract brand identity from a website",
        promptGuidelines: [
            "Use webclaw_brand when you need visual identity information from a website.",
        ],
        parameters: Type.Object({
            url: Type.String({ description: "URL to analyze for brand identity" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execWebclaw([params.url, "--brand"], signal);
        },
    });

    // --- webclaw_vertical ---
    pi.registerTool({
        name: "webclaw_vertical",
        label: "Webclaw Vertical",
        description:
            "Run a vertical extractor by name. Returns typed JSON with fields specific " +
            "to the target site (title, price, author, rating) rather than generic markdown. " +
            "28 extractors available: reddit, github_repo, amazon_product, arxiv, npm, etc.",
        promptSnippet: "Extract structured data using a vertical extractor",
        promptGuidelines: [
            "Use webclaw_vertical for site-specific structured extraction (e.g., Amazon products, Hacker News posts, GitHub repos).",
            "Run webclaw_extractors first to see available vertical extractors and their supported URL patterns.",
            "Much more reliable than generic scraping for supported sites because extractors understand page structure.",
        ],
        parameters: Type.Object({
            extractor: Type.String({
                description: "Vertical extractor name (e.g. reddit, github_repo, amazon_product)",
            }),
            url: Type.String({ description: "URL to extract from" }),
        }),
        async execute(_toolCallId, params, signal) {
            return execWebclaw(["vertical", params.extractor, params.url], signal);
        },
    });

    // --- webclaw_extractors ---
    pi.registerTool({
        name: "webclaw_extractors",
        label: "Webclaw Extractors",
        description:
            "List all vertical extractors in the webclaw catalog (28 available). " +
            "Use to discover available site-specific extractors before using webclaw_vertical.",
        promptSnippet: "List available vertical extractors",
        promptGuidelines: [
            "Use webclaw_extractors to see what site-specific extractors are available.",
        ],
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, signal) {
            return execWebclaw(["extractors", "--json"], signal);
        },
    });

    // =====================================================
    // Research & summarization
    // =====================================================

    // --- webclaw_research ---
    pi.registerTool({
        name: "webclaw_research",
        label: "Webclaw Research",
        description:
            "Run deep research on a topic via the webclaw cloud API. Produces a full report " +
            "with sources and findings. Requires WEBCLAW_API_KEY.",
        promptSnippet: "Deep research on a topic",
        promptGuidelines: [
            "Use webclaw_research when you need a comprehensive, multi-source report on a topic.",
        ],
        parameters: Type.Object({
            topic: Type.String({ description: "Research topic or question" }),
            deep: Type.Optional(
                Type.Boolean({
                    description:
                        "Enable deep research mode (longer, more thorough). Default: false",
                }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["--research", params.topic];

            if (params.deep) {
                args.push("--deep");
            }

            return execWebclaw(args, signal, RESEARCH_TIMEOUT);
        },
    });

    // --- webclaw_summarize ---
    pi.registerTool({
        name: "webclaw_summarize",
        label: "Webclaw Summarize",
        description:
            "Summarize web page content using LLM. Returns a concise summary of the given number of sentences.",
        promptSnippet: "Summarize a web page",
        promptGuidelines: [
            "Use webclaw_summarize when you need a quick summary instead of the full page content.",
        ],
        parameters: Type.Object({
            url: Type.String({ description: "URL to summarize" }),
            sentences: Type.Optional(
                Type.Number({ description: "Number of summary sentences. Default: 3" }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const sentences = params.sentences ?? 3;
            return execWebclaw([params.url, "--summarize", String(sentences)], signal);
        },
    });

    // =====================================================
    // Change tracking
    // =====================================================

    // --- webclaw_diff ---
    pi.registerTool({
        name: "webclaw_diff",
        label: "Webclaw Diff",
        description:
            "Compare current page content against a previous JSON snapshot. " +
            "Reports differences in content, structure, or data.",
        promptSnippet: "Compare a web page against a previous snapshot",
        promptGuidelines: ["Use webclaw_diff to track changes on a web page over time."],
        parameters: Type.Object({
            url: Type.String({ description: "URL to fetch and compare" }),
            snapshot: Type.String({
                description: "Previous JSON snapshot to diff against",
            }),
        }),
        async execute(_toolCallId, params, signal) {
            return execWebclaw([params.url, "--diff-with", params.snapshot, "-f", "json"], signal);
        },
    });

    // --- webclaw_watch ---
    pi.registerTool({
        name: "webclaw_watch",
        label: "Webclaw Watch",
        description:
            "Watch a URL for changes at a specified interval. Reports diffs when changes are detected. " +
            "Can POST to a webhook or run a command on change.",
        promptSnippet: "Watch a URL for changes",
        promptGuidelines: ["Use webclaw_watch to monitor a page for content changes."],
        parameters: Type.Object({
            url: Type.String({ description: "URL to watch" }),
            interval: Type.Optional(
                Type.Number({ description: "Check interval in seconds. Default: 300" }),
            ),
            webhook: Type.Optional(
                Type.String({
                    description: "Webhook URL to POST JSON payload on change",
                }),
            ),
            on_change: Type.Optional(
                Type.String({
                    description:
                        "Command to run when changes detected (receives diff JSON on stdin)",
                }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = [params.url, "--watch"];

            if (params.interval !== undefined) {
                args.push("--watch-interval", String(params.interval));
            }
            if (params.webhook) {
                args.push("--webhook", params.webhook);
            }
            if (params.on_change) {
                args.push("--on-change", params.on_change);
            }

            // Watch runs indefinitely; caller should use signal to stop
            return execWebclaw(args, signal, CRAWL_TIMEOUT);
        },
    });

    // =====================================================
    // Benchmarking
    // =====================================================

    // --- webclaw_bench ---
    pi.registerTool({
        name: "webclaw_bench",
        label: "Webclaw Bench",
        description:
            "Benchmark extraction quality for a URL. Compares raw HTML vs. LLM-optimized output " +
            "on token count, bytes, and extraction time.",
        promptSnippet: "Benchmark extraction quality for a URL",
        promptGuidelines: [
            "Use webclaw_bench to compare extraction performance across URLs or configurations.",
        ],
        parameters: Type.Object({
            url: Type.String({ description: "URL to benchmark" }),
            json: Type.Optional(
                Type.Boolean({
                    description: "Emit single JSON line instead of ASCII table",
                }),
            ),
        }),
        async execute(_toolCallId, params, signal) {
            const args = ["bench", params.url];

            if (params.json) {
                args.push("--json");
            }

            return execWebclaw(args, signal);
        },
    });
}
